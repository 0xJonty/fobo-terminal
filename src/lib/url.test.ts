import { describe, expect, it } from 'vitest'
import { profilePath, safeImageUrl, sameOriginHref, tokenPath } from '~/lib/url'

describe('paths', () => {
  it('encodes every segment', () => {
    expect(tokenPath('solana', 'So111')).toBe('/tokens/solana/So111')
    expect(tokenPath('base', '../../evil?x=1#y')).toBe('/tokens/base/..%2F..%2Fevil%3Fx%3D1%23y')
    expect(profilePath('a/b')).toBe('/profile/a%2Fb')
  })
})

describe('sameOriginHref', () => {
  it('keeps in-app paths and rejects foreign origins', () => {
    // jsdom's default location is http://localhost:3000
    expect(sameOriginHref('/tokens/x/y?z#h')).toBe('/tokens/x/y?z#h')
    expect(sameOriginHref('//evil.example/x')).toBeNull()
    expect(sameOriginHref('https://evil.example/')).toBeNull()
    expect(sameOriginHref('javascript:alert(1)')).toBeNull()
  })
})

describe('safeImageUrl', () => {
  it('accepts only https', () => {
    expect(safeImageUrl('https://cdn.example/a.png')).toBe('https://cdn.example/a.png')
    expect(safeImageUrl('http://cdn.example/a.png')).toBeUndefined()
    expect(safeImageUrl('data:image/png;base64,AAAA')).toBeUndefined()
    expect(safeImageUrl('')).toBeUndefined()
    expect(safeImageUrl(42)).toBeUndefined()
    expect(safeImageUrl('not a url')).toBeUndefined()
  })
})
