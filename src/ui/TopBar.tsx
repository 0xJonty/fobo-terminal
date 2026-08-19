import { useEffect, useRef, useState } from 'react'
import { currentUser, searchTokens, walletTotals, type FomoUser, type WalletTotals } from '~/lib/fomoApi'
import type { SocketStatus } from '~/lib/fomoSocket'
import { usd } from '~/lib/format'
import type { Token } from '~/types/token'

/**
 * The terminal's top bar: fobo brand on the left, fomo's own token search in the middle,
 * the logged-in wallet/profile on the right. Search and profile are fed by fomo's real API
 * (see lib/fomoApi.ts) — nothing here is synthesised, and each cluster simply disappears
 * when its data is unavailable.
 */

const SEARCH_DEBOUNCE_MS = 250
const SEARCH_MIN_CHARS = 2
const BALANCE_POLL_MS = 30_000

const STATUS_TEXT: Record<SocketStatus, string> = {
  connecting: 'connecting',
  authenticated: 'live',
  closed: 'reconnecting',
  unauthenticated: 'signed out',
}

/** Round image with an initials fallback, shared by search results and the profile chip. */
function CircleImage({ src, label, className }: { src?: string; label: string; className: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])

  if (src && !failed) {
    return <img className={className} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
  }
  return (
    <span className={`${className} circle-fallback`} aria-hidden="true">
      {(label || '?').slice(0, 2).toUpperCase()}
    </span>
  )
}

export function TopBar({
  status,
  onDismiss,
  onNavigate,
}: {
  status: SocketStatus
  onDismiss: () => void
  onNavigate: (href: string) => void
}) {
  /* ---- search ---- */
  const [query, setQuery] = useState('')
  // null = no completed search for the current query yet (idle or still in flight).
  const [results, setResults] = useState<Token[] | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const q = query.trim()
    if (q.length < SEARCH_MIN_CHARS) {
      setResults(null)
      return
    }
    const mine = ++seq.current
    const timer = window.setTimeout(() => {
      void searchTokens(q).then((tokens) => {
        // A newer keystroke owns the panel now; stale responses must not overwrite it.
        if (seq.current === mine) setResults(tokens)
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  /* ---- wallet / profile ---- */
  const [user, setUser] = useState<FomoUser | null>(null)
  const [totals, setTotals] = useState<WalletTotals | null>(null)

  useEffect(() => {
    let cancelled = false
    void currentUser().then((u) => {
      if (!cancelled) setUser(u)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const load = () =>
      void walletTotals(user.id).then((t) => {
        if (!cancelled && t) setTotals(t)
      })
    load()
    const id = window.setInterval(load, BALANCE_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [user])

  const openToken = (token: Token) => {
    setQuery('')
    setResults(null)
    onNavigate(`/tokens/${token.chain}/${token.address}`)
  }

  const panelOpen = query.trim().length >= SEARCH_MIN_CHARS
  const profileName = user?.displayName || user?.userHandle || ''

  return (
    <header className="topbar">
      <h1 className="brand">
        fobo<span>.</span>
      </h1>
      <span className="tagline">fear of better options</span>

      <div className="search">
        <input
          className="search-input"
          type="text"
          placeholder="Search tokens or paste an address"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && query) {
              // First Esc clears the search; only an Esc on an empty box closes the terminal.
              setQuery('')
              event.stopPropagation()
            }
          }}
        />
        {panelOpen && (
          <div className="search-results">
            {results === null ? (
              <p className="search-empty">searching…</p>
            ) : results.length === 0 ? (
              <p className="search-empty">No tokens found.</p>
            ) : (
              results.map((token) => (
                <button
                  key={token.key}
                  className="result"
                  // Fires before the input's blur, so the row is still there to click.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => openToken(token)}
                >
                  <CircleImage src={token.logo} label={token.symbol || token.name} className="result-logo" />
                  <span className="result-symbol">{token.symbol || token.name || '—'}</span>
                  <span className="result-name">{token.name}</span>
                  <span className="result-end">
                    {token.marketCap !== undefined && (
                      <span className="result-mc">{usd(token.marketCap)}</span>
                    )}
                    <span className="result-chain">{token.chain}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {user && (
        <button
          className="profile"
          onClick={() => user.userHandle && onNavigate(`/profile/${user.userHandle}`)}
          title={user.userHandle ? `@${user.userHandle}` : undefined}
        >
          <CircleImage src={user.profilePictureLink} label={profileName} className="profile-avatar" />
          <span className="profile-lines">
            <span className="profile-name">{profileName || '—'}</span>
            {totals && (
              <span
                className="profile-balance"
                title={`cash ${usd(totals.cashUsd)} + holdings ${usd(totals.holdingsUsd)}`}
              >
                {usd(totals.totalUsd)}
              </span>
            )}
          </span>
        </button>
      )}

      <span className="status">
        <span className="dot" data-live={status === 'authenticated' ? 'true' : 'false'} />
        {STATUS_TEXT[status]}
      </span>
      <button className="ghost-button" onClick={onDismiss}>
        Close (Esc)
      </button>
    </header>
  )
}
