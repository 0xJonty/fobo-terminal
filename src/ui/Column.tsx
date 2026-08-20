import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ColumnControls } from '~/ui/ColumnControls'
import { filtersActive, type ColumnPrefs } from '~/lib/columnPrefs'
import type { ListKey } from '~/lib/protocol'
import { TokenCard } from '~/ui/TokenCard'
import type { Token } from '~/types/token'

const ROW_HEIGHT = 84

function Skeleton() {
  return (
    <div className="skeleton-row" aria-hidden="true">
      <div className="skeleton-block" style={{ width: '2.75rem', height: '2.75rem', borderRadius: '999px' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3125rem', paddingTop: '0.25rem' }}>
        <div className="skeleton-block" style={{ height: '0.6875rem', width: '60%' }} />
        <div className="skeleton-block" style={{ height: '0.5625rem', width: '85%' }} />
        <div className="skeleton-block" style={{ height: '0.5625rem', width: '45%' }} />
      </div>
    </div>
  )
}

export function Column({
  list,
  title,
  tokens,
  total,
  loading,
  showBond,
  freshKeys,
  prefs,
  onPrefsChange,
  onOpen,
}: {
  list: ListKey
  title: string
  tokens: Token[]
  /** Rows in fomo's store for this list, before our filters and the render cap. */
  total: number
  loading: boolean
  showBond: boolean
  freshKeys: ReadonlySet<string>
  prefs: ColumnPrefs
  onPrefsChange: (next: ColumnPrefs) => void
  onOpen: (token: Token) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)

  /**
   * Pause-on-hover. Rows prepend constantly, so without this a row can slide out from
   * under the cursor mid-click. While hovered we render a frozen copy. This is our own
   * addition — Axiom uses sound alerts rather than a pause.
   */
  const [frozen, setFrozen] = useState<Token[] | null>(null)
  useEffect(() => {
    if (hovered) setFrozen((current) => current ?? tokens)
    else setFrozen(null)
  }, [hovered, tokens])

  const rows = frozen ?? tokens

  // The terminal hides rather than unmounts across a handoff (see content/index.tsx). The cursor
  // was over this column at the moment it clicked away and mouseleave never fires on a hidden
  // element, so without this the column came back frozen on stale rows, badged "paused".
  useEffect(() => {
    const release = () => setHovered(false)
    window.addEventListener('fobo:hidden', release)
    return () => window.removeEventListener('fobo:hidden', release)
  }, [])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
    getItemKey: (index) => rows[index]?.key ?? index,
  })

  return (
    <section className="column">
      <header className="column-header">
        <h2 className="column-title">{title}</h2>
        <span
          className="column-count"
          title={filtersActive(prefs) ? `${tokens.length} of ${total} rows pass the filters` : undefined}
        >
          {filtersActive(prefs) ? `${tokens.length}/${total}` : tokens.length}
        </span>
        {frozen && <span className="column-paused">paused</span>}
        <ColumnControls list={list} prefs={prefs} onChange={onPrefsChange} />
      </header>

      <div
        className="column-body"
        ref={scrollRef}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {loading && rows.length === 0 ? (
          Array.from({ length: 8 }, (_, i) => <Skeleton key={i} />)
        ) : rows.length === 0 ? (
          <p className="column-empty">
            {filtersActive(prefs) && total > 0
              ? `No rows pass this column's filters (${total} hidden).`
              : 'Nothing here yet. Waiting for fomo to stream this list.'}
          </p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const token = rows[item.index]
              if (!token) return null
              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <TokenCard
                    token={token}
                    fresh={freshKeys.has(token.key)}
                    showBond={showBond}
                    onOpen={onOpen}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
