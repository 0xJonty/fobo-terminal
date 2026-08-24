import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { AlertsPanel } from '~/ui/AlertsPanel'
import { FeedView } from '~/ui/FeedView'
import { PanelFilters } from '~/ui/PanelFilters'
import { WatchlistView } from '~/ui/WatchlistView'
import {
  ALERTS_MAX_WIDTH,
  ALERTS_MIN_WIDTH,
  PANEL_VIEWS,
  PANEL_VIEW_LABEL,
  type AlertsFilterSettings,
  type PanelView,
} from '~/lib/settings'
import type { AlertItem } from '~/lib/alerts'
import type { FeedItem } from '~/lib/feed'
import type { Token } from '~/types/token'
import { HIDDEN_EVENT } from '~/lib/host'

/**
 * The FOMO Panel — the side rail beside the token columns, switching between fomo's Alerts,
 * the user's Watchlist, and fomo's social Feed. The title is the switcher: a dropdown in the
 * header, matching the column controls' visual language. The chosen view is tab-session
 * state (see settings.ts). The panel's inner edge is a drag handle — the popup slider it
 * replaces is gone.
 */

export function SidePanel({
  view,
  onViewChange,
  side,
  width,
  onWidthChange,
  onWidthCommit,
  alerts,
  alertsLoading,
  alertsHasMore,
  alertsLoadingMore,
  freshKeys,
  onLoadMoreAlerts,
  watchlist,
  watchlistLoading,
  feed,
  feedLoading,
  feedHasMore,
  feedLoadingMore,
  onLoadMoreFeed,
  feedDisabledGroups,
  alertsFilters,
  onFeedGroupsChange,
  onAlertsFiltersChange,
  onOpen,
  onOpenToken,
}: {
  view: PanelView
  onViewChange: (view: PanelView) => void
  side: 'left' | 'right'
  width: number
  /** Live width while dragging — state only, no storage write. */
  onWidthChange: (width: number) => void
  /** Drag finished — persist. */
  onWidthCommit: (width: number) => void
  alerts: AlertItem[]
  alertsLoading: boolean
  alertsHasMore: boolean
  alertsLoadingMore: boolean
  freshKeys: ReadonlySet<string>
  onLoadMoreAlerts: () => void
  watchlist: Token[] | null
  watchlistLoading: boolean
  feed: FeedItem[]
  feedLoading: boolean
  feedHasMore: boolean
  feedLoadingMore: boolean
  onLoadMoreFeed: () => void
  feedDisabledGroups: string[]
  alertsFilters: AlertsFilterSettings
  onFeedGroupsChange: (disabled: string[]) => void
  onAlertsFiltersChange: (filters: AlertsFilterSettings) => void
  onOpen: (href: string) => void
  onOpenToken: (token: Token) => void
}) {
  const [open, setOpen] = useState(false)
  const selectRef = useRef<HTMLDivElement>(null)

  // Click-away for the view menu; composedPath works across the shadow boundary.
  useEffect(() => {
    if (!open) return
    const onDown = (event: Event) => {
      const root = selectRef.current
      if (root && !event.composedPath().includes(root)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  useEffect(() => {
    const close = () => setOpen(false)
    window.addEventListener(HIDDEN_EVENT, close)
    return () => window.removeEventListener(HIDDEN_EVENT, close)
  }, [])

  const count = view === 'alerts' ? alerts.length : view === 'watchlist' ? (watchlist?.length ?? 0) : feed.length

  /**
   * Edge drag. Pointer capture keeps the gesture alive when the cursor outruns the 6px
   * handle; width follows the pointer against the drag origin, clamped to the same bounds
   * the old slider had.
   */
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)

  const onHandleDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onHandleMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    const dx = event.clientX - state.startX
    // A right-side panel grows as its left edge is dragged left; a left-side one, rightward.
    const next = side === 'right' ? state.startWidth - dx : state.startWidth + dx
    onWidthChange(Math.min(ALERTS_MAX_WIDTH, Math.max(ALERTS_MIN_WIDTH, Math.round(next))))
  }
  const onHandleUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    drag.current = null
    onWidthCommit(width)
  }

  return (
    <section className="column alerts-panel" aria-label="FOMO Panel">
      <div
        className="panel-resize"
        data-side={side}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panel"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerCancel={onHandleUp}
      />

      <header className="column-header">
        <div className="panelsel" ref={selectRef}>
          <button
            type="button"
            className="panelsel-button"
            aria-expanded={open}
            title="Switch view"
            onClick={() => setOpen((current) => !current)}
          >
            <h2 className="column-title">{PANEL_VIEW_LABEL[view]}</h2>
            <ChevronDown size={13} className="panelsel-chevron" data-open={open || undefined} />
          </button>
          {open && (
            <div className="panelsel-menu">
              {PANEL_VIEWS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className="panelsel-option"
                  data-on={option === view || undefined}
                  onClick={() => {
                    setOpen(false)
                    onViewChange(option)
                  }}
                >
                  {PANEL_VIEW_LABEL[option]}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="column-count">{count}</span>
        <PanelFilters
          view={view}
          feedDisabledGroups={feedDisabledGroups}
          alertsFilters={alertsFilters}
          onFeedGroupsChange={onFeedGroupsChange}
          onAlertsFiltersChange={onAlertsFiltersChange}
        />
      </header>

      {view === 'alerts' && (
        <AlertsPanel
          alerts={alerts}
          loading={alertsLoading}
          hasMore={alertsHasMore}
          loadingMore={alertsLoadingMore}
          freshKeys={freshKeys}
          onLoadMore={onLoadMoreAlerts}
          onOpen={onOpen}
        />
      )}
      {view === 'watchlist' && (
        <WatchlistView tokens={watchlist} loading={watchlistLoading} onOpen={onOpenToken} />
      )}
      {view === 'feed' && (
        <FeedView
          items={feed}
          loading={feedLoading}
          hasMore={feedHasMore}
          loadingMore={feedLoadingMore}
          onLoadMore={onLoadMoreFeed}
          onOpen={onOpen}
        />
      )}
    </section>
  )
}
