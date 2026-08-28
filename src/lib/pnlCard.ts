/**
 * The PnL card's own state: where it sits, how big it is, and the balance its PnL counts
 * from. Stored in chrome.storage.sync beside the other preferences (see settings.ts), so a
 * dragged card and a zeroed baseline both survive a reload and follow the Chrome profile.
 *
 * The PnL figure itself is never stored — it is always (current balance - baseline),
 * recomputed from whatever /balances reports now. Only the baseline persists, and that is
 * what makes "reset" mean something across sessions: it is the number the user last zeroed
 * at. Deposits and withdrawals move the balance without being profit, so the figure is a
 * since-you-last-reset delta, not fomo's own pnl accounting — fomo owns that (the header's
 * 24h change and the holdings bar percentages come from its selectors, untouched).
 */

import { debounce, withTimeout } from '~/lib/async'

export const PNL_KEY = 'fobo:pnl'

/** Same guard as the other storage readers: a hung read must not leave the card unrendered. */
const STORAGE_READ_TIMEOUT_MS = 1_000

export const PNL_MIN_WIDTH = 150
export const PNL_MIN_HEIGHT = 82
export const PNL_MAX_WIDTH = 560
export const PNL_MAX_HEIGHT = 420

export interface PnlCardGeometry {
  x: number
  y: number
  width: number
  height: number
}

/** Everything the card itself owns and writes: where it sits and what it counts from. */
export interface PnlCardState extends PnlCardGeometry {
  /** The balance the PnL counts from; null until the first reading seeds it. */
  baselineUsd: number | null
}

export interface PnlCardSettings extends PnlCardState {
  /**
   * Whether the card shows at all. The POPUP owns this one — the card never writes it, and
   * its own writes merge onto whatever storage holds, so a toggle flipped while the terminal
   * is open is not undone by the next drag.
   */
  enabled: boolean
}

/** Opens under the top bar at the left edge of the first column, out of the header's way. */
export const PNL_DEFAULT: PnlCardSettings = {
  x: 24,
  y: 108,
  width: 200,
  height: 96,
  baselineUsd: null,
  enabled: true,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Clamp and default whatever is in storage, so a bad write can never break the layout. */
export function sanitizePnlSettings(raw: unknown): PnlCardSettings {
  const row = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  return {
    x: Math.round(finiteOr(row.x, PNL_DEFAULT.x)),
    y: Math.round(finiteOr(row.y, PNL_DEFAULT.y)),
    width: Math.round(clamp(finiteOr(row.width, PNL_DEFAULT.width), PNL_MIN_WIDTH, PNL_MAX_WIDTH)),
    height: Math.round(clamp(finiteOr(row.height, PNL_DEFAULT.height), PNL_MIN_HEIGHT, PNL_MAX_HEIGHT)),
    baselineUsd:
      typeof row.baselineUsd === 'number' && Number.isFinite(row.baselineUsd) ? row.baselineUsd : null,
    // Absent means on: the card shipped before this flag existed, and an upgrade must not
    // silently hide it.
    enabled: row.enabled !== false,
  }
}

/**
 * Keep the card inside the terminal. The size gives way first (a window narrower than the
 * card shrinks it), then the position is clamped against the size that survived — so a card
 * saved on a wide monitor, or dragged while the window was resized under it, can never come
 * back out of reach.
 */
export function clampGeometry(
  geometry: PnlCardGeometry,
  viewportWidth: number,
  viewportHeight: number,
): PnlCardGeometry {
  const width = Math.round(
    clamp(geometry.width, PNL_MIN_WIDTH, Math.max(PNL_MIN_WIDTH, Math.min(PNL_MAX_WIDTH, viewportWidth))),
  )
  const height = Math.round(
    clamp(geometry.height, PNL_MIN_HEIGHT, Math.max(PNL_MIN_HEIGHT, Math.min(PNL_MAX_HEIGHT, viewportHeight))),
  )
  return {
    width,
    height,
    x: Math.round(clamp(geometry.x, 0, Math.max(0, viewportWidth - width))),
    y: Math.round(clamp(geometry.y, 0, Math.max(0, viewportHeight - height))),
  }
}

export type PnlDragMode = 'move' | 'resize'

/**
 * The geometry a gesture produces, before it is clamped to the viewport: a move slides the
 * whole card, a resize pulls its bottom-right corner (the top-left stays put, so the card
 * grows away from wherever it sits). Pure, so the arithmetic behind the drag can be checked
 * without a browser — the caller clamps the result with clampGeometry.
 */
export function dragGeometry(
  mode: PnlDragMode,
  start: PnlCardGeometry,
  dx: number,
  dy: number,
): PnlCardGeometry {
  if (mode === 'move') return { ...start, x: start.x + dx, y: start.y + dy }
  return {
    ...start,
    width: clamp(start.width + dx, PNL_MIN_WIDTH, PNL_MAX_WIDTH),
    height: clamp(start.height + dy, PNL_MIN_HEIGHT, PNL_MAX_HEIGHT),
  }
}

/** Defaults when the extension context is gone (orphaned content script) or storage throws. */
export async function readPnlSettings(): Promise<PnlCardSettings> {
  try {
    const stored = await withTimeout(chrome.storage.sync.get(PNL_KEY), STORAGE_READ_TIMEOUT_MS, {})
    return sanitizePnlSettings(stored[PNL_KEY])
  } catch {
    return PNL_DEFAULT
  }
}

async function writePnlState(state: PnlCardState): Promise<void> {
  try {
    // Read-modify-write, exactly as the popup does: `enabled` is not ours, and writing a
    // snapshot taken when the card mounted would put a stale value back on the first drag.
    const stored = await withTimeout(chrome.storage.sync.get(PNL_KEY), STORAGE_READ_TIMEOUT_MS, {})
    await chrome.storage.sync.set({ [PNL_KEY]: { ...sanitizePnlSettings(stored[PNL_KEY]), ...state } })
  } catch {
    /* quota or a context already gone — the card just does not persist this time */
  }
}

/**
 * Debounced write, like the panel settings: a drag commits on release, but a window resize
 * can re-clamp several times in a row and chrome.storage.sync caps writes at 120/minute.
 * The last value wins.
 */
export const savePnlState: (state: PnlCardState) => void = debounce(
  (state: PnlCardState) => void writePnlState(state),
  400,
)

/** The popup's half of the record. Read-modify-write, so a drag in flight is not clobbered. */
export async function savePnlEnabled(enabled: boolean): Promise<PnlCardSettings> {
  const next = { ...(await readPnlSettings()), enabled }
  try {
    await chrome.storage.sync.set({ [PNL_KEY]: next })
  } catch {
    /* context already gone */
  }
  return next
}

/** Watch the record (the popup toggling the card on or off). Returns an unsubscribe. */
export function watchPnlSettings(onChange: (settings: PnlCardSettings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'sync' || !(PNL_KEY in changes)) return
    onChange(sanitizePnlSettings(changes[PNL_KEY]?.newValue))
  }
  try {
    chrome.storage.onChanged.addListener(listener)
    return () => {
      try {
        chrome.storage.onChanged.removeListener(listener)
      } catch {
        /* context already gone */
      }
    }
  } catch {
    return () => {}
  }
}
