import { useClickAway } from '~/lib/clickAway'
import { useEffect, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { FEED_GROUPS } from '~/lib/feed'
import { parseAmount } from '~/lib/columnPrefs'
import { HIDDEN_EVENT } from '~/lib/host'
import {
  ALERTS_FILTERS_DEFAULT,
  type AlertsFilterSettings,
  type PanelView,
} from '~/lib/settings'

/**
 * The FOMO Panel's filter control — fomo's own filters for the view on screen. The Alerts
 * view gets fomo's threshold/equity/market-cap bounds; the Feed view gets fomo's eight
 * filter groups as toggles. The Watchlist has no native filters, so the button hides there.
 * Reuses the column controls' visual language wholesale.
 *
 * The amount boxes edit a local draft and commit on blur, Enter, or 400ms of idle typing.
 * Committing per keystroke used to mean a storage write and a full alerts backfill (with
 * the list wiped) for every character typed.
 */

const COMMIT_IDLE_MS = 400

const AMOUNT_ROWS: readonly { field: keyof AlertsFilterSettings; label: string; title: string }[] = [
  { field: 'threshold', label: 'Trade size', title: "Minimum trade size in USD — fomo's stock setting is $1k. Accepts k / m." },
  { field: 'minEquity', label: 'Portfolio', title: 'Minimum portfolio value for the trader. Accepts k / m.' },
]

export function PanelFilters({
  view,
  feedDisabledGroups,
  alertsFilters,
  onFeedGroupsChange,
  onAlertsFiltersChange,
}: {
  view: PanelView
  feedDisabledGroups: string[]
  alertsFilters: AlertsFilterSettings
  onFeedGroupsChange: (disabled: string[]) => void
  onAlertsFiltersChange: (filters: AlertsFilterSettings) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Click-away — shadow-root aware (see lib/clickAway.ts).
  useClickAway(rootRef, open, () => setOpen(false))

  useEffect(() => {
    const close = () => setOpen(false)
    window.addEventListener(HIDDEN_EVENT, close)
    return () => window.removeEventListener(HIDDEN_EVENT, close)
  }, [])

  /* ---- draft + commit for the alerts amount boxes ---- */

  const [draft, setDraft] = useState<AlertsFilterSettings>(alertsFilters)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const commitTimer = useRef<number | undefined>(undefined)
  // What the parent last agreed to, by content. The storage watcher echoes each debounced
  // write back as a new object with the same content; that echo must not reset a draft the
  // user has kept typing into. Only a genuinely different value (Reset, the popup, another
  // tab) replaces the draft.
  const committedRef = useRef(JSON.stringify(alertsFilters))

  useEffect(() => {
    const incoming = JSON.stringify(alertsFilters)
    if (incoming === committedRef.current) return
    committedRef.current = incoming
    setDraft(alertsFilters)
  }, [alertsFilters])

  const commit = () => {
    if (commitTimer.current !== undefined) {
      window.clearTimeout(commitTimer.current)
      commitTimer.current = undefined
    }
    const next = draftRef.current
    const serialized = JSON.stringify(next)
    if (serialized === committedRef.current) return
    committedRef.current = serialized
    onAlertsFiltersChange(next)
  }
  const commitRef = useRef(commit)
  commitRef.current = commit

  const setAmount = (field: keyof AlertsFilterSettings, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
    if (commitTimer.current !== undefined) window.clearTimeout(commitTimer.current)
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = undefined
      commitRef.current()
    }, COMMIT_IDLE_MS)
  }

  useEffect(
    () => () => {
      if (commitTimer.current !== undefined) window.clearTimeout(commitTimer.current)
    },
    [],
  )

  // The watchlist is fomo's own unfiltered list; nothing honest to offer there.
  if (view === 'watchlist') return null

  const active =
    view === 'feed'
      ? feedDisabledGroups.length > 0
      : JSON.stringify(alertsFilters) !== JSON.stringify(ALERTS_FILTERS_DEFAULT)

  const amountInput = (field: keyof AlertsFilterSettings, placeholder: string) => {
    const value = draft[field]
    const bad = value.trim() !== '' && parseAmount(value) === undefined
    return (
      <input
        className="colctl-input"
        type="text"
        inputMode="decimal"
        placeholder={placeholder}
        value={value}
        data-bad={bad ? 'true' : undefined}
        onChange={(event) => setAmount(field, event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
        }}
      />
    )
  }

  return (
    <div className="colctl" ref={rootRef}>
      <button
        type="button"
        className="colctl-button"
        data-active={active ? 'true' : undefined}
        data-open={open ? 'true' : undefined}
        title={view === 'feed' ? 'Feed filters' : 'Alert filters'}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <SlidersHorizontal size={13} />
      </button>

      {open && (
        <div
          className="colctl-panel"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              setOpen(false)
            }
          }}
        >
          {view === 'feed' ? (
            <div className="colctl-section">
              <div className="colctl-section-label">
                Show
                {feedDisabledGroups.length > 0 && (
                  <button type="button" className="colctl-clear" onClick={() => onFeedGroupsChange([])}>
                    all
                  </button>
                )}
              </div>
              <div className="colctl-chips">
                {FEED_GROUPS.map((group) => {
                  const on = !feedDisabledGroups.includes(group.id)
                  return (
                    <button
                      key={group.id}
                      type="button"
                      className="colctl-chip"
                      data-on={on ? 'true' : undefined}
                      onClick={() =>
                        onFeedGroupsChange(
                          on
                            ? [...feedDisabledGroups, group.id]
                            : feedDisabledGroups.filter((id) => id !== group.id),
                        )
                      }
                    >
                      {group.label}
                    </button>
                  )
                })}
              </div>
              <div className="colctl-hint">fomo&apos;s own recap posts show whenever anything is on.</div>
            </div>
          ) : (
            <>
              <div className="colctl-section">
                <div className="colctl-section-label">Minimums</div>
                {AMOUNT_ROWS.map(({ field, label, title }) => (
                  <div className="colctl-range" key={field} title={title}>
                    <span className="colctl-range-label">{label}</span>
                    {amountInput(field, 'min')}
                    <span />
                  </div>
                ))}
              </div>
              <div className="colctl-section">
                <div className="colctl-section-label">Market cap</div>
                <div className="colctl-range" title='USD — accepts k / m / b, e.g. "500k"'>
                  <span className="colctl-range-label">Range</span>
                  {amountInput('minMarketCap', 'min')}
                  {amountInput('maxMarketCap', 'max')}
                </div>
              </div>
              <div className="colctl-foot">
                <button
                  type="button"
                  className="colctl-reset"
                  disabled={!active}
                  onClick={() => onAlertsFiltersChange({ ...ALERTS_FILTERS_DEFAULT })}
                >
                  Reset filters
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
