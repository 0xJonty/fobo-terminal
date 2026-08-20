/**
 * fomo's PercentChange, mirrored from its bundle: a 6px ▲/▼ caret carrying the sign next to
 * |change|% to two decimals. Zero or missing change renders a grey caret and "--", exactly as
 * fomo's component does. `change` is already multiplied (7.54 === +7.54%).
 */
export function PercentChange({ change }: { change: number | undefined }) {
  const value = change ?? 0
  const rounded = Number(value.toFixed(2))
  const tone = !rounded ? 'flat' : rounded > 0 ? 'up' : 'down'
  return (
    <span className="ticker-change" data-tone={tone}>
      <span className="ticker-caret">{rounded < 0 ? '▼' : '▲'}</span>
      <span className="ticker-pct">{change ? `${Math.abs(value).toFixed(2)}%` : '--'}</span>
    </span>
  )
}
