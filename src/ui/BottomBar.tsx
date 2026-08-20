import { useCallback, useEffect, useRef, useState } from 'react'
import {
  appStatus,
  filterTokens,
  watchlist,
  watchlistRemove,
  type AppStatus,
} from '~/lib/fomoApi'
import { tickerPrice, usd } from '~/lib/format'
import { PercentChange } from '~/ui/PercentChange'
import { tokenKey, type Token } from '~/types/token'

/**
 * A one-to-one recreation of fomo's own bottom bar, read out of its bundle (the footer
 * component in the authenticated chunk) and measured off the live page: majors on the left,
 * the user's watchlist in a drag-scrollable strip with a fade, and on the right the status
 * dot, the legal links and the social icons. Every data source is fomo's own:
 *
 * - majors + watchlist rows: POST /proxy/filterTokens with `${address}:${networkId}` ids,
 *   refetched every minute — the same ids fomo's footer hardcodes and the same interval.
 * - watchlist membership: GET /watchlist, newest-starred first, capped at 15 like fomo's.
 * - status dot: GET status.fomo.family/prod every 5 minutes; STABLE shows a rotating easter
 *   egg as its tooltip, exactly as fomo ships.
 *
 * Display rules mirrored from their code, not guessed: majors always show price; a watchlist
 * token shows market cap only when 0 < mc <= $10B (fomo's own cutoff), otherwise price; the
 * percent is |change24|·100 to two decimals with the ▲/▼ carrying the sign.
 */

const SOLANA = 1399811149

/** fomo's four majors, verbatim from its footer component: cbBTC, WETH, WSOL, HYPE. */
const MAJORS = [
  'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij',
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
  'So11111111111111111111111111111111111111112',
  '98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g',
].map((address) => tokenKey(address, SOLANA))

const MAJOR_SET = new Set(MAJORS)

/** Above this market cap fomo's ticker falls back to price. 1e10 in their bundle. */
const MC_DISPLAY_MAX = 1e10

/** Tokens fomo never shows an MC for (the majors plus one hardcoded exception). */
const MC_BLOCKED = new Set([...MAJORS, tokenKey('uniHfuPhEQSrtpzXpJZDCSq53yaejKKpNhFUiKoHKHV', SOLANA)])

const WATCHLIST_MAX = 15
const TICKER_POLL_MS = 60_000
const STATUS_POLL_MS = 300_000

/** fomo's rotating "all good" tooltips, from its i18n catalogue. */
const STABLE_PHRASES = [
  'All systems go 🦾',
  'Smooth and steady ⛵️',
  'Houston, we do not have a problem 🚀',
  'The blocks are chaining ⛓️',
  'fomo systems stable ✨',
]

const STATUS_LABEL = { STABLE: 'Stable', MODERATE: 'Minor issues', SEVERE: 'Major issues' } as const
const STATUS_TONE = { STABLE: 'green', MODERATE: 'yellow', SEVERE: 'red' } as const

function TickerItem({ token, onNavigate }: { token: Token; onNavigate: (href: string) => void }) {
  // fomo's rule: market cap only inside (0, $10B] and never for the majors; otherwise price.
  const mc = token.marketCap
  const showMc = mc !== undefined && mc > 0 && mc <= MC_DISPLAY_MAX && !MC_BLOCKED.has(token.key)
  const change = token.change24h === undefined ? undefined : token.change24h * 100
  const href = `/tokens/${token.chain}/${token.address}`
  return (
    <a
      className="ticker-link"
      href={href}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        onNavigate(href)
      }}
    >
      {token.logo && <img className="ticker-icon" src={token.logo} alt={token.symbol} />}
      <span className="ticker-value">
        {showMc ? (
          <>
            {usd(mc)}
            <span className="ticker-mc"> MC</span>
          </>
        ) : (
          tickerPrice(token.priceUSD)
        )}
      </span>
      <PercentChange change={change} />
    </a>
  )
}

/** The filled star fomo renders beside each watchlist entry; clicking un-stars it. */
function StarButton({ onRemove }: { onRemove: () => void }) {
  return (
    <button className="ticker-star" aria-label="Remove from watchlist" onClick={onRemove}>
      <svg viewBox="0 0 20 20" fill="none">
        <path
          d="M10.9786 1.4468L12.9566 5.47906C13.1053 5.78274 13.3926 5.99277 13.7256 6.04115L18.2917 6.70817C19.1289 6.83067 19.4631 7.86835 18.857 8.46336L15.556 11.7009C15.3146 11.9377 15.2045 12.2784 15.2615 12.613L16.0162 17.0437C16.169 17.9423 15.235 18.6279 14.4345 18.2048L10.4744 16.11C10.177 15.9525 9.82253 15.9525 9.52614 16.11L5.56909 18.2028C4.76749 18.6269 3.8304 17.9403 3.9842 17.0395L4.73903 12.613C4.79607 12.2784 4.68601 11.9377 4.44461 11.7009L1.14355 8.46336C0.536495 7.86835 0.870508 6.83067 1.70877 6.70817L6.27493 6.04115C6.60697 5.99277 6.89421 5.78274 7.04393 5.47906L9.02196 1.4468C9.42021 0.628409 10.5773 0.628409 10.9786 1.4468Z"
          fill="#FFC74F"
        />
      </svg>
    </button>
  )
}

/** fomo's X and Discord footer icons, paths verbatim. */
function XIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="ticker-social-icon">
      <path
        d="M11.438 8.85221L17.0277 2.5H15.7036L10.8481 8.0144L6.97281 2.5H2.50208L8.36348 10.8395L2.50208 17.5H3.82618L8.95047 11.6754L13.0439 17.5H17.5146M4.30408 3.47619H6.33828L15.7026 16.5718H13.6679"
        fill="currentColor"
      />
    </svg>
  )
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 20 16" fill="none" className="ticker-social-icon">
      <path
        d="M16.9419 1.29643C15.6473 0.690699 14.263 0.250481 12.8157 -0.000183105C12.638 0.321159 12.4304 0.753372 12.2872 1.09719C10.7487 0.865832 9.22445 0.865832 7.7143 1.09719C7.57116 0.753372 7.3588 0.321159 7.17947 -0.000183105C5.73067 0.250481 4.3448 0.692316 3.05016 1.29963C0.438869 5.24564 -0.269009 9.09363 0.0849305 12.887C1.81688 14.1804 3.49534 14.966 5.14548 15.4802C5.55291 14.9194 5.91628 14.3234 6.22931 13.6952C5.63313 13.4686 5.06211 13.1891 4.52256 12.8645C4.6657 12.7585 4.80571 12.6476 4.94098 12.5335C8.23183 14.0727 11.8074 14.0727 15.0589 12.5335C15.1958 12.6476 15.3358 12.7585 15.4774 12.8645C14.9362 13.1906 14.3637 13.4702 13.7675 13.6968C14.0805 14.3234 14.4423 14.9211 14.8513 15.4818C16.503 14.9676 18.183 14.182 19.915 12.887C20.3303 8.48952 19.2056 4.67687 16.9419 1.29643ZM6.67765 10.5541C5.68977 10.5541 4.87963 9.63186 4.87963 8.50879C4.87963 7.38573 5.67247 6.46189 6.67765 6.46189C7.68285 6.46189 8.49297 7.38411 8.47567 8.50879C8.47723 9.63186 7.68285 10.5541 6.67765 10.5541ZM13.3223 10.5541C12.3344 10.5541 11.5243 9.63186 11.5243 8.50879C11.5243 7.38573 12.3171 6.46189 13.3223 6.46189C14.3275 6.46189 15.1376 7.38411 15.1203 8.50879C15.1203 9.63186 14.3275 10.5541 13.3223 10.5541Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function BottomBar({ onNavigate }: { onNavigate: (href: string) => void }) {
  const [majors, setMajors] = useState<Token[]>([])
  const [watched, setWatched] = useState<Token[]>([])
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [stablePhrase] = useState(
    () => STABLE_PHRASES[Math.floor(Math.random() * STABLE_PHRASES.length)],
  )

  const refresh = useCallback(async () => {
    // One filterTokens call covers both halves — fomo issues two, but the payload is the same.
    const entries = (await watchlist()) ?? []
    const watchedIds = entries
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((entry) => tokenKey(entry.tokenAddress, entry.networkId))
      .filter((id) => !MAJOR_SET.has(id))
      .slice(0, WATCHLIST_MAX)

    const rows = await filterTokens([...MAJORS, ...watchedIds])
    if (rows.length === 0) return
    const byKey = new Map(rows.map((row) => [row.key, row]))

    const majorRows = MAJORS.map((id) => byKey.get(id)).filter((row): row is Token => !!row)
    const watchedRows = watchedIds.map((id) => byKey.get(id)).filter((row): row is Token => !!row)
    setMajors(majorRows)
    setWatched(watchedRows)
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), TICKER_POLL_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    const tick = async () => setStatus(await appStatus())
    void tick()
    const timer = window.setInterval(() => void tick(), STATUS_POLL_MS)
    return () => window.clearInterval(timer)
  }, [])

  const remove = useCallback(
    async (token: Token) => {
      setWatched((current) => current.filter((row) => row.key !== token.key))
      await watchlistRemove(token.networkId, token.address)
      void refresh()
    },
    [refresh],
  )

  /* Drag-to-scroll, matching fomo's cursor-grab strip. */
  const scrollRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ startX: number; startLeft: number } | null>(null)

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!el) return
    drag.current = { startX: event.clientX, startLeft: el.scrollLeft }
    el.setPointerCapture(event.pointerId)
  }, [])
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!el || !drag.current) return
    el.scrollLeft = drag.current.startLeft - (event.clientX - drag.current.startX)
  }, [])
  const onPointerUp = useCallback(() => {
    drag.current = null
  }, [])

  const severity = status?.statusSeverity
  const statusTitle = severity
    ? severity === 'STABLE'
      ? stablePhrase
      : [status?.statusMessage, status?.statusDescription].filter(Boolean).join(' — ')
    : undefined

  return (
    <footer className="bottombar">
      <div className="ticker-majors">
        {majors.map((token) => (
          <TickerItem key={token.key} token={token} onNavigate={onNavigate} />
        ))}
      </div>

      {watched.length > 0 && (
        <>
          <div className="bottombar-divider" />
          <div className="ticker-watch">
            <div
              className="ticker-watch-scroll"
              ref={scrollRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {watched.map((token) => (
                <div className="ticker-watch-item" key={token.key}>
                  <TickerItem token={token} onNavigate={onNavigate} />
                  <StarButton onRemove={() => void remove(token)} />
                </div>
              ))}
            </div>
            <div className="ticker-fade" />
          </div>
        </>
      )}

      <div className="bottombar-end">
        {severity && (
          <>
            <div className="ticker-status" data-tone={STATUS_TONE[severity]} title={statusTitle}>
              <span className="ticker-dot">
                {severity !== 'STABLE' && <span className="ticker-dot-ping" />}
                <span className="ticker-dot-core" />
              </span>
              <span className="ticker-status-label">{STATUS_LABEL[severity]}</span>
            </div>
            <div className="bottombar-divider" />
          </>
        )}
        <a
          className="ticker-text-link"
          href="/privacy-policy"
          onClick={(event) => {
            event.preventDefault()
            onNavigate('/privacy-policy')
          }}
        >
          Privacy
        </a>
        <a
          className="ticker-text-link"
          href="/terms"
          onClick={(event) => {
            event.preventDefault()
            onNavigate('/terms')
          }}
        >
          Terms
        </a>
        <a
          className="ticker-text-link"
          href="https://help.fomo.family/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Help
        </a>
        <a
          className="ticker-social"
          href="https://twitter.com/fomo"
          target="_blank"
          rel="noreferrer"
          aria-label="Fomo on X"
        >
          <XIcon />
        </a>
        <a
          className="ticker-social"
          href="https://discord.gg/fomofamily"
          target="_blank"
          rel="noreferrer"
          aria-label="Fomo Discord"
        >
          <DiscordIcon />
        </a>
      </div>
    </footer>
  )
}
