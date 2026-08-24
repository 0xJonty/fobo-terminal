import { describe, expect, it } from 'vitest'
import { feedTypesFor, mergeFeed, parseFeedItem, parsePostSegments, type FeedItem } from '~/lib/feed'

const base = { id: 'f1', createdAt: '2026-08-24T10:00:00.000Z' }

describe('feedTypesFor', () => {
  it('adds manual whenever anything is on, nothing when everything is off', () => {
    expect(feedTypesFor([])).toContain('manual')
    expect(feedTypesFor(['trades'])).not.toContain('large_buy')
    const all = ['trades', 'closed', 'theses', 'multiUser', 'newListings', 'priceSpikes', 'milestones', 'newTraders']
    expect(feedTypesFor(all)).toEqual([])
  })
})

describe('parsePostSegments', () => {
  it('links token:// mentions and keeps other text', () => {
    const segs = parsePostSegments('Buy [$X](token://base/0xabc) not [$Y](perp://z) ok')
    expect(segs).toEqual([
      { text: 'Buy ' },
      { text: '$X', href: '/tokens/base/0xabc' },
      { text: ' not ' },
      { text: '$Y', href: undefined },
      { text: ' ok' },
    ])
  })
})

describe('parseFeedItem', () => {
  it('derives trade size from price x amount when no usd figure is carried', () => {
    const item = parseFeedItem({ ...base, type: 'large_buy', tokenAddress: 'abc', networkId: 8453, body: { price: 2, humanTokenAmount: 50 } })
    expect(item).toMatchObject({ kind: 'trade', verb: 'Bought', usdAmount: 100, chain: 'base' })
  })
  it('keeps fomo posts without token identity and drops unknown chains', () => {
    expect(parseFeedItem({ ...base, type: 'manual', tokenAddress: null, networkId: null, body: { description: 'hi' } })).toMatchObject({ kind: 'post' })
    expect(parseFeedItem({ ...base, type: 'manual', tokenAddress: 'x', networkId: 9 })).toBeNull()
    expect(parseFeedItem({ ...base, type: 'unknown_thing' })).toBeNull()
  })
  it('only https images survive', () => {
    const item = parseFeedItem({ ...base, type: 'thesis_created', body: { userImageUrl: 'data:image/png;base64,AAAA' } })
    expect(item && 'userImageUrl' in item ? item.userImageUrl : 'x').toBeUndefined()
  })
})

describe('mergeFeed', () => {
  const mk = (id: string, t: number, pinned = false) =>
    ({ ...(parseFeedItem({ ...base, id, type: 'manual', pinned }) as FeedItem), createdAtMs: t })
  it('pinned first, then newest', () => {
    const merged = mergeFeed([mk('a', 1)], [mk('p', 0, true), mk('b', 2)])
    expect(merged.map((i) => i.id)).toEqual(['p', 'b', 'a'])
  })
})
