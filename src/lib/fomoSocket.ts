/**
 * Client for fomo's own token-list WebSocket.
 *
 * Why we connect ourselves rather than observe fomo's socket: fomo subscribes to exactly
 * one list at a time — whichever tab its side panel has open. Verified live: switching to
 * Bonding stopped `trending_tokens` at 12 frames while `pre_graduated_tokens` climbed past
 * 100. Passive mirroring can therefore only ever fill one column, never three.
 *
 * So we open one connection and subscribe to all three topics. Same endpoint, same data,
 * same ordering as fomo — we are simply a second client of the user's own session.
 *
 * Protocol, read out of fomo's bundle and confirmed against live frames:
 *   server {type:"challenge"}          -> we {type:"challengeResponse", jwt}
 *   server {type:"challengeAccepted"}  -> we {type:"subscribe", topicType, topicId}
 *   server {type:"data", topicType, topicId, payload:{kind,...}}
 *
 * The JWT is read from the page's own localStorage at connect time, sent only to fomo's
 * own API, held in a local variable, and never persisted or logged.
 *
 * Liveness: a socket can die without a `close` — laptop sleep, a network change, or a
 * server that answers the challenge with an `error` frame and then just sits there. Any
 * of those used to leave the columns frozen while the status still read "authenticated".
 * So: an `error` frame closes the socket (the close handler reconnects), the handshake has
 * a deadline, an idle watchdog reconnects when no frame has arrived for a while, and
 * `online` / the tab becoming visible reconnect immediately instead of waiting out a
 * backoff timer.
 */

import { readJwt } from '~/lib/fomoApi'
import { SUPPORTED_CHAINS, TOPIC_TO_LIST, type ListDiff, type ListKey } from '~/lib/protocol'

const WS_URL = 'wss://prod-api.fomo.family/ws'

/** The chain set fomo subscribes with — the topicId on every real frame. */
const TOPIC_ID = SUPPORTED_CHAINS

const TOPICS = Object.keys(TOPIC_TO_LIST)

/**
 * fomo's alerts feed topic. Unlike the list topics its topicId is the user's own id, and each
 * data frame's payload is one feed item rather than a diff — both verified against live frames.
 */
const ALERT_TOPIC = 'trading_activity'

/** Time allowed between opening the socket and `challengeAccepted`. */
const HANDSHAKE_TIMEOUT_MS = 10_000

/**
 * No frame for this long means the connection is dead or the server stopped talking; either
 * way a reconnect costs one snapshot and restores certainty. Trending alone streams several
 * frames a minute, so a healthy socket never trips this.
 */
const IDLE_TIMEOUT_MS = 60_000

export type SocketStatus = 'connecting' | 'authenticated' | 'closed' | 'unauthenticated'

export interface FomoSocketHandlers {
  onDiff: (list: ListKey, diff: ListDiff) => void
  onStatus: (status: SocketStatus) => void
  /** One alerts feed item, raw off the wire. Parse with parseAlert. */
  onAlert?: (payload: unknown) => void
  /** Any frame arrived (timestamp ms) — lets the UI show "stale" honestly. */
  onFrame?: (at: number) => void
}

export interface FomoSocket {
  close: () => void
  /**
   * Subscribe the alerts topic for this user. The id arrives asynchronously (from
   * /v2/users/current), so it is set after connect; reconnects resubscribe automatically.
   */
  setAlertUser: (userId: string) => void
}

export function createFomoSocket({ onDiff, onStatus, onAlert, onFrame }: FomoSocketHandlers): FomoSocket {
  let socket: WebSocket | null = null
  let closed = false
  let attempt = 0
  let retryTimer: number | undefined
  let handshakeTimer: number | undefined
  let idleTimer: number | undefined
  let ready = false
  let alertUserId: string | null = null

  function clearTimers(): void {
    if (handshakeTimer !== undefined) window.clearTimeout(handshakeTimer)
    if (idleTimer !== undefined) window.clearTimeout(idleTimer)
    handshakeTimer = undefined
    idleTimer = undefined
  }

  function subscribeAlerts(): void {
    if (!ready || alertUserId === null) return
    socket?.send(JSON.stringify({ type: 'subscribe', topicType: ALERT_TOPIC, topicId: alertUserId }))
  }

  function scheduleRetry(): void {
    if (closed || retryTimer !== undefined) return
    attempt += 1
    // Same shape as fomo's own reconnect policy: exponential, capped at 30s.
    const delay = Math.min(1000 * 2 ** Math.min(attempt, 5), 30_000)
    retryTimer = window.setTimeout(() => {
      retryTimer = undefined
      connect()
    }, delay)
  }

  /** Drop the current socket; its close handler schedules the reconnect. */
  function dropSocket(): void {
    const current = socket
    if (!current) return
    try {
      current.close()
    } catch {
      /* already gone */
    }
  }

  function armIdleWatchdog(): void {
    if (idleTimer !== undefined) window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(dropSocket, IDLE_TIMEOUT_MS)
  }

  function connect(): void {
    if (closed || socket) return

    const jwt = readJwt()
    if (!jwt) {
      onStatus('unauthenticated')
      scheduleRetry()
      return
    }

    onStatus('connecting')

    let ws: WebSocket
    try {
      ws = new WebSocket(WS_URL)
    } catch {
      scheduleRetry()
      return
    }
    socket = ws

    handshakeTimer = window.setTimeout(() => {
      if (!ready) dropSocket()
    }, HANDSHAKE_TIMEOUT_MS)

    ws.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') return
      onFrame?.(Date.now())
      armIdleWatchdog()

      let frame: Record<string, unknown>
      try {
        frame = JSON.parse(event.data) as Record<string, unknown>
      } catch {
        return
      }

      switch (frame.type) {
        case 'challenge': {
          ws.send(JSON.stringify({ type: 'challengeResponse', jwt }))
          return
        }

        case 'challengeAccepted': {
          attempt = 0
          ready = true
          if (handshakeTimer !== undefined) window.clearTimeout(handshakeTimer)
          handshakeTimer = undefined
          onStatus('authenticated')
          for (const topicType of TOPICS) {
            ws.send(JSON.stringify({ type: 'subscribe', topicType, topicId: TOPIC_ID }))
          }
          subscribeAlerts()
          return
        }

        case 'data': {
          const topicType = frame.topicType
          if (typeof topicType !== 'string') return

          if (topicType === ALERT_TOPIC) {
            onAlert?.(frame.payload)
            return
          }

          const list = TOPIC_TO_LIST[topicType]
          if (!list) return

          const payload = frame.payload
          if (typeof payload !== 'object' || payload === null) return
          const kind = (payload as { kind?: unknown }).kind
          if (kind !== 'snapshot' && kind !== 'new' && kind !== 'update' && kind !== 'remove') return

          onDiff(list, payload as ListDiff)
          return
        }

        case 'error': {
          // A bad subscription or an expired token. The server does not always close after
          // this, so close ourselves — the close handler re-reads the JWT and reconnects.
          dropSocket()
          return
        }

        default:
          return
      }
    })

    ws.addEventListener('close', () => {
      if (socket !== ws) return
      ready = false
      clearTimers()
      socket = null
      onStatus('closed')
      scheduleRetry()
    })

    ws.addEventListener('error', () => {
      // 'close' always follows; retry is scheduled there.
    })
  }

  /** The network came back or the tab is visible again: do not wait out a backoff timer. */
  function reconnectNow(): void {
    if (closed || socket) return
    if (retryTimer !== undefined) {
      window.clearTimeout(retryTimer)
      retryTimer = undefined
    }
    connect()
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') reconnectNow()
  }
  window.addEventListener('online', reconnectNow)
  document.addEventListener('visibilitychange', onVisible)

  connect()

  return {
    close: () => {
      closed = true
      window.removeEventListener('online', reconnectNow)
      document.removeEventListener('visibilitychange', onVisible)
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      retryTimer = undefined
      clearTimers()
      const current = socket
      socket = null
      try {
        current?.close()
      } catch {
        /* already gone */
      }
    },
    setAlertUser: (userId: string) => {
      if (userId === alertUserId) return
      alertUserId = userId
      subscribeAlerts()
    },
  }
}
