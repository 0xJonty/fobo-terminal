import { describe, expect, it } from 'vitest'
import {
  CARD_FIELDS,
  DISPLAY_DEFAULT,
  QUICK_BUY_MAX_USD,
  sanitizeDisplaySettings,
} from '~/lib/displayPrefs'
import { SWAP_MIN_USD, usdToBaseUnits } from '~/lib/swap'

describe('sanitizeDisplaySettings', () => {
  it('defaults everything on for an empty or broken payload', () => {
    for (const raw of [undefined, null, 'nonsense', 42, []]) {
      const settings = sanitizeDisplaySettings(raw)
      for (const field of CARD_FIELDS) expect(settings.fields[field]).toBe(true)
      expect(settings.quickBuySize).toBe(DISPLAY_DEFAULT.quickBuySize)
      expect(settings.quickBuyAmountUsd).toBe(DISPLAY_DEFAULT.quickBuyAmountUsd)
      expect(settings.quickBuyConfirm).toBe(true)
    }
  })

  it('treats a field absent from an older payload as shown', () => {
    // Written before `quickBuy` existed: the card must not lose anything on upgrade, and the
    // one explicit `false` must still be honoured.
    const settings = sanitizeDisplaySettings({ fields: { liquidity: false } })
    expect(settings.fields.liquidity).toBe(false)
    expect(settings.fields.quickBuy).toBe(true)
    expect(settings.fields.marketCap).toBe(true)
  })

  it('clamps the amount to fomo’s own floor and a sane ceiling', () => {
    expect(sanitizeDisplaySettings({ quickBuyAmountUsd: 0 }).quickBuyAmountUsd).toBe(SWAP_MIN_USD)
    expect(sanitizeDisplaySettings({ quickBuyAmountUsd: -50 }).quickBuyAmountUsd).toBe(SWAP_MIN_USD)
    expect(sanitizeDisplaySettings({ quickBuyAmountUsd: 1e9 }).quickBuyAmountUsd).toBe(QUICK_BUY_MAX_USD)
    expect(sanitizeDisplaySettings({ quickBuyAmountUsd: Number.NaN }).quickBuyAmountUsd).toBe(
      DISPLAY_DEFAULT.quickBuyAmountUsd,
    )
  })

  it('rounds the amount to cents so the label and the sent amount agree', () => {
    const settings = sanitizeDisplaySettings({ quickBuyAmountUsd: 12.3456 })
    expect(settings.quickBuyAmountUsd).toBe(12.35)
    expect(usdToBaseUnits(settings.quickBuyAmountUsd)).toBe('12350000')
  })

  it('falls back on an unknown button size', () => {
    expect(sanitizeDisplaySettings({ quickBuySize: 'huge' }).quickBuySize).toBe('medium')
    expect(sanitizeDisplaySettings({ quickBuySize: 'large' }).quickBuySize).toBe('large')
  })
})

describe('usdToBaseUnits', () => {
  it('converts dollars to USDC base units, rounding rather than truncating', () => {
    expect(usdToBaseUnits(10)).toBe('10000000')
    expect(usdToBaseUnits(2)).toBe('2000000')
    // 0.1 * 1e6 lands at 100000.00000000001 in binary floating point.
    expect(usdToBaseUnits(0.1)).toBe('100000')
    expect(usdToBaseUnits(1.005)).toBe('1005000')
  })
})
