/**
 * The normalised token row the UI renders.
 *
 * Two sources feed it: fomo's own lists (authoritative for membership and ordering) and
 * Mobula's open Pulse endpoint (decoration only). Everything Mobula supplies is optional —
 * a card renders what it has and omits what it does not. We never invent a metric.
 */

import { safeImageUrl } from '~/lib/url'

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

/**
 * Returns undefined for a network we do not know.
 *
 * This used to fall back to 'solana', which meant an unrecognised networkId produced a card
 * labelled with — and linking to — the wrong chain entirely. Guessing a chain is worse than
 * dropping the row, so callers drop.
 */
export function chainSlug(networkId: number): string | undefined {
  return NETWORK_SLUG[networkId]
}

/**
 * The key fomo uses to identify a row in its diff protocol.
 *
 * EVM addresses are case-insensitive and reach us in mixed casing — fomo tends to send them
 * checksummed, Mobula lowercased — so the same token produced two different keys and enrichment
 * silently never matched. Solana addresses are base58 and ARE case-sensitive, so only the 0x
 * family is folded.
 */
export function tokenKey(address: string, networkId: number): string {
  const canonical = address.startsWith('0x') ? address.toLowerCase() : address
  return `${canonical}:${networkId}`
}

/** Apply the same folding to a key that arrived on the wire, so it matches the ones we build. */
export function normalizeKey(key: string): string {
  return key.startsWith('0x') ? key.toLowerCase() : key
}

/** Risk/holder metrics. Sourced from Mobula; every field may be absent. */
export interface TokenMetrics {
  holdersCount?: number
  top10Holdings?: number
  devHoldings?: number
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
    info?: {
      totalSupply?: number | string
      circulatingSupply?: number | string
      decimals?: number | string
      imageSmallUrl?: string
      imageThumbUrl?: string
      imageLargeUrl?: string
    }
    launchpad?: { graduationPercent?: number }
    socialLinks?: Record<string, string | undefined>
  }
  marketCap?: string | number
  fdv?: string | number
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
 * No single asset is worth $10t, so a market cap at or above this did not come from reality — it
 * came from multiplying a price by a supply still denominated in base units. We show nothing
 * rather than a number we know is wrong.
 */
const MAX_PLAUSIBLE_MARKET_CAP = 1e13

/**
 * Market cap, preferring a figure fomo reports outright over one we derive.
 *
 * The derived path is the fragile one: `totalSupply` arrives raw when the row also carries
 * `decimals`, and multiplying that by price overstates the cap by 10^decimals. We scale by
 * decimals when they are reported and discard anything still implausible afterwards.
 */
function marketCapOf(row: FomoRow, priceUSD: number | undefined): number | undefined {
  const reported = num(row.marketCap) ?? num(row.fdv)
  if (reported !== undefined && reported > 0) return reported

  if (priceUSD === undefined) return undefined
  const rawSupply = num(row.token?.info?.circulatingSupply) ?? num(row.token?.info?.totalSupply)
  if (rawSupply === undefined || rawSupply <= 0) return undefined

  const decimals = num(row.token?.info?.decimals)
  const supply = decimals !== undefined && decimals > 0 ? rawSupply / 10 ** decimals : rawSupply

  const cap = priceUSD * supply
  if (!Number.isFinite(cap) || cap <= 0 || cap >= MAX_PLAUSIBLE_MARKET_CAP) return undefined
  return cap
}

/**
 * fomo's `createdAt` is unix seconds, but millisecond timestamps show up on some rows. Left
 * unnormalised those read as ~55 years in the future, which the age formatter clamps to "0s" —
 * so every affected token claimed to be brand new. Anything past this bound cannot be seconds
 * (it would be the year 33658), so it is milliseconds.
 */
const MS_THRESHOLD = 1e12

function createdAtSeconds(value: unknown): number | undefined {
  const n = num(value)
  if (n === undefined || n <= 0) return undefined
  return n >= MS_THRESHOLD ? Math.floor(n / 1000) : n
}

/**
 * Adapt one row from a fomo list. Returns null when the row lacks the identity we need,
 * so a shape change downstream degrades to "fewer rows" rather than a crash.
 */
export function fromFomoRow(raw: unknown): Token | null {
  const row = raw as FomoRow | null
  const address = row?.token?.address
  const networkId = row?.token?.networkId
  if (typeof address !== 'string' || address === '' || typeof networkId !== 'number') return null

  // An unknown network means we cannot name the chain or build a working link, and guessing one
  // produces a card that is confidently wrong. Drop the row instead.
  const chain = chainSlug(networkId)
  if (chain === undefined) return null

  const priceUSD = num(row?.priceUSD)

  return {
    key: tokenKey(address, networkId),
    address,
    networkId,
    chain,
    symbol: row?.token?.symbol ?? '',
    name: row?.token?.name ?? '',
    logo:
      safeImageUrl(row?.token?.info?.imageSmallUrl) ??
      safeImageUrl(row?.token?.info?.imageThumbUrl) ??
      safeImageUrl(row?.token?.info?.imageLargeUrl),
    priceUSD,
    marketCap: marketCapOf(row ?? {}, priceUSD),
    liquidity: num(row?.liquidity),
    volume24: num(row?.volume24),
    change5m: num(row?.change5m),
    change1h: num(row?.change1),
    change24h: num(row?.change24),
    createdAt: createdAtSeconds(row?.createdAt),
    graduationPercent: num(row?.token?.launchpad?.graduationPercent),
    socials: {
      twitter: row?.token?.socialLinks?.twitter,
      telegram: row?.token?.socialLinks?.telegram,
      website: row?.token?.socialLinks?.website,
    },
  }
}
