import { describe, expect, it } from 'vitest'
import { mergeToken } from '~/lib/backfill'
import { fromFomoRow, type Token } from '~/types/token'

const SOL = 1399811149

function token(extra: Partial<Token> = {}): Token {
  return {
    key: `abc:${SOL}`,
    address: 'abc',
    networkId: SOL,
    chain: 'solana',
    symbol: 'ABC',
    name: 'Alphabet Coin',
    ...extra,
  }
}

describe('mergeToken', () => {
  it('returns the base untouched when there is nothing to merge', () => {
    const base = token()
    expect(mergeToken(base, undefined, undefined)).toBe(base)
  })

  it('fills only missing fields and never overwrites the base', () => {
    const base = token({ marketCap: 100, volume24: 50 })
    const fill = token({ marketCap: 999, liquidity: 42, createdAt: 1_700_000_000, change1h: 0.1 })
    const out = mergeToken(base, fill, undefined)
    expect(out.marketCap).toBe(100) // base wins
    expect(out.volume24).toBe(50)
    expect(out.liquidity).toBe(42) // filled
    expect(out.createdAt).toBe(1_700_000_000)
    expect(out.change1h).toBe(0.1)
  })

  it('merges socials per field', () => {
    const base = token({ socials: { twitter: 'base-tw' } })
    const fill = token({ socials: { twitter: 'fill-tw', website: 'fill-web' } })
    const out = mergeToken(base, fill, undefined)
    expect(out.socials).toEqual({ twitter: 'base-tw', telegram: undefined, website: 'fill-web' })
  })

  it('merges metrics with base > fill > mobula precedence, ignoring undefined', () => {
    const base = token({ metrics: { holdersCount: 10, buys1h: undefined } })
    const fill = token({ metrics: { holdersCount: 99, buys1h: 5, trades1h: 7 } })
    const out = mergeToken(base, fill, { holdersCount: 1, trades1h: 100, top10Holdings: 33 })
    expect(out.metrics).toEqual({
      holdersCount: 10, // base wins
      buys1h: 5, // base's explicit undefined does not shadow fill
      trades1h: 7, // fill wins over mobula
      top10Holdings: 33, // mobula fills what neither fomo source has
    })
  })

  it('applies mobula metrics alone when there is no backfill row', () => {
    const base = token()
    const out = mergeToken(base, undefined, { top10Holdings: 12 })
    expect(out.metrics).toEqual({ top10Holdings: 12 })
    expect(out.key).toBe(base.key)
  })
})

describe('fromFomoRow first-party metrics', () => {
  it('parses holders and the 1h counts off a fomo row (string or number)', () => {
    const row = {
      token: { address: 'abc', networkId: SOL, symbol: 'ABC', name: 'Alphabet Coin' },
      holders: 14590,
      buyCount1: '12',
      sellCount1: 8,
      txnCount1: '20',
      volume1: '123.45',
    }
    expect(fromFomoRow(row)?.metrics).toEqual({
      holdersCount: 14590,
      buys1h: 12,
      sells1h: 8,
      trades1h: 20,
      volume1h: 123.45,
    })
  })

  it('yields no metrics object when the row carries none of them', () => {
    const row = { token: { address: 'abc', networkId: SOL }, priceUSD: 1 }
    expect(fromFomoRow(row)?.metrics).toBeUndefined()
  })
})
