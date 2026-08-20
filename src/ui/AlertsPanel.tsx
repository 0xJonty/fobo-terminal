import { useEffect, useReducer, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { usd, percent } from '~/lib/format'
import type { AlertItem, MultiAlert, SwapAlert, ThesisAlert, MilestoneAlert } from '~/lib/alerts'

/**
 * The Alerts view — fomo's "trading activity" feed of the traders the user follows. One of
 * the FOMO Panel's three views (see SidePanel.tsx, which owns the shell and the switcher);
 * this renders only the scrolling list. Row content mirrors what fomo's own alert rows show
 * (trader, action, amount, token, market cap), and a row renders what its item has, never a
 * guessed figure.
 */

/** Alert rows vary in height (theses carry text); this is the virtualiser's starting guess. */
const ESTIMATED_ROW = 74

/** Relative timestamps drift; re-render on a slow tick to keep them honest. */
const CLOCK_MS = 30_000

const ACTION_LABEL: Record<SwapAlert['action'], string> = {
  buy: 'Buy',
  sell: 'Sell',
  receive: 'Received',
  send: 'Sent',
}

function actionClass(action: 'buy' | 'sell' | 'receive' | 'send'): string {
  return action === 'buy' || action === 'receive' ? 'pos' : 'neg'
}

/** Compact age from milliseconds: 12s / 4m / 3h / 2d. Same scale as the token cards. */
export function ageMs(createdAtMs: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - createdAtMs) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export function Avatar({ src, label }: { src?: string; label?: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (src && !failed) {
    return <img className="alert-avatar" src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
  }
  return (
    <span className="alert-avatar circle-fallback" aria-hidden="true">
      {(label || '?').slice(0, 2).toUpperCase()}
    </span>
  )
}

function TokenLine({
  item,
  children,
}: {
  item: AlertItem
  children?: React.ReactNode
}) {
  return (
    <span className="alert-token">
      {item.tokenImageUrl && <img className="alert-token-logo" src={item.tokenImageUrl} alt="" loading="lazy" />}
      {item.ticker && <span className="alert-ticker">{item.ticker}</span>}
      {children}
      {item.marketCap !== undefined && (
        <span className="muted">at {usd(item.marketCap)} MC</span>
      )}
    </span>
  )
}

export function TraderName({
  item,
  onOpenProfile,
}: {
  item: { userHandle?: string; displayName?: string }
  onOpenProfile: (handle: string) => void
}) {
  const name = item.userHandle ?? item.displayName
  if (!name) return <span className="alert-handle">someone</span>
  if (!item.userHandle) return <span className="alert-handle">{name}</span>
  return (
    <button
      className="alert-handle alert-handle-link"
      onClick={(event) => {
        event.stopPropagation()
        onOpenProfile(item.userHandle!)
      }}
    >
      {name}
    </button>
  )
}

function SwapRow({
  item,
  now,
  onOpenProfile,
}: {
  item: SwapAlert
  now: number
  onOpenProfile: (handle: string) => void
}) {
  return (
    <>
      <Avatar src={item.profilePictureLink} label={item.userHandle ?? item.displayName} />
      <div className="alert-lines">
        <span className="alert-head">
          <TraderName item={item} onOpenProfile={onOpenProfile} />
          <span className={`alert-badge ${actionClass(item.action)}`}>{ACTION_LABEL[item.action]}</span>
          <span className="alert-time">{ageMs(item.createdAtMs, now)}</span>
        </span>
        <TokenLine item={item}>
          {item.usdAmount !== undefined && <span className="alert-amount">{usd(Math.abs(item.usdAmount))}</span>}
        </TokenLine>
      </div>
    </>
  )
}

function MultiRow({ item, now }: { item: MultiAlert; now: number }) {
  const traders = item.topTraders.filter((t) => t.userImageUrl || t.userHandle || t.displayName)
  return (
    <>
      <span className="alert-stack">
        {traders.length > 0 ? (
          traders.map((t, i) => (
            <img
              key={t.userHandle ?? i}
              className="alert-stack-avatar"
              src={t.userImageUrl}
              alt=""
              loading="lazy"
              style={{ zIndex: traders.length - i }}
            />
          ))
        ) : (
          <span className="alert-avatar circle-fallback" aria-hidden="true">
            ∗
          </span>
        )}
      </span>
      <div className="alert-lines">
        <span className="alert-head">
          <span className="alert-handle">
            {item.uniqueTraders !== undefined ? `${item.uniqueTraders} traders` : 'Multiple traders'}
          </span>
          <span className={`alert-badge ${actionClass(item.action)}`}>
            {item.action === 'buy' ? 'Buying' : 'Selling'}
          </span>
          <span className="alert-time">{ageMs(item.createdAtMs, now)}</span>
        </span>
        <TokenLine item={item}>
          {item.totalVolume !== undefined && <span className="alert-amount">{usd(item.totalVolume)}</span>}
        </TokenLine>
        {(item.numTrades !== undefined || item.minutes !== undefined) && (
          <span className="alert-sub">
            {item.numTrades !== undefined && `${item.numTrades.toLocaleString('en-US')} trades`}
            {item.numTrades !== undefined && item.minutes !== undefined && ' · '}
            {item.minutes !== undefined && `${item.minutes}m window`}
          </span>
        )}
      </div>
    </>
  )
}

function ThesisRow({
  item,
  now,
  onOpenProfile,
}: {
  item: ThesisAlert
  now: number
  onOpenProfile: (handle: string) => void
}) {
  return (
    <>
      <Avatar src={item.profilePictureLink} label={item.userHandle ?? item.displayName} />
      <div className="alert-lines">
        <span className="alert-head">
          <TraderName item={item} onOpenProfile={onOpenProfile} />
          <span className="alert-badge dev">Thesis</span>
          <span className="alert-time">{ageMs(item.createdAtMs, now)}</span>
        </span>
        {item.comment && <p className="alert-comment">{item.comment}</p>}
        <TokenLine item={item}>
          {item.positionUsd !== undefined && (
            <span className="alert-amount">{usd(item.positionUsd)} position</span>
          )}
        </TokenLine>
      </div>
    </>
  )
}

function MilestoneRow({
  item,
  now,
  onOpenProfile,
}: {
  item: MilestoneAlert
  now: number
  onOpenProfile: (handle: string) => void
}) {
  const up = item.pnlUsd === undefined || item.pnlUsd >= 0
  return (
    <>
      <Avatar src={item.profilePictureLink} label={item.userHandle ?? item.displayName} />
      <div className="alert-lines">
        <span className="alert-head">
          <TraderName item={item} onOpenProfile={onOpenProfile} />
          <span className={`alert-badge ${up ? 'pos' : 'neg'}`}>Milestone</span>
          <span className="alert-time">{ageMs(item.createdAtMs, now)}</span>
        </span>
        <TokenLine item={item}>
          {item.pnlUsd !== undefined && (
            <span className={`alert-amount ${up ? 'pos' : 'neg'}`}>
              {up ? '+' : '-'}
              {usd(Math.abs(item.pnlUsd))}
            </span>
          )}
          {item.pnlPercent !== undefined && (
            <span className={up ? 'pos' : 'neg'}>{percent(item.pnlPercent, 0)}</span>
          )}
        </TokenLine>
        {item.tag && <span className="alert-sub">{item.tag}</span>}
      </div>
    </>
  )
}

export function AlertsPanel({
  alerts,
  loading,
  hasMore,
  loadingMore,
  freshKeys,
  onLoadMore,
  onOpen,
}: {
  alerts: AlertItem[]
  loading: boolean
  hasMore: boolean
  loadingMore: boolean
  freshKeys: ReadonlySet<string>
  onLoadMore: () => void
  onOpen: (href: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Keep the relative timestamps moving while the list is quiet.
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const id = window.setInterval(tick, CLOCK_MS)
    return () => window.clearInterval(id)
  }, [])
  const now = Date.now()

  const virtualizer = useVirtualizer({
    count: alerts.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW,
    overscan: 8,
    getItemKey: (index) => alerts[index]?.id ?? index,
  })

  // Backfill the next page when the last rendered row comes into view.
  const virtualItems = virtualizer.getVirtualItems()
  const lastVisible = virtualItems[virtualItems.length - 1]?.index
  useEffect(() => {
    if (lastVisible === undefined || !hasMore || loadingMore) return
    if (lastVisible >= alerts.length - 5) onLoadMore()
  }, [lastVisible, hasMore, loadingMore, alerts.length, onLoadMore])

  const openToken = (item: AlertItem) => onOpen(`/tokens/${item.chain}/${item.tokenAddress}`)
  const openProfile = (handle: string) => onOpen(`/profile/${handle}`)

  return (
    <div className="column-body" ref={scrollRef}>
        {loading && alerts.length === 0 ? (
          <p className="column-empty">Loading alerts…</p>
        ) : alerts.length === 0 ? (
          <p className="column-empty">
            No alerts yet. Follow traders on fomo and their activity lands here.
          </p>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualItems.map((row) => {
              const item = alerts[row.index]
              if (!item) return null
              return (
                <div
                  key={row.key}
                  ref={virtualizer.measureElement}
                  data-index={row.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  <button
                    className="alert-row"
                    data-fresh={freshKeys.has(item.id) || undefined}
                    onClick={() => openToken(item)}
                  >
                    {item.kind === 'swap' && <SwapRow item={item} now={now} onOpenProfile={openProfile} />}
                    {item.kind === 'multi' && <MultiRow item={item} now={now} />}
                    {item.kind === 'thesis' && <ThesisRow item={item} now={now} onOpenProfile={openProfile} />}
                    {item.kind === 'milestone' && (
                      <MilestoneRow item={item} now={now} onOpenProfile={openProfile} />
                    )}
                  </button>
                </div>
              )
            })}
          </div>
        )}
      {loadingMore && <p className="alert-more">Loading more…</p>}
    </div>
  )
}
