import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, SlidersHorizontal } from 'lucide-react'
import { ChainIcon } from '~/ui/ChainIcon'
import {
  FILTERABLE_CHAINS,
  defaultPrefs,
  parseAmount,
  parseDuration,
  type ColumnPrefs,
  type RangeFilter,
  type SortField,
} from '~/lib/columnPrefs'
import type { ListKey } from '~/lib/protocol'
import { HIDDEN_EVENT } from '~/lib/host'

/**
 * The per-column filter/sort control: a funnel button in the column header and, when open,
 * a panel dropped over the top of the column body. The panel never edits local state — every
 * interaction calls onChange with the next prefs, and App owns persistence.
 */

/** `desc`/`asc` name the direction in the field's own terms — age reads newest/oldest. */
const SORT_OPTIONS: readonly { field: SortField; label: string; desc: string; asc: string }[] = [
  { field: 'marketCap', label: 'Market cap', desc: 'highest', asc: 'lowest' },
  { field: 'volume', label: 'Volume', desc: 'highest', asc: 'lowest' },
  { field: 'holders', label: 'Holders', desc: 'highest', asc: 'lowest' },
  { field: 'liquidity', label: 'Liquidity', desc: 'highest', asc: 'lowest' },
  { field: 'age', label: 'Age', desc: 'newest', asc: 'oldest' },
]

type RangeField = 'marketCap' | 'volume' | 'liquidity' | 'holders' | 'age'

const RANGE_ROWS: readonly {
  field: RangeField
  label: string
  title: string
  parse: (raw: string) => number | undefined
}[] = [
  { field: 'marketCap', label: 'Market cap', title: 'USD — accepts k / m / b, e.g. "50k"', parse: parseAmount },
  {
    field: 'volume',
    label: 'Volume',
    title: '24h volume in USD (1h figure when no 24h is known, matching the card) — accepts k / m / b',
    parse: parseAmount,
  },
  { field: 'liquidity', label: 'Liquidity', title: 'USD — accepts k / m / b, e.g. "10k"', parse: parseAmount },
  { field: 'holders', label: 'Holders', title: 'Holder count — accepts k / m, e.g. "1k"', parse: parseAmount },
  { field: 'age', label: 'Age', title: 'Token age — "30s", "5m", "2h", "1d"; a bare number is minutes', parse: parseDuration },
]

function RangeInput({
  range,
  side,
  parse,
  onChange,
}: {
  range: RangeFilter
  side: 'min' | 'max'
  parse: (raw: string) => number | undefined
  onChange: (next: RangeFilter) => void
}) {
  const value = range[side]
  const bad = value.trim() !== '' && parse(value) === undefined
  return (
    <input
      className="colctl-input"
      type="text"
      inputMode="decimal"
      placeholder={side}
      value={value}
      data-bad={bad ? 'true' : undefined}
      onChange={(event) => onChange({ ...range, [side]: event.target.value })}
    />
  )
}

export function ColumnControls({
  list,
  prefs,
  onChange,
}: {
  list: ListKey
  prefs: ColumnPrefs
  onChange: (next: ColumnPrefs) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  // "Active" means departed from this column's own defaults, not from empty — graduated
  // ships with a newest-first sort, and its funnel must not glow for the factory setting.
  // Both sides are built with the same literal field order, so the string compare holds.
  const active = JSON.stringify(prefs) !== JSON.stringify(defaultPrefs(list))

  // Click-away: composedPath works across the shadow boundary, plain target does not.
  useEffect(() => {
    if (!open) return
    const onDown = (event: Event) => {
      const root = rootRef.current
      if (root && !event.composedPath().includes(root)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  // The terminal hides (not unmounts) on a handoff; do not come back with a stale open panel.
  useEffect(() => {
    const close = () => setOpen(false)
    window.addEventListener(HIDDEN_EVENT, close)
    return () => window.removeEventListener(HIDDEN_EVENT, close)
  }, [])

  const cycleSort = (field: SortField) => {
    const current = prefs.sort
    let next: ColumnPrefs['sort']
    if (!current || current.field !== field) next = { field, dir: 'desc' }
    else if (current.dir === 'desc') next = { field, dir: 'asc' }
    else next = null
    onChange({ ...prefs, sort: next })
  }

  /**
   * Chain tiles behave like a chart legend: with everything on, clicking one chain solos it
   * ("Sol only" is one click); after that, clicks toggle membership. Deselecting the last
   * chain — or selecting all of them — reads as "no chain filter".
   */
  const toggleChain = (networkId: number) => {
    let next: number[]
    if (prefs.chains === null) next = [networkId]
    else if (prefs.chains.includes(networkId)) next = prefs.chains.filter((id) => id !== networkId)
    else next = [...prefs.chains, networkId]
    const all = next.length === 0 || next.length === FILTERABLE_CHAINS.length
    onChange({ ...prefs, chains: all ? null : next })
  }

  return (
    <div className="colctl" ref={rootRef}>
      <button
        type="button"
        className="colctl-button"
        data-active={active ? 'true' : undefined}
        data-open={open ? 'true' : undefined}
        title="Filter & sort"
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
              // Esc closes the panel only; without the stop it would also dismiss the terminal.
              event.stopPropagation()
              setOpen(false)
            }
          }}
        >
          <div className="colctl-section">
            <div className="colctl-section-label">Sort by</div>
            <div className="colctl-chips">
              {SORT_OPTIONS.map(({ field, label, desc, asc }) => {
                const on = prefs.sort?.field === field
                const dir = on ? prefs.sort?.dir : undefined
                return (
                  <button
                    key={field}
                    type="button"
                    className="colctl-chip"
                    data-on={on ? 'true' : undefined}
                    title={
                      on
                        ? dir === 'desc'
                          ? `${label}: ${desc} first — click for ${asc} first`
                          : `${label}: ${asc} first — click to clear (fomo's order)`
                        : `Sort by ${label}, ${desc} first`
                    }
                    onClick={() => cycleSort(field)}
                  >
                    {label}
                    {dir === 'desc' && <ArrowDown size={11} />}
                    {dir === 'asc' && <ArrowUp size={11} />}
                  </button>
                )
              })}
            </div>
            {prefs.sort === null && <div className="colctl-hint">Unsorted — fomo&apos;s own order.</div>}
          </div>

          <div className="colctl-section">
            <div className="colctl-section-label">
              Chains
              {prefs.chains !== null && (
                <button type="button" className="colctl-clear" onClick={() => onChange({ ...prefs, chains: null })}>
                  all
                </button>
              )}
            </div>
            <div className="colctl-chains">
              {FILTERABLE_CHAINS.map(({ networkId, label }) => {
                const on = prefs.chains === null || prefs.chains.includes(networkId)
                return (
                  <button
                    key={networkId}
                    type="button"
                    className="colctl-chain"
                    data-on={on ? 'true' : undefined}
                    title={prefs.chains === null ? `Only ${label}` : on ? `Hide ${label}` : `Also show ${label}`}
                    onClick={() => toggleChain(networkId)}
                  >
                    <ChainIcon networkId={networkId} size={14} />
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="colctl-section">
            <div className="colctl-section-label">Ranges</div>
            {RANGE_ROWS.map(({ field, label, title, parse }) => (
              <div className="colctl-range" key={field} title={title}>
                <span className="colctl-range-label">{label}</span>
                <RangeInput
                  range={prefs[field]}
                  side="min"
                  parse={parse}
                  onChange={(next) => onChange({ ...prefs, [field]: next })}
                />
                <RangeInput
                  range={prefs[field]}
                  side="max"
                  parse={parse}
                  onChange={(next) => onChange({ ...prefs, [field]: next })}
                />
              </div>
            ))}
            <div className="colctl-hint">Rows missing a bounded metric are hidden — a blank beats a guess.</div>
          </div>

          <div className="colctl-foot">
            <button
              type="button"
              className="colctl-reset"
              disabled={!active}
              onClick={() => onChange(defaultPrefs(list))}
            >
              Reset column
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
