/**
 * The normalised token row the UI renders.
 *
 * Two sources feed it: fomo's own lists (authoritative for membership and ordering) and
 * Mobula's open Pulse endpoint (decoration only). Everything Mobula supplies is optional —
 * a card renders what it has and omits what it does not. We never invent a metric.
 */

/** networkId -> the chain slug fomo uses in its own URLs (/tokens/<chain>/<address>). */
export const NETWORK_SLUG: Readonly<Record<number, string>> = {
  1: 'ethereum',
  56: 'bnb',
  143: 'monad',
  1337: 'hyperliquid',
  4663: 'robinhood',
  8453: 'base',
  1399811149: 'solana',
}

export function chainSlug(networkId: number): string {
  return NETWORK_SLUG[networkId] ?? 'solana'
}

/** The key fomo uses to identify a row in its diff protocol. */
export function tokenKey(address: string, networkId: number): string {
  return `${address}:${networkId}`
}

/** Risk/holder metrics. Sourced from Mobula; every field may be absent. */
export interface TokenMetrics {
  holdersCount?: number
  top10Holdings?: number
  devHoldings?: number
  snipersCount?: number
  snipersHoldings?: number
  insidersCount?: number
  insidersHoldings?: number
  bundlersHoldings?: number
  proTradersCount?: number
  smartTradersCount?: number
  securityScore?: number
  deployerMigrationsCount?: number
  twitterReusesCount?: number
  buys1h?: number
  sells1h?: number
  trades1h?: number
  volume1h?: number
}

export interface TokenSocials {
  twitter?: string
  telegram?: string
  website?: string
}

export interface Token {
  /** `${address}:${networkId}` — stable identity across both sources. */
  key: string
  address: string
  networkId: number
  chain: string

  symbol: string
  name: string
  logo?: string

  priceUSD?: number
  marketCap?: number
  liquidity?: number
  volume24?: number

  /** Fractional change (0.05 === +5%), as fomo reports it. */
  change5m?: number
  change1h?: number
  change24h?: number

  /** Unix seconds. */
  createdAt?: number

  /** 0–100. Present for bonding-phase tokens. */
  graduationPercent?: number
  /** Launchpad the token originated on, e.g. "pumpfun". */
  source?: string

  socials?: TokenSocials
  metrics?: TokenMetrics
}

/** Shape of a row inside fomo's own list payloads. Everything is defensive — their bundle is hashed per deploy. */
interface FomoRow {
  token?: {
    address?: string
    networkId?: number
    symbol?: string
    name?: string
    info?: { totalSupply?: number | string; imageSmallUrl?: string; imageThumbUrl?: string }
    launchpad?: { graduationPercent?: number }
    socialLinks?: Record<string, string | undefined>
  }
  priceUSD?: string | number
  liquidity?: string | number
  volume24?: string | number
  change5m?: string | number
  change1?: string | number
  change24?: string | number
  createdAt?: number
}

function num(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

/**
 * Adapt one row from a fomo list. Returns null when the row lacks the identity we need,
 * so a shape change downstream degrades to "fewer rows" rather than a crash.
 */
export function fromFomoRow(raw: unknown): Token | null {
  const row = raw as FomoRow | null
  const address = row?.token?.address
  const networkId = row?.token?.networkId
  if (typeof address !== 'string' || typeof networkId !== 'number') return null

  const priceUSD = num(row?.priceUSD)
  const totalSupply = num(row?.token?.info?.totalSupply)

  return {
    key: tokenKey(address, networkId),
    address,
    networkId,
    chain: chainSlug(networkId),
    symbol: row?.token?.symbol ?? '',
    name: row?.token?.name ?? '',
    logo: row?.token?.info?.imageSmallUrl ?? row?.token?.info?.imageThumbUrl,
    priceUSD,
    // fomo computes market cap client-side the same way.
    marketCap: priceUSD !== undefined && totalSupply !== undefined ? priceUSD * totalSupply : undefined,
    liquidity: num(row?.liquidity),
    volume24: num(row?.volume24),
    change5m: num(row?.change5m),
    change1h: num(row?.change1),
    change24h: num(row?.change24),
    createdAt: num(row?.createdAt),
    graduationPercent: num(row?.token?.launchpad?.graduationPercent),
    socials: {
      twitter: row?.token?.socialLinks?.twitter,
      telegram: row?.token?.socialLinks?.telegram,
      website: row?.token?.socialLinks?.website,
    },
  }
}
