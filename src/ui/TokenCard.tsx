import { memo, useEffect, useState } from 'react'
import { ChefHat, Droplet, UserStar, Users } from 'lucide-react'
import { BondBar } from '~/ui/BondBar'
import { ChainIcon } from '~/ui/ChainIcon'
import { Metric, riskClass } from '~/ui/Metric'
import { QuickBuy } from '~/ui/QuickBuy'
import { age, count, percent, share, usd } from '~/lib/format'
import { amountForList, useDisplaySettings } from '~/lib/displayPrefs'
import type { ListKey } from '~/lib/protocol'
import { canQuickBuy } from '~/lib/swap'
import { tokenPath } from '~/lib/url'
import type { Token } from '~/types/token'

/**
 * One row. Dense lines beside an avatar, following Axiom Pulse's anatomy but rendered
 * entirely in fomo's design tokens.
 *
 * Every data point on the row can be switched off in Display settings (see lib/displayPrefs.ts);
 * a field switched ON still renders nothing when the row does not carry it. The one control
 * here is quick buy, the only part of the card that is not read-only — it spends that column's
 * own amount (see ui/QuickBuy.tsx). Nothing else reads wallet state.
 */

/**
 * Initials stand in whenever we have no usable image — either the row carried no logo, or the URL
 * it carried failed to load. Plenty of fresh launches point at art that 404s or is still
 * propagating, and without the onError path those rows rendered a broken-image glyph.
 */
function Avatar({ token }: { token: Token }) {
  const [failed, setFailed] = useState(false)

  // Rows are virtualised and recycled, so the same Avatar instance can be handed a different
  // token. Clear the failure when the URL changes or a retry never happens.
  useEffect(() => setFailed(false), [token.logo])

  if (token.logo && !failed) {
    return (
      <img
        className="avatar"
        src={token.logo}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <div className="avatar avatar-fallback" aria-hidden="true">
      {(token.symbol || token.name || '?').slice(0, 3).toUpperCase()}
    </div>
  )
}

/**
 * Buy/sell split. Both sides must be known: coercing a missing count to 0 drew a bar claiming
 * "0 sells" for a token we simply had no sell data for, which is a fabricated reading of a real
 * risk signal.
 */
function Pressure({ buys, sells }: { buys?: number; sells?: number }) {
  if (buys === undefined || sells === undefined) return null
  const total = buys + sells
  if (total <= 0) return null
  const buyPct = (buys / total) * 100
  return (
    <span className="pressure" title={`${buys} buys / ${sells} sells (1h)`}>
      <span className="pressure-buy" style={{ width: `${buyPct}%` }} />
      <span className="pressure-sell" style={{ width: `${100 - buyPct}%` }} />
    </span>
  )
}

export const TokenCard = memo(function TokenCard({
  token,
  fresh,
  showBond,
  list,
  onOpen,
}: {
  token: Token
  fresh: boolean
  showBond: boolean
  /** Which column this row sits in, so quick buy can use that column's own amount. Absent in
   * the watchlist, whose cards spend the default. */
  list?: ListKey
  onOpen: (token: Token) => void
}) {
  // Read straight from the shared store rather than through Column and the side panel — the
  // value is the same for every card on screen (see lib/displayPrefs.ts).
  const display = useDisplaySettings()
  const href = tokenPath(token.chain, token.address)
  // fomo reports change as a fraction; the formatter wants a percentage.
  const change24 = token.change24h === undefined ? undefined : token.change24h * 100
  const m = token.metrics
  const show = display.fields

  // Lines are only drawn when something on them survives the user's switches — an empty flex
  // row still costs its gap, and three of those turn a trimmed card into a stack of blanks.
  const line2 =
    show.age ||
    (show.holders && m?.holdersCount !== undefined) ||
    (show.top10 && m?.top10Holdings !== undefined) ||
    (show.dev && m?.devHoldings !== undefined) ||
    show.volume
  const line3 =
    (show.liquidity && token.liquidity !== undefined) ||
    (show.change24h && change24 !== undefined) ||
    (show.trades && m?.trades1h !== undefined) ||
    show.pressure

  return (
    <a
      className="row"
      data-fresh={fresh ? 'true' : 'false'}
      href={href}
      onClick={(event) => {
        // Let modified clicks fall through to the browser so "open in new tab" still works.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
        event.preventDefault()
        onOpen(token)
      }}
    >
      <span className="avatar-wrap">
        <Avatar token={token} />
      </span>

      <span className="rowlines">
        {/* 1 — identity, market cap, volume */}
        <span className="line">
          {show.chainIcon && (
            <ChainIcon networkId={token.networkId} size={12} className="symbol-chain" />
          )}
          <span className="symbol">{token.symbol || token.name || '—'}</span>
          {show.name && <span className="name">{token.name}</span>}
          {show.marketCap && (
            <span className="line-end">
              <span className="stat">{usd(token.marketCap)}</span>
              <span className="stat-label">MC</span>
            </span>
          )}
        </span>

        {/* 2 — age and the wallet-cohort counts */}
        {line2 && (
          <span className="line">
            {show.age && (
              <span className="metric muted" title="Age">
                {age(token.createdAt)}
              </span>
            )}
            {show.holders && m?.holdersCount !== undefined && (
              <Metric icon={Users} value={count(m.holdersCount)} title="Holders" />
            )}
            {show.top10 && m?.top10Holdings !== undefined && (
              <Metric
                icon={UserStar}
                value={share(m.top10Holdings)}
                title="Top 10 holders' share of supply"
                tone={riskClass(m.top10Holdings)}
              />
            )}
            {show.dev && m?.devHoldings !== undefined && (
              <Metric
                icon={ChefHat}
                value={share(m.devHoldings)}
                title="Dev wallet holdings"
                tone={m.devHoldings >= 5 ? riskClass(m.devHoldings) : 'dev'}
              />
            )}
            {show.volume && (
              <span className="line-end">
                {/*
                  * The label has to name the window the number actually came from. This used to read
                  * `volume24 ?? volume1h` under a fixed "VOL" heading, so a token with no 24h figure
                  * showed its 1h volume captioned as a 24h one.
                  */}
                <span className="stat-label">{token.volume24 !== undefined ? 'VOL' : 'VOL 1H'}</span>
                <span className="stat">{usd(token.volume24 ?? m?.volume1h)}</span>
              </span>
            )}
          </span>
        )}

        {/* 3 — liquidity, price direction, trade pressure */}
        {line3 && (
          <span className="line">
            {show.liquidity && token.liquidity !== undefined && (
              <Metric icon={Droplet} value={usd(token.liquidity)} title="Liquidity" />
            )}
            {show.change24h && change24 !== undefined && (
              <span className={change24 >= 0 ? 'metric pos' : 'metric neg'} title="24h change">
                {percent(change24)}
              </span>
            )}
            <span className="line-end">
              {show.trades && m?.trades1h !== undefined && (
                <span className="metric">{count(m.trades1h)} tx</span>
              )}
              {show.pressure && <Pressure buys={m?.buys1h} sells={m?.sells1h} />}
            </span>
          </span>
        )}

        {/*
          * 4 — bonding progress, pre-graduated only. Sniper/insider/bundler cohorts used to sit
          * here, joined in from Mobula's pulse feed; fomo itself exposes none of them and the
          * joined numbers did not hold up, so they are gone. A blank beats a guess.
          */}
        {show.bondBar && showBond && token.graduationPercent !== undefined && (
          <span className="line">
            <BondBar percent={token.graduationPercent} />
          </span>
        )}
      </span>

      {/*
        * The button sits INSIDE the row's anchor, which nests interactive content. The
        * alternative — lifting it out and absolutely positioning it over the row — would cost
        * the anchor's keyboard focus and middle-click-to-new-tab, both of which the row relies
        * on. The button suppresses the anchor instead: it stops the pointer and the click, so a
        * buy never navigates (see ui/QuickBuy.tsx).
        */}
      {show.quickBuy && canQuickBuy(token) && (
        <span className="qbuy-slot">
          <QuickBuy
            token={token}
            size={display.quickBuySize}
            amountUsd={amountForList(display, list)}
            confirm={display.quickBuyConfirm}
          />
        </span>
      )}
    </a>
  )
})
