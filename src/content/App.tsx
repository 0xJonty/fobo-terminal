import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertsPanel } from '~/ui/AlertsPanel'
import { BottomBar } from '~/ui/BottomBar'
import { Column } from '~/ui/Column'
import { TopBar } from '~/ui/TopBar'
import { fetchAlertsPage, mergeAlerts, parseAlert, type AlertItem } from '~/lib/alerts'
import { currentUser } from '~/lib/fomoApi'
import { MAX_ROWS, applyDiff } from '~/lib/listStore'
import { createFomoSocket, type SocketStatus } from '~/lib/fomoSocket'
import { metricsFor, warm } from '~/lib/mobula'
import { LIST_KEYS, LIST_LABEL, type ListKey } from '~/lib/protocol'
import { readAlertsSettings, watchAlertsSettings, type AlertsSettings } from '~/lib/settings'
import { tokenKey, type Token } from '~/types/token'

type Lists = Record<ListKey, Token[]>

const EMPTY: Lists = { 'pre-graduated': [], graduated: [], trending: [] }

/** How long a newly inserted row stays highlighted. */
const FRESH_MS = 900

export function App({
  onOpen,
  onDeposit,
}: {
  onOpen: (href: string) => void
  onDeposit: () => void
}) {
  const [lists, setLists] = useState<Lists>(EMPTY)
  const [status, setStatus] = useState<SocketStatus>('connecting')
  const [freshKeys, setFreshKeys] = useState<ReadonlySet<string>>(new Set())
  const freshTimers = useRef(new Map<string, number>())

  const markFresh = useCallback((key: string) => {
    setFreshKeys((current) => {
      if (current.has(key)) return current
      const next = new Set(current)
      next.add(key)
      return next
    })

    const timers = freshTimers.current
    const existing = timers.get(key)
    if (existing) window.clearTimeout(existing)
    timers.set(
      key,
      window.setTimeout(() => {
        timers.delete(key)
        setFreshKeys((current) => {
          if (!current.has(key)) return current
          const next = new Set(current)
          next.delete(key)
          return next
        })
      }, FRESH_MS),
    )
  }, [])

  /* ---- alerts panel: settings, backfill, live feed ---- */

  const [alertsSettings, setAlertsSettings] = useState<AlertsSettings | null>(null)
  useEffect(() => {
    void readAlertsSettings().then(setAlertsSettings)
    return watchAlertsSettings(setAlertsSettings)
  }, [])

  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [alertsLoading, setAlertsLoading] = useState(true)
  const [alertsHasMore, setAlertsHasMore] = useState(false)
  const [alertsLoadingMore, setAlertsLoadingMore] = useState(false)
  // fomo pages by the last RAW item's id, which our parse filtering must not lose.
  const alertsLastId = useRef<string | undefined>(undefined)
  // After a failed page fetch, hold off before retrying. Without this the panel's
  // load-more effect refires on the loadingMore state toggle and, with the user parked at
  // the list bottom, spins a tight fetch loop against a failing endpoint.
  const alertsRetryAt = useRef(0)

  useEffect(() => {
    let cancelled = false
    void fetchAlertsPage().then((page) => {
      if (cancelled || !page) {
        if (!cancelled) setAlertsLoading(false)
        return
      }
      alertsLastId.current = page.lastId
      setAlerts((current) => mergeAlerts(current, page.items))
      setAlertsHasMore(page.hasNextPage)
      setAlertsLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const loadMoreAlerts = useCallback(() => {
    const lastId = alertsLastId.current
    if (!lastId || Date.now() < alertsRetryAt.current) return
    setAlertsLoadingMore(true)
    void fetchAlertsPage(lastId).then((page) => {
      setAlertsLoadingMore(false)
      if (!page) {
        alertsRetryAt.current = Date.now() + 30_000
        return
      }
      alertsLastId.current = page.lastId ?? alertsLastId.current
      setAlerts((current) => mergeAlerts(current, page.items))
      setAlertsHasMore(page.hasNextPage)
    })
  }, [])

  // One socket, all list topics plus the alerts feed. See lib/fomoSocket.ts for why we
  // connect rather than observe.
  useEffect(() => {
    const socket = createFomoSocket({
      onStatus: setStatus,
      onDiff: (list, diff) => {
        if (diff.kind === 'new') {
          const raw = diff.update as { token?: { address?: string; networkId?: number } }
          const address = raw?.token?.address
          const networkId = raw?.token?.networkId
          if (typeof address === 'string' && typeof networkId === 'number') {
            markFresh(tokenKey(address, networkId))
          }
        }
        setLists((current) => ({ ...current, [list]: applyDiff(current[list], diff) }))
      },
      onAlert: (payload) => {
        const item = parseAlert(payload)
        if (!item) return
        markFresh(item.id)
        setAlerts((current) => mergeAlerts(current, [item]))
      },
    })
    // The alerts topic wants the user's own id, which only the API knows.
    void currentUser().then((user) => {
      if (user) socket.setAlertUser(user.id)
    })
    return socket.close
  }, [markFresh])

  useEffect(() => {
    const timers = freshTimers.current
    return () => {
      for (const id of timers.values()) window.clearTimeout(id)
      timers.clear()
    }
  }, [])

  // Warm Mobula for whichever chains are actually on screen, then re-render when it lands.
  const [enrichStamp, setEnrichStamp] = useState(0)
  const networkIds = useMemo(() => {
    const ids = new Set<number>()
    for (const key of LIST_KEYS) {
      for (const token of lists[key].slice(0, MAX_ROWS)) ids.add(token.networkId)
    }
    return [...ids].sort().join(',')
  }, [lists])

  useEffect(() => {
    if (!networkIds) return
    const ids = networkIds.split(',').map(Number)

    warm(ids)
    const settle = window.setTimeout(() => setEnrichStamp((n) => n + 1), 2_000)
    const id = window.setInterval(() => {
      warm(ids)
      setEnrichStamp((n) => n + 1)
    }, 30_000)
    return () => {
      window.clearTimeout(settle)
      window.clearInterval(id)
    }
  }, [networkIds])

  /**
   * Left join: fomo owns membership and order, Mobula only decorates.
   * The 100-row cap is applied here, at the render boundary, exactly as fomo does it.
   */
  const enriched = useMemo(() => {
    void enrichStamp
    const decorate = (rows: Token[]) =>
      rows.slice(0, MAX_ROWS).map((token) => {
        const metrics = metricsFor(token.key, token.networkId)
        return metrics ? { ...token, metrics } : token
      })
    return {
      'pre-graduated': decorate(lists['pre-graduated']),
      graduated: decorate(lists.graduated),
      trending: decorate(lists.trending),
    } satisfies Lists
  }, [lists, enrichStamp])

  const open = useCallback(
    (token: Token) => {
      // Navigation mechanics (client-side pushState with a full-load fallback) and the handoff
      // bookkeeping both live in content/index.tsx — this only builds the href. Nothing is
      // dismissed on the way out, so Back remounts the terminal.
      onOpen(`/tokens/${token.chain}/${token.address}`)
    },
    [onOpen],
  )

  const totalRows = LIST_KEYS.reduce((sum, key) => sum + lists[key].length, 0)

  return (
    <div className="shell">
      <TopBar onNavigate={onOpen} onDeposit={onDeposit} />

      <div className="main" data-alerts-side={alertsSettings?.enabled ? alertsSettings.side : undefined}>
        {alertsSettings?.enabled && (
          <div className="alerts-slot" style={{ width: alertsSettings.width }}>
            <AlertsPanel
              alerts={alerts}
              loading={alertsLoading}
              hasMore={alertsHasMore}
              loadingMore={alertsLoadingMore}
              freshKeys={freshKeys}
              onLoadMore={loadMoreAlerts}
              onOpen={onOpen}
            />
          </div>
        )}
        <div className="columns">
          {LIST_KEYS.map((key) => (
            <Column
              key={key}
              title={LIST_LABEL[key]}
              tokens={enriched[key]}
              loading={totalRows === 0 && status !== 'unauthenticated'}
              showBond={key === 'pre-graduated'}
              freshKeys={freshKeys}
              onOpen={open}
            />
          ))}
        </div>
      </div>

      <BottomBar onNavigate={onOpen} />
    </div>
  )
}
