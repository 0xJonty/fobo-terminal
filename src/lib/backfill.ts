/**
 * First-party backfill for fomo's thin trending rows.
 *
 * The `trending_tokens` socket frames omit most of what a card shows — measured live on a
 * 79-row snapshot: liquidity 0/79, createdAt 0/79, change1/change5m 0/79; only marketCap,
 * volume24, change24, priceUSD, holders and images arrive. The full rows exist on fomo's
 * side: POST /proxy/filterTokens with the same `${address}:${networkId}` ids returns fomo's
 * standard list-row shape, complete (verified live: liquidity 12/12, createdAt 11/12, plus
 * the 1h trade counts). It is the same endpoint fomo's own bottom bar and watchlist read.
 *
 * Same contract as mobula.ts: decoration only. The socket owns membership and order; this
 * cache only fills fields a row arrived without, and only from fomo's own data.
 */

import { fomoCall } from '~/lib/fomoApi'
import { fromFomoRow, type Token, type TokenMetrics } from '~/types/token'

/** How long a fetched row is considered fresh. Stale entries still serve fills until replaced. */
const TTL_MS = 60_000

/** fomo's own client batches filterTokens at 100 ids per request; match it. */
const BATCH = 100

/** Backoff after a failed fetch: 30s, 60s, ... capped at 10 minutes (mobula.ts's policy). */
const BACKOFF_BASE_MS = 30_000
const BACKOFF_MAX_MS = 600_000

interface CacheEntry {
  at: number
  /** null: the id was requested and the response omitted it — no point refetching every tick. */
  token: Token | null
}

const cache = new Map<string, CacheEntry>()
let inflight = false
let failureCount = 0
let retryAt = 0

const METRIC_KEYS = [
  'holdersCount',
  'top10Holdings',
  'devHoldings',
  'proTradersCount',
  'smartTradersCount',
  'securityScore',
  'deployerMigrationsCount',
  'twitterReusesCount',
  'buys1h',
  'sells1h',
  'trades1h',
  'volume1h',
] as const

/** Per-field first-defined-wins merge; earlier sources take precedence. */
function mergeMetrics(...sources: (TokenMetrics | undefined)[]): TokenMetrics | undefined {
  let out: TokenMetrics | undefined
  for (const key of METRIC_KEYS) {
    for (const source of sources) {
      const value = source?.[key]
      if (value !== undefined) {
        ;(out ??= {})[key] = value
        break
      }
    }
  }
  return out
}

/**
 * Left join for one row: `base` (fomo's stream) always wins; `fill` (our filterTokens
 * backfill, same first party) supplies what the stream omitted; `mobula` decorates last.
 * Nothing is ever overwritten and nothing is invented — a field all three lack stays absent.
 */
export function mergeToken(
  base: Token,
  fill: Token | undefined,
  mobula: TokenMetrics | undefined,
): Token {
  if (!fill && !mobula) return base
  if (!fill) return { ...base, metrics: mergeMetrics(base.metrics, mobula) }
  return {
    ...base,
    symbol: base.symbol || fill.symbol,
    name: base.name || fill.name,
    logo: base.logo ?? fill.logo,
    priceUSD: base.priceUSD ?? fill.priceUSD,
    marketCap: base.marketCap ?? fill.marketCap,
    liquidity: base.liquidity ?? fill.liquidity,
    volume24: base.volume24 ?? fill.volume24,
    change5m: base.change5m ?? fill.change5m,
    change1h: base.change1h ?? fill.change1h,
    change24h: base.change24h ?? fill.change24h,
    createdAt: base.createdAt ?? fill.createdAt,
    graduationPercent: base.graduationPercent ?? fill.graduationPercent,
    source: base.source ?? fill.source,
    socials: {
      twitter: base.socials?.twitter ?? fill.socials?.twitter,
      telegram: base.socials?.telegram ?? fill.socials?.telegram,
      website: base.socials?.website ?? fill.socials?.website,
    },
    metrics: mergeMetrics(base.metrics, fill.metrics, mobula),
  }
}

/**
 * Fetch full rows for tokens that arrived without their card fields (no liquidity or no
 * createdAt). Never throws; a failed call backs off and the cards simply stay sparse until
 * the next success. One request in flight at a time, at most BATCH ids per request.
 */
export function warmBackfill(tokens: readonly Token[]): void {
  if (inflight) return
  const now = Date.now()
  if (now < retryAt) return

  const wanted: Token[] = []
  for (const token of tokens) {
    if (token.liquidity !== undefined && token.createdAt !== undefined) continue
    const entry = cache.get(token.key)
    if (entry && now - entry.at < TTL_MS) continue
    wanted.push(token)
    if (wanted.length === BATCH) break
  }
  if (wanted.length === 0) return

  inflight = true
  // The wire takes raw `${address}:${networkId}` ids; token.key folds EVM casing, so the id
  // is rebuilt from the address fomo actually sent (watchlist.ts does the same).
  const ids = wanted.map((token) => `${token.address}:${token.networkId}`)
  void fomoCall<unknown[]>('/proxy/filterTokens', { method: 'POST', body: JSON.stringify(ids) })
    .then((rows) => {
      if (!rows || !Array.isArray(rows)) {
        // A null is a failed or unauthorized call, not an empty answer — back off, and do
        // not negative-cache ids the server never actually reported on.
        failureCount += 1
        retryAt = Date.now() + Math.min(BACKOFF_BASE_MS * 2 ** (failureCount - 1), BACKOFF_MAX_MS)
        return
      }
      failureCount = 0
      const at = Date.now()
      const byKey = new Map<string, Token>()
      for (const raw of rows) {
        const token = fromFomoRow(raw)
        if (token) byKey.set(token.key, token)
      }
      for (const token of wanted) cache.set(token.key, { at, token: byKey.get(token.key) ?? null })
    })
    .finally(() => {
      inflight = false
    })
}

/** Cached full row for one token, if a backfill has landed. */
export function backfillFor(key: string): Token | undefined {
  return cache.get(key)?.token ?? undefined
}
