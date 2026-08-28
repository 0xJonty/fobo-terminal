import { describe, expect, it } from 'vitest'
import {
  PNL_DEFAULT,
  PNL_MAX_HEIGHT,
  PNL_MAX_WIDTH,
  PNL_MIN_HEIGHT,
  PNL_MIN_WIDTH,
  clampGeometry,
  dragGeometry,
  sanitizePnlSettings,
} from '~/lib/pnlCard'

describe('sanitizePnlSettings', () => {
  it('falls back to the defaults for a missing or junk payload', () => {
    expect(sanitizePnlSettings(undefined)).toEqual(PNL_DEFAULT)
    expect(sanitizePnlSettings('nope')).toEqual(PNL_DEFAULT)
    expect(sanitizePnlSettings({ x: 'left', width: Number.NaN, baselineUsd: 'lots' })).toEqual(PNL_DEFAULT)
  })

  it('clamps the size and rounds the position', () => {
    const tiny = sanitizePnlSettings({ x: 10.4, y: -3.6, width: 10, height: 10 })
    expect(tiny.width).toBe(PNL_MIN_WIDTH)
    expect(tiny.height).toBe(PNL_MIN_HEIGHT)
    expect(tiny.x).toBe(10)
    expect(tiny.y).toBe(-4)
    expect(sanitizePnlSettings({ width: 5_000 }).width).toBe(PNL_MAX_WIDTH)
  })

  it('keeps a zero baseline — an empty account is a real reference, not a missing one', () => {
    expect(sanitizePnlSettings({ baselineUsd: 0 }).baselineUsd).toBe(0)
    expect(sanitizePnlSettings({ baselineUsd: -12.5 }).baselineUsd).toBe(-12.5)
    expect(sanitizePnlSettings({}).baselineUsd).toBeNull()
  })
})

describe('clampGeometry', () => {
  it('leaves a card that already fits alone', () => {
    const fits = { x: 100, y: 120, width: 200, height: 96 }
    expect(clampGeometry(fits, 1_280, 800)).toEqual(fits)
  })

  it('pulls a card dragged past an edge back into view', () => {
    expect(clampGeometry({ x: -40, y: -10, width: 200, height: 96 }, 1_280, 800)).toMatchObject({ x: 0, y: 0 })
    expect(clampGeometry({ x: 5_000, y: 5_000, width: 200, height: 96 }, 1_280, 800)).toMatchObject({
      x: 1_080,
      y: 704,
    })
  })

  it('shrinks before it moves, so a small window still shows the whole card', () => {
    const cramped = clampGeometry({ x: 300, y: 300, width: 500, height: 400 }, 400, 300)
    expect(cramped.width).toBe(400)
    expect(cramped.height).toBe(300)
    expect(cramped.x).toBe(0)
    expect(cramped.y).toBe(0)
  })

  it('never shrinks below the minimum, even in a window smaller than the card', () => {
    const squeezed = clampGeometry({ x: 10, y: 10, width: 200, height: 96 }, 80, 40)
    expect(squeezed.width).toBe(PNL_MIN_WIDTH)
    expect(squeezed.height).toBe(PNL_MIN_HEIGHT)
    expect(squeezed.x).toBe(0)
    expect(squeezed.y).toBe(0)
  })
})

describe('dragGeometry', () => {
  const start = { x: 100, y: 120, width: 200, height: 96 }

  it('slides the card on a move, leaving the size alone', () => {
    expect(dragGeometry('move', start, 40, -30)).toEqual({ x: 140, y: 90, width: 200, height: 96 })
  })

  it('pulls the bottom-right corner on a resize, leaving the position alone', () => {
    expect(dragGeometry('resize', start, 60, 24)).toEqual({ x: 100, y: 120, width: 260, height: 120 })
  })

  it('holds a resize inside its bounds however far the pointer travels', () => {
    const shrunk = dragGeometry('resize', start, -900, -900)
    expect(shrunk.width).toBe(PNL_MIN_WIDTH)
    expect(shrunk.height).toBe(PNL_MIN_HEIGHT)
    const grown = dragGeometry('resize', start, 9_000, 9_000)
    expect(grown.width).toBe(PNL_MAX_WIDTH)
    expect(grown.height).toBe(PNL_MAX_HEIGHT)
  })
})
