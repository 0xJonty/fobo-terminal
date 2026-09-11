import { describe, expect, it } from 'vitest'
import {
  CARD_FIELDS,
  DISPLAY_DEFAULT,
  enabledColumns,
  sanitizeDisplaySettings,
} from '~/lib/displayPrefs'
import { LIST_KEYS } from '~/lib/protocol'

describe('sanitizeDisplaySettings', () => {
  it('defaults every field on for an empty or broken payload', () => {
    for (const raw of [undefined, null, 'nonsense', 42, []]) {
      const settings = sanitizeDisplaySettings(raw)
      for (const field of CARD_FIELDS) expect(settings.fields[field]).toBe(true)
    }
  })

  it('treats a field absent from an older payload as shown', () => {
    // Written before a field existed: the card must not lose anything on upgrade, and the one
    // explicit `false` must still be honoured.
    const settings = sanitizeDisplaySettings({ fields: { liquidity: false } })
    expect(settings.fields.liquidity).toBe(false)
    expect(settings.fields.marketCap).toBe(true)
    expect(settings.fields.bondBar).toBe(true)
  })
})

describe('column visibility', () => {
  it('defaults every column on', () => {
    for (const raw of [undefined, null, 'nonsense', 42, []]) {
      const settings = sanitizeDisplaySettings(raw)
      for (const list of LIST_KEYS) expect(settings.columns[list]).toBe(true)
    }
    for (const list of LIST_KEYS) expect(DISPLAY_DEFAULT.columns[list]).toBe(true)
  })

  it('honours an explicit false, treats an absent or non-boolean column as shown', () => {
    // A payload written before a column existed, or a corrupt map, must not hide anything;
    // only an explicit `false` turns a column off.
    const settings = sanitizeDisplaySettings({ columns: { graduated: false, trending: 'nope' } })
    expect(settings.columns.graduated).toBe(false)
    expect(settings.columns.trending).toBe(true)
    expect(settings.columns['pre-graduated']).toBe(true)
  })

  it('lists enabled columns in LIST_KEYS order', () => {
    const settings = sanitizeDisplaySettings({ columns: { graduated: false } })
    expect(enabledColumns(settings)).toEqual(['pre-graduated', 'trending'])
    expect(enabledColumns(sanitizeDisplaySettings({}))).toEqual([...LIST_KEYS])
  })
})
