import { useCallback, useEffect, useRef, useState } from 'react'
import { usdCompact, usdCompactDelta } from '~/lib/format'
import {
  clampGeometry,
  dragGeometry,
  readPnlSettings,
  savePnlSettings,
  type PnlCardGeometry,
  type PnlCardSettings,
  type PnlDragMode,
} from '~/lib/pnlCard'
import { useResource } from '~/lib/resource'
import { balances } from '~/lib/session'

/**
 * A floating card over the terminal showing the account balance and the profit since the
 * user last zeroed it. Dragged by its header, resized from its bottom-right corner, both
 * persisted (lib/pnlCard.ts).
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
  const [settings, setSettings] = useState<PnlCardSettings | null>(null)

  // Loaded once. This card is the only writer, so there is no storage watcher: one would
  // echo debounced writes back over a drag already in progress (same reasoning as the
  // column prefs in content/App.tsx).
  useEffect(() => {
    void readPnlSettings().then((stored) => {
      const { width, height } = viewport()
      setSettings({ ...stored, ...clampGeometry(stored, width, height) })
    })
  }, [])

  const numbers = useResource(balances)?.numbers ?? null
  const balanceUsd = numbers?.portfolioUsd

  /** State now, storage on release — the same split the panel's edge drag uses. */
  const commit = useCallback((next: PnlCardSettings) => {
    setSettings(next)
    savePnlSettings(next)
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
  const latest = useRef<PnlCardSettings | null>(null)
  useEffect(() => {
    latest.current = settings
  }, [settings])

  const beginDrag = (mode: PnlDragMode) => (event: React.PointerEvent<HTMLElement>) => {
    if (!settings) return
    // The reset button lives in the drag handle; a click on it is not a drag.
    if ((event.target as HTMLElement).closest('button')) return
    event.preventDefault()
    drag.current = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      start: { x: settings.x, y: settings.y, width: settings.width, height: settings.height },
    }
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
    if (latest.current) savePnlSettings(latest.current)
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
    >
      <header
        className="pnlcard-head"
        onPointerDown={beginDrag('move')}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="pnlcard-title">PnL</span>
        <button
          type="button"
          className="pnlcard-reset"
          title="Zero the PnL at the current balance"
          disabled={balanceUsd === undefined}
          onClick={reset}
        >
          Reset
        </button>
      </header>

      <div className="pnlcard-body">
        <div className="pnlcard-row">
          <span className="pnlcard-label">Balance</span>
          <span className="pnlcard-value">{usdCompact(balanceUsd)}</span>
        </div>
        <div className="pnlcard-row">
          <span className="pnlcard-label">PnL</span>
          <span className="pnlcard-value" data-tone={tone}>
            {usdCompactDelta(pnl)}
          </span>
        </div>
      </div>

      <div
        className="pnlcard-grip"
        role="separator"
        aria-label="Resize PnL card"
        onPointerDown={beginDrag('resize')}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </section>
  )
}
