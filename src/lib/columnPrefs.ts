/**
 * Per-column filter and sort preferences.
 *
 * fomo still owns list membership and base order — these prefs only narrow (filters) or
 * re-order (an explicit user sort) what fomo streamed. `sort: null` renders fomo's own
 * order untouched, and every filter defaults to off, so the out-of-the-box terminal is
 * exactly fomo's lists.
 *
 * Stored in chrome.storage.sync so they survive reloads and follow the user's Chrome
 * profile, same as the alerts panel settings. Within a session nothing here is even
 * needed: the terminal hides rather than unmounts across a handoff, so React state
 * already survives terminal -> token -> terminal.
 */

import { withTimeout } from '~/lib/async'
import { LIST_KEYS, type ListKey } from '~/lib/protocol'
import type { Token } from '~/types/token'

export const COLUMNS_KEY = 'fobo:columns'

/**
 * Bumped when a change in meaning (not just shape) needs a migration on read — see
 * sanitizeAllColumnPrefs. v1 had no version field.
 */
const STORAGE_VERSION = 2

export type SortField = 'marketCap' | 'volume' | 'holders' | 'liquidity' | 'age'
export type SortDir = 'desc' | 'asc'

/** Raw user input, kept verbatim so the boxes round-trip exactly; '' means unset. */
export interface RangeFilter {
  min: string
  max: string
}

export interface ColumnPrefs {
  sort: { field: SortField; dir: SortDir } | null
  /** networkIds to keep; null = every chain. Never persisted as empty or the full set. */
  chains: number[] | null
  marketCap: RangeFilter
  liquidity: RangeFilter
  holders: RangeFilter
  volume: RangeFilter
  /** Token age bounds, parsed as durations ("30s" / "5m" / "2h" / "1d"; bare number = minutes). */
  age: RangeFilter
}

export type AllColumnPrefs = Record<ListKey, ColumnPrefs>

/**
 * The chains offered in the filter UI: fomo's supported set (see SUPPORTED_CHAINS in
 * protocol.ts), labelled with fomo's own display names. Hyperliquid is in NETWORK_SLUG but
 * not in fomo's supported-chains header, so it is not offered here either.
 */
export const FILTERABLE_CHAINS: readonly { networkId: number; label: string }[] = [
  { networkId: 1399811149, label: 'Solana' },
  { networkId: 8453, label: 'Base' },
  { networkId: 56, label: 'BNB' },
  { networkId: 4663, label: 'Robinhood' },
  { networkId: 143, label: 'Monad' },
  { networkId: 1, label: 'Ethereum' },
]

const FILTERABLE_IDS = new Set(FILTERABLE_CHAINS.map((chain) => chain.networkId))
const SORT_FIELDS: readonly SortField[] = ['marketCap', 'volume', 'holders', 'liquidity', 'age']

/**
 * Graduated defaults to newest-first: fomo streams that list in its own order, and a fresh
 * graduation is the event the column exists to surface. The user can still clear the sort
 * (back to fomo's order) and that choice persists; Reset restores this default.
 */
export function defaultPrefs(list?: ListKey): ColumnPrefs {
  return {
    sort: list === 'graduated' ? { field: 'age', dir: 'desc' } : null,
    chains: null,
    marketCap: { min: '', max: '' },
    liquidity: { min: '', max: '' },
    holders: { min: '', max: '' },
    volume: { min: '', max: '' },
    age: { min: '', max: '' },
  }
}

export function defaultAllPrefs(): AllColumnPrefs {
  return {
    'pre-graduated': defaultPrefs('pre-graduated'),
    graduated: defaultPrefs('graduated'),
    trending: defaultPrefs('trending'),
  }
}

/* ---------------------------------------------------------------------------- parsing */

/** "$1.2m" / "50k" / "1,000" / "250" -> a number, or undefined when not parseable. */
export function parseAmount(raw: string): number | undefined {
  const match = /^\$?\s*([\d,]*\.?\d+)\s*([kmb])?$/i.exec(raw.trim())
  if (!match?.[1]) return undefined
  const base = Number(match[1].replace(/,/g, ''))
  if (!Number.isFinite(base)) return undefined
  const scale = { k: 1e3, m: 1e6, b: 1e9 }[match[2]?.toLowerCase() as 'k' | 'm' | 'b'] ?? 1
  return base * scale
}

/** "30s" / "5m" / "2h" / "1d" -> seconds. A bare number reads as minutes. */
export function parseDuration(raw: string): number | undefined {
  const match = /^([\d.]+)\s*([smhd])?$/i.exec(raw.trim())
  if (!match?.[1]) return undefined
  const base = Number(match[1])
  if (!Number.isFinite(base)) return undefined
  const scale = { s: 1, m: 60, h: 3600, d: 86400 }[match[2]?.toLowerCase() as 's' | 'm' | 'h' | 'd'] ?? 60
  return base * scale
}

/* ------------------------------------------------------------------------- application */

interface Bound {
  min?: number
  max?: number
}

function boundOf(range: RangeFilter, parse: (raw: string) => number | undefined): Bound {
  // An unparseable entry is treated as unset rather than as "matches nothing"; the input
  // box flags it instead (see ColumnControls), so a half-typed number never blanks a column.
  return {
    min: range.min.trim() === '' ? undefined : parse(range.min),
    max: range.max.trim() === '' ? undefined : parse(range.max),
  }
}

/**
 * An active bound on a metric we do not have drops the row. Letting unknowns through would
 * make "min 100 holders" pass exactly the rows the user is trying to screen out, purely
 * because Mobula has not decorated them yet.
 */
function passes(value: number | undefined, bound: Bound): boolean {
  if (bound.min === undefined && bound.max === undefined) return true
  if (value === undefined) return false
  if (bound.min !== undefined && value < bound.min) return false
  if (bound.max !== undefined && value > bound.max) return false
  return true
}

/**
 * Volume reads exactly what the card displays: 24h when known, else Mobula's 1h figure
 * (TokenCard labels the fallback "VOL 1H"). Filtering on a number the card does not show
 * would make rows vanish for no visible reason.
 */
const SORT_VALUE: Readonly<Record<SortField, (token: Token) => number | undefined>> = {
  marketCap: (token) => token.marketCap,
  volume: (token) => token.volume24 ?? token.metrics?.volume1h,
  holders: (token) => token.metrics?.holdersCount,
  liquidity: (token) => token.liquidity,
  // Age sorts on createdAt itself: 'desc' (largest timestamp first) is newest-first, which
  // the UI labels "newest" rather than "highest". Unknown createdAt sinks like any unknown.
  age: (token) => token.createdAt,
}

/** True when any membership filter is set (sort alone does not change the row count). */
export function filtersActive(prefs: ColumnPrefs): boolean {
  const rangeSet = (range: RangeFilter) => range.min.trim() !== '' || range.max.trim() !== ''
  return (
    prefs.chains !== null ||
    rangeSet(prefs.marketCap) ||
    rangeSet(prefs.liquidity) ||
    rangeSet(prefs.holders) ||
    rangeSet(prefs.volume) ||
    rangeSet(prefs.age)
  )
}

/** Filter, then optionally sort. Callers apply the render row cap after this, not before. */
export function applyPrefs(tokens: readonly Token[], prefs: ColumnPrefs, nowMs: number): Token[] {
  const chainSet = prefs.chains === null ? null : new Set(prefs.chains)
  const marketCap = boundOf(prefs.marketCap, parseAmount)
  const liquidity = boundOf(prefs.liquidity, parseAmount)
  const holders = boundOf(prefs.holders, parseAmount)
  const volume = boundOf(prefs.volume, parseAmount)
  const ageBound = boundOf(prefs.age, parseDuration)
  const nowSeconds = Math.floor(nowMs / 1000)

  const rows = tokens.filter((token) => {
    if (chainSet && !chainSet.has(token.networkId)) return false
    if (!passes(token.marketCap, marketCap)) return false
    if (!passes(token.liquidity, liquidity)) return false
    if (!passes(token.metrics?.holdersCount, holders)) return false
    if (!passes(SORT_VALUE.volume(token), volume)) return false
    if (ageBound.min !== undefined || ageBound.max !== undefined) {
      if (token.createdAt === undefined) return false
      if (!passes(Math.max(0, nowSeconds - token.createdAt), ageBound)) return false
    }
    return true
  })

  const sort = prefs.sort
  if (sort) {
    const value = SORT_VALUE[sort.field]
    const mul = sort.dir === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      const av = value(a)
      const bv = value(b)
      if (av === undefined && bv === undefined) return 0
      // Unknowns sink to the bottom in either direction — "lowest first" must not lead
      // with rows whose value we simply do not have.
      if (av === undefined) return 1
      if (bv === undefined) return -1
      return (av - bv) * mul
    })
  }
  return rows
}

/* ----------------------------------------------------------------------------- storage */

function sanitizeRange(raw: unknown): RangeFilter {
  const row = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const str = (value: unknown) => (typeof value === 'string' ? value.slice(0, 24) : '')
  return { min: str(row.min), max: str(row.max) }
}

export function sanitizeColumnPrefs(raw: unknown): ColumnPrefs {
  const row = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>

  let sort: ColumnPrefs['sort'] = null
  const rawSort = row.sort as { field?: unknown; dir?: unknown } | null | undefined
  if (rawSort && SORT_FIELDS.includes(rawSort.field as SortField)) {
    sort = { field: rawSort.field as SortField, dir: rawSort.dir === 'asc' ? 'asc' : 'desc' }
  }

  let chains: number[] | null = null
  if (Array.isArray(row.chains)) {
    const kept = [...new Set(row.chains)].filter(
      (id): id is number => typeof id === 'number' && FILTERABLE_IDS.has(id),
    )
    if (kept.length > 0 && kept.length < FILTERABLE_IDS.size) chains = kept
  }

  return {
    sort,
    chains,
    marketCap: sanitizeRange(row.marketCap),
    liquidity: sanitizeRange(row.liquidity),
    holders: sanitizeRange(row.holders),
    volume: sanitizeRange(row.volume),
    age: sanitizeRange(row.age),
  }
}

export function sanitizeAllColumnPrefs(raw: unknown): AllColumnPrefs {
  const row = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const all = defaultAllPrefs()
  for (const key of LIST_KEYS) {
    if (key in row) all[key] = sanitizeColumnPrefs(row[key])
  }
  // v1 predates the age sort, so a v1 graduated `sort: null` cannot be a deliberate
  // rejection of the newest-first default — upgrade it. From v2 on, null is explicit
  // ("give me fomo's order") and stays put.
  if (row.v !== STORAGE_VERSION && 'graduated' in row && all.graduated.sort === null) {
    all.graduated.sort = { field: 'age', dir: 'desc' }
  }
  return all
}

/** Defaults when the extension context is gone (orphaned content script) or storage throws. */
export async function readColumnPrefs(): Promise<AllColumnPrefs> {
  try {
    const stored = await withTimeout(chrome.storage.sync.get(COLUMNS_KEY), 1_000, {})
    return sanitizeAllColumnPrefs(stored[COLUMNS_KEY])
  } catch {
    return defaultAllPrefs()
  }
}

let saveTimer: number | undefined
let pending: AllColumnPrefs | null = null

/**
 * Debounced write. Every keystroke in a min/max box lands here, and chrome.storage.sync
 * caps writes at 120/minute — coalescing keeps a typed-out "125000" to one write.
 */
export function saveColumnPrefs(all: AllColumnPrefs): void {
  pending = all
  if (saveTimer !== undefined) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined
    const value = pending
    pending = null
    if (!value) return
    try {
      chrome.storage.sync.set({ [COLUMNS_KEY]: { ...value, v: STORAGE_VERSION } }).catch(() => {
        /* quota or context gone — prefs just do not persist this time */
      })
    } catch {
      /* context already gone — prefs just do not persist this time */
    }
  }, 400)
}
