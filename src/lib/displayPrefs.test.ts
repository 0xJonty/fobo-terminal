import { describe, expect, it } from 'vitest'
import {
  amountForList,
  CARD_FIELDS,
  DISPLAY_DEFAULT,
  QUICK_BUY_MAX_USD,
  sanitizeDisplaySettings,
} from '~/lib/displayPrefs'
import { SWAP_MIN_USD } from '~/lib/swap'

describe('sanitizeDisplaySettings', () => {
  it('defaults everything on for an empty or broken payload', () => {
    for (const raw of [undefined, null, 'nonsense', 42, []]) {
      const settings = sanitizeDisplaySettings(raw)
      for (const field of CARD_FIELDS) expect(settings.fields[field]).toBe(true)
      expect(settings.quickBuySize).toBe(DISPLAY_DEFAULT.quickBuySize)
      expect(settings.quickBuyAmountUsd).toBe(DISPLAY_DEFAULT.quickBuyAmountUsd)
      expect(settings.quickBuyAmountByList).toEqual({})
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
    expect(sanitizeDisplaySettings({ quickBuyAmountUsd: 12.3456 }).quickBuyAmountUsd).toBe(12.35)
  })

  it('falls back on an unknown button size', () => {
    expect(sanitizeDisplaySettings({ quickBuySize: 'huge' }).quickBuySize).toBe('medium')
    expect(sanitizeDisplaySettings({ quickBuySize: 'large' }).quickBuySize).toBe('large')
  })
})

describe('per-column amounts', () => {
  it('keeps only real numbers, clamped like the default', () => {
    const settings = sanitizeDisplaySettings({
      quickBuyAmountByList: { 'pre-graduated': 5, graduated: 0, trending: 'lots', nonsense: 12 },
    })
    expect(settings.quickBuyAmountByList['pre-graduated']).toBe(5)
    // Below fomo's floor, so clamped up rather than dropped.
    expect(settings.quickBuyAmountByList.graduated).toBe(SWAP_MIN_USD)
    // Not a number, and not a column — neither survives.
    expect(settings.quickBuyAmountByList.trending).toBeUndefined()
    expect(Object.keys(settings.quickBuyAmountByList)).toEqual(['pre-graduated', 'graduated'])
    // And an override is clamped by the same ceiling as the default.
    expect(
      sanitizeDisplaySettings({ quickBuyAmountByList: { trending: 1e9 } }).quickBuyAmountByList.trending,
    ).toBe(QUICK_BUY_MAX_USD)
  })

  it('falls back to the default for a column with no amount, and for the watchlist', () => {
    const settings = sanitizeDisplaySettings({
      quickBuyAmountUsd: 10,
      quickBuyAmountByList: { trending: 50 },
    })
    expect(amountForList(settings, 'trending')).toBe(50)
    expect(amountForList(settings, 'graduated')).toBe(10)
    // No column at all — a watchlist card.
    expect(amountForList(settings, undefined)).toBe(10)
  })
})
