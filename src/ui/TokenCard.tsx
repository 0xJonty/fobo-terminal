import { memo } from 'react'
import { Boxes, ChefHat, Crosshair, Droplet, Ghost, UserStar, Users } from 'lucide-react'
import { BondBar } from '~/ui/BondBar'
import { Metric, riskClass } from '~/ui/Metric'
import { age, count, percent, usd } from '~/lib/format'
import type { Token } from '~/types/token'

/**
 * One row. Four dense lines beside an avatar, following Axiom Pulse's anatomy but rendered
 * entirely in fomo's design tokens.
 *
 * Read-only by design: the whole row is a link into fomo's own coin page. There is no buy
 * control, and nothing here reads wallet state.
 */

function Avatar({ token }: { token: Token }) {
  if (token.logo) {
    return <img className="avatar" src={token.logo} alt="" loading="lazy" decoding="async" />
  }
  return (
    <div className="avatar avatar-fallback" aria-hidden="true">
      {(token.symbol || '?').slice(0, 3).toUpperCase()}
    </div>
  )
}

function Pressure({ buys, sells }: { buys?: number; sells?: number }) {
  const b = buys ?? 0
  const s = sells ?? 0
  const total = b + s
  if (total === 0) return null
  const buyPct = (b / total) * 100
  return (
    <span className="pressure" title={`${b} buys / ${s} sells (1h)`}>
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
            <span className="stat-label">VOL</span>
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

        {/* 4 — bonding progress, or the remaining concentration metrics */}
        <span className="line">
          {showBond && token.graduationPercent !== undefined ? (
            <BondBar percent={token.graduationPercent} />
          ) : (
            <>
              {m?.snipersCount !== undefined && (
                <Metric
                  icon={Crosshair}
                  value={count(m.snipersCount)}
                  title="Snipers"
                  tone={riskClass(m.snipersHoldings)}
                />
              )}
              {m?.insidersHoldings !== undefined && (
                <Metric
                  icon={Ghost}
                  value={percent(m.insidersHoldings, 0)}
                  title="Insider holdings"
                  tone={riskClass(m.insidersHoldings)}
                />
              )}
              {m?.bundlersHoldings !== undefined && (
                <Metric
                  icon={Boxes}
                  value={percent(m.bundlersHoldings, 0)}
                  title="Bundled supply"
                  tone={riskClass(m.bundlersHoldings)}
                />
              )}
            </>
          )}
        </span>
      </span>
    </a>
  )
})
