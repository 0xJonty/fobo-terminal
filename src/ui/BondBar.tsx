/**
 * Bonding-curve progress.
 *
 * fomo already renders this from `token.launchpad.graduationPercent` and bands it
 * `<33` red, `<66` warning, else green. We reuse their thresholds so the two agree.
 */

export function bondColor(percent: number): string {
  if (percent < 33) return 'var(--fobo-red)'
  if (percent < 66) return 'var(--fobo-warning)'
  return 'var(--fobo-green)'
}

export function BondBar({ percent }: { percent: number }) {
  const clamped = Math.min(100, Math.max(0, Math.floor(percent)))
  return (
    <div className="bond">
      <div className="bond-track">
        <div
          className="bond-fill"
          style={{ width: `${clamped}%`, background: bondColor(clamped) }}
        />
      </div>
      <span className="bond-label">{clamped}% bonded</span>
    </div>
  )
}
