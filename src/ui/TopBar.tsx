import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  ACCOUNT_ICON,
  DEPOSIT_ICON,
  LOGOUT_ICON,
  PROFILE_ICON,
  REFERRALS_ICON,
  SETTINGS_ICON,
  TRANSFERS_ICON,
  WITHDRAW_ICON,
  type MenuIcon,
} from '~/ui/headerMenuIcons'
import {
  currentUser,
  headerNumbers,
  searchTokens,
  searchUsers,
  type FomoTrader,
  type FomoUser,
  type HeaderNumbers,
} from '~/lib/fomoApi'
import { usd, usdDelta, usdExact } from '~/lib/format'
import type { Token } from '~/types/token'

/**
 * A one-to-one recreation of fomo's own top bar, measured off the live page: logo left
 * (fobo's wordmark, set in fomo's letterforms), the token/trader search centred, and on the
 * right the cash chip (Solana USDC + "Deposit more") and the portfolio chip (total, 24h pnl,
 * avatar) linking to the profile. All numbers come from fomo's API via fomo's own arithmetic —
 * see lib/fomoApi.ts.
 */

const SEARCH_DEBOUNCE_MS = 250
const SEARCH_MIN_CHARS = 2
/** fomo refetches balances every 10s in its header; match it so the numbers track theirs. */
const BALANCE_POLL_MS = 10_000

/**
 * The fobo wordmark, built from fomo's actual logo geometry: the f is fomo's own path, and
 * every bowl reuses fomo's o dimensions (outer 9.21x8.94 at y 15.06, counter 4.32x4.93), so
 * the mark sits in the bar exactly like the original. Only the letters changed.
 */
function ring(cx: number): string {
  return (
    `M${(cx - 9.2125).toFixed(3)} 15.0597` +
    'a9.2125 8.9403 0 1 1 18.425 0' +
    'a9.2125 8.9403 0 1 1 -18.425 0Z' +
    `M${(cx - 4.3173).toFixed(3)} 15.0597` +
    'a4.3173 4.9292 0 1 0 8.6346 0' +
    'a4.3173 4.9292 0 1 0 -8.6346 0Z'
  )
}

const FOBO_F =
  'M0.000730533 4.96351C0.000730533 1.80193 1.70048 0 5.3036 0H8.96C9.08115 0 9.17895 0.0977959 ' +
  '9.17895 0.218946V3.92862C9.17895 4.04977 9.08115 4.14757 8.96 4.14757H6.11954C5.20143 4.14757 ' +
  '4.79346 4.55554 4.79346 5.43935V6.10421C4.79346 6.22536 4.89125 6.32316 5.0124 6.32316H8.74106C8.86221 ' +
  '6.32316 8.96 6.42096 8.96 6.54211V10.2175C8.96 10.3386 8.86221 10.4364 8.74106 10.4364H5.0124C4.89125 ' +
  '10.4364 4.79346 10.5342 4.79346 10.6554V23.5776C4.79346 23.6987 4.69566 23.7965 4.57451 ' +
  '23.7965H0.218946C0.0977959 23.7965 0 23.6987 0 23.5776V4.96351H0.000730533Z'

const FOBO_B = 'M28.2 0.219h4.79v23.577h-4.79Z' + ring(37.4125)

function FoboLogo() {
  return (
    <svg viewBox="0 0 66.1 24" fill="none" className="logo" aria-label="fobo">
      <path d={FOBO_F} fill="#CBD0EB" />
      <path d={ring(18.0186)} fill="#CBD0EB" />
      <path d={FOBO_B} fill="#CBD0EB" />
      <path d={ring(56.83)} fill="#CBD0EB" />
    </svg>
  )
}

/** Round image with an initials fallback, used by results and the profile chip. */
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

interface SearchResults {
  tokens: Token[]
  traders: FomoTrader[]
}

/** One row of a header dropdown, drawn with fomo's own icon geometry. */
function MenuItem({
  icon,
  label,
  onSelect,
}: {
  icon: MenuIcon
  label: string
  onSelect: () => void
}) {
  return (
    <button type="button" className="hdrmenu-item" onClick={onSelect}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox={icon.viewBox} fill="none" className="hdrmenu-icon">
        {icon.paths.map((d, i) => (
          <path key={i} d={d} fill="currentColor" />
        ))}
      </svg>
      {label}
    </button>
  )
}

export function TopBar({
  onNavigate,
  onDeposit,
  onHeaderAction,
}: {
  onNavigate: (href: string) => void
  onDeposit: () => void
  onHeaderAction: (menu: 'cash' | 'profile', item: string) => void
}) {
  /* ---- search ---- */
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)

  useEffect(() => {
    const q = query.trim()
    if (q.length < SEARCH_MIN_CHARS) {
      setResults(null)
      return
    }
    const mine = ++seq.current
    const timer = window.setTimeout(() => {
      void Promise.all([searchTokens(q), searchUsers(q)]).then(([tokens, traders]) => {
        // A newer keystroke owns the panel now; stale responses must not overwrite it.
        if (seq.current === mine) setResults({ tokens, traders })
      })
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  // fomo's "/" shortcut: focus the search from anywhere that is not already a text field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/') return
      const input = inputRef.current
      if (!input) return
      const root = input.getRootNode() as ShadowRoot
      if (root.activeElement === input) return
      event.preventDefault()
      input.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const paste = () => {
    void navigator.clipboard
      ?.readText()
      .then((text) => {
        if (text) {
          setQuery(text.trim())
          inputRef.current?.focus()
        }
      })
      .catch(() => {
        /* clipboard permission denied — the button just does nothing */
      })
  }

  /* ---- wallet / profile ---- */
  const [user, setUser] = useState<FomoUser | null>(null)
  const [numbers, setNumbers] = useState<HeaderNumbers | null>(null)

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
      void headerNumbers(user.id).then((n) => {
        if (!cancelled && n) setNumbers(n)
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
  const openTrader = (trader: FomoTrader) => {
    setQuery('')
    setResults(null)
    onNavigate(`/profile/${trader.userHandle}`)
  }

  /* ---- header dropdowns, mirroring fomo's own cash and profile menus ---- */

  const [menu, setMenu] = useState<'cash' | 'profile' | null>(null)
  const menusRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!menu) return
    const onDown = (event: Event) => {
      const root = menusRef.current
      if (root && !event.composedPath().includes(root)) setMenu(null)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [menu])

  useEffect(() => {
    const close = () => setMenu(null)
    window.addEventListener('fobo:hidden', close)
    return () => window.removeEventListener('fobo:hidden', close)
  }, [])

  /** Menu items that step aside and drive fomo's real header menu (see content/index.tsx). */
  const act = (which: 'cash' | 'profile', item: string) => {
    setMenu(null)
    onHeaderAction(which, item)
  }

  const panelOpen = query.trim().length >= SEARCH_MIN_CHARS
  const change = numbers?.change24hUsd
  const profileName = user?.displayName || user?.userHandle || ''

  return (
    <header className="topbar">
      <div className="topbar-side">
        <FoboLogo />
      </div>

      <div className="search">
        <div className="search-box">
          <svg viewBox="0 0 16 16" fill="none" className="search-icon" aria-hidden="true">
            <path
              d="M14 14L11.6667 11.6667M13.3333 7.66667C13.3333 10.7963 10.7963 13.3333 7.66667 13.3333C4.53705 13.3333 2 10.7963 2 7.66667C2 4.53705 4.53705 2 7.66667 2C10.7963 2 13.3333 4.53705 13.3333 7.66667Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <input
            ref={inputRef}
            className="search-input"
            type="text"
            placeholder="Search for tokens or traders..."
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
          <button type="button" className="search-chip search-chip-button" onClick={paste}>
            Paste
          </button>
          <div className="search-chip">/</div>
        </div>

        {panelOpen && (
          <div className="search-results">
            {results === null ? (
              <p className="search-empty">searching…</p>
            ) : results.tokens.length === 0 && results.traders.length === 0 ? (
              <p className="search-empty">No results</p>
            ) : (
              <>
                {results.tokens.length > 0 && <div className="search-section">Tokens</div>}
                {results.tokens.map((token) => (
                  <button
                    key={token.key}
                    className="result"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => openToken(token)}
                  >
                    <CircleImage src={token.logo} label={token.symbol || token.name} className="result-image" />
                    <span className="result-lines">
                      <span className="result-title">{token.symbol || token.name || '—'}</span>
                      <span className="result-sub">{token.name}</span>
                    </span>
                    <span className="result-end">
                      {token.marketCap !== undefined && (
                        <span className="result-mc">{usd(token.marketCap)}</span>
                      )}
                      <span className="result-chain">{token.chain}</span>
                    </span>
                  </button>
                ))}
                {results.traders.length > 0 && <div className="search-section">Traders</div>}
                {results.traders.map((trader) => (
                  <button
                    key={trader.userHandle}
                    className="result"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => openTrader(trader)}
                  >
                    <CircleImage
                      src={trader.profilePictureLink}
                      label={trader.displayName || trader.userHandle}
                      className="result-image"
                    />
                    <span className="result-lines">
                      <span className="result-title">{trader.displayName || trader.userHandle}</span>
                      <span className="result-sub">@{trader.userHandle}</span>
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <div className="topbar-side topbar-side-end">
        {user && (
          <ul className="chips" ref={menusRef}>
            <li className="chip chip-cash">
              <button
                type="button"
                className="chip-trigger"
                aria-expanded={menu === 'cash'}
                onClick={() => setMenu((current) => (current === 'cash' ? null : 'cash'))}
              >
                <span className="chip-line">
                  <span className="chip-value">
                    {numbers ? usdExact(numbers.cashUsd) : '-'}
                  </span>
                  <span className="chip-label">cash</span>
                </span>
                <ChevronDown size={12} className="chip-chevron" data-open={menu === 'cash' || undefined} />
              </button>
              <button type="button" className="chip-deposit" onClick={onDeposit}>
                Deposit more
              </button>
              {menu === 'cash' && (
                <div className="hdrmenu hdrmenu-cash">
                  <MenuItem
                    icon={DEPOSIT_ICON}
                    label="Deposit"
                    onSelect={() => {
                      setMenu(null)
                      onDeposit()
                    }}
                  />
                  <MenuItem icon={WITHDRAW_ICON} label="Withdraw" onSelect={() => act('cash', 'Withdraw')} />
                </div>
              )}
            </li>
            <li className="chip chip-profile">
              <button
                type="button"
                className="chip-profile-link"
                aria-expanded={menu === 'profile'}
                onClick={() => setMenu((current) => (current === 'profile' ? null : 'profile'))}
                title={profileName + (user.userHandle ? ` (@${user.userHandle})` : '')}
              >
                <span className="chip-profile-lines">
                  <span className="chip-value">
                    {numbers ? usdExact(numbers.portfolioUsd) : '-'}
                  </span>
                  {change !== undefined && change !== 0 && (
                    <span className="chip-line">
                      <span className={change >= 0 ? 'chip-change pos' : 'chip-change neg'}>
                        {usdDelta(change)}
                      </span>
                      <span className="chip-window">24h</span>
                    </span>
                  )}
                </span>
                <CircleImage src={user.profilePictureLink} label={profileName} className="chip-avatar" />
              </button>
              {menu === 'profile' && (
                <div className="hdrmenu hdrmenu-profile">
                  {user.userHandle && (
                    <MenuItem
                      icon={PROFILE_ICON}
                      label="Your profile"
                      onSelect={() => {
                        setMenu(null)
                        onNavigate(`/profile/${user.userHandle}`)
                      }}
                    />
                  )}
                  <MenuItem icon={ACCOUNT_ICON} label="Manage account" onSelect={() => act('profile', 'Manage account')} />
                  <MenuItem icon={SETTINGS_ICON} label="Settings" onSelect={() => act('profile', 'Settings')} />
                  <MenuItem icon={TRANSFERS_ICON} label="Transfers" onSelect={() => act('profile', 'Transfers')} />
                  <MenuItem icon={REFERRALS_ICON} label="Referrals" onSelect={() => act('profile', 'Referrals')} />
                  <MenuItem icon={LOGOUT_ICON} label="Log out" onSelect={() => act('profile', 'Log out')} />
                </div>
              )}
            </li>
          </ul>
        )}
      </div>
    </header>
  )
}
