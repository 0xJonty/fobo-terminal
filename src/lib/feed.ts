/**
 * fomo's social Feed — the side panel's "Feed" tab. Read out of fomo's own bundle (the side
 * panel chunk) and verified against the live API:
 *
 *   GET /feed?limit=50[&lastFeedId=<id>]&feedTypes=a&feedTypes=b...   -> responseObject.feed
 *
 * The feedTypes params are REQUIRED (the endpoint 400s without them); fomo sends the enabled
 * set, and "everything" is all thirteen listed below. Items carry top-level identity
 * (tokenAddress/networkId, both null for fomo's own "manual" posts) and a per-type `body`.
 * Types verified against live payloads where the feed carried them; the rest mirror fomo's
 * renderer field reads (its Qt/Wt/es/zt components — fomo phrases a listing as "verified").
 * Unknown types are skipped, exactly as fomo's own switch defaults to null.
 */

import { fomoCall } from '~/lib/fomoApi'
import { safeImageUrl } from '~/lib/url'
import { chainSlug } from '~/types/token'

const PAGE_LIMIT = 50

/** Bound on the merged list, so a long-lived tab cannot grow it without limit. */
export const MAX_FEED = 400

/**
 * fomo's own filter groups for the Feed tab, lifted verbatim from its bundle (ids, member
 * types, and labels via its i18n keys). The UI toggles groups, and the query carries the
 * enabled groups' types. fomo's "manual" posts (the pinned recaps) belong to no group and
 * ride along whenever ANY group is enabled; with every group off, fomo fetches nothing.
 */
export interface FeedGroup {
  id: string
  label: string
  types: readonly string[]
}

export const FEED_GROUPS: readonly FeedGroup[] = [
  {
    id: 'trades',
    label: 'Trades',
    types: ['large_buy', 'large_sell', 'large_transfer_in', 'large_transfer_out', 'single_user_transfer_out'],
  },
  { id: 'closed', label: 'Closed positions', types: ['single_user_sell'] },
  { id: 'theses', label: 'Theses', types: ['thesis_created'] },
  { id: 'multiUser', label: 'Multi-user trades', types: ['multi_user_buy', 'multi_user_sell'] },
  { id: 'newListings', label: 'New listings', types: ['new_token_listing'] },
  { id: 'priceSpikes', label: 'Price spikes', types: ['price_since_listing'] },
  { id: 'milestones', label: 'Profit milestones', types: ['user_trade_profit_milestone'] },
  { id: 'newTraders', label: 'New traders', types: ['user_with_smart_following'] },
]

/** The feedTypes params for a disabled-groups set — fomo's `je`, exactly. */
export function feedTypesFor(disabledGroups: readonly string[]): string[] {
  const enabled = FEED_GROUPS.filter((group) => !disabledGroups.includes(group.id)).flatMap(
    (group) => [...group.types],
  )
  return enabled.length === 0 ? [] : [...enabled, 'manual']
}

interface FeedBase {
  id: string
  createdAtMs: number
  pinned: boolean
  likes?: number
  tokenAddress?: string
  networkId?: number
  /** Present exactly when the token identity is present — unknown chains are dropped. */
  chain?: string
  ticker?: string
  tokenImageUrl?: string
  marketCap?: number
}

interface FeedTrader {
  userHandle?: string
  displayName?: string
  userImageUrl?: string
}

/** large_* and single_user_* — one trader's oversized or position-closing move. */
export interface TradeFeedItem extends FeedBase, FeedTrader {
  kind: 'trade'
  /** Displayed verb, from the wire type. */
  verb: 'Bought' | 'Sold' | 'Received' | 'Sent' | 'Closed'
  usdAmount?: number
  realizedPnlUsd?: number
  /** Already a percentage (fomo sends 1842.17 for +1842%). */
  realizedPnlPercent?: number
}

export interface MultiFeedItem extends FeedBase {
  kind: 'multi'
  action: 'buy' | 'sell'
  uniqueTraders?: number
  areTopTraders?: boolean
  totalVolume?: number
  topTraders: FeedTrader[]
}

export interface ThesisFeedItem extends FeedBase, FeedTrader {
  kind: 'thesis'
  comment?: string
  positionUsd?: number
}

export interface MilestoneFeedItem extends FeedBase, FeedTrader {
  kind: 'milestone'
  pnlUsd?: number
  /** Already a percentage. */
  pnlPercent?: number
}

/** new_token_listing / price_since_listing — fomo phrases both around "verification". */
export interface VerifiedFeedItem extends FeedBase {
  kind: 'verified'
  sinceListing: boolean
  /** Already a percentage. */
  changePercent?: number
}

export interface SmartFollowFeedItem extends FeedBase, FeedTrader {
  kind: 'smart'
  followerCount?: number
}

/** A segment of a fomo post body: plain text, or a link into a token page. */
export interface PostSegment {
  text: string
  /** In-app path, e.g. /tokens/base/0x… — absent for plain text and non-token links. */
  href?: string
}

/** fomo's own "manual" posts — the pinned recaps. */
export interface PostFeedItem extends FeedBase {
  kind: 'post'
  title?: string
  author?: string
  segments: PostSegment[]
}

export type FeedItem =
  | TradeFeedItem
  | MultiFeedItem
  | ThesisFeedItem
  | MilestoneFeedItem
  | VerifiedFeedItem
  | SmartFollowFeedItem
  | PostFeedItem

function num(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

const TRADE_VERB: Readonly<Record<string, TradeFeedItem['verb']>> = {
  large_buy: 'Bought',
  large_sell: 'Sold',
  large_transfer_in: 'Received',
  large_transfer_out: 'Sent',
  single_user_sell: 'Closed',
  single_user_transfer_out: 'Closed',
}

/**
 * The trade's USD size, from fomo's own numbers only. Transfers carry it outright as
 * usdValue; closes carry closingEventUsdAmount; swaps carry price and the token amount, whose
 * product is the same figure fomo derives (verified against live rows to within slippage).
 */
function tradeUsd(body: Record<string, unknown>): number | undefined {
  const direct = num(body.usdValue) ?? num(body.closingEventUsdAmount)
  if (direct !== undefined) return Math.abs(direct)
  const price = num(body.price)
  const amount = num(body.humanTokenAmount)
  if (price === undefined || amount === undefined) return undefined
  const usd = Math.abs(price * amount)
  return Number.isFinite(usd) && usd > 0 ? usd : undefined
}

/**
 * fomo post bodies link tokens as markdown: [$X](token://<chain>/<address>). Split into
 * segments so the panel can linkify token mentions into fomo's own token pages. Non-token
 * schemes (perp://…) keep their text and lose the link — a wrong destination is worse.
 */
export function parsePostSegments(text: string): PostSegment[] {
  const segments: PostSegment[] = []
  const link = /\[([^\]]+)\]\(([^)\s]+)\)/g
  let cursor = 0
  for (const match of text.matchAll(link)) {
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index) })
    const target = /^token:\/\/([\w-]+)\/([\w.-]+)$/.exec(match[2] ?? '')
    segments.push({
      text: match[1] ?? '',
      href: target ? `/tokens/${target[1]}/${target[2]}` : undefined,
    })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) })
  return segments
}

/** Parse one wire item. Null for unknown types, missing identity, or unnameable chains. */
export function parseFeedItem(raw: unknown): FeedItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>

  const id = str(row.id)
  const type = str(row.type)
  const createdAtMs = typeof row.createdAt === 'string' ? Date.parse(row.createdAt) : NaN
  if (!id || !type || !Number.isFinite(createdAtMs)) return null

  const body = (typeof row.body === 'object' && row.body !== null ? row.body : {}) as Record<
    string,
    unknown
  >

  const base: FeedBase = {
    id,
    createdAtMs,
    pinned: row.pinned === true,
    likes: num(row.likes),
    ticker: str(body.ticker),
    tokenImageUrl: safeImageUrl(body.tokenImageUrl),
    marketCap: num(body.fdv) ?? num(body.marketCap),
  }

  // Token identity is top-level and null on fomo's own posts. When present, an unknown
  // chain drops the row — a card linking to the wrong chain is worse than no card.
  const tokenAddress = str(row.tokenAddress)
  const networkId = typeof row.networkId === 'number' ? row.networkId : undefined
  if (tokenAddress && networkId !== undefined) {
    const chain = chainSlug(networkId)
    if (chain === undefined) return null
    base.tokenAddress = tokenAddress
    base.networkId = networkId
    base.chain = chain
  }

  const trader: FeedTrader = {
    userHandle: str(body.userHandle),
    displayName: str(body.displayName),
    userImageUrl: safeImageUrl(body.userImageUrl),
  }

  switch (type) {
    case 'large_buy':
    case 'large_sell':
    case 'large_transfer_in':
    case 'large_transfer_out':
    case 'single_user_sell':
    case 'single_user_transfer_out': {
      const closing = type.startsWith('single_user')
      return {
        ...base,
        ...trader,
        kind: 'trade',
        verb: TRADE_VERB[type] ?? 'Bought',
        usdAmount: tradeUsd(body),
        realizedPnlUsd: closing ? num(body.realizedPnlUsd) : undefined,
        realizedPnlPercent: closing ? num(body.percentageRealizedPnl) : undefined,
      }
    }

    case 'multi_user_buy':
    case 'multi_user_sell': {
      const rawTraders = Array.isArray(body.topTraders) ? body.topTraders : []
      return {
        ...base,
        kind: 'multi',
        action: type === 'multi_user_buy' ? 'buy' : 'sell',
        uniqueTraders: num(body.uniqueTraders),
        areTopTraders: body.areTopTraders === true,
        totalVolume: num(body.totalVolume),
        topTraders: rawTraders
          .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
          .slice(0, 3)
          .map((t) => ({
            userHandle: str(t.userHandle),
            displayName: str(t.displayName),
            userImageUrl: safeImageUrl(t.userImageUrl),
          })),
      }
    }

    case 'thesis_created':
      return {
        ...base,
        ...trader,
        kind: 'thesis',
        comment: str(body.comment),
        positionUsd: num(body.positionNotionalUsd),
      }

    case 'user_trade_profit_milestone':
      return {
        ...base,
        ...trader,
        kind: 'milestone',
        pnlUsd: num(body.totalPnlUsd),
        pnlPercent: num(body.totalPercentagePnl),
      }

    case 'new_token_listing':
    case 'price_since_listing':
      return {
        ...base,
        kind: 'verified',
        sinceListing: type === 'price_since_listing',
        changePercent: num(body.changePercentage),
      }

    case 'user_with_smart_following': {
      const followers = Array.isArray(body.followers) ? body.followers.length : undefined
      return { ...base, ...trader, kind: 'smart', followerCount: followers }
    }

    case 'manual': {
      const description = str(body.description)
      return {
        ...base,
        kind: 'post',
        title: str(body.title),
        author: str(body.displayName),
        segments: description ? parsePostSegments(description) : [],
      }
    }

    default:
      return null
  }
}

export interface FeedPage {
  items: FeedItem[]
  /** The LAST RAW item's id — fomo pages by it, so it must survive our parse filtering. */
  lastId?: string
  hasMore: boolean
}

export async function fetchFeedPage(
  lastFeedId?: string,
  disabledGroups: readonly string[] = [],
): Promise<FeedPage | null> {
  const types = feedTypesFor(disabledGroups)
  // Every group off means fomo fetches nothing — the endpoint 400s on an empty types list.
  if (types.length === 0) return { items: [], lastId: undefined, hasMore: false }
  const params = types.map((type) => `feedTypes=${type}`).join('&')
  const path = `/feed?limit=${PAGE_LIMIT}${lastFeedId ? `&lastFeedId=${encodeURIComponent(lastFeedId)}` : ''}&${params}`
  const raw = await fomoCall<{ feed?: unknown[] }>(path)
  if (!raw || !Array.isArray(raw.feed)) return null

  const items = raw.feed.map(parseFeedItem).filter((item): item is FeedItem => item !== null)
  const lastRaw = raw.feed[raw.feed.length - 1] as { id?: unknown } | undefined
  return {
    items,
    lastId: typeof lastRaw?.id === 'string' ? lastRaw.id : undefined,
    hasMore: raw.feed.length >= PAGE_LIMIT,
  }
}

/** fomo's ordering: pinned posts first, then createdAt descending. */
function compare(a: FeedItem, b: FeedItem): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs < b.createdAtMs ? 1 : -1
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
}

/** Merge new items into the list: dedupe by id, resort, cap. */
export function mergeFeed(current: readonly FeedItem[], incoming: readonly FeedItem[]): FeedItem[] {
  if (incoming.length === 0) return current as FeedItem[]
  const seen = new Set(current.map((item) => item.id))
  const fresh = incoming.filter((item) => !seen.has(item.id))
  if (fresh.length === 0) return current as FeedItem[]
  return [...current, ...fresh].sort(compare).slice(0, MAX_FEED)
}
