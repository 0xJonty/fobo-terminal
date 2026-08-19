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

export type SocketStatus = 'connecting' | 'authenticated' | 'closed' | 'unauthenticated'

export interface FomoSocketHandlers {
  onDiff: (list: ListKey, diff: ListDiff) => void
  onStatus: (status: SocketStatus) => void
  /** One alerts feed item, raw off the wire. Parse with parseAlert. */
  onAlert?: (payload: unknown) => void
}

export interface FomoSocket {
  close: () => void
  /**
   * Subscribe the alerts topic for this user. The id arrives asynchronously (from
   * /v2/users/current), so it is set after connect; reconnects resubscribe automatically.
   */
  setAlertUser: (userId: string) => void
}

export function createFomoSocket({ onDiff, onStatus, onAlert }: FomoSocketHandlers): FomoSocket {
  let socket: WebSocket | null = null
  let closed = false
  let attempt = 0
  let retryTimer: number | undefined
  let ready = false
  let alertUserId: string | null = null

  function subscribeAlerts(): void {
    if (!ready || alertUserId === null) return
    socket?.send(JSON.stringify({ type: 'subscribe', topicType: ALERT_TOPIC, topicId: alertUserId }))
  }

  function scheduleRetry(): void {
    if (closed) return
    attempt += 1
    // Same shape as fomo's own reconnect policy: exponential, capped at 30s.
    const delay = Math.min(1000 * 2 ** Math.min(attempt, 5), 30_000)
    retryTimer = window.setTimeout(connect, delay)
  }

  function connect(): void {
    if (closed) return

    const jwt = readJwt()
    if (!jwt) {
      onStatus('unauthenticated')
      scheduleRetry()
      return
    }

    onStatus('connecting')

    try {
      socket = new WebSocket(WS_URL)
    } catch {
      scheduleRetry()
      return
    }

    socket.addEventListener('message', (event: MessageEvent) => {
      if (typeof event.data !== 'string') return

      let frame: Record<string, unknown>
      try {
        frame = JSON.parse(event.data) as Record<string, unknown>
      } catch {
        return
      }

      switch (frame.type) {
        case 'challenge': {
          socket?.send(JSON.stringify({ type: 'challengeResponse', jwt }))
          return
        }

        case 'challengeAccepted': {
          attempt = 0
          ready = true
          onStatus('authenticated')
          for (const topicType of TOPICS) {
            socket?.send(JSON.stringify({ type: 'subscribe', topicType, topicId: TOPIC_ID }))
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
          // Surfaced by the server for a bad subscription or an expired token; the reconnect
          // path re-reads the JWT, so just let the socket close naturally.
          return
        }

        default:
          return
      }
    })

    socket.addEventListener('close', () => {
      ready = false
      onStatus('closed')
      socket = null
      scheduleRetry()
    })

    socket.addEventListener('error', () => {
      // 'close' always follows; retry is scheduled there.
    })
  }

  connect()

  return {
    close: () => {
      closed = true
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      try {
        socket?.close()
      } catch {
        /* already gone */
      }
      socket = null
    },
    setAlertUser: (userId: string) => {
      if (userId === alertUserId) return
      alertUserId = userId
      subscribeAlerts()
    },
  }
}
