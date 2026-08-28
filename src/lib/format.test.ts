import { describe, expect, it } from 'vitest'
import {
  age,
  percent,
  share,
  shortAddress,
  tickerPrice,
  usd,
  usdCompact,
  usdCompactDelta,
  usdDelta,
  usdExact,
} from '~/lib/format'

describe('usd', () => {
  it('formats compact values with the sign before the symbol', () => {
    expect(usd(1_200_000)).toBe('$1.2M')
    expect(usd(-1_200)).toBe('-$1.2K')
    expect(usd(0)).toBe('$0')
    expect(usd(0.001234)).toBe('$0.00123')
    expect(usd(undefined)).toBe('—')
    expect(usd(Number.NaN)).toBe('—')
  })
})

describe('other formatters', () => {
  it('usdExact / usdDelta', () => {
    expect(usdExact(1234.5)).toBe('$1,234.50')
    expect(usdDelta(-107.756)).toBe('-$107.76')
    expect(usdDelta(4.2)).toBe('+$4.20')
  })
  it('percent / share', () => {
    expect(percent(5.25)).toBe('+5.3%')
    expect(percent(-0.4, 2)).toBe('-0.40%')
    expect(share(71.4)).toBe('71%')
  })
  it('age', () => {
    const now = 1_000_000_000_000
    expect(age(now / 1000 - 12, now)).toBe('12s')
    expect(age(now / 1000 - 4 * 60, now)).toBe('4m')
    expect(age(now / 1000 - 3 * 3600, now)).toBe('3h')
    expect(age(now / 1000 - 2 * 86400, now)).toBe('2d')
    expect(age(undefined, now)).toBe('—')
  })
  it('shortAddress', () => {
    expect(shortAddress('7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU')).toBe('7xKX…gAsU')
    expect(shortAddress('short')).toBe('short')
  })
  it('tickerPrice follows fomo precision rules', () => {
    expect(tickerPrice(1234.567)).toBe('$1,234.57')
    expect(tickerPrice(0.00001234)).toBe('$0.0000123')
    expect(tickerPrice(0)).toBe('$0')
    expect(tickerPrice(undefined)).toBe('$0')
  })
})

describe('usdCompact', () => {
  it('suffixes round thousands and millions without trailing zeros', () => {
    expect(usdCompact(1_000)).toBe('$1k')
    expect(usdCompact(10_000)).toBe('$10k')
    expect(usdCompact(100_000)).toBe('$100k')
    expect(usdCompact(1_000_000)).toBe('$1m')
    expect(usdCompact(2_500_000_000)).toBe('$2.5b')
  })

  it('truncates, never rounds — $9,999 is not $10k', () => {
    expect(usdCompact(9_999)).toBe('$9.99k')
    expect(usdCompact(9_999.99)).toBe('$9.99k')
    expect(usdCompact(999_999.95)).toBe('$999.9k')
    expect(usdCompact(1_999_999)).toBe('$1.9m')
    expect(usdCompact(1_999_999.9999)).toBe('$1.9m')
    expect(usdCompact(9.999)).toBe('$9.99')
  })

  it('takes its precision from the real magnitude: two decimals under $10,000, one above', () => {
    expect(usdCompact(1_234)).toBe('$1.23k')
    expect(usdCompact(1_500)).toBe('$1.5k')
    expect(usdCompact(15_949)).toBe('$15.9k')
    expect(usdCompact(1_543_210)).toBe('$1.5m')
  })

  it('renders under $1,000 as plain dollars, truncated to cents', () => {
    expect(usdCompact(0)).toBe('$0.00')
    expect(usdCompact(12.5)).toBe('$12.50')
    expect(usdCompact(999.999)).toBe('$999.99')
  })

  it('puts the sign before the symbol, and never overstates a loss', () => {
    expect(usdCompact(-1_200)).toBe('-$1.2k')
    expect(usdCompact(-1_345.67)).toBe('-$1.34k')
    expect(usdCompact(-9_999)).toBe('-$9.99k')
    expect(usdCompact(-45.678)).toBe('-$45.67')
    expect(usdCompact(undefined)).toBe('—')
    expect(usdCompact(Number.NaN)).toBe('—')
  })

  it('usdCompactDelta signs a gain and leaves flat unsigned', () => {
    expect(usdCompactDelta(1_500)).toBe('+$1.5k')
    expect(usdCompactDelta(-1_500)).toBe('-$1.5k')
    expect(usdCompactDelta(0)).toBe('$0.00')
    expect(usdCompactDelta(undefined)).toBe('—')
  })
})
