/** Display formatting. Kept dumb and pure so it is easy to eyeball against fomo's own rendering. */

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/** $1.2M / $860.4K / $12 */
export function usd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  if (value === 0) return '$0'
  if (Math.abs(value) < 0.01) return `$${value.toPrecision(3)}`
  return `$${COMPACT.format(value)}`
}

/** Plain compact count: 1.2K */
export function count(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return COMPACT.format(value)
}

/**
 * fomo reports change as a fraction (0.05 === +5%).
 * Mobula reports it already multiplied. Callers normalise before calling this.
 */
export function percent(value: number | undefined, digits = 1): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}%`
}

/** Exact dollars, two decimals, as fomo's header renders balances: $1,234.56 */
export function usdExact(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Signed exact dollars for a PnL delta, fomo-style: -$107.76 / +$4.20 */
export function usdDelta(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  const sign = value < 0 ? '-' : '+'
  return `${sign}$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** A wallet cohort's share of supply: 71%. Unsigned — a share is not a delta. */
export function share(value: number | undefined, digits = 0): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

/** Compact age from a unix-seconds timestamp: 12s / 4m / 3h / 2d */
export function age(createdAtSeconds: number | undefined, now = Date.now()): string {
  if (createdAtSeconds === undefined || !Number.isFinite(createdAtSeconds)) return '—'
  const seconds = Math.max(0, Math.floor(now / 1000 - createdAtSeconds))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

/** Truncated contract address: 7xKX…mNa2 */
export function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`
}

/**
 * fomo's own price formatter, mirrored from its bundle (chains chunk: `formatPrice` and its
 * precision helper): >= $1 gets two decimals with thousands grouping; below $1 the decimal
 * count follows the leading zeros so three significant digits survive. The bottom bar renders
 * majors with this.
 */
export function tickerPrice(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '$0'
  const abs = Math.abs(value)
  let digits: number
  if (value === 0) {
    digits = 0
  } else if (abs >= 1) {
    digits = 2
  } else {
    const exponent = Number(abs.toExponential().split('e')[1])
    digits = Math.min(100, Math.max(0, -exponent - 1) + 3)
  }
  const fixed = abs.toFixed(digits)
  const dot = fixed.indexOf('.')
  const whole = dot === -1 ? fixed : fixed.slice(0, dot)
  const frac = dot === -1 ? '' : fixed.slice(dot + 1)
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const out = frac ? `${grouped}.${frac}` : grouped
  return value < 0 ? `-$${out}` : `$${out}`
}
