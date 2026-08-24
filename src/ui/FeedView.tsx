import { useEffect, useReducer, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Avatar, AvatarStack, RowLink, TokenLine, TraderName, ageMs } from '~/ui/AlertsPanel'
import { usd, percent } from '~/lib/format'
import { profilePath, tokenPath } from '~/lib/url'
import { useActiveInterval } from '~/lib/visibility'
import type {
  FeedItem,
  MilestoneFeedItem,
  MultiFeedItem,
  PostFeedItem,
  SmartFollowFeedItem,
  ThesisFeedItem,
  TradeFeedItem,
  VerifiedFeedItem,
} from '~/lib/feed'

/**
 * The Feed view — fomo's social feed (its side panel's "Feed" tab): oversized trades,
 * position closes, multi-trader clusters, theses, milestones, verification events, smart
 * followings, and fomo's own pinned recap posts. Same visual language (and the same row
 * anatomy) as the alerts rows; every figure comes off the wire item, never derived beyond
 * fomo's own arithmetic.
 */

/** Feed rows vary widely (posts carry paragraphs); the virtualiser's starting guess. */
const ESTIMATED_ROW = 84

const CLOCK_MS = 30_000

function TradeRow({
  item,
  now,
  onOpenProfile,
}: {
  item: TradeFeedItem
  now: number
  onOpenProfile: (handle: string) => void
}) {
  const buyish = item.verb === 'Bought' || item.verb === 'Received'
  const pnlUp = item.realizedPnlUsd !== undefined && item.realizedPnlUsd >= 0
  return (
    <>
      <Avatar src={item.userImageUrl} label={item.userHandle ?? item.displayName} />
      <div className="alert-lines">
        <span className="alert-head">
          <TraderName item={item} onOpenProfile={onOpenProfile} />
          <span className={`alert-badge ${item.verb === 'Closed' ? (pnlUp ? 'pos' : 'neg') : buyish ? 'pos' : 'neg'}`}>
            {item.verb}
          </span>
          <span className="alert-time">{ageMs(item.createdAtMs, now)}</span>
        </span>
        <TokenLine item={item}>
          {item.usdAmount !== undefined && <span className="alert-amount">{usd(item.usdAmount)}</span>}
        </TokenLine>
        {item.realizedPnlUsd !== undefined && (
          <span className={`alert-sub ${pnlUp ? 'pos' : 'neg'}`}>
            {pnlUp ? '+' : '-'}
            {usd(Math.abs(item.realizedPnlUsd))} realized
            {item.realizedPnlPercent !== undefined && ` (${percent(item.realizedPnlPercent, 0)})`}
          </span>
        )}
      </div>
    </>
  )
}

function MultiRow({ item, now }: { item: MultiFeedItem; now: number }) {
  const who =
    item.uniqueTraders !== undefined
      ? `${item.uniqueTraders} ${item.areTopTraders ? 'top traders' : 'traders'}`
      : 'Multiple traders'
  return (
    <>
      <AvatarStack traders={item.topTraders} />
      <div className="alert-lines">
        <span className="alert-head">
          <span className="alert-handle">{who}</span>
          <span className={`alert-badge ${item.action === 'buy' ? 'pos' : 'neg'}`}>
            {item.action === 'buy' ? 'Bought' : 'Sold'}
          </span>
          <span className="alert-time">{ageMs(item.createdAtMs, now)}</span>
        </span>
        <TokenLine item={item}>
          {item.totalVolume !== undefined && <span className="alert-amount">{usd(item.totalVolume)}</span>}
        </TokenLine>
      </div>
    </>
  )
}

function ThesisRow({
  item,
  now,
  onOpenProfile,
}: {
  item: ThesisFeedItem
  now: number
  onOpenProfile: (handle: string) => void
}) {
  return (
    <>
      <Avatar src={item.userImageUrl} label={item.userHandle ?? item.displayName} />
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
  item: MilestoneFeedItem
  now: number
  onOpenProfile: (handle: string) => void
}) {
  const up = item.pnlUsd === undefined || item.pnlUsd >= 0
  return (
    <>
      <Avatar src={item.userImageUrl} label={item.userHandle ?? item.displayName} />
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
      </div>
    </>
  )
}

function VerifiedRow({ item, now }: { item: VerifiedFeedItem; now: number }) {
  const up = item.changePercent === undefined || item.changePercent >= 0
  return (
    <>
      <Avatar src={item.tokenImageUrl} label={item.ticker} />
      <div className="alert-lines">
        <span className="alert-head">
          <span className="alert-handle">{item.ticker ?? 'Token'}</span>
          {/* fomo's own phrasing for listing events. */}
          <span className="alert-badge pos">{item.sinceListing ? 'Since verification' : 'Verified'}</span>
          <span className="alert-time">{ageMs(item.createdAtMs, now)}</span>
        </span>
        <TokenLine item={item}>
          {item.sinceListing && item.changePercent !== undefined && (
            <span className={`alert-amount ${up ? 'pos' : 'neg'}`}>{percent(item.changePercent, 0)}</span>
          )}
        </TokenLine>
      </div>
    </>
  )
}

function SmartRow({
  item,
  now,
  onOpenProfile,
}: {
  item: SmartFollowFeedItem
  now: number
  onOpenProfile: (handle: string) => void
}) {
  return (
    <>
      <Avatar src={item.userImageUrl} label={item.userHandle ?? item.displayName} />
      <div className="alert-lines">
        <span className="alert-head">
          <TraderName item={item} onOpenProfile={onOpenProfile} />
          {/* fomo's own copy for this item type. */}
          <span className="alert-badge dev">just joined</span>
          <span className="alert-time">{ageMs(item.createdAtMs, now)}</span>
        </span>
        {item.followerCount !== undefined && item.followerCount > 0 && (
          <span className="alert-sub">
            {item.followerCount} notable {item.followerCount === 1 ? 'follower' : 'followers'}
          </span>
        )}
      </div>
    </>
  )
}

function PostRow({
  item,
  now,
  onOpenToken,
}: {
  item: PostFeedItem
  now: number
  onOpenToken: (href: string) => void
}) {
  return (
    <div className="alert-lines feed-post">
      <span className="alert-head">
        <span className="alert-handle">{item.author ?? 'fomo'}</span>
        {item.pinned && <span className="alert-badge dev">Pinned</span>}
        <span className="alert-time">{ageMs(item.createdAtMs, now)}</span>
      </span>
      {item.title && <p className="feed-post-title">{item.title}</p>}
      {item.segments.length > 0 && (
        <p className="alert-comment feed-post-body">
          {item.segments.map((segment, i) =>
            segment.href ? (
              <a
                key={i}
                className="feed-post-link"
                href={segment.href}
                onClick={(event) => {
                  event.stopPropagation()
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
                  event.preventDefault()
                  onOpenToken(segment.href!)
                }}
              >
                {segment.text}
              </a>
            ) : (
              <span key={i}>{segment.text}</span>
            ),
          )}
        </p>
      )}
    </div>
  )
}

/** Where a click on the row goes: the token page, else the trader's profile, else nowhere. */
function destination(item: FeedItem): { href: string; label: string } | null {
  if (item.chain && item.tokenAddress) {
    return { href: tokenPath(item.chain, item.tokenAddress), label: `Open ${item.ticker ?? 'token'} on fomo` }
  }
  if ('userHandle' in item && item.userHandle) {
    return { href: profilePath(item.userHandle), label: `Open ${item.userHandle}'s profile` }
  }
  return null
}

export function FeedView({
  items,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpen,
}: {
  items: FeedItem[]
  loading: boolean
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onOpen: (href: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const [, tick] = useReducer((n: number) => n + 1, 0)
  useActiveInterval(tick, CLOCK_MS)
  const now = Date.now()

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW,
    overscan: 8,
    getItemKey: (index) => items[index]?.id ?? index,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const lastVisible = virtualItems[virtualItems.length - 1]?.index
  useEffect(() => {
    if (lastVisible === undefined || !hasMore || loadingMore) return
    if (lastVisible >= items.length - 5) onLoadMore()
  }, [lastVisible, hasMore, loadingMore, items.length, onLoadMore])

  const openProfile = (handle: string) => onOpen(profilePath(handle))

  return (
    <div className="column-body" ref={scrollRef}>
      {loading && items.length === 0 ? (
        <p className="column-empty">Loading feed…</p>
      ) : items.length === 0 ? (
        <p className="column-empty">Nothing in the feed yet.</p>
      ) : (
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualItems.map((row) => {
            const item = items[row.index]
            if (!item) return null
            const target = destination(item)
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
                <div className="alert-row" data-static={target ? undefined : ''}>
                  {target && <RowLink href={target.href} label={target.label} onOpen={onOpen} />}
                  {item.kind === 'trade' && <TradeRow item={item} now={now} onOpenProfile={openProfile} />}
                  {item.kind === 'multi' && <MultiRow item={item} now={now} />}
                  {item.kind === 'thesis' && <ThesisRow item={item} now={now} onOpenProfile={openProfile} />}
                  {item.kind === 'milestone' && (
                    <MilestoneRow item={item} now={now} onOpenProfile={openProfile} />
                  )}
                  {item.kind === 'verified' && <VerifiedRow item={item} now={now} />}
                  {item.kind === 'smart' && <SmartRow item={item} now={now} onOpenProfile={openProfile} />}
                  {item.kind === 'post' && <PostRow item={item} now={now} onOpenToken={onOpen} />}
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
