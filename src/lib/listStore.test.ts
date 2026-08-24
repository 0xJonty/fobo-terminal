import { describe, expect, it } from 'vitest'
import { STORE_CAP, applyDiff, fromSnapshot } from '~/lib/listStore'
import type { Token } from '~/types/token'

const SOL = 1399811149

function row(address: string, networkId = SOL, extra: Record<string, unknown> = {}) {
  return { token: { address, networkId, symbol: address.slice(0, 3), name: address }, priceUSD: 1, ...extra }
}

function keys(list: readonly Token[]): string[] {
  return list.map((t) => t.key)
}

describe('applyDiff', () => {
  const base = fromSnapshot([row('aaa'), row('bbb'), row('ccc')])

  it('snapshot replaces the list', () => {
    const next = applyDiff(base, { kind: 'snapshot', tokens: [row('zzz')] })
    expect(keys(next)).toEqual([`zzz:${SOL}`])
  })

  it('new inserts at index', () => {
    const next = applyDiff(base, { kind: 'new', index: 1, update: row('nnn') })
    expect(keys(next)).toEqual([`aaa:${SOL}`, `nnn:${SOL}`, `bbb:${SOL}`, `ccc:${SOL}`])
  })

  it('new dedupes a re-delivered row', () => {
    const next = applyDiff(base, { kind: 'new', index: 0, update: row('ccc') })
    expect(keys(next)).toEqual([`ccc:${SOL}`, `aaa:${SOL}`, `bbb:${SOL}`])
  })

  it('update removes by wire key then inserts', () => {
    const next = applyDiff(base, { kind: 'update', index: 2, tokenKey: `aaa:${SOL}`, update: row('aaa') })
    expect(keys(next)).toEqual([`bbb:${SOL}`, `ccc:${SOL}`, `aaa:${SOL}`])
  })

  it('update folds EVM keys so a checksummed wire key matches', () => {
    const evm = fromSnapshot([row('0xABCDEF', 8453)])
    const next = applyDiff(evm, { kind: 'update', index: 0, tokenKey: '0xABCDEF:8453', update: row('0xabcdef', 8453) })
    expect(next).toHaveLength(1)
  })

  it('remove drops by key', () => {
    const next = applyDiff(base, { kind: 'remove', tokenKey: `bbb:${SOL}` })
    expect(keys(next)).toEqual([`aaa:${SOL}`, `ccc:${SOL}`])
  })

  it('an unusable payload leaves the list untouched', () => {
    expect(applyDiff(base, { kind: 'new', index: 0, update: { nope: true } })).toBe(base)
    expect(applyDiff(base, { kind: 'snapshot', tokens: 'x' as unknown as unknown[] })).toBe(base)
  })

  it('drops rows on unknown chains', () => {
    const next = applyDiff(base, { kind: 'snapshot', tokens: [row('ok'), row('bad', 999999)] })
    expect(keys(next)).toEqual([`ok:${SOL}`])
  })

  it('caps the store', () => {
    let list: Token[] = []
    for (let i = 0; i < STORE_CAP + 50; i++) {
      list = applyDiff(list, { kind: 'new', index: 0, update: row(`t${i}`) })
    }
    expect(list).toHaveLength(STORE_CAP)
    expect(list[0]?.address).toBe(`t${STORE_CAP + 49}`)
  })
})
