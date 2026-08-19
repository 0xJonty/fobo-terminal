import { memo, useEffect, useState } from 'react'
import { ChefHat, Droplet, UserStar, Users } from 'lucide-react'
import { BondBar } from '~/ui/BondBar'
import { Metric, riskClass } from '~/ui/Metric'
import { age, count, percent, usd } from '~/lib/format'
import type { Token } from '~/types/token'

/**
 * One row. Dense lines beside an avatar, following Axiom Pulse's anatomy but rendered
 * entirely in fomo's design tokens.
 *
 * Read-only by design: the whole row is a link into fomo's own coin page. There is no buy
 * control, and nothing here reads wallet state.
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
  onOpen,
}: {
  token: Token
  fresh: boolean
  showBond: boolean
  onOpen: (token: Token) => void
}) {
  const href = `/tokens/${token.chain}/${token.address}`
  // fomo reports change as a fraction; the formatter wants a percentage.
  const change24 = token.change24h === undefined ? undefined : token.change24h * 100
  const m = token.metrics

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
          <span className="symbol">{token.symbol || token.name || '—'}</span>
          <span className="name">{token.name}</span>
          <span className="line-end">
            <span className="stat">{usd(token.marketCap)}</span>
            <span className="stat-label">MC</span>
          </span>
        </span>

        {/* 2 — age and the wallet-cohort counts */}
        <span className="line">
          <span className="metric muted" title="Age">
            {age(token.createdAt)}
          </span>
          {m?.holdersCount !== undefined && (
            <Metric icon={Users} value={count(m.holdersCount)} title="Holders" />
          )}
          {m?.top10Holdings !== undefined && (
            <Metric
              icon={UserStar}
              value={percent(m.top10Holdings, 0)}
              title="Top 10 holders' share of supply"
              tone={riskClass(m.top10Holdings)}
            />
          )}
          {m?.devHoldings !== undefined && (
            <Metric
              icon={ChefHat}
              value={percent(m.devHoldings, 0)}
              title="Dev wallet holdings"
              tone={m.devHoldings >= 5 ? riskClass(m.devHoldings) : 'dev'}
            />
          )}
          <span className="line-end">
            {/*
              * The label has to name the window the number actually came from. This used to read
              * `volume24 ?? volume1h` under a fixed "VOL" heading, so a token with no 24h figure
              * showed its 1h volume captioned as a 24h one.
              */}
            <span className="stat-label">{token.volume24 !== undefined ? 'VOL' : 'VOL 1H'}</span>
            <span className="stat">{usd(token.volume24 ?? m?.volume1h)}</span>
          </span>
        </span>

        {/* 3 — liquidity, price direction, trade pressure */}
        <span className="line">
          {token.liquidity !== undefined && (
            <Metric icon={Droplet} value={usd(token.liquidity)} title="Liquidity" />
          )}
          {change24 !== undefined && (
            <span className={change24 >= 0 ? 'metric pos' : 'metric neg'} title="24h change">
              {percent(change24)}
            </span>
          )}
          <span className="line-end">
            {m?.trades1h !== undefined && <span className="metric">{count(m.trades1h)} tx</span>}
            <Pressure buys={m?.buys1h} sells={m?.sells1h} />
          </span>
        </span>

        {/*
          * 4 — bonding progress, pre-graduated only. Sniper/insider/bundler cohorts used to sit
          * here, joined in from Mobula's pulse feed; fomo itself exposes none of them and the
          * joined numbers did not hold up, so they are gone. A blank beats a guess.
          */}
        {showBond && token.graduationPercent !== undefined && (
          <span className="line">
            <BondBar percent={token.graduationPercent} />
          </span>
        )}
      </span>
    </a>
  )
})
