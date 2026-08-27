/**
 * The shared, per-page-load data the top bar, holdings bar, bottom bar and side panel all
 * read. One fetch per resource per interval, paused while the terminal is hidden.
 *
 * The current user is special: it is needed once, but the first attempt can legitimately
 * fail — the content script runs at document_idle, which can beat Privy writing its token,
 * and fomoCall returns null without a JWT. A one-shot call left the header blank and the
 * alerts topic unsubscribed for the whole session; this retries with backoff until it lands.
 */

import { useSyncExternalStore } from 'react'
import {
  appStatus,
  currentUser,
  filterTokens,
  headerNumbers,
  holdings,
  watchlist,
  type AppStatus,
  type FomoUser,
  type HeaderNumbers,
  type Holding,
} from '~/lib/fomoApi'
import { createResource } from '~/lib/resource'
import { fetchWatchlistTokens } from '~/lib/watchlist'
import { tokenKey, type Token } from '~/types/token'

/* ---------- current user (retry until success) ---------- */

let user: FomoUser | null = null
let attempt = 0
let retryTimer: number | undefined
let inflight = false
const userListeners = new Set<() => void>()

function emitUser(): void {
  for (const listener of userListeners) listener()
}

async function loadUser(): Promise<void> {
  if (user || inflight) return
  inflight = true
  try {
    const next = await currentUser()
    if (next) {
      user = next
      attempt = 0
      emitUser()
      balances.refresh()
      return
    }
  } finally {
    inflight = false
  }
  if (userListeners.size === 0) return
  attempt += 1
  const delay = Math.min(2_000 * 2 ** Math.min(attempt - 1, 4), 30_000)
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined
    void loadUser()
  }, delay)
}

export const currentUserStore = {
  get: (): FomoUser | null => user,
  subscribe(listener: () => void): () => void {
    userListeners.add(listener)
    if (!user && !inflight && retryTimer === undefined) void loadUser()
    return () => {
      userListeners.delete(listener)
      if (userListeners.size === 0 && retryTimer !== undefined) {
        window.clearTimeout(retryTimer)
        retryTimer = undefined
      }
    }
  },
  /** Try again now — used when the socket authenticates, which proves a JWT exists. */
  refresh(): void {
    if (user || inflight) return
    if (retryTimer !== undefined) {
      window.clearTimeout(retryTimer)
      retryTimer = undefined
    }
    void loadUser()
  },
}

export function useCurrentUser(): FomoUser | null {
  return useSyncExternalStore(currentUserStore.subscribe, currentUserStore.get)
}

/* ---------- balances: header numbers + holdings, one request per 10s ---------- */

/** fomo refetches balances every 10s in its header; the header and holdings strip track it. */
const BALANCE_POLL_MS = 10_000

export interface Balances {
  numbers: HeaderNumbers | null
  holdings: Holding[] | null
}

export const balances = createResource<Balances>(async () => {
  const id = user?.id
  if (!id) return null
  // headerNumbers and holdings share one /balances response through fetchBalances' cache.
  const [numbers, positions] = await Promise.all([headerNumbers(id), holdings(id)])
  if (numbers === null && positions === null) return null
  return { numbers, holdings: positions }
}, BALANCE_POLL_MS)

/* ---------- bottom bar: majors + watchlist ticker, status dot ---------- */

const SOLANA = 1399811149

/** fomo's four majors, verbatim from its footer component: cbBTC, WETH, WSOL, HYPE. */
export const MAJORS = [
  'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
  'So11111111111111111111111111111111111111112',
  '98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g',
].map((address) => tokenKey(address, SOLANA))

const MAJOR_SET = new Set(MAJORS)

/** fomo's ticker shows at most this many watched tokens. */
const WATCHLIST_MAX = 15
const TICKER_POLL_MS = 60_000
const STATUS_POLL_MS = 300_000

export interface Ticker {
  majors: Token[]
  watched: Token[]
}

export const ticker = createResource<Ticker>(async () => {
  const entries = await watchlist()
  // A failed id fetch keeps whatever strip is on screen rather than blanking the watchlist.
  if (entries === null) return null
  const watchedIds = entries
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || 0)
    .map((entry) => tokenKey(entry.tokenAddress, entry.networkId))
    .filter((id) => !MAJOR_SET.has(id))
    .slice(0, WATCHLIST_MAX)

  const rows = await filterTokens([...MAJORS, ...watchedIds])
  if (rows.length === 0) return null
  const byKey = new Map(rows.map((row) => [row.key, row]))
  return {
    majors: MAJORS.map((id) => byKey.get(id)).filter((row): row is Token => !!row),
    watched: watchedIds.map((id) => byKey.get(id)).filter((row): row is Token => !!row),
  }
}, TICKER_POLL_MS)

export const status = createResource<AppStatus>(appStatus, STATUS_POLL_MS)

/* ---------- side panel: watchlist view ---------- */

/** fomo's own refetch interval for the watchlist ids. */
const WATCHLIST_VIEW_POLL_MS = 60_000

export const watchlistTokens = createResource<Token[]>(fetchWatchlistTokens, WATCHLIST_VIEW_POLL_MS)
