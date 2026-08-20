import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BottomBar } from '~/ui/BottomBar'
import { Column } from '~/ui/Column'
import { HoldingsBar } from '~/ui/HoldingsBar'
import { SidePanel } from '~/ui/SidePanel'
import { TopBar } from '~/ui/TopBar'
import {
  fetchAlertsPage,
  mergeAlerts,
  parseAlert,
  passesAlertsFilters,
  type AlertItem,
  type AlertsFilters,
} from '~/lib/alerts'
import { fetchFeedPage, mergeFeed, type FeedItem } from '~/lib/feed'
import { dingForAlert, unlockAudio } from '~/lib/sound'
import { WATCHLIST_POLL_MS, fetchWatchlistTokens } from '~/lib/watchlist'
import {
  applyPrefs,
  defaultAllPrefs,
  parseAmount,
  readColumnPrefs,
  saveColumnPrefs,
  type AllColumnPrefs,
  type ColumnPrefs,
} from '~/lib/columnPrefs'
import { currentUser } from '~/lib/fomoApi'
import { MAX_ROWS, applyDiff } from '~/lib/listStore'
import { createFomoSocket, type SocketStatus } from '~/lib/fomoSocket'
import { metricsFor, warm } from '~/lib/mobula'
import { LIST_KEYS, LIST_LABEL, type ListKey } from '~/lib/protocol'
import {
  readAlertsSettings,
  readPanelView,
  saveAlertsSettings,
  savePanelView,
  watchAlertsSettings,
  type AlertsFilterSettings,
  type AlertsSettings,
  type PanelView,
} from '~/lib/settings'
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

  /* ---- per-column filter & sort prefs ---- */

  // Loaded once per page load; within a session the app stays mounted across handoffs, so
  // this state alone carries terminal -> token -> terminal. No storage watcher: this app
  // instance is the only writer, and watching would echo debounced writes back over
  // whatever the user typed since.
  const [colPrefs, setColPrefs] = useState<AllColumnPrefs>(defaultAllPrefs)
  useEffect(() => {
    void readColumnPrefs().then(setColPrefs)
  }, [])

  const changePrefs = useCallback((list: ListKey, next: ColumnPrefs) => {
    setColPrefs((current) => {
      const all = { ...current, [list]: next }
      saveColumnPrefs(all)
      return all
    })
  }, [])
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

  /* ---- FOMO Panel: settings, view, backfill, live feeds ---- */

  const [alertsSettings, setAlertsSettings] = useState<AlertsSettings | null>(null)
  useEffect(() => {
    void readAlertsSettings().then(setAlertsSettings)
    return watchAlertsSettings(setAlertsSettings)
  }, [])
  const panelEnabled = alertsSettings?.enabled === true

  // The sound preference must reach the socket callback without re-running the socket
  // effect; a ref carries the latest value across renders.
  const soundRef = useRef(true)
  useEffect(() => {
    soundRef.current = alertsSettings?.sound !== false
  }, [alertsSettings])

  // AudioContext creation is gesture-gated by the browser; any pointerdown unlocks it.
  useEffect(() => {
    window.addEventListener('pointerdown', unlockAudio, { capture: true })
    return () => window.removeEventListener('pointerdown', unlockAudio, { capture: true })
  }, [])

  // The chosen view is tab-session state — it survives refreshes of this tab.
  const [panelView, setPanelView] = useState<PanelView>(readPanelView)
  const changeView = useCallback((view: PanelView) => {
    setPanelView(view)
    savePanelView(view)
  }, [])

  // Edge-drag resize: live moves only touch state; the commit on release persists, so the
  // storage watcher's echo always carries the value already rendered.
  const changeWidth = useCallback((width: number) => {
    setAlertsSettings((current) => (current ? { ...current, width } : current))
  }, [])
  const commitWidth = useCallback((width: number) => {
    setAlertsSettings((current) => {
      if (!current) return current
      const next = { ...current, width }
      saveAlertsSettings(next)
      return next
    })
  }, [])

  // fomo's filters for both live views, edited in the panel header and persisted with the
  // rest of the panel settings.
  const changeFeedGroups = useCallback((feedDisabledGroups: string[]) => {
    setAlertsSettings((current) => {
      if (!current) return current
      const next = { ...current, feedDisabledGroups }
      saveAlertsSettings(next)
      return next
    })
  }, [])
  const changeAlertsFilters = useCallback((alertsFilters: AlertsFilterSettings) => {
    setAlertsSettings((current) => {
      if (!current) return current
      const next = { ...current, alertsFilters }
      saveAlertsSettings(next)
      return next
    })
  }, [])

  /** The raw filter strings parsed to the numbers fomo's endpoint takes ("1k" -> 1000). */
  const alertsFilters = useMemo<AlertsFilters>(() => {
    const raw = alertsSettings?.alertsFilters
    if (!raw) return {}
    return {
      threshold: parseAmount(raw.threshold),
      minEquity: parseAmount(raw.minEquity),
      minMarketCap: parseAmount(raw.minMarketCap),
      maxMarketCap: parseAmount(raw.maxMarketCap),
    }
  }, [alertsSettings])
  const alertsFiltersRef = useRef(alertsFilters)
  useEffect(() => {
    alertsFiltersRef.current = alertsFilters
  }, [alertsFilters])
  const alertsFiltersKey = JSON.stringify(alertsFilters)

  const feedGroupsKey = JSON.stringify(alertsSettings?.feedDisabledGroups ?? [])
  const feedGroupsRef = useRef<string[]>([])
  useEffect(() => {
    feedGroupsRef.current = alertsSettings?.feedDisabledGroups ?? []
  }, [alertsSettings])

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

  // Runs once the settings have loaded (the filters come from them), and again whenever
  // the filters change — the server owns filtering, so a change means a fresh backfill.
  useEffect(() => {
    if (!alertsSettings) return
    let cancelled = false
    setAlerts([])
    setAlertsLoading(true)
    setAlertsHasMore(false)
    alertsLastId.current = undefined
    void fetchAlertsPage(undefined, alertsFiltersRef.current).then((page) => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the parsed filters
  }, [alertsSettings !== null && alertsFiltersKey])

  const loadMoreAlerts = useCallback(() => {
    const lastId = alertsLastId.current
    if (!lastId || Date.now() < alertsRetryAt.current) return
    setAlertsLoadingMore(true)
    void fetchAlertsPage(lastId, alertsFiltersRef.current).then((page) => {
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

  /* ---- watchlist view: fomo's own ids + row data, polled on fomo's cadence ---- */

  const [watchTokens, setWatchTokens] = useState<Token[] | null>(null)
  const [watchLoading, setWatchLoading] = useState(false)
  useEffect(() => {
    if (panelView !== 'watchlist' || !panelEnabled) return
    let cancelled = false
    setWatchLoading(true)
    const load = () =>
      void fetchWatchlistTokens().then((tokens) => {
        if (cancelled) return
        setWatchLoading(false)
        // A failed refresh keeps the last good list on screen rather than blanking it.
        if (tokens !== null) setWatchTokens(tokens)
        else setWatchTokens((current) => current)
      })
    load()
    const id = window.setInterval(load, WATCHLIST_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [panelView, panelEnabled])

  /* ---- feed view: first page + slow refresh + demand paging, like the alerts ---- */

  const [feedItems, setFeedItems] = useState<FeedItem[]>([])
  const [feedLoading, setFeedLoading] = useState(true)
  const [feedHasMore, setFeedHasMore] = useState(false)
  const [feedLoadingMore, setFeedLoadingMore] = useState(false)
  const feedLastId = useRef<string | undefined>(undefined)
  const feedRetryAt = useRef(0)

  useEffect(() => {
    if (panelView !== 'feed' || !panelEnabled) return
    let cancelled = false
    // A groups change re-keys this effect: start over, the server owns membership.
    setFeedItems([])
    setFeedLoading(true)
    setFeedHasMore(false)
    feedLastId.current = undefined
    const load = () =>
      void fetchFeedPage(undefined, feedGroupsRef.current).then((page) => {
        if (cancelled) return
        setFeedLoading(false)
        if (!page) return
        feedLastId.current = feedLastId.current ?? page.lastId
        setFeedItems((current) => mergeFeed(current, page.items))
        setFeedHasMore((had) => had || page.hasMore)
      })
    load()
    const id = window.setInterval(load, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the disabled groups
  }, [panelView, panelEnabled, feedGroupsKey])

  const loadMoreFeed = useCallback(() => {
    const lastId = feedLastId.current
    if (!lastId || Date.now() < feedRetryAt.current) return
    setFeedLoadingMore(true)
    void fetchFeedPage(lastId, feedGroupsRef.current).then((page) => {
      setFeedLoadingMore(false)
      if (!page) {
        feedRetryAt.current = Date.now() + 30_000
        return
      }
      feedLastId.current = page.lastId ?? feedLastId.current
      setFeedItems((current) => mergeFeed(current, page.items))
      setFeedHasMore(page.hasMore)
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
        // The socket topic is unfiltered; re-apply the backfill's bounds to live frames.
        if (!passesAlertsFilters(item, alertsFiltersRef.current)) return
        markFresh(item.id)
        // fomo's own ding, for live alerts only — backfill stays silent (see lib/sound.ts).
        if (soundRef.current) dingForAlert(item.createdAtMs)
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
    // Watchlist chains warm too, so its cards can carry the same holder metrics.
    for (const token of watchTokens ?? []) ids.add(token.networkId)
    return [...ids].sort().join(',')
  }, [lists, watchTokens])

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
   * Left join: fomo owns membership and order, Mobula only decorates. The user's prefs
   * then narrow (filters) or re-order (an explicit sort) that stream — with defaults this
   * is a no-op and fomo's order renders untouched.
   *
   * The 100-row cap stays at the render boundary, exactly as fomo does it, but is applied
   * AFTER filtering: the whole store is filtered, so "min 10k MC" surfaces matching rows
   * from beyond the first hundred instead of just thinning the visible page. Decoration
   * runs on the full list for the same reason — the holders filter needs metrics on every
   * candidate row, and metricsFor is a map lookup.
   */
  const enriched = useMemo(() => {
    void enrichStamp
    const now = Date.now()
    const build = (key: ListKey) =>
      applyPrefs(
        lists[key].map((token) => {
          const metrics = metricsFor(token.key, token.networkId)
          return metrics ? { ...token, metrics } : token
        }),
        colPrefs[key],
        now,
      ).slice(0, MAX_ROWS)
    return {
      'pre-graduated': build('pre-graduated'),
      graduated: build('graduated'),
      trending: build('trending'),
    } satisfies Lists
  }, [lists, enrichStamp, colPrefs])

  // Same left join for the watchlist cards: fomo owns the list, Mobula only decorates.
  const watchEnriched = useMemo(() => {
    void enrichStamp
    if (watchTokens === null) return null
    return watchTokens.map((token) => {
      const metrics = metricsFor(token.key, token.networkId)
      return metrics ? { ...token, metrics } : token
    })
  }, [watchTokens, enrichStamp])

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

      <HoldingsBar onNavigate={onOpen} />

      <div className="main" data-alerts-side={alertsSettings?.enabled ? alertsSettings.side : undefined}>
        {alertsSettings?.enabled && (
          <div className="alerts-slot" style={{ width: alertsSettings.width }}>
            <SidePanel
              view={panelView}
              onViewChange={changeView}
              side={alertsSettings.side}
              width={alertsSettings.width}
              onWidthChange={changeWidth}
              onWidthCommit={commitWidth}
              alerts={alerts}
              alertsLoading={alertsLoading}
              alertsHasMore={alertsHasMore}
              alertsLoadingMore={alertsLoadingMore}
              freshKeys={freshKeys}
              onLoadMoreAlerts={loadMoreAlerts}
              watchlist={watchEnriched}
              watchlistLoading={watchLoading}
              feed={feedItems}
              feedLoading={feedLoading}
              feedHasMore={feedHasMore}
              feedLoadingMore={feedLoadingMore}
              onLoadMoreFeed={loadMoreFeed}
              feedDisabledGroups={alertsSettings.feedDisabledGroups}
              alertsFilters={alertsSettings.alertsFilters}
              onFeedGroupsChange={changeFeedGroups}
              onAlertsFiltersChange={changeAlertsFilters}
              onOpen={onOpen}
              onOpenToken={open}
            />
          </div>
        )}
        <div className="columns">
          {LIST_KEYS.map((key) => (
            <Column
              key={key}
              list={key}
              title={LIST_LABEL[key]}
              tokens={enriched[key]}
              total={lists[key].length}
              loading={totalRows === 0 && status !== 'unauthenticated'}
              showBond={key === 'pre-graduated'}
              freshKeys={freshKeys}
              prefs={colPrefs[key]}
              onPrefsChange={(next) => changePrefs(key, next)}
              onOpen={open}
            />
          ))}
        </div>
      </div>

      <BottomBar onNavigate={onOpen} />
    </div>
  )
}
