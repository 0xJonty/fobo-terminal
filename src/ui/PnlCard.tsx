import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { usdCompact, usdCompactDelta } from '~/lib/format'
import {
  clampGeometry,
  dragGeometry,
  readPnlSettings,
  savePnlState,
  type PnlCardGeometry,
  type PnlCardState,
  type PnlDragMode,
} from '~/lib/pnlCard'
import { useResource } from '~/lib/resource'
import { balances } from '~/lib/session'

/**
 * A floating card over the terminal showing the account balance and the profit since the
 * user last zeroed it, split evenly left and right. Dragged from anywhere on it, resized from
 * its bottom-right corner, both persisted (lib/pnlCard.ts).
 *
 * The reset control is pinned to the top-right corner and the right column reserves its
 * width, so the two halves stay an even 50/50 and no number ever runs under the button. Type
 * and the glyph both scale with the card — see the .pnlcard rules in content/styles.css.
 *
 * One pointer handler on the card owns both gestures: the target decides which. That is why
 * the grip and the reset control carry no handlers of their own — a second set would fire on
 * the same bubbled event and run the same drag twice.
 *
 * The balance is fomo's own portfolio total — the figure its header shows, read from the
 * shared /balances resource on the same 10s cadence as the holdings bar, so the card costs
 * no extra requests. Nothing here is invented: with no balance yet the card renders dashes
 * rather than a zero.
 *
 * The card is position: fixed. The host is `position: fixed; inset: 0` with no transformed
 * ancestor, so viewport coordinates and terminal coordinates are the same thing, and fixed
 * escapes the shell's `overflow: hidden` instead of being clipped by it.
 */

interface DragState {
  mode: PnlDragMode
  pointerId: number
  startX: number
  startY: number
  start: PnlCardGeometry
}

function viewport(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight }
}

export function PnlCard() {
  const [settings, setSettings] = useState<PnlCardState | null>(null)

  // Loaded once. Nothing else writes the geometry or the baseline, so there is no storage
  // watcher here: one would echo debounced writes back over a drag already in progress (same
  // reasoning as the column prefs in content/App.tsx). The popup's `enabled` flag IS watched,
  // but by App.tsx, which decides whether this component is mounted at all.
  useEffect(() => {
    void readPnlSettings().then(({ x, y, width, height, baselineUsd }) => {
      const view = viewport()
      setSettings({ baselineUsd, ...clampGeometry({ x, y, width, height }, view.width, view.height) })
    })
  }, [])

  const numbers = useResource(balances)?.numbers ?? null
  const balanceUsd = numbers?.portfolioUsd

  /** State now, storage on release — the same split the panel's edge drag uses. */
  const commit = useCallback((next: PnlCardState) => {
    setSettings(next)
    savePnlState(next)
  }, [])

  // The first balance of a fresh install seeds the baseline, so the card opens at zero
  // instead of counting a whole portfolio as profit.
  useEffect(() => {
    if (!settings || settings.baselineUsd !== null || balanceUsd === undefined) return
    commit({ ...settings, baselineUsd: balanceUsd })
  }, [settings, balanceUsd, commit])

  // A window narrower than the card pulls it back into view. Not persisted: the stored
  // geometry stays whatever the user chose, ready for the screen they chose it on.
  useEffect(() => {
    const onResize = () => {
      setSettings((current) => {
        if (!current) return current
        const { width, height } = viewport()
        const next = clampGeometry(current, width, height)
        const same =
          next.x === current.x &&
          next.y === current.y &&
          next.width === current.width &&
          next.height === current.height
        return same ? current : { ...current, ...next }
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const drag = useRef<DragState | null>(null)

  // The latest committed geometry, for the release handler: pointerup lands after the last
  // move's render, so this is what the user actually let go of. Reading it from a ref keeps
  // the storage write out of a state updater, which React is free to run more than once.
  const latest = useRef<PnlCardState | null>(null)
  useEffect(() => {
    latest.current = settings
  }, [settings])

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (!settings || event.button !== 0) return
    const target = event.target as HTMLElement
    // The reset control is a click, not a gesture; the corner grip resizes; everything else
    // on the card moves it.
    if (target.closest('button')) return
    const mode: PnlDragMode = target.closest('.pnlcard-grip') ? 'resize' : 'move'
    event.preventDefault()
    drag.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      start: { x: settings.x, y: settings.y, width: settings.width, height: settings.height },
    }
    // Captured on the card itself, so a pointer that outruns the card keeps the gesture.
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    const { width: vw, height: vh } = viewport()
    const moved = dragGeometry(
      state.mode,
      state.start,
      event.clientX - state.startX,
      event.clientY - state.startY,
    )
    setSettings((current) => (current ? { ...current, ...clampGeometry(moved, vw, vh) } : current))
  }

  const endDrag = (event: React.PointerEvent<HTMLElement>) => {
    const state = drag.current
    if (!state || state.pointerId !== event.pointerId) return
    drag.current = null
    if (latest.current) savePnlState(latest.current)
  }

  const reset = () => {
    if (!settings || balanceUsd === undefined) return
    commit({ ...settings, baselineUsd: balanceUsd })
  }

  if (!settings) return null

  const pnl =
    settings.baselineUsd === null || balanceUsd === undefined ? undefined : balanceUsd - settings.baselineUsd
  // Exactly flat is neither a gain nor a loss, so it stays in the neutral text colour —
  // painting it green would claim a profit that is not there.
  const tone = pnl === undefined || pnl === 0 ? 'flat' : pnl > 0 ? 'up' : 'down'

  return (
    <section
      className="pnlcard"
      aria-label="PnL"
      style={{ left: settings.x, top: settings.y, width: settings.width, height: settings.height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <button
        type="button"
        className="pnlcard-reset"
        title="Zero the PnL at the current balance"
        aria-label="Zero the PnL at the current balance"
        disabled={balanceUsd === undefined}
        onClick={reset}
      >
        {/* Sized by CSS, not by the prop — the glyph scales with the card like the type does. */}
        <RotateCcw aria-hidden="true" />
      </button>

      <div className="pnlcard-cell">
        <span className="pnlcard-label">Balance</span>
        <span className="pnlcard-value">{usdCompact(balanceUsd)}</span>
      </div>

      <div className="pnlcard-cell pnlcard-cell-right">
        <span className="pnlcard-label">PnL</span>
        <span className="pnlcard-value" data-tone={tone}>
          {usdCompactDelta(pnl)}
        </span>
      </div>

      {/* Purely the corner affordance — the gesture belongs to the card's own handler. */}
      <div className="pnlcard-grip" aria-hidden="true" />
    </section>
  )
}
