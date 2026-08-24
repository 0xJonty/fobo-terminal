import { describe, expect, it } from 'vitest'
import { MAX_ALERTS, mergeAlerts, parseAlert, passesAlertsFilters, type AlertItem } from '~/lib/alerts'

const base = {
  id: 'a1',
  createdAt: '2026-08-24T10:00:00.000Z',
  tokenAddress: 'So11111111111111111111111111111111111111112',
  networkId: 1399811149,
}

describe('parseAlert', () => {
  it('parses a swap with safe images', () => {
    const item = parseAlert({
      ...base,
      type: 'swap_buy',
      ticker: 'SOL',
      tokenImageUrl: 'https://cdn.example/sol.png',
      profilePictureLink: 'http://insecure.example/x.png',
      usdAmount: '1234.5',
      userHandle: 'bob',
    })
    expect(item).toMatchObject({ kind: 'swap', action: 'buy', usdAmount: 1234.5, userHandle: 'bob', chain: 'solana' })
    expect(item && 'tokenImageUrl' in item && item.tokenImageUrl).toBe('https://cdn.example/sol.png')
    expect(item && 'profilePictureLink' in item && item.profilePictureLink).toBeUndefined()
  })

  it('drops unknown types, chains and missing identity', () => {
    expect(parseAlert({ ...base, type: 'manual' })).toBeNull()
    expect(parseAlert({ ...base, type: 'swap_buy', networkId: 42 })).toBeNull()
    expect(parseAlert({ ...base, type: 'swap_buy', tokenAddress: '' })).toBeNull()
    expect(parseAlert({ ...base, type: 'swap_buy', createdAt: 'nope' })).toBeNull()
  })

  it('reads multi-user clusters from the body', () => {
    const item = parseAlert({
      ...base,
      type: 'multi_user_buy',
      body: { ticker: 'X', totalVolume: 10, uniqueTraders: 3, topTraders: [{ userHandle: 'a' }, { userHandle: 'b' }, {}, {}] },
    })
    expect(item).toMatchObject({ kind: 'multi', action: 'buy', uniqueTraders: 3 })
    expect(item && item.kind === 'multi' ? item.topTraders : []).toHaveLength(3)
  })
})

describe('passesAlertsFilters', () => {
  const swap = parseAlert({ ...base, type: 'swap_sell', usdAmount: 500, fdv: 2_000_000 }) as AlertItem
  it('applies threshold to swaps and market cap bounds to everything', () => {
    expect(passesAlertsFilters(swap, { threshold: 1000 })).toBe(false)
    expect(passesAlertsFilters(swap, { threshold: 100 })).toBe(true)
    expect(passesAlertsFilters(swap, { minMarketCap: 5_000_000 })).toBe(false)
    expect(passesAlertsFilters(swap, { maxMarketCap: 5_000_000 })).toBe(true)
  })
  it('lets an unknown market cap through', () => {
    const thesis = parseAlert({ ...base, type: 'thesis' }) as AlertItem
    expect(passesAlertsFilters(thesis, { minMarketCap: 1 })).toBe(true)
  })
})

describe('mergeAlerts', () => {
  const at = (id: string, t: number) => ({ ...(parseAlert({ ...base, id, type: 'swap_buy' }) as AlertItem), createdAtMs: t })
  it('dedupes, sorts newest first, tie-breaks by id', () => {
    const merged = mergeAlerts([at('b', 2), at('a', 1)], [at('b', 2), at('c', 3), at('aa', 1)])
    expect(merged.map((i) => i.id)).toEqual(['c', 'b', 'a', 'aa'])
  })
  it('returns the same array when nothing is new', () => {
    const current = [at('a', 1)]
    expect(mergeAlerts(current, [at('a', 1)])).toBe(current)
  })
  it('caps the list', () => {
    const many = Array.from({ length: MAX_ALERTS + 10 }, (_, i) => at(`x${i}`, i))
    expect(mergeAlerts([], many)).toHaveLength(MAX_ALERTS)
  })
})
