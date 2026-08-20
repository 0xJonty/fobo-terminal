import { TokenCard } from '~/ui/TokenCard'
import type { Token } from '~/types/token'

/**
 * The Watchlist view — the tokens the user has starred on fomo, newest addition first,
 * rendered with the same cards as the columns. Data comes from fomo's own watchlist
 * endpoints (see lib/watchlist.ts); Mobula decoration applies where the cache has it.
 * Watchlists are small (fomo renders them unvirtualised too), so this is a plain list.
 */
export function WatchlistView({
  tokens,
  loading,
  onOpen,
}: {
  /** Null while nothing has loaded yet; [] is a genuinely empty watchlist. */
  tokens: Token[] | null
  loading: boolean
  onOpen: (token: Token) => void
}) {
  return (
    <div className="column-body">
      {tokens === null ? (
        <p className="column-empty">{loading ? 'Loading watchlist…' : 'Could not load the watchlist.'}</p>
      ) : tokens.length === 0 ? (
        // fomo's own empty-state copy.
        <p className="column-empty">No items on your watchlist yet.</p>
      ) : (
        tokens.map((token) => (
          <TokenCard key={token.key} token={token} fresh={false} showBond={false} onOpen={onOpen} />
        ))
      )}
    </div>
  )
}
