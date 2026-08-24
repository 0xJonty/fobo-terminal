/**
 * Authorized client for fomo's own REST API.
 *
 * Every endpoint, header and calculation here was read out of fomo's production bundle
 * (its fetch wrapper and call sites) rather than guessed, so this cannot drift into invented
 * behaviour: same base URL, same auth header, same response envelope, same portfolio
 * arithmetic. We are a second client of the user's own session — the same Privy JWT the
 * socket uses, sent only to fomo's API, never persisted or logged.
 */

import { countRequest } from '~/lib/host'
import { SUPPORTED_CHAINS } from '~/lib/protocol'
import { safeImageUrl } from '~/lib/url'
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

/* ---------- auth state ---------- */

/**
 * A 401/403 (or no JWT at all) used to be indistinguishable from a network blip: every
 * failure was a null, the header showed "-", and nothing told the user to sign in again.
 * The last auth failure is remembered here and cleared by the next successful call, so
 * the top bar can show a "signed out" hint instead of a blank.
 */
let authFailedAt: number | null = null

export function isAuthFailing(): boolean {
  return authFailedAt !== null
}

/**
 * One authorized call, mirroring fomo's own wrapper: JSON content type, Bearer JWT,
 * X-Supported-Chains, credentials included. Null on any failure — every caller treats the API
 * as optional decoration, so a failure means a sparser top bar, never a broken one.
 *
 * Exported (as fomoCall) for the other lib modules that call fomo endpoints, e.g. the alerts
 * feed — one wrapper, one set of headers, one envelope.
 */
async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  const jwt = readJwt()
  if (!jwt) {
    authFailedAt = Date.now()
    return null
  }

  countRequest(path.split('?')[0]!.replace(/\/v2\/users\/[^/]+\//, '/v2/users/:id/'))
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
  if (response.status === 401 || response.status === 403) {
    authFailedAt = Date.now()
    return null
  }
  if (!response.ok) return null

  try {
    const body = (await response.json()) as Envelope<T>
    if (body.statusCode !== undefined && body.statusCode !== 200) return null
    authFailedAt = null
    return body.responseObject ?? null
  } catch {
    return null
  }
}

export { call as fomoCall }

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
    profilePictureLink: safeImageUrl(raw.profilePictureLink),
  }
}

/* ---------- header numbers: cash, portfolio, 24h change ---------- */

/**
 * fomo's cash rail: USDC on Solana. The header's "cash" figure is exactly this row's
 * shiftedBalance — nothing summed across chains (verified against the live header component).
 */
const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const USDC_SOL_TOKEN_ID = `${USDC_SOL}:1399811149`

/**
 * The per-chain USDC addresses fomo's portfolio reducer skips, lifted verbatim from its chains
 * chunk. Everything else counts at shiftedBalance x priceUSD; the Solana USDC row at face value.
 */
const EVM_USDC = new Set(
  [
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // Ethereum
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // Base
    '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // BNB
    '0x754704bc059f8c67012fed69bc8a327a5aafb603',
    '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
  ].map(foldAddress),
)

interface BalanceRow {
  balance?: { tokenAddress?: unknown; tokenId?: unknown; shiftedBalance?: unknown }
  tokenFilterResult?: { priceUSD?: unknown }
  activeTrade?: {
    realizedPnlUsd?: unknown
    humanTokenAmount?: unknown
    sumTransferIn?: unknown
    sumSwapOpen?: unknown
    avgEntryPrice?: unknown
    avgTransferInPrice?: unknown
  }
  userToken?: {
    currentRealizedPnlUsd?: unknown
    humanAmountRemaining?: unknown
    averageEntryPriceUsd?: unknown
    currentCostBasisUsd?: unknown
  }
}

interface BalancesPayload {
  balances?: unknown[]
  otherPnl?: unknown
  livePerpPnl?: unknown
}

/**
 * One /balances response feeds both the header numbers and the holdings bar, which poll on the
 * same 10s cadence. A short cache turns those concurrent reads into one request — the way
 * fomo's own react-query layer dedupes them.
 */
let balancesCache: { at: number; userId: string; payload: BalancesPayload } | null = null
let balancesInflight: { userId: string; promise: Promise<BalancesPayload | null> } | null = null
const BALANCES_TTL_MS = 5_000

async function fetchBalances(userId: string): Promise<BalancesPayload | null> {
  const now = Date.now()
  if (balancesCache && balancesCache.userId === userId && now - balancesCache.at < BALANCES_TTL_MS) {
    return balancesCache.payload
  }
  // Concurrent readers (header numbers + holdings in the same tick) share one request.
  if (balancesInflight && balancesInflight.userId === userId) return balancesInflight.promise
  const promise = call<BalancesPayload>(`/v2/users/${encodeURIComponent(userId)}/balances`)
    .then((raw) => {
      if (raw) balancesCache = { at: Date.now(), userId, payload: raw }
      return raw
    })
    .finally(() => {
      balancesInflight = null
    })
  balancesInflight = { userId, promise }
  return promise
}

/** fomo's blended entry price for an open trade (its `Dr`): swaps and transfers, weighted. */
function tradeEntryPrice(trade: NonNullable<BalanceRow['activeTrade']>): number {
  const transferIn = num(trade.sumTransferIn) ?? 0
  const swapOpen = num(trade.sumSwapOpen) ?? 0
  const amount = transferIn + swapOpen
  if (amount === 0) return 0
  const cost =
    (num(trade.avgEntryPrice) ?? 0) * swapOpen + (num(trade.avgTransferInPrice) ?? 0) * transferIn
  return cost / amount
}

export interface HeaderNumbers {
  cashUsd: number
  portfolioUsd: number
  /** Absent until the 24h-ago snapshot has loaded. */
  change24hUsd?: number
}

/** The 24h-ago pnl reference barely moves; cache it for an hour, exactly as fomo does. */
let snapshotCache: { at: number; userId: string; pnl: number } | null = null

async function snapshotPnl24hAgo(userId: string): Promise<number | null> {
  const now = Date.now()
  if (snapshotCache && snapshotCache.userId === userId && now - snapshotCache.at < 3_600_000) {
    return snapshotCache.pnl
  }
  // fomo's reference point: the hourly snapshot at floor(now - 24h) — its own id arithmetic.
  const snapshotId = Math.floor((now / 1000 - 86_400) / 3_600) * 3_600
  const raw = await call<{ pnl?: unknown }>(
    `/v2/userTokens/aggregatedSnapshotById?userId=${encodeURIComponent(userId)}&snapshotId=${snapshotId}`,
  )
  const pnl = num(raw?.pnl)
  if (pnl === undefined) return null
  snapshotCache = { at: now, userId, pnl }
  return pnl
}

/**
 * GET /v2/users/:id/balances, reduced to the three figures fomo's header shows, using fomo's
 * own arithmetic end to end:
 *  - cash: the Solana USDC row's shiftedBalance;
 *  - portfolio: skip EVM USDC rows, Solana USDC at face value, the rest at price;
 *  - 24h change: live pnl (per-position realized + unrealized, plus otherPnl and livePerpPnl)
 *    minus the pnl recorded in the snapshot from 24 hours ago.
 */
export async function headerNumbers(userId: string): Promise<HeaderNumbers | null> {
  const raw = await fetchBalances(userId)
  if (!raw || !Array.isArray(raw.balances)) return null

  let cash = 0
  let portfolio = 0
  let livePnl = 0

  for (const item of raw.balances) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as BalanceRow
    const address = row.balance?.tokenAddress
    const shifted = num(row.balance?.shiftedBalance)
    if (typeof address !== 'string' || shifted === undefined) continue
    const price = num(row.tokenFilterResult?.priceUSD)

    if (row.balance?.tokenId === USDC_SOL_TOKEN_ID) cash += shifted

    if (!EVM_USDC.has(foldAddress(address))) {
      portfolio += address === USDC_SOL ? shifted : shifted * (price ?? 0)
    }

    // Per-position pnl (fomo's Sl): cash rows and unpriced rows do not participate.
    if (address === USDC_SOL || price === undefined) continue
    if (row.activeTrade) {
      livePnl +=
        (num(row.activeTrade.realizedPnlUsd) ?? 0) +
        (num(row.activeTrade.humanTokenAmount) ?? 0) * (price - tradeEntryPrice(row.activeTrade))
    } else if (row.userToken) {
      livePnl +=
        (num(row.userToken.currentRealizedPnlUsd) ?? 0) +
        (num(row.userToken.humanAmountRemaining) ?? 0) *
          (price - (num(row.userToken.averageEntryPriceUsd) ?? 0))
    }
  }

  livePnl += (num(raw.otherPnl) ?? 0) + (num(raw.livePerpPnl) ?? 0)

  const reference = await snapshotPnl24hAgo(userId)
  return {
    cashUsd: cash,
    portfolioUsd: portfolio,
    change24hUsd: reference === null ? undefined : livePnl - reference,
  }
}

/* ---------- holdings (per-position value + pnl) ---------- */

export interface Holding {
  token: Token
  /** Human token amount held (shiftedBalance). */
  amount: number
  /** amount x priceUSD — the same figure fomo's positions list shows. */
  valueUsd: number
  /** Realized + unrealized, fomo's own selector. Absent when the row carries no trade data. */
  pnlUsd?: number
  /** Fraction (0.05 === +5%), pnl / cost basis. Absent when the cost basis is zero. */
  pnlPercent?: number
}

/**
 * fomo's open-position pnl, lifted verbatim from its bundle (tradeSettings chunk):
 * an activeTrade prices against the blended entry (swaps + transfers, weighted) over the
 * trade's total cost basis; otherwise the userToken aggregate prices against
 * averageEntryPriceUsd over currentCostBasisUsd. Percentage is null at zero cost basis.
 */
function positionPnl(
  row: BalanceRow,
  price: number,
): { pnlUsd: number; pnlPercent?: number } | null {
  const trade = row.activeTrade
  if (trade) {
    const swapOpen = num(trade.sumSwapOpen) ?? 0
    const transferIn = num(trade.sumTransferIn) ?? 0
    const costBasis =
      swapOpen * (num(trade.avgEntryPrice) ?? 0) + transferIn * (num(trade.avgTransferInPrice) ?? 0)
    const unrealized = (price - tradeEntryPrice(trade)) * (num(trade.humanTokenAmount) ?? 0)
    const pnlUsd = (num(trade.realizedPnlUsd) ?? 0) + unrealized
    return { pnlUsd, pnlPercent: costBasis === 0 ? undefined : pnlUsd / costBasis }
  }

  const ut = row.userToken
  if (ut) {
    const costBasis = num(ut.currentCostBasisUsd)
    const unrealized =
      (num(ut.humanAmountRemaining) ?? 0) * (price - (num(ut.averageEntryPriceUsd) ?? 0))
    const pnlUsd = (num(ut.currentRealizedPnlUsd) ?? 0) + unrealized
    return {
      pnlUsd,
      pnlPercent: costBasis === undefined || costBasis === 0 ? undefined : pnlUsd / costBasis,
    }
  }
  return null
}

/**
 * The account's current token holdings, from GET /v2/users/:id/balances — the endpoint fomo's
 * own positions list reads. Same row filter as theirs: the Solana USDC cash row and the
 * per-chain USDC rows are not positions. Rows fobo cannot price or identify are dropped,
 * never padded. Sorted by value, largest first.
 */
export async function holdings(userId: string): Promise<Holding[] | null> {
  const raw = await fetchBalances(userId)
  if (!raw || !Array.isArray(raw.balances)) return null

  const out: Holding[] = []
  for (const item of raw.balances) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as BalanceRow & { tokenFilterResult?: unknown }

    const address = row.balance?.tokenAddress
    const amount = num(row.balance?.shiftedBalance)
    if (typeof address !== 'string' || amount === undefined || amount <= 0) continue
    if (row.balance?.tokenId === USDC_SOL_TOKEN_ID) continue
    if (EVM_USDC.has(foldAddress(address))) continue

    const token = fromFomoRow(row.tokenFilterResult)
    if (!token || token.priceUSD === undefined) continue

    const pnl = positionPnl(row, token.priceUSD)
    out.push({
      token,
      amount,
      valueUsd: amount * token.priceUSD,
      pnlUsd: pnl?.pnlUsd,
      pnlPercent: pnl?.pnlPercent,
    })
  }

  out.sort((a, b) => b.valueUsd - a.valueUsd)
  return out
}

/* ---------- trader search ---------- */

export interface FomoTrader {
  userHandle: string
  displayName?: string
  profilePictureLink?: string
}

/** GET /v2/users/fuzzy-search — fomo's trader search, shapes verified against the live API. */
export async function searchUsers(query: string): Promise<FomoTrader[]> {
  const q = query.trim()
  if (!q) return []
  const raw = await call<{ users?: unknown[] }>(
    `/v2/users/fuzzy-search?searchTerm=${encodeURIComponent(q)}`,
  )
  if (!raw || !Array.isArray(raw.users)) return []

  const traders: FomoTrader[] = []
  for (const item of raw.users) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as { userHandle?: unknown; displayName?: unknown; profilePictureLink?: unknown }
    if (typeof row.userHandle !== 'string' || row.userHandle === '') continue
    traders.push({
      userHandle: row.userHandle,
      displayName: typeof row.displayName === 'string' ? row.displayName : undefined,
      profilePictureLink: safeImageUrl(row.profilePictureLink),
    })
  }
  return traders
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

  const logo = [row?.imageSmallUrl, row?.imageThumbUrl, row?.logo]
    .map(safeImageUrl)
    .find((v): v is string => v !== undefined)
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

/* ---------- watchlist + majors ticker (fomo's bottom bar) ---------- */

export interface WatchlistEntry {
  networkId: number
  tokenAddress: string
  /** ISO string. fomo sorts the ticker newest-watched first. */
  createdAt: string
}

/**
 * The bottom-bar ticker and the panel's watchlist view both read the ids on their own
 * minute clocks; a short cache plus in-flight sharing turns those into one request.
 */
let watchlistCache: { at: number; entries: WatchlistEntry[] } | null = null
let watchlistInflight: Promise<WatchlistEntry[] | null> | null = null
const WATCHLIST_TTL_MS = 5_000

/** GET /watchlist — the ids of every token the user has starred, verified live. */
export function watchlist(): Promise<WatchlistEntry[] | null> {
  if (watchlistCache && Date.now() - watchlistCache.at < WATCHLIST_TTL_MS) {
    return Promise.resolve(watchlistCache.entries)
  }
  if (watchlistInflight) return watchlistInflight
  watchlistInflight = fetchWatchlist()
    .then((entries) => {
      if (entries) watchlistCache = { at: Date.now(), entries }
      return entries
    })
    .finally(() => {
      watchlistInflight = null
    })
  return watchlistInflight
}

/** Drop the cached ids — after an un-star, the next read must hit the server. */
export function invalidateWatchlist(): void {
  watchlistCache = null
}

async function fetchWatchlist(): Promise<WatchlistEntry[] | null> {
  const raw = await call<{ watchlist?: unknown[] }>('/watchlist')
  if (!raw || !Array.isArray(raw.watchlist)) return null

  const entries: WatchlistEntry[] = []
  for (const item of raw.watchlist) {
    if (typeof item !== 'object' || item === null) continue
    const row = item as { networkId?: unknown; tokenAddress?: unknown; createdAt?: unknown }
    if (typeof row.networkId !== 'number' || typeof row.tokenAddress !== 'string') continue
    entries.push({
      networkId: row.networkId,
      tokenAddress: row.tokenAddress,
      createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
    })
  }
  return entries
}

/** DELETE /watchlist — un-star one token, exactly as fomo's own star button does. */
export async function watchlistRemove(networkId: number, tokenAddress: string): Promise<boolean> {
  const result = await call<unknown>('/watchlist', {
    method: 'DELETE',
    body: JSON.stringify({ networkId, tokenAddress }),
  })
  invalidateWatchlist()
  return result !== null
}

/**
 * POST /proxy/filterTokens — batch token data by `${address}:${networkId}` ids. This is the
 * call fomo's bottom bar makes for both the majors and the watchlist row (its own client
 * batches at 100 per request; the ticker never needs more than ~20).
 */
export async function filterTokens(ids: string[]): Promise<Token[]> {
  if (ids.length === 0) return []
  const rows = await call<unknown[]>('/proxy/filterTokens', {
    method: 'POST',
    body: JSON.stringify(ids),
  })
  if (!Array.isArray(rows)) return []

  const tokens: Token[] = []
  for (const raw of rows) {
    const token = fromFomoRow(raw)
    if (token) tokens.push(token)
  }
  return tokens
}

/* ---------- app status (status.fomo.family) ---------- */

export type StatusSeverity = 'STABLE' | 'MODERATE' | 'SEVERE'

export interface AppStatus {
  statusSeverity: StatusSeverity
  statusMessage?: string
  statusDescription?: string
}

/**
 * GET https://status.fomo.family/prod — public, unauthenticated, same envelope. fomo's footer
 * polls it every 5 minutes for the little status dot.
 */
export async function appStatus(): Promise<AppStatus | null> {
  countRequest('status')
  let response: Response
  try {
    response = await fetch('https://status.fomo.family/prod')
  } catch {
    return null
  }
  if (!response.ok) return null

  try {
    const body = (await response.json()) as Envelope<Record<string, unknown>>
    const raw = body.responseObject
    const severity = raw?.statusSeverity
    if (severity !== 'STABLE' && severity !== 'MODERATE' && severity !== 'SEVERE') return null
    return {
      statusSeverity: severity,
      statusMessage: typeof raw?.statusMessage === 'string' ? raw.statusMessage : undefined,
      statusDescription:
        typeof raw?.statusDescription === 'string' ? raw.statusDescription : undefined,
    }
  } catch {
    return null
  }
}
