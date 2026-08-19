/**
 * Applies fomo's list diff protocol.
 *
 * fomo's own reducer is, in essence:
 *   snapshot -> replace
 *   new      -> insertAt(list, index, row)
 *   update   -> insertAt(removeByKey(list, key), index, row)
 *   remove   -> removeByKey(list, key)
 *
 * We reproduce it exactly, so our columns can be diffed against fomo's own panel during
 * verification. Divergence there means this file is wrong.
 */

import type { ListDiff } from '~/lib/protocol'
import { fromFomoRow, normalizeKey, type Token } from '~/types/token'

/**
 * fomo caps at 100 rows when it *renders*, not in its reducer — its store keeps the full
 * list. We do the same, so a `remove` correctly promotes row 101 into view instead of
 * silently losing it. Apply MAX_ROWS at the render boundary.
 */
export const MAX_ROWS = 100

function insertAt(list: readonly Token[], index: number, row: Token): Token[] {
  const next = list.slice()
  const at = Math.max(0, Math.min(Number.isFinite(index) ? index : next.length, next.length))
  next.splice(at, 0, row)
  return next
}

function removeByKey(list: readonly Token[], key: string): Token[] {
  return list.filter((row) => row.key !== key)
}

/**
 * Apply one diff. Returns the previous array unchanged when the diff is unusable, so a
 * payload shape change degrades to "no update" rather than a corrupted column.
 */
export function applyDiff(current: readonly Token[], diff: ListDiff): Token[] {
  switch (diff.kind) {
    case 'snapshot': {
      if (!Array.isArray(diff.tokens)) return current as Token[]
      return diff.tokens.map(fromFomoRow).filter((row): row is Token => row !== null)
    }

    case 'new': {
      const row = fromFomoRow(diff.update)
      if (!row) return current as Token[]
      // fomo inserts without deduping; we drop any existing copy first so a re-delivered
      // frame cannot produce a duplicate row. With unique keys the result is identical.
      return insertAt(removeByKey(current, row.key), diff.index, row)
    }

    case 'update': {
      const row = fromFomoRow(diff.update)
      if (!row) return current as Token[]
      // Keys we build are case-folded for EVM; the wire key is not, so fold it before matching
      // or an 'update' would insert a second copy instead of moving the existing row.
      const without = removeByKey(current, diff.tokenKey ? normalizeKey(diff.tokenKey) : row.key)
      return insertAt(without, diff.index, row)
    }

    case 'remove': {
      if (typeof diff.tokenKey !== 'string') return current as Token[]
      return removeByKey(current, normalizeKey(diff.tokenKey))
    }

    default:
      return current as Token[]
  }
}

/** Replace a whole list from a REST response. */
export function fromSnapshot(rows: readonly unknown[]): Token[] {
  return rows.map(fromFomoRow).filter((row): row is Token => row !== null)
}
