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
import { useClickAway } from '~/lib/clickAway'
import { isAuthFailing, searchTokens, searchUsers, type FomoTrader } from '~/lib/fomoApi'
import iconUrl from '~/assets/icon-48.png?inline'
import { usd, usdDelta, usdExact } from '~/lib/format'
import { HIDDEN_EVENT } from '~/lib/host'
import { useResource } from '~/lib/resource'
import { balances, useCurrentUser } from '~/lib/session'
import { profilePath, tokenPath } from '~/lib/url'
import { isActive } from '~/lib/visibility'
import type { Token } from '~/types/token'

/**
 * A one-to-one recreation of fomo's own top bar, measured off the live page: logo left
 * (the fobo icon mark), the token/trader search centred, and on the
 * right the cash chip (Solana USDC + "Deposit more") and the portfolio chip (total, 24h pnl,
 * avatar) linking to the profile. All numbers come from fomo's API via fomo's own arithmetic —
 * see lib/fomoApi.ts; the polling lives in lib/session.ts, shared with the holdings bar.
 */

const SEARCH_DEBOUNCE_MS = 250
const SEARCH_MIN_CHARS = 2

/**
 * The fobo mark. The provided icon artwork (fobo-icon.png at the repo root, resized into
 * src/assets) is inlined as a data URI: the top bar lives in the page's DOM, so an
 * extension URL would need web_accessible_resources — inlining keeps the manifest narrow.
 */
function FoboLogo() {
  return <img src={iconUrl} className="logo" alt="fobo" />
}

/** Round image with an initials fallback, used by results and the profile chip. */
function CircleImage({ src, label, className }: { src?: string; label: string; className: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])

  if (src && !failed) {
    return (
      <img
        className={className}
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    )
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

/**
 * True when the key event originated in something the user types into. The terminal's own
 * shadow root is CLOSED, so a window listener sees inside events retargeted to the host and
 * composedPath truncated — resolve the real focused element off the shadow root instead.
 */
function isEditableTarget(event: KeyboardEvent, root: Node | null): boolean {
  let el: Element | null = event.target instanceof Element ? event.target : null
  if (root instanceof ShadowRoot && el === root.host) el = root.activeElement
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
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
  // Only while the terminal is on screen — this app stays mounted (hidden) across a handoff,
  // and an unguarded listener used to swallow every "/" typed into fomo's own inputs.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.isComposing) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (!isActive()) return
      if (isEditableTarget(event, inputRef.current?.getRootNode() ?? null)) return
      const input = inputRef.current
      if (!input) return
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
  const user = useCurrentUser()
  const numbers = useResource(balances)?.numbers ?? null
  // Shown only when the API told us the session is gone and there is nothing else to show.
  const signedOut = user === null && isAuthFailing()

  const openToken = (token: Token) => {
    setQuery('')
    setResults(null)
    onNavigate(tokenPath(token.chain, token.address))
  }
  const openTrader = (trader: FomoTrader) => {
    setQuery('')
    setResults(null)
    onNavigate(profilePath(trader.userHandle))
  }

  /* ---- header dropdowns, mirroring fomo's own cash and profile menus ---- */

  const [menu, setMenu] = useState<'cash' | 'profile' | null>(null)
  const menusRef = useRef<HTMLUListElement>(null)

  // Click-away — shadow-root aware (see lib/clickAway.ts).
  useClickAway(menusRef, menu !== null, () => setMenu(null))

  useEffect(() => {
    const close = () => setMenu(null)
    window.addEventListener(HIDDEN_EVENT, close)
    return () => window.removeEventListener(HIDDEN_EVENT, close)
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
        {signedOut && (
          <span className="topbar-signedout" title="fomo's API rejected the session token. Sign in on fomo to restore balances and alerts.">
            Signed out of fomo
          </span>
        )}
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
                        onNavigate(profilePath(user.userHandle!))
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
