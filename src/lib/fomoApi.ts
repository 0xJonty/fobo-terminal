/**
 * Authorized client for fomo's own REST API.
 *
 * Every endpoint, header and calculation here was read out of fomo's production bundle
 * (its fetch wrapper and call sites) rather than guessed, so this cannot drift into invented
 * behaviour: same base URL, same auth header, same response envelope, same portfolio
 * arithmetic. We are a second client of the user's own session — the same Privy JWT the
 * socket uses, sent only to fomo's API, never persisted or logged.
 */

import { SUPPORTED_CHAINS } from '~/lib/protocol'
import { chainSlug, fromFomoRow, tokenKey, type Token } from '~/types/token'

const BASE = 'https://prod-api.fomo.family'

/** Read the page's Privy access token. Stored JSON-stringified by fomo's own storage layer. */
export function readJwt(): string | null {
  try {
    const raw = window.localStorage.getItem('privy:token')
    if (!raw) return null
    const parsed: unknown = raw.startsWith('"') ? JSON.parse(raw) : raw
    return typeof parsed === 'string' && parsed.length > 0 ? parsed : null
  } catch {
    return null
  }
}

/** fomo's response envelope. `responseObject` carries the payload on success. */
interface Envelope<T> {
  statusCode?: number
  responseObject?: T
}

/**
 * One authorized call, mirroring fomo's own wrapper: JSON content type, Bearer JWT,
 * X-Supported-Chains, credentials included. Null on any failure — every caller treats the API
 * as optional decoration, so a failure means a sparser top bar, never a broken one.
 */
async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  const jwt = readJwt()
  if (!jwt) return null

  let response: Response
  try {
    response = await fetch(BASE + path, {
      credentials: 'include',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
        'X-Supported-Chains': SUPPORTED_CHAINS,
      },
    })
  } catch {
    return null
  }
  if (!response.ok) return null

  try {
    const body = (await response.json()) as Envelope<T>
    if (body.statusCode !== undefined && body.statusCode !== 200) return null
    return body.responseObject ?? null
  } catch {
    return null
  }
}

function num(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

/** EVM addresses fold to lowercase; base58 is case-sensitive. Same rule as tokenKey. */
function foldAddress(address: string): string {
  return address.startsWith('0x') ? address.toLowerCase() : address
}

/* ---------- current user ---------- */

export interface FomoUser {
  id: string
  displayName?: string
  userHandle?: string
  profilePictureLink?: string
}

/** GET /v2/users/current — the logged-in fomo profile. */
export async function currentUser(): Promise<FomoUser | null> {
  const raw = await call<Record<string, unknown>>('/v2/users/current')
  if (!raw) return null
  const id = raw.id ?? raw.userId
  if (typeof id !== 'string' && typeof id !== 'number') return null
  return {
    id: String(id),
    displayName: typeof raw.displayName === 'string' ? raw.displayName : undefined,
    userHandle: typeof raw.userHandle === 'string' ? raw.userHandle : undefined,
    profilePictureLink:
      typeof raw.profilePictureLink === 'string' ? raw.profilePictureLink : undefined,
  }
}

/* ---------- wallet balances ---------- */

/**
 * The USDC address fomo treats as cash on each chain, lifted verbatim from its chains chunk.
 * fomo's own portfolio reducer counts the Solana one 1:1 and excludes the EVM ones from the
 * price-multiplied holdings sum; we surface all of them as cash, so total = cash + holdings.
 */
const CASH_ADDRESSES = new Set(
  [
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // Solana
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // Ethereum
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // Base
    '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // BNB
    '0x754704bc059f8c67012fed69bc8a327a5aafb603', // per fomo's chains chunk
    '0x5fc5360d0400a0fd4f2af552add042d716f1d168', // per fomo's chains chunk
  ].map(foldAddress),
)

interface BalanceRow {
  userToken?: { tokenAddress?: unknown }
  balance?: { tokenAddress?: unknown; shiftedBalance?: unknown }
  tokenFilterResult?: { priceUSD?: unknown }
}

export interface WalletTotals {
  cashUsd: number
  holdingsUsd: number
  totalUsd: number
}

/**
 * GET /v2/users/:id/balances, totalled the way fomo's own frontend does it:
 * cash rows at face value, every other row shiftedBalance x priceUSD (missing price counts 0,
 * exactly as fomo's `?? 0` does).
 */
export async function walletTotals(userId: string): Promise<WalletTotals | null> {
  const raw = await call<{ balances?: unknown[] } | unknown[]>(
    `/v2/users/${encodeURIComponent(userId)}/balances`,
  )
  if (!raw) return null
  const rows = Array.isArray(raw) ? raw : Array.isArray(raw.balances) ? raw.balances : null
  if (!rows) return null

  let cash = 0
  let holdings = 0
  for (const item of rows) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as BalanceRow
    const address = row.balance?.tokenAddress ?? row.userToken?.tokenAddress
    const shifted = num(row.balance?.shiftedBalance)
    if (typeof address !== 'string' || shifted === undefined) continue

    if (CASH_ADDRESSES.has(foldAddress(address))) cash += shifted
    else holdings += shifted * (num(row.tokenFilterResult?.priceUSD) ?? 0)
  }
  return { cashUsd: cash, holdingsUsd: holdings, totalUsd: cash + holdings }
}

/* ---------- token search ---------- */

/** fomo's own address-detect patterns, so a pasted contract address searches by address. */
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

/**
 * Some endpoints put the token identity at the top level rather than under `token`. Only real,
 * recognisable fields are carried; a row without identity (or on an unknown chain) is dropped,
 * never padded out.
 */
function fromFlatRow(raw: unknown): Token | null {
  const row = raw as {
    address?: unknown
    networkId?: unknown
    symbol?: unknown
    name?: unknown
    imageSmallUrl?: unknown
    imageThumbUrl?: unknown
    logo?: unknown
  } | null
  const address = row?.address
  const networkId = row?.networkId
  if (typeof address !== 'string' || address === '' || typeof networkId !== 'number') return null
  const chain = chainSlug(networkId)
  if (chain === undefined) return null

  const logo = [row?.imageSmallUrl, row?.imageThumbUrl, row?.logo].find(
    (v): v is string => typeof v === 'string' && v !== '',
  )
  return {
    key: tokenKey(address, networkId),
    address,
    networkId,
    chain,
    symbol: typeof row?.symbol === 'string' ? row.symbol : '',
    name: typeof row?.name === 'string' ? row.name : '',
    logo,
  }
}

/** POST /proxy/filterTokensSearch — fomo's own token search, by phrase or pasted address. */
export async function searchTokens(query: string): Promise<Token[]> {
  const q = query.trim()
  if (!q) return []
  const body = EVM_ADDRESS.test(q) || SOLANA_ADDRESS.test(q) ? { token: q } : { phrase: q }
  const rows = await call<unknown[]>('/proxy/filterTokensSearch', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!Array.isArray(rows)) return []

  const tokens: Token[] = []
  for (const raw of rows) {
    const token = fromFomoRow(raw) ?? fromFlatRow(raw)
    if (token) tokens.push(token)
  }
  return tokens
}
