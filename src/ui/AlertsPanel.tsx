import { useEffect, useReducer, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { usd, percent } from '~/lib/format'
import { profilePath, tokenPath } from '~/lib/url'
import { useActiveInterval } from '~/lib/visibility'
import { ChainIcon } from '~/ui/ChainIcon'
import type { AlertItem, MultiAlert, SwapAlert, ThesisAlert, MilestoneAlert } from '~/lib/alerts'

/**
 * The Alerts view — fomo's "trading activity" feed of the traders the user follows. One of
 * the FOMO Panel's three views (see SidePanel.tsx, which owns the shell and the switcher);
 * this renders only the scrolling list. Row content mirrors what fomo's own alert rows show
 * (trader, action, amount, token, market cap), and a row renders what its item has, never a
 * guessed figure.
 *
 * Row anatomy: a plain block with a stretched anchor underneath (the "card link" pattern).
 * Rows used to be <button>s containing further <button>s, which HTML forbids and screen
 * readers flatten; now the row link is a real <a> (middle-click works), and the trader /
 * post links inside it sit above the overlay as their own controls.
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
    return (
      <img
        className="alert-avatar"
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <span className="alert-avatar circle-fallback" aria-hidden="true">
      {(label || '?').slice(0, 2).toUpperCase()}
    </span>
  )
}

/** A stack of trader avatars for multi-user rows, or a placeholder when none carry one. */
export function AvatarStack({
  traders,
}: {
  traders: { userHandle?: string; displayName?: string; userImageUrl?: string }[]
}) {
  const shown = traders.filter((t) => t.userImageUrl || t.userHandle || t.displayName)
  return (
    <span className="alert-stack">
      {shown.length > 0 ? (
        shown.map((t, i) => (
          <img
            key={t.userHandle ?? i}
            className="alert-stack-avatar"
            src={t.userImageUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            style={{ zIndex: shown.length - i }}
          />
        ))
      ) : (
        <span className="alert-avatar circle-fallback" aria-hidden="true">
          ∗
        </span>
      )}
    </span>
  )
}

export function TokenLine({
  item,
  children,
}: {
  item: { networkId?: number; tokenImageUrl?: string; ticker?: string; marketCap?: number }
  children?: React.ReactNode
}) {
  return (
    <span className="alert-token">
      {item.networkId !== undefined && (
        <ChainIcon networkId={item.networkId} size={12} className="symbol-chain" />
      )}
      {item.tokenImageUrl && (
        <img
          className="alert-token-logo"
          src={item.tokenImageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}
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
  const handle = item.userHandle
  if (!handle) return <span className="alert-handle">{name}</span>
  const href = profilePath(handle)
  return (
    <a
      className="alert-handle alert-handle-link"
      href={href}
      onClick={(event) => {
        event.stopPropagation()
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        onOpenProfile(handle)
      }}
    >
      {name}
    </a>
  )
}

/**
 * The stretched link that makes the whole row open its destination. Modified clicks fall
 * through to the browser (new tab); plain clicks navigate in-app.
 */
export function RowLink({ href, label, onOpen }: { href: string; label: string; onOpen: (href: string) => void }) {
  return (
    <a
      className="alert-row-link"
      href={href}
      aria-label={label}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        onOpen(href)
      }}
    />
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
  return (
    <>
      <AvatarStack traders={item.topTraders} />
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

  // Keep the relative timestamps moving while the list is quiet — and on screen.
  const [, tick] = useReducer((n: number) => n + 1, 0)
  useActiveInterval(tick, CLOCK_MS)
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

  const openProfile = (handle: string) => onOpen(profilePath(handle))

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
                  <div className="alert-row" data-fresh={freshKeys.has(item.id) || undefined}>
                    <RowLink
                      href={tokenPath(item.chain, item.tokenAddress)}
                      label={`Open ${item.ticker ?? 'token'} on fomo`}
                      onOpen={onOpen}
                    />
                    {item.kind === 'swap' && <SwapRow item={item} now={now} onOpenProfile={openProfile} />}
                    {item.kind === 'multi' && <MultiRow item={item} now={now} />}
                    {item.kind === 'thesis' && <ThesisRow item={item} now={now} onOpenProfile={openProfile} />}
                    {item.kind === 'milestone' && (
                      <MilestoneRow item={item} now={now} onOpenProfile={openProfile} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      {loadingMore && <p className="alert-more">Loading more…</p>}
    </div>
  )
}
