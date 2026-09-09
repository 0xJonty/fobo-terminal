import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BottomBar } from '~/ui/BottomBar'
import { Column } from '~/ui/Column'
import { DisplaySettings as DisplaySettingsDialog } from '~/ui/DisplaySettings'
import { HoldingsBar } from '~/ui/HoldingsBar'
import { PnlCard } from '~/ui/PnlCard'
import { SidePanel } from '~/ui/SidePanel'
import { Toasts } from '~/ui/Toasts'
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
import {
  applyPrefs,
  defaultAllPrefs,
  parseAmount,
  readColumnPrefs,
  saveColumnPrefs,
  type AllColumnPrefs,
  type ColumnPrefs,
} from '~/lib/columnPrefs'
import { backfillFor, mergeToken, warmBackfill } from '~/lib/backfill'
import {
  DISPLAY_SETTINGS_EVENT,
  displayStore,
  takeDisplaySettingsRequest,
  useDisplaySettings,
} from '~/lib/displayPrefs'
import { MAX_ROWS, applyDiff } from '~/lib/listStore'
import { createFomoSocket, type SocketStatus } from '~/lib/fomoSocket'
import { setDiag } from '~/lib/host'
import { metricsFor, warm } from '~/lib/mobula'
import { readPnlSettings, watchPnlSettings } from '~/lib/pnlCard'
import { LIST_KEYS, LIST_LABEL, type ListDiff, type ListKey } from '~/lib/protocol'
import { currentUserStore, useCurrentUser, watchlistTokens } from '~/lib/session'
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
import { tokenPath } from '~/lib/url'
import { isActive, useTerminalActive } from '~/lib/visibility'
import { tokenKey, type Token } from '~/types/token'

type Lists = Record<ListKey, Token[]>

const EMPTY: Lists = { 'pre-graduated': [], graduated: [], trending: [] }

/** How long a newly inserted row stays highlighted. */
const FRESH_MS = 900

/** Mobula re-warm cadence while the terminal is on screen (its cache TTL is 60s). */
const ENRICH_MS = 30_000

/** The feed view's slow refresh, matching fomo's own cadence. */
const FEED_REFRESH_MS = 60_000

/** No socket frame for this long (while authenticated) is shown as "stale" in the columns. */
const STALE_AFTER_MS = 30_000

/** Hidden-terminal diff queue ceiling before a forced flush. */
const MAX_QUEUED_DIFFS = 1_000

/**
 * Left join: fomo owns membership and order; decoration fills what a row is missing —
 * first from fomo's own filterTokens backfill (trending rows arrive thin), then Mobula.
 */
function decorate(tokens: readonly Token[]): Token[] {
  return tokens.map((token) =>
    mergeToken(token, backfillFor(token.key), metricsFor(token.key, token.networkId)),
  )
}

export function App({
  onOpen,
  onDeposit,
  onHeaderAction,
}: {
  onOpen: (href: string) => void
  onDeposit: () => void
  onHeaderAction: (menu: 'cash' | 'profile', item: string) => void
}) {
  const [lists, setLists] = useState<Lists>(EMPTY)
  const [status, setStatus] = useState<SocketStatus>('connecting')
  const active = useTerminalActive()
  const user = useCurrentUser()

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

  /* ---- PnL card: the popup owns whether it shows ---- */

  // Null until the preference has been read, so the card never flashes on for a user who
  // switched it off. The card owns its own geometry and baseline (see ui/PnlCard.tsx); only
  // the on/off flag is watched here, and gating the mount means a hidden card subscribes to
  // nothing.
  const [pnlEnabled, setPnlEnabled] = useState<boolean | null>(null)
  useEffect(() => {
    void readPnlSettings().then((stored) => setPnlEnabled(stored.enabled))
    return watchPnlSettings((stored) => setPnlEnabled(stored.enabled))
  }, [])

  /* ---- Display settings: the cards read the store; this owns only the dialog ---- */

  // Opened from the toolbar popup. The request can arrive before this app exists — the popup
  // summons a hidden terminal on its way — so a latched request is claimed on mount as well as
  // through the event (see lib/displayPrefs.ts).
  const displaySettings = useDisplaySettings()
  const [displayOpen, setDisplayOpen] = useState(false)
  useEffect(() => {
    const open = () => {
      takeDisplaySettingsRequest()
      setDisplayOpen(true)
    }
    if (takeDisplaySettingsRequest()) setDisplayOpen(true)
    window.addEventListener(DISPLAY_SETTINGS_EVENT, open)
    return () => window.removeEventListener(DISPLAY_SETTINGS_EVENT, open)
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

  // AudioContext creation is gesture-gated by the browser, so a pointerdown inside the visible
  // terminal is the only thing that can unlock it.
  //
  // This used to skip the unlock while the sound preference was off, to avoid building a context
  // for someone who would never hear it. That made turning the sound back ON look broken: the
  // popup toggle is a gesture in the POPUP document, not in the page, so nothing unlocked audio
  // and dingForAlert kept bailing on its `context.state !== 'running'` gate — silence until the
  // user happened to click inside the terminal again. Turning sound off stayed instant (soundRef
  // guards the call site), so the control only appeared to work one way.
  //
  // Unlock on any in-terminal pointerdown while the panel is on, and let soundRef decide whether
  // a ding actually plays. The cost of being wrong is one idle AudioContext and one small
  // same-origin mp3; the cost of the old gate was a preference that did not take effect.
  useEffect(() => {
    if (!panelEnabled) return
    const unlock = () => {
      if (isActive()) unlockAudio()
    }
    window.addEventListener('pointerdown', unlock, { capture: true })
    return () => window.removeEventListener('pointerdown', unlock, { capture: true })
  }, [panelEnabled])

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
  // rest of the panel settings (the write is debounced in settings.ts).
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

  // The Display settings dialog treats the panel as the fourth column, but its on/off flag lives
  // here with the rest of the panel settings — same store the popup toggle writes, so both stay
  // in step. Ignored until the settings have loaded; the dialog cannot open before they have.
  const changePanelEnabled = useCallback((enabled: boolean) => {
    setAlertsSettings((current) => {
      if (!current) return current
      const next = { ...current, enabled }
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
  // the (debounced) filters change — the server owns filtering, so a change means a fresh
  // backfill. The list on screen stays until the new page arrives: live frames that landed
  // meanwhile are kept if they pass the new filters, everything older is replaced.
  useEffect(() => {
    if (!alertsSettings) return
    let cancelled = false
    const startedAt = Date.now()
    const filters = alertsFiltersRef.current
    setAlertsLoading(true)
    void fetchAlertsPage(undefined, filters).then((page) => {
      if (cancelled) return
      setAlertsLoading(false)
      if (!page) return
      alertsLastId.current = page.lastId
      setAlerts((current) =>
        mergeAlerts(
          page.items,
          current.filter((item) => item.createdAtMs >= startedAt && passesAlertsFilters(item, filters)),
        ),
      )
      setAlertsHasMore(page.hasNextPage)
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

  /* ---- watchlist view: a shared, visibility-gated resource (see lib/session.ts) ---- */

  const watchOn = panelView === 'watchlist' && panelEnabled
  const [watchTokens, setWatchTokens] = useState<Token[] | null>(null)
  const [watchFailed, setWatchFailed] = useState(false)
  useEffect(() => {
    if (!watchOn) return
    const read = () => {
      setWatchTokens(watchlistTokens.get())
      setWatchFailed(watchlistTokens.getStatus() === 'error')
    }
    read()
    return watchlistTokens.subscribe(read)
  }, [watchOn])

  /* ---- feed view: first page + slow refresh + demand paging, like the alerts ---- */

  const feedOn = panelView === 'feed' && panelEnabled
  const [feedItems, setFeedItems] = useState<FeedItem[]>([])
  const [feedLoading, setFeedLoading] = useState(true)
  const [feedHasMore, setFeedHasMore] = useState(false)
  const [feedLoadingMore, setFeedLoadingMore] = useState(false)
  const feedLastId = useRef<string | undefined>(undefined)
  const feedRetryAt = useRef(0)

  // A groups change re-keys this effect: start over, the server owns membership.
  useEffect(() => {
    setFeedItems([])
    setFeedLoading(true)
    setFeedHasMore(false)
    feedLastId.current = undefined
  }, [feedGroupsKey])

  useEffect(() => {
    if (!feedOn || !active) return
    let cancelled = false
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
    const id = window.setInterval(load, FEED_REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [feedOn, active, feedGroupsKey])

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

  /* ---- the socket: one connection, all list topics plus the alerts feed ---- */

  // Frames are applied in batches: a burst of trending re-orders used to mean one
  // setLists (and a full filter+sort of every column) per frame. While the terminal is
  // hidden nothing is applied at all — the diffs queue and are replayed in order when it
  // comes back, so the hidden tree does no layout work behind fomo's own page.
  const pendingDiffs = useRef<{ list: ListKey; diff: ListDiff }[]>([])
  const flushHandle = useRef<number | null>(null)
  const lastFrameAt = useRef(0)
  const [stale, setStale] = useState(false)

  const flushDiffs = useCallback(() => {
    flushHandle.current = null
    const batch = pendingDiffs.current
    if (batch.length === 0) return
    pendingDiffs.current = []
    setLists((current) => {
      const next = { ...current }
      for (const { list, diff } of batch) next[list] = applyDiff(next[list], diff)
      return next
    })
  }, [])

  const scheduleFlush = useCallback(() => {
    if (!isActive() || flushHandle.current !== null) return
    flushHandle.current = window.requestAnimationFrame(flushDiffs)
  }, [flushDiffs])

  // Replay whatever queued while hidden the moment the terminal is active again.
  useEffect(() => {
    if (active) scheduleFlush()
  }, [active, scheduleFlush])

  const socketRef = useRef<ReturnType<typeof createFomoSocket> | null>(null)
  useEffect(() => {
    const socket = createFomoSocket({
      onStatus: (next) => {
        setStatus(next)
        setDiag('socket', next)
        // The socket authenticating proves a JWT exists now — worth another try at the
        // current-user lookup if the first one raced Privy's boot.
        if (next === 'authenticated') currentUserStore.refresh()
      },
      onFrame: (at) => {
        // The attribute write is throttled: frames arrive several times a second.
        if (at - lastFrameAt.current > 1_000) setDiag('lastFrame', String(at))
        lastFrameAt.current = at
      },
      onDiff: (list, diff) => {
        if (diff.kind === 'new') {
          const raw = diff.update as { token?: { address?: string; networkId?: number } }
          const address = raw?.token?.address
          const networkId = raw?.token?.networkId
          if (typeof address === 'string' && typeof networkId === 'number') {
            markFresh(tokenKey(address, networkId))
          }
        }
        pendingDiffs.current.push({ list, diff })
        // A tab left hidden for hours must not queue without bound; past this many frames
        // apply them even though the tree is hidden (one setLists, rarely).
        if (pendingDiffs.current.length > MAX_QUEUED_DIFFS) flushDiffs()
        else scheduleFlush()
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
    socketRef.current = socket
    return () => {
      socketRef.current = null
      if (flushHandle.current !== null) window.cancelAnimationFrame(flushHandle.current)
      flushHandle.current = null
      socket.close()
    }
  }, [markFresh, scheduleFlush, flushDiffs])

  // The alerts topic wants the user's own id, which only the API knows — and the lookup
  // retries until it lands (lib/session.ts), so this fires as soon as it does.
  useEffect(() => {
    if (user) socketRef.current?.setAlertUser(user.id)
  }, [user])

  useEffect(() => {
    setDiag('active', String(active))
  }, [active])

  // "Stale" is judged only while the terminal is on screen and the socket claims to be live.
  useEffect(() => {
    if (!active || status !== 'authenticated') {
      setStale(false)
      return
    }
    const tick = () => setStale(lastFrameAt.current > 0 && Date.now() - lastFrameAt.current > STALE_AFTER_MS)
    tick()
    const id = window.setInterval(tick, 5_000)
    return () => window.clearInterval(id)
  }, [active, status])

  useEffect(() => {
    const timers = freshTimers.current
    return () => {
      for (const id of timers.values()) window.clearTimeout(id)
      timers.clear()
    }
  }, [])

  /* ---- Mobula enrichment: warm the chains on screen, re-render when it lands ---- */

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

  // The backfill needs the rows themselves (to see which still miss fields), but effects
  // must not re-run on every socket frame — a ref carries the latest list into the ticks.
  const trendingRef = useRef<Token[]>(EMPTY.trending)
  useEffect(() => {
    trendingRef.current = lists.trending
  }, [lists])

  // Trending MEMBERSHIP drives the backfill: new rows arrive thin and want a fetch soon,
  // while `update` frames only replace known rows (the sorted key signature filters the
  // per-frame re-order churn out of the effect key).
  const trendingKeys = useMemo(
    () => lists.trending.map((token) => token.key).sort().join(' '),
    [lists.trending],
  )
  useEffect(() => {
    if (!trendingKeys || !active) return
    warmBackfill(trendingRef.current)
    const settle = window.setTimeout(() => setEnrichStamp((n) => n + 1), 2_000)
    return () => window.clearTimeout(settle)
  }, [trendingKeys, active])

  useEffect(() => {
    if (!networkIds || !active) return
    const ids = networkIds.split(',').map(Number)

    warm(ids)
    const settle = window.setTimeout(() => setEnrichStamp((n) => n + 1), 2_000)
    const id = window.setInterval(() => {
      warm(ids)
      warmBackfill(trendingRef.current)
      setEnrichStamp((n) => n + 1)
    }, ENRICH_MS)
    return () => {
      window.clearTimeout(settle)
      window.clearInterval(id)
    }
  }, [networkIds, active])

  /**
   * Per column: decorate, then the user's prefs narrow (filters) or re-order (an explicit
   * sort) fomo's stream — with defaults this is a no-op and fomo's order renders untouched.
   * Memoised per list so a trending frame does not re-sort bonding and graduated.
   *
   * The 100-row cap stays at the render boundary, exactly as fomo does it, but is applied
   * AFTER filtering: the whole store is filtered, so "min 10k MC" surfaces matching rows
   * from beyond the first hundred instead of just thinning the visible page. Decoration
   * runs on the full list for the same reason — the holders filter needs metrics on every
   * candidate row, and metricsFor is a map lookup.
   */
  const bondingRaw = lists['pre-graduated']
  const bondingPrefs = colPrefs['pre-graduated']
  const bonding = useMemo(
    () => applyPrefs(decorate(bondingRaw), bondingPrefs, Date.now()).slice(0, MAX_ROWS),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enrichStamp invalidates the decoration
    [bondingRaw, bondingPrefs, enrichStamp],
  )
  const graduatedRaw = lists.graduated
  const graduatedPrefs = colPrefs.graduated
  const graduated = useMemo(
    () => applyPrefs(decorate(graduatedRaw), graduatedPrefs, Date.now()).slice(0, MAX_ROWS),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enrichStamp invalidates the decoration
    [graduatedRaw, graduatedPrefs, enrichStamp],
  )
  const trendingRaw = lists.trending
  const trendingPrefs = colPrefs.trending
  const trending = useMemo(
    () => applyPrefs(decorate(trendingRaw), trendingPrefs, Date.now()).slice(0, MAX_ROWS),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enrichStamp invalidates the decoration
    [trendingRaw, trendingPrefs, enrichStamp],
  )
  const enriched: Lists = { 'pre-graduated': bonding, graduated, trending }

  // Same left join for the watchlist cards: fomo owns the list, Mobula only decorates.
  const watchEnriched = useMemo(
    () => (watchTokens === null ? null : decorate(watchTokens)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enrichStamp invalidates the decoration
    [watchTokens, enrichStamp],
  )

  const open = useCallback(
    (token: Token) => {
      // Navigation mechanics (client-side pushState with a full-load fallback) and the handoff
      // bookkeeping both live in content/index.tsx — this only builds the href. Nothing is
      // dismissed on the way out, so Back remounts the terminal.
      onOpen(tokenPath(token.chain, token.address))
    },
    [onOpen],
  )

  const totalRows = LIST_KEYS.reduce((sum, key) => sum + lists[key].length, 0)

  // Which token columns to draw. The dialog keeps at least one of the four (three columns plus
  // the panel) on, but the popup can still switch the panel off on its own — so if that would
  // leave nothing at all on screen, fall back to every column rather than a blank terminal.
  const chosenCols = LIST_KEYS.filter((key) => displaySettings.columns[key])
  const visibleCols = chosenCols.length > 0 ? chosenCols : panelEnabled ? [] : LIST_KEYS
  // The panel is the only column on screen: it spans the window instead of holding its
  // user-set width against empty space, and its edge handle goes — there is nothing to drag
  // it against.
  const panelOnly = panelEnabled && visibleCols.length === 0

  return (
    <div className="shell">
      <TopBar onNavigate={onOpen} onDeposit={onDeposit} onHeaderAction={onHeaderAction} />

      <HoldingsBar onNavigate={onOpen} />

      <div className="main" data-alerts-side={alertsSettings?.enabled ? alertsSettings.side : undefined}>
        {alertsSettings?.enabled && (
          <div className="alerts-slot" style={{ width: panelOnly ? '100%' : alertsSettings.width }}>
            <SidePanel
              view={panelView}
              onViewChange={changeView}
              side={alertsSettings.side}
              width={alertsSettings.width}
              resizable={!panelOnly}
              onWidthChange={changeWidth}
              onWidthCommit={commitWidth}
              alerts={alerts}
              alertsLoading={alertsLoading}
              alertsHasMore={alertsHasMore}
              alertsLoadingMore={alertsLoadingMore}
              freshKeys={freshKeys}
              onLoadMoreAlerts={loadMoreAlerts}
              watchlist={watchEnriched}
              watchlistLoading={!watchFailed}
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
        {visibleCols.length > 0 && (
          <div
            className="columns"
            style={{ gridTemplateColumns: `repeat(${visibleCols.length}, minmax(0, 1fr))` }}
          >
            {visibleCols.map((key) => (
              <Column
                key={key}
                list={key}
                title={LIST_LABEL[key]}
                tokens={enriched[key]}
                total={lists[key].length}
                loading={totalRows === 0 && status !== 'unauthenticated'}
                stale={stale}
                showBond={key === 'pre-graduated'}
                freshKeys={freshKeys}
                prefs={colPrefs[key]}
                onPrefsChange={(next) => changePrefs(key, next)}
                onOpen={open}
              />
            ))}
          </div>
        )}
      </div>

      <BottomBar onNavigate={onOpen} />

      {/* Floats over everything above; last in the DOM so it also paints last. */}
      {pnlEnabled && <PnlCard />}

      {/* Above the card and the dialog both: a failed buy is the most important thing on
          screen at the moment it happens. */}
      <Toasts />

      {displayOpen && (
        <DisplaySettingsDialog
          settings={displaySettings}
          onChange={displayStore.set}
          panelEnabled={panelEnabled}
          onPanelChange={changePanelEnabled}
          onClose={() => setDisplayOpen(false)}
        />
      )}
    </div>
  )
}
