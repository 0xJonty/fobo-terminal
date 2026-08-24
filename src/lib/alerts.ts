/**
 * fomo's Alerts feed — the "trading activity" of traders the user follows: their swaps and
 * transfers, multi-user buy/sell clusters, theses, and profit milestones.
 *
 * Everything here is read out of fomo's own bundle (the alerts panel chunk) and verified
 * against the live API, never guessed:
 *   backfill  GET /feed/tradingActivity?limit=50[&lastId=<id>]   (fomo pages by last item id)
 *   live      WebSocket topic `trading_activity`, topicId = the user's own id; each data
 *             frame's payload is one feed item, prepended.
 *
 * fomo's item vocabulary: swap_buy / swap_sell / transfer_in / transfer_out / multi_user_buy /
 * multi_user_sell / thesis / user_trade_profit_milestone / manual. `manual` is skipped by
 * fomo's own renderer, so we skip it too. Rows on chains we cannot name are dropped, exactly
 * as the token columns drop them — a wrong chain link is worse than a missing row.
 */

import { fomoCall } from '~/lib/fomoApi'
import { safeImageUrl } from '~/lib/url'
import { chainSlug } from '~/types/token'

/** fomo requests pages of 50 (its `ks`). */
const PAGE_LIMIT = 50

/** Bound on the merged list, so a long-lived tab cannot grow it without limit. */
export const MAX_ALERTS = 400

interface AlertBase {
  id: string
  /** Milliseconds since epoch, parsed from fomo's ISO `createdAt`. */
  createdAtMs: number
  tokenAddress: string
  networkId: number
  /** fomo's URL slug for the chain — present because unknown chains are dropped at parse. */
  chain: string
  ticker?: string
  tokenImageUrl?: string
  /** fdv ?? marketCap, fomo's own preference order. */
  marketCap?: number
}

export interface SwapAlert extends AlertBase {
  kind: 'swap'
  /** Buy / Sell for swaps; Received / Sent for transfers. */
  action: 'buy' | 'sell' | 'receive' | 'send'
  userId?: string
  userHandle?: string
  displayName?: string
  profilePictureLink?: string
  usdAmount?: number
}

export interface MultiAlert extends AlertBase {
  kind: 'multi'
  action: 'buy' | 'sell'
  totalVolume?: number
  uniqueTraders?: number
  numTrades?: number
  /** The window the cluster was observed over. */
  minutes?: number
  topTraders: { userHandle?: string; displayName?: string; userImageUrl?: string }[]
}

export interface ThesisAlert extends AlertBase {
  kind: 'thesis'
  userId?: string
  userHandle?: string
  displayName?: string
  profilePictureLink?: string
  comment?: string
  /** The author's open position in the token, USD. */
  positionUsd?: number
}

export interface MilestoneAlert extends AlertBase {
  kind: 'milestone'
  userId?: string
  userHandle?: string
  displayName?: string
  profilePictureLink?: string
  pnlUsd?: number
  pnlPercent?: number
  /** fomo's cohort tag on the trader, e.g. "Top Trader". */
  tag?: string
}

export type AlertItem = SwapAlert | MultiAlert | ThesisAlert | MilestoneAlert

function num(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * Parse one wire item into our shape. Null when identity is missing, the type is unknown,
 * or the chain is one we cannot name — a shape change upstream degrades to fewer rows.
 */
export function parseAlert(raw: unknown): AlertItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const row = raw as Record<string, unknown>

  const id = str(row.id)
  const type = str(row.type)
  const tokenAddress = str(row.tokenAddress)
  const networkId = typeof row.networkId === 'number' ? row.networkId : undefined
  const createdAtMs = typeof row.createdAt === 'string' ? Date.parse(row.createdAt) : NaN
  if (!id || !type || !tokenAddress || networkId === undefined || !Number.isFinite(createdAtMs)) {
    return null
  }
  const chain = chainSlug(networkId)
  if (chain === undefined) return null

  const base = { id, createdAtMs, tokenAddress, networkId, chain }
  const body = (typeof row.body === 'object' && row.body !== null ? row.body : {}) as Record<
    string,
    unknown
  >

  switch (type) {
    case 'swap_buy':
    case 'swap_sell':
    case 'transfer_in':
    case 'transfer_out': {
      const action =
        type === 'swap_buy'
          ? 'buy'
          : type === 'swap_sell'
            ? 'sell'
            : type === 'transfer_in'
              ? 'receive'
              : 'send'
      return {
        ...base,
        kind: 'swap',
        action,
        ticker: str(row.ticker),
        tokenImageUrl: safeImageUrl(row.tokenImageUrl),
        marketCap: num(row.fdv) ?? num(row.marketCap),
        userId: str(row.userId),
        userHandle: str(row.userHandle),
        displayName: str(row.displayName),
        profilePictureLink: safeImageUrl(row.profilePictureLink),
        usdAmount: num(row.usdAmount),
      }
    }

    case 'multi_user_buy':
    case 'multi_user_sell': {
      const rawTraders = Array.isArray(body.topTraders) ? body.topTraders : []
      return {
        ...base,
        kind: 'multi',
        action: type === 'multi_user_buy' ? 'buy' : 'sell',
        ticker: str(body.ticker),
        tokenImageUrl: safeImageUrl(body.tokenImageUrl),
        marketCap: num(body.fdv) ?? num(body.marketCap),
        totalVolume: num(body.totalVolume),
        uniqueTraders: num(body.uniqueTraders),
        numTrades: num(body.numTrades),
        minutes: num(body.minutes),
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

    case 'thesis': {
      const comment = (
        typeof row.comment === 'object' && row.comment !== null ? row.comment : {}
      ) as Record<string, unknown>
      const authorTrade = (
        typeof row.authorTrade === 'object' && row.authorTrade !== null ? row.authorTrade : {}
      ) as Record<string, unknown>
      return {
        ...base,
        kind: 'thesis',
        ticker: str(row.ticker),
        tokenImageUrl: safeImageUrl(row.tokenImageUrl),
        marketCap: num(row.fdv) ?? num(row.marketCap),
        userId: str(row.userId),
        userHandle: str(row.userHandle),
        displayName: str(row.displayName),
        profilePictureLink: safeImageUrl(row.profilePictureLink),
        comment: str(comment.comment),
        positionUsd: num(authorTrade.usdValue),
      }
    }

    case 'user_trade_profit_milestone': {
      return {
        ...base,
        kind: 'milestone',
        ticker: str(body.ticker),
        tokenImageUrl: safeImageUrl(body.tokenImageUrl),
        marketCap: num(body.fdv) ?? num(body.marketCap),
        userId: str(row.userId),
        userHandle: str(body.userHandle),
        displayName: str(body.displayName),
        profilePictureLink: safeImageUrl(body.userImageUrl),
        pnlUsd: num(body.totalPnlUsd),
        pnlPercent: num(body.totalPercentagePnl),
        tag: str(body.tag),
      }
    }

    default:
      // `manual` and anything fomo adds later: their renderer returns null, so do we.
      return null
  }
}

export interface AlertsPage {
  items: AlertItem[]
  hasNextPage: boolean
  /** The LAST RAW item's id — fomo pages by it, so it must survive our parse filtering. */
  lastId?: string
}

/**
 * fomo's alerts filters, exactly as its own fetch builds them (the side panel chunk's `ws`):
 * threshold is the min trade size in USD, minEquity the trader's min portfolio value (sent
 * only when positive), and the market-cap bounds are plain min/max. All server-side — the
 * response is already filtered.
 */
export interface AlertsFilters {
  threshold?: number
  minEquity?: number
  minMarketCap?: number
  maxMarketCap?: number
}

/** GET /feed/tradingActivity — one backfill page, filtered fomo's way. */
export async function fetchAlertsPage(lastId?: string, filters?: AlertsFilters): Promise<AlertsPage | null> {
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT) })
  if (lastId) params.set('lastId', lastId)
  if (filters?.threshold !== undefined) params.set('threshold', String(filters.threshold))
  if (filters?.minEquity !== undefined && filters.minEquity > 0) params.set('minEquity', String(filters.minEquity))
  if (filters?.minMarketCap !== undefined) params.set('minMarketCap', String(filters.minMarketCap))
  if (filters?.maxMarketCap !== undefined) params.set('maxMarketCap', String(filters.maxMarketCap))
  const raw = await fomoCall<{ items?: unknown[]; hasNextPage?: unknown }>(
    `/feed/tradingActivity?${params.toString()}`,
  )
  if (!raw || !Array.isArray(raw.items)) return null

  const items = raw.items.map(parseAlert).filter((item): item is AlertItem => item !== null)
  const lastRaw = raw.items[raw.items.length - 1] as { id?: unknown } | undefined
  return {
    items,
    hasNextPage: raw.hasNextPage === true,
    lastId: typeof lastRaw?.id === 'string' ? lastRaw.id : undefined,
  }
}

/**
 * Best-effort filter for LIVE frames — the socket topic is not parameterised, so the bounds
 * the server applied to the backfill are re-applied here on the fields a frame carries.
 * Trade size only constrains swaps/transfers (the kinds it means anything for); an unknown
 * market cap passes rather than silently killing theses and milestones; minEquity is the
 * trader's portfolio value, which frames do not carry, so it stays server-side only.
 */
export function passesAlertsFilters(item: AlertItem, filters: AlertsFilters): boolean {
  if (filters.threshold !== undefined && item.kind === 'swap') {
    if (item.usdAmount !== undefined && Math.abs(item.usdAmount) < filters.threshold) return false
  }
  if (item.marketCap !== undefined) {
    if (filters.minMarketCap !== undefined && item.marketCap < filters.minMarketCap) return false
    if (filters.maxMarketCap !== undefined && item.marketCap > filters.maxMarketCap) return false
  }
  return true
}

/** fomo's ordering: createdAt descending, id ascending as the tiebreak (its `Se`). */
function compare(a: AlertItem, b: AlertItem): number {
  if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs < b.createdAtMs ? 1 : -1
  return a.id === b.id ? 0 : a.id < b.id ? -1 : 1
}

/** Merge new items (live or backfill) into the list: dedupe by id, resort, cap. */
export function mergeAlerts(current: readonly AlertItem[], incoming: readonly AlertItem[]): AlertItem[] {
  if (incoming.length === 0) return current as AlertItem[]
  const seen = new Set(current.map((item) => item.id))
  const fresh = incoming.filter((item) => !seen.has(item.id))
  if (fresh.length === 0) return current as AlertItem[]
  return [...current, ...fresh].sort(compare).slice(0, MAX_ALERTS)
}
