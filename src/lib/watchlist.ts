/**
 * fomo's watchlist, mirrored from its own bundle (token chunk):
 *   ids   GET  /watchlist            -> responseObject.watchlist: {tokenAddress, networkId, createdAt}[]
 *   data  POST /proxy/filterTokens   -> body is a JSON array of "address:networkId" ids,
 *                                       response rows are fomo's standard list-row shape.
 * fomo sorts the joined rows by when each token was added, newest first (its `Ug`), and
 * refetches on a one-minute cadence. Rows the id fetch names but the data fetch omits are
 * simply absent — fomo renders the same way.
 */

import { fomoCall } from '~/lib/fomoApi'
import { fromFomoRow, tokenKey, type Token } from '~/types/token'

interface WatchlistWire {
  watchlist?: unknown[]
}

/** fomo's own refetch interval for the watchlist ids. */
export const WATCHLIST_POLL_MS = 60_000

/** Null means the fetch failed (keep whatever is shown); [] means a genuinely empty list. */
export async function fetchWatchlistTokens(): Promise<Token[] | null> {
  const wire = await fomoCall<WatchlistWire>('/watchlist')
  if (!wire || !Array.isArray(wire.watchlist)) return null

  const entries = wire.watchlist
    .map((raw) => {
      const row = raw as { tokenAddress?: unknown; networkId?: unknown; createdAt?: unknown }
      if (typeof row?.tokenAddress !== 'string' || typeof row?.networkId !== 'number') return null
      const addedAt = typeof row.createdAt === 'string' ? Date.parse(row.createdAt) : 0
      return {
        key: tokenKey(row.tokenAddress, row.networkId),
        id: `${row.tokenAddress}:${row.networkId}`,
        addedAtMs: Number.isFinite(addedAt) ? addedAt : 0,
      }
    })
    .filter((entry): entry is { key: string; id: string; addedAtMs: number } => entry !== null)

  if (entries.length === 0) return []

  const rows = await fomoCall<unknown[]>('/proxy/filterTokens', {
    method: 'POST',
    body: JSON.stringify(entries.map((entry) => entry.id)),
  })
  if (!rows || !Array.isArray(rows)) return null

  const addedAt = new Map(entries.map((entry) => [entry.key, entry.addedAtMs]))
  return rows
    .map(fromFomoRow)
    .filter((token): token is Token => token !== null)
    .sort((a, b) => (addedAt.get(b.key) ?? 0) - (addedAt.get(a.key) ?? 0))
}
