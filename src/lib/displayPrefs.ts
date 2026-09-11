/**
 * What a token card shows, and which columns the terminal draws.
 *
 * Stored in chrome.storage.sync beside the other preferences (see settings.ts), so a card
 * trimmed down to the numbers someone actually reads follows their Chrome profile. Unlike the
 * panel settings, BOTH writers are in the page: the Display settings dialog is rendered inside
 * the terminal, opened from the toolbar popup. The popup only asks for it — it never writes these.
 *
 * Every field and column defaults to ON. An upgrade must not silently strip a card of the metrics
 * it had yesterday, so a stored payload written before one existed reads as "shown".
 */

import { useSyncExternalStore } from 'react'
import { debounce, withTimeout } from '~/lib/async'
import { LIST_KEYS, type ListKey } from '~/lib/protocol'

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
}

export const CARD_FIELD_HINT: Readonly<Partial<Record<CardField, string>>> = {
  bondBar: 'Bonding column only',
}

export interface DisplaySettings {
  fields: Record<CardField, boolean>
  /**
   * Which of the three token columns are shown, keyed by list. The side panel is a fourth
   * column the dialog also toggles, but its on/off flag lives in the panel's own settings
   * (settings.ts) — this map covers only the columns App renders from LIST_KEYS. Every column
   * defaults ON; at least one column (including the panel) must stay visible, enforced by the
   * dialog and, as a last resort, by App's render.
   */
  columns: Record<ListKey, boolean>
}

function allFields(value: boolean): Record<CardField, boolean> {
  return Object.fromEntries(CARD_FIELDS.map((field) => [field, value])) as Record<CardField, boolean>
}

function allColumns(value: boolean): Record<ListKey, boolean> {
  return Object.fromEntries(LIST_KEYS.map((list) => [list, value])) as Record<ListKey, boolean>
}

export const DISPLAY_DEFAULT: DisplaySettings = {
  fields: allFields(true),
  columns: allColumns(true),
}

/** The token columns App should render, in LIST_KEYS order. Never used to force a minimum. */
export function enabledColumns(settings: DisplaySettings): ListKey[] {
  return LIST_KEYS.filter((list) => settings.columns[list])
}

/** Default whatever is in storage, so a bad write can never break a card. */
export function sanitizeDisplaySettings(raw: unknown): DisplaySettings {
  const row = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const storedFields = (
    typeof row.fields === 'object' && row.fields !== null ? row.fields : {}
  ) as Record<string, unknown>

  const fields = allFields(true)
  for (const field of CARD_FIELDS) fields[field] = storedFields[field] !== false

  const storedColumns = (
    typeof row.columns === 'object' && row.columns !== null ? row.columns : {}
  ) as Record<string, unknown>
  const columns = allColumns(true)
  // Default-on, like the fields: a payload written before a column existed must not hide it,
  // and a corrupt map can never blank every column — only an explicit `false` turns one off.
  for (const list of LIST_KEYS) columns[list] = storedColumns[list] !== false

  return { fields, columns }
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
 * Debounced, like the column prefs: the dialog calls this on every flip, and chrome.storage.sync
 * caps writes at 120/minute. The last value wins.
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
