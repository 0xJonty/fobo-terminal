/**
 * What a token card shows, and how quick buy behaves on it.
 *
 * Stored in chrome.storage.sync beside the other preferences (see settings.ts), so a card
 * trimmed down to the four numbers someone actually reads follows their Chrome profile. Unlike
 * the panel settings, BOTH writers are in the page: the Display settings dialog is rendered
 * inside the terminal, opened from the toolbar popup. The popup only asks for it — it never
 * writes these.
 *
 * Every field defaults to ON. An upgrade must not silently strip a card of the metrics it had
 * yesterday, so a stored payload written before a field existed reads as "shown".
 */

import { useSyncExternalStore } from 'react'
import { debounce, withTimeout } from '~/lib/async'
import { LIST_KEYS, type ListKey } from '~/lib/protocol'
import { SWAP_MIN_USD } from '~/lib/swap'

export const DISPLAY_KEY = 'fobo:display'

/** Same guard as the other storage readers: a hung read must not leave the cards unrendered. */
const STORAGE_READ_TIMEOUT_MS = 1_000

/**
 * One per data point a card can draw, in the order the dialog lists them. These are the card's
 * own field names, not fomo's — `top10` is the top-ten holders' share, `dev` the dev wallet's.
 */
export const CARD_FIELDS = [
  'chainIcon',
  'name',
  'marketCap',
  'age',
  'holders',
  'top10',
  'dev',
  'volume',
  'liquidity',
  'change24h',
  'trades',
  'pressure',
  'bondBar',
  'quickBuy',
] as const

export type CardField = (typeof CARD_FIELDS)[number]

export const CARD_FIELD_LABEL: Readonly<Record<CardField, string>> = {
  chainIcon: 'Chain icon',
  name: 'Token name',
  marketCap: 'Market cap',
  age: 'Age',
  holders: 'Holders',
  top10: 'Top 10 share',
  dev: 'Dev holdings',
  volume: 'Volume',
  liquidity: 'Liquidity',
  change24h: '24h change',
  trades: 'Trade count',
  pressure: 'Buy/sell pressure',
  bondBar: 'Bonding progress',
  quickBuy: 'Quick buy button',
}

export const CARD_FIELD_HINT: Readonly<Partial<Record<CardField, string>>> = {
  bondBar: 'Bonding column only',
  quickBuy: 'Amount per column, beside its filter',
}

export type QuickBuySize = 'small' | 'medium' | 'large'

export const QUICK_BUY_SIZES: readonly QuickBuySize[] = ['small', 'medium', 'large']

export const QUICK_BUY_SIZE_LABEL: Readonly<Record<QuickBuySize, string>> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
}

/** Above fomo's own $2 floor, and low enough that a mis-click is not a disaster. */
export const QUICK_BUY_MAX_USD = 10_000

export interface DisplaySettings {
  fields: Record<CardField, boolean>
  quickBuySize: QuickBuySize
  /**
   * The default USD of cash spent per click, used by any column without its own amount and by
   * the watchlist's cards. Never below fomo's own minimum swap value.
   */
  quickBuyAmountUsd: number
  /**
   * Per-column overrides, set from the box beside each column's filter button. Sizing differs
   * by column in practice — small on Bonding, larger on Trending — which is the whole reason
   * the box is per column rather than one figure in this dialog.
   */
  quickBuyAmountByList: Partial<Record<ListKey, number>>
}

function allFields(value: boolean): Record<CardField, boolean> {
  return Object.fromEntries(CARD_FIELDS.map((field) => [field, value])) as Record<CardField, boolean>
}

export const DISPLAY_DEFAULT: DisplaySettings = {
  fields: allFields(true),
  quickBuySize: 'medium',
  quickBuyAmountUsd: 10,
  quickBuyAmountByList: {},
}

/** Clamp one amount the way both the dialog and the per-column boxes must. */
export function clampAmount(value: number): number {
  // Two decimals: the amount is dollars of USDC, and a stored 10.005 must not round-trip into
  // a base-unit amount the server reads differently from the label on the button.
  return Math.round(clamp(value, SWAP_MIN_USD, QUICK_BUY_MAX_USD) * 100) / 100
}

/** What a card in `list` actually spends: that column's override, else the default. */
export function amountForList(settings: DisplaySettings, list?: ListKey): number {
  if (list === undefined) return settings.quickBuyAmountUsd
  return settings.quickBuyAmountByList[list] ?? settings.quickBuyAmountUsd
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Clamp and default whatever is in storage, so a bad write can never break a card. */
export function sanitizeDisplaySettings(raw: unknown): DisplaySettings {
  const row = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const storedFields = (
    typeof row.fields === 'object' && row.fields !== null ? row.fields : {}
  ) as Record<string, unknown>

  const fields = allFields(true)
  for (const field of CARD_FIELDS) fields[field] = storedFields[field] !== false

  const amount =
    typeof row.quickBuyAmountUsd === 'number' && Number.isFinite(row.quickBuyAmountUsd)
      ? row.quickBuyAmountUsd
      : DISPLAY_DEFAULT.quickBuyAmountUsd

  const storedByList = (
    typeof row.quickBuyAmountByList === 'object' && row.quickBuyAmountByList !== null
      ? row.quickBuyAmountByList
      : {}
  ) as Record<string, unknown>
  const quickBuyAmountByList: Partial<Record<ListKey, number>> = {}
  for (const list of LIST_KEYS) {
    const value = storedByList[list]
    // An override is only kept when it is a real number; anything else falls back to the
    // default rather than pinning a column to a nonsense amount.
    if (typeof value === 'number' && Number.isFinite(value)) quickBuyAmountByList[list] = clampAmount(value)
  }

  return {
    fields,
    quickBuySize: QUICK_BUY_SIZES.includes(row.quickBuySize as QuickBuySize)
      ? (row.quickBuySize as QuickBuySize)
      : DISPLAY_DEFAULT.quickBuySize,
    quickBuyAmountUsd: clampAmount(amount),
    quickBuyAmountByList,
  }
}

/** Defaults when the extension context is gone (orphaned content script) or storage throws. */
export async function readDisplaySettings(): Promise<DisplaySettings> {
  try {
    const stored = await withTimeout(chrome.storage.sync.get(DISPLAY_KEY), STORAGE_READ_TIMEOUT_MS, {})
    return sanitizeDisplaySettings(stored[DISPLAY_KEY])
  } catch {
    return DISPLAY_DEFAULT
  }
}

function writeDisplaySettings(settings: DisplaySettings): void {
  try {
    chrome.storage.sync.set({ [DISPLAY_KEY]: settings }).catch(() => {
      /* quota or a context already gone — the preference just does not persist this time */
    })
  } catch {
    /* context already gone */
  }
}

/**
 * Debounced, like the column prefs: the amount box calls this per keystroke, and
 * chrome.storage.sync caps writes at 120/minute. The last value wins.
 */
export const saveDisplaySettings: (settings: DisplaySettings) => void = debounce(writeDisplaySettings, 400)

/** Watch for changes from another window's terminal. Returns an unsubscribe. */
export function watchDisplaySettings(onChange: (settings: DisplaySettings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'sync' || !(DISPLAY_KEY in changes)) return
    onChange(sanitizeDisplaySettings(changes[DISPLAY_KEY]?.newValue))
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

/* ---------------------------------------------------------------- the shared live value */

/**
 * Every token card reads these, and cards render in two places (the columns and the panel's
 * watchlist) three components deep. Threading a prop through Column, SidePanel and
 * WatchlistView to reach them would touch four files to deliver one value that never varies by
 * call site, so the settings live in one store instead and the cards subscribe.
 *
 * Loading and the storage watch both start on the first subscriber — nothing reads storage in a
 * document where no card ever renders.
 */

let current: DisplaySettings = DISPLAY_DEFAULT
const listeners = new Set<() => void>()
let started = false

function emit(): void {
  for (const listener of listeners) listener()
}

function start(): void {
  if (started) return
  started = true
  void readDisplaySettings().then((stored) => {
    current = stored
    emit()
  })
  watchDisplaySettings((stored) => {
    current = stored
    emit()
  })
}

export const displayStore = {
  get: (): DisplaySettings => current,
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    start()
    return () => {
      listeners.delete(listener)
    }
  },
  /**
   * Apply and persist. The dialog calls this on every interaction; the write is debounced and
   * the storage watcher's echo carries a value already on screen.
   */
  set(next: DisplaySettings): void {
    current = sanitizeDisplaySettings(next)
    emit()
    saveDisplaySettings(current)
  },
}

export function useDisplaySettings(): DisplaySettings {
  return useSyncExternalStore(displayStore.subscribe, displayStore.get)
}

/* ---------------------------------------------------------------- opening the dialog */

/**
 * The toolbar popup asks for the dialog; the terminal owns it. The request arrives at
 * content/index.tsx as a runtime message, which may land BEFORE the app has mounted (the
 * terminal has to be summoned first when it was not on screen), so the request is also latched:
 * whoever gets there first — a live listener or the app's first render — consumes it.
 */
export const DISPLAY_SETTINGS_EVENT = 'fobo:display-settings'

let pendingOpen = false

export function requestDisplaySettings(): void {
  pendingOpen = true
  window.dispatchEvent(new Event(DISPLAY_SETTINGS_EVENT))
}

/** True once per request, for whichever side reads it first. */
export function takeDisplaySettingsRequest(): boolean {
  const pending = pendingOpen
  pendingOpen = false
  return pending
}
