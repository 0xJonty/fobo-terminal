import { useEffect, useState } from 'react'
import { currentUser, holdings, type Holding } from '~/lib/fomoApi'
import { tickerPrice } from '~/lib/format'
import { PercentChange } from '~/ui/PercentChange'

/**
 * The account's current holdings as a slim strip under the top bar, modelled on Axiom Pulse's
 * holdings bar (measured off its live page: a 28px row of 24px chips — 15px token icon, symbol,
 * remaining value, pnl percent — horizontally scrollable behind a right-edge fade) but drawn in
 * fomo's own design language, like everything else in fobo.
 *
 * Every number is fomo's: rows come from GET /v2/users/:id/balances (the endpoint fomo's own
 * positions list reads, polled on the same 10s cadence as the header), value is
 * shiftedBalance x priceUSD, and the pnl percent is fomo's open-position selector — realized
 * plus unrealized over the position's cost basis. Cash rows (USDC) are not holdings; rows fobo
 * cannot price are dropped, never padded. Clicking a chip opens the token on fomo.
 */

/** fomo refetches balances every 10s in its header; the strip tracks the same clock. */
const POLL_MS = 10_000

/** Retry cadence for the current-user lookup while fomo is still booting its session. */
const USER_RETRY_MS = 5_000

function Chip({ holding, onNavigate }: { holding: Holding; onNavigate: (href: string) => void }) {
  const { token } = holding
  const href = `/tokens/${token.chain}/${token.address}`
  const change = holding.pnlPercent === undefined ? undefined : holding.pnlPercent * 100
  return (
    <a
      className="holdbar-chip"
      href={href}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        onNavigate(href)
      }}
    >
      {token.logo && <img className="holdbar-icon" src={token.logo} alt={token.symbol} />}
      <span className="holdbar-symbol">{token.symbol}</span>
      <span className="holdbar-value">{tickerPrice(holding.valueUsd)}</span>
      <PercentChange change={change} />
    </a>
  )
}

export function HoldingsBar({ onNavigate }: { onNavigate: (href: string) => void }) {
  const [userId, setUserId] = useState<string | null>(null)
  const [rows, setRows] = useState<Holding[] | null>(null)

  useEffect(() => {
    let cancelled = false
    let timer = 0
    const lookup = () =>
      void currentUser().then((user) => {
        if (cancelled) return
        if (user) setUserId(user.id)
        else timer = window.setTimeout(lookup, USER_RETRY_MS)
      })
    lookup()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const load = () =>
      void holdings(userId).then((next) => {
        if (!cancelled && next) setRows(next)
      })
    load()
    const id = window.setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [userId])

  // Nothing to show is no strip at all — an empty bar is dead space, and a guessed placeholder
  // would be worse than a blank.
  if (!rows || rows.length === 0) return null

  return (
    <div className="holdbar">
      <div className="holdbar-scroll">
        {rows.map((holding) => (
          <Chip key={holding.token.key} holding={holding} onNavigate={onNavigate} />
        ))}
      </div>
      <div className="holdbar-fade" />
    </div>
  )
}
