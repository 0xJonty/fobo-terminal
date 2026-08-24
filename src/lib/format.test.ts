import { describe, expect, it } from 'vitest'
import { age, percent, share, shortAddress, tickerPrice, usd, usdDelta, usdExact } from '~/lib/format'

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
