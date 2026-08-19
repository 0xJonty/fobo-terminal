import type { ComponentType } from 'react'

/**
 * One icon + value cluster.
 *
 * Concentration metrics are risk scales, not neutral numbers: Axiom (and the wider genre)
 * reads them green -> amber -> red as a single wallet cohort's share of supply climbs.
 */
export function riskClass(percent: number | undefined): string {
  if (percent === undefined) return 'muted'
  if (percent >= 20) return 'neg'
  if (percent >= 10) return 'warn'
  return 'metric'
}

export function Metric({
  icon: Icon,
  value,
  title,
  tone,
}: {
  icon: ComponentType<{ className?: string }>
  value: string
  title: string
  tone?: string
}) {
  return (
    <span className="metric" title={title}>
      <Icon className={tone} />
      <span className={tone}>{value}</span>
    </span>
  )
}
