import { describe, expect, it } from 'vitest'
import {
  applyPrefs,
  defaultPrefs,
  filtersActive,
  parseAmount,
  parseDuration,
  sanitizeAllColumnPrefs,
  sanitizeColumnPrefs,
} from '~/lib/columnPrefs'
import type { Token } from '~/types/token'

function token(partial: Partial<Token> & { address: string }): Token {
  return {
    key: `${partial.address}:1399811149`,
    networkId: 1399811149,
    chain: 'solana',
    symbol: partial.address,
    name: partial.address,
    ...partial,
  }
}

describe('parseAmount', () => {
  it('reads plain, suffixed and grouped numbers', () => {
    expect(parseAmount('250')).toBe(250)
    expect(parseAmount('1.5m')).toBe(1_500_000)
    expect(parseAmount('$50K')).toBe(50_000)
    expect(parseAmount('1,000')).toBe(1000)
    expect(parseAmount('2b')).toBe(2e9)
  })
  it('rejects garbage', () => {
    expect(parseAmount('')).toBeUndefined()
    expect(parseAmount('abc')).toBeUndefined()
    expect(parseAmount('1.2.3')).toBeUndefined()
  })
})

describe('parseDuration', () => {
  it('reads units and defaults to minutes', () => {
    expect(parseDuration('30s')).toBe(30)
    expect(parseDuration('5m')).toBe(300)
    expect(parseDuration('2h')).toBe(7200)
    expect(parseDuration('1d')).toBe(86400)
    expect(parseDuration('3')).toBe(180)
  })
})

describe('applyPrefs', () => {
  const now = 1_000_000_000_000
  const rows = [
    token({ address: 'a', marketCap: 10_000, liquidity: 500, createdAt: now / 1000 - 60, metrics: { holdersCount: 5 } }),
    token({ address: 'b', marketCap: 50_000, liquidity: 5000, createdAt: now / 1000 - 3600 }),
    token({ address: 'c', marketCap: undefined, liquidity: 100, createdAt: now / 1000 - 10 }),
  ]

  it('is a no-op with defaults', () => {
    expect(applyPrefs(rows, defaultPrefs(), now).map((t) => t.address)).toEqual(['a', 'b', 'c'])
  })

  it('a bound on a missing metric drops the row', () => {
    const prefs = { ...defaultPrefs(), marketCap: { min: '1k', max: '' } }
    expect(applyPrefs(rows, prefs, now).map((t) => t.address)).toEqual(['a', 'b'])
    const holders = { ...defaultPrefs(), holders: { min: '1', max: '' } }
    expect(applyPrefs(rows, holders, now).map((t) => t.address)).toEqual(['a'])
  })

  it('an unparseable bound is treated as unset', () => {
    const prefs = { ...defaultPrefs(), marketCap: { min: 'xx', max: '' } }
    expect(applyPrefs(rows, prefs, now)).toHaveLength(3)
  })

  it('age filters in seconds', () => {
    const prefs = { ...defaultPrefs(), age: { min: '', max: '5m' } }
    expect(applyPrefs(rows, prefs, now).map((t) => t.address)).toEqual(['a', 'c'])
  })

  it('sorts with unknowns last in either direction', () => {
    const desc = { ...defaultPrefs(), sort: { field: 'marketCap' as const, dir: 'desc' as const } }
    expect(applyPrefs(rows, desc, now).map((t) => t.address)).toEqual(['b', 'a', 'c'])
    const asc = { ...defaultPrefs(), sort: { field: 'marketCap' as const, dir: 'asc' as const } }
    expect(applyPrefs(rows, asc, now).map((t) => t.address)).toEqual(['a', 'b', 'c'])
  })

  it('filtersActive ignores sort', () => {
    expect(filtersActive(defaultPrefs('graduated'))).toBe(false)
    expect(filtersActive({ ...defaultPrefs(), chains: [1] })).toBe(true)
  })
})

describe('sanitize', () => {
  it('rejects unknown chains and full/empty sets', () => {
    expect(sanitizeColumnPrefs({ chains: [1, 999] }).chains).toEqual([1])
    expect(sanitizeColumnPrefs({ chains: [] }).chains).toBeNull()
    expect(sanitizeColumnPrefs({ chains: [1, 56, 143, 4663, 8453, 1399811149] }).chains).toBeNull()
  })

  it('clamps strings and drops bad sort fields', () => {
    const out = sanitizeColumnPrefs({ sort: { field: 'nope' }, marketCap: { min: 'x'.repeat(100) } })
    expect(out.sort).toBeNull()
    expect(out.marketCap.min).toHaveLength(24)
  })

  it('upgrades a v1 graduated null sort, keeps a v2 one', () => {
    expect(sanitizeAllColumnPrefs({ graduated: { sort: null } }).graduated.sort).toEqual({ field: 'age', dir: 'desc' })
    expect(sanitizeAllColumnPrefs({ v: 2, graduated: { sort: null } }).graduated.sort).toBeNull()
  })
})
