/**
 * Mobula Pulse enrichment.
 *
 * fomo's own list rows carry price/liquidity/change but none of the holder-concentration
 * metrics an Axiom-style card shows. Mobula's Pulse endpoint carries all of them, is open
 * (no auth, `access-control-allow-origin: *`), and is already allowed by fomo's CSP
 * `connect-src`, so the content script can call it directly.
 *
 * This is decoration only. fomo remains the source of truth for list membership and order.
 */

import { tokenKey, type TokenMetrics } from '~/types/token'

const ENDPOINT = 'https://fomo-api.mobula.io/api/2/pulse'

/** The payload is ~1.5 MB per chain, so poll slowly and cache hard. */
const TTL_MS = 60_000

/** networkId -> Mobula's chainId parameter. Chains absent here simply go un-enriched. */
const MOBULA_CHAIN: Readonly<Record<number, string>> = {
  1: 'evm:1',
  56: 'evm:56',
  143: 'evm:143',
  4663: 'evm:4663',
  8453: 'evm:8453',
  1399811149: 'solana:solana',
}

interface CacheEntry {
  at: number
  rows: Map<string, TokenMetrics>
}

const cache = new Map<number, CacheEntry>()
const inflight = new Map<number, Promise<void>>()

function num(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function toMetrics(row: Record<string, unknown>): TokenMetrics {
  return {
    holdersCount: num(row.holdersCount),
    // Holdings arrive already as percentages. An earlier fraction assumption multiplied them by
    // 100 and produced cards claiming +7114% top-10 concentration.
    top10Holdings: num(row.top10Holdings),
    devHoldings: num(row.devHoldings),
    proTradersCount: num(row.proTradersCount),
    smartTradersCount: num(row.smartTradersCount),
    securityScore: num(row.securityScore),
    deployerMigrationsCount: num(row.deployerMigrationsCount),
    twitterReusesCount: num(row.twitterReusesCount),
    buys1h: num(row.buys_1h),
    sells1h: num(row.sells_1h),
    trades1h: num(row.trades_1h),
    volume1h: num(row.volume_1h),
  }
}

async function refresh(networkId: number): Promise<void> {
  const chainId = MOBULA_CHAIN[networkId]
  if (!chainId) return

  const url = `${ENDPOINT}?assetMode=false&chainId=${encodeURIComponent(chainId)}&model=default`
  const response = await fetch(url, { credentials: 'omit' })
  if (!response.ok) throw new Error(`mobula pulse ${response.status}`)

  const body = (await response.json()) as Record<string, { data?: unknown[] } | undefined>
  const rows = new Map<string, TokenMetrics>()

  // The three views overlap in useful ways; merge them all, later views winning.
  for (const view of ['new', 'bonding', 'bonded']) {
    for (const raw of body[view]?.data ?? []) {
      if (typeof raw !== 'object' || raw === null) continue
      const row = raw as Record<string, unknown>
      const address = row.address
      if (typeof address !== 'string') continue
      rows.set(tokenKey(address, networkId), toMetrics(row))
    }
  }

  cache.set(networkId, { at: Date.now(), rows })
}

/** Kick off a refresh for any chain whose cache is cold. Never throws. */
export function warm(networkIds: Iterable<number>): void {
  const now = Date.now()
  for (const networkId of new Set(networkIds)) {
    if (!MOBULA_CHAIN[networkId]) continue
    const entry = cache.get(networkId)
    if (entry && now - entry.at < TTL_MS) continue
    if (inflight.has(networkId)) continue

    const task = refresh(networkId)
      .catch(() => {
        // Enrichment is optional by design; a failure just means sparser cards.
      })
      .finally(() => {
        inflight.delete(networkId)
      })
    inflight.set(networkId, task)
  }
}

/** Look up cached metrics for one token. Returns undefined when we have nothing honest to show. */
export function metricsFor(key: string, networkId: number): TokenMetrics | undefined {
  return cache.get(networkId)?.rows.get(key)
}

/** Monotonic counter so React can re-render when new enrichment lands. */
export function cacheStamp(): number {
  let stamp = 0
  for (const entry of cache.values()) stamp = Math.max(stamp, entry.at)
  return stamp
}
