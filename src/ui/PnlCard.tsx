import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCcw, Settings } from 'lucide-react'
import { useClickAway } from '~/lib/clickAway'
import { usdCompact, usdCompactDelta } from '~/lib/format'
import { HIDDEN_EVENT } from '~/lib/host'
import {
  clampGeometry,
  clearPnlImage,
  dragGeometry,
  importPnlImage,
  isImageDataUrl,
  readPnlImage,
  readPnlSettings,
  savePnlImage,
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
 * The reset and settings controls are pinned to the top-right corner and the right column
 * reserves their width, so the two halves stay an even 50/50 and no number ever runs under
 * them. Type and the glyphs both scale with the card — see content/styles.css.
 *
 * Settings opens a panel under the card: the background image (a picked file, downscaled and
 * kept in chrome.storage.local) and the fill's opacity. Opacity dims the FILL only — the
 * frame, the numbers and these controls keep theirs, so a card faded to nothing is still
 * readable and still has the control that would undo it.
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
    void readPnlSettings().then(({ x, y, width, height, baselineUsd, opacity }) => {
      const view = viewport()
      setSettings({ baselineUsd, opacity, ...clampGeometry({ x, y, width, height }, view.width, view.height) })
    })
  }, [])

  /* ---- the settings panel: background image and fill opacity ---- */

  const [menuOpen, setMenuOpen] = useState(false)
  const [image, setImage] = useState<string | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void readPnlImage().then(setImage)
  }, [])

  useClickAway(menuRef, menuOpen, () => setMenuOpen(false))
  useEffect(() => {
    const close = () => setMenuOpen(false)
    window.addEventListener(HIDDEN_EVENT, close)
    return () => window.removeEventListener(HIDDEN_EVENT, close)
  }, [])

  const pickImage = (file: File | undefined) => {
    if (!file) return
    setImageError(null)
    void importPnlImage(file).then(
      (dataUrl) => {
        setImage(dataUrl)
        void savePnlImage(dataUrl).catch(() => setImageError('That image could not be saved.'))
      },
      (error: unknown) => setImageError(error instanceof Error ? error.message : 'That image could not be used.'),
    )
  }

  const resetImage = () => {
    setImageError(null)
    setImage(null)
    void clearPnlImage()
  }

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
    // The corner controls and the settings panel are clicks, not gestures; the corner grip
    // resizes; everything else on the card moves it.
    if (target.closest('button, input, label, .pnlcard-menu')) return
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

  // Live while dragging the slider, persisted on release — the same split as the card's own
  // geometry, so a sweep of the range is one storage write rather than a hundred.
  const changeOpacity = (opacity: number) => {
    setSettings((current) => (current ? { ...current, opacity } : current))
  }
  const commitOpacity = () => {
    if (latest.current) savePnlState(latest.current)
  }

  if (!settings) return null

  const pnl =
    settings.baselineUsd === null || balanceUsd === undefined ? undefined : balanceUsd - settings.baselineUsd
  // Exactly flat is neither a gain nor a loss, so it stays in the neutral text colour —
  // painting it green would claim a profit that is not there.
  const tone = pnl === undefined || pnl === 0 ? 'flat' : pnl > 0 ? 'up' : 'down'

  const custom = isImageDataUrl(image) ? image : null

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
      {/* The fill: surface, pattern and wordmark, or the user's own image. Only this layer
          takes the opacity, and it never takes a pointer. */}
      <div
        className="pnlcard-fill"
        data-custom={custom ? 'true' : undefined}
        style={{
          opacity: settings.opacity / 100,
          ...(custom ? { backgroundImage: `url("${custom}")` } : {}),
        }}
      />

      <div className="pnlcard-corner">
        <button
          type="button"
          className="pnlcard-control"
          title="Zero the PnL at the current balance"
          aria-label="Zero the PnL at the current balance"
          disabled={balanceUsd === undefined}
          onClick={reset}
        >
          {/* Sized by CSS, not by the prop — the glyphs scale with the card like the type does. */}
          <RotateCcw aria-hidden="true" />
        </button>
        <button
          type="button"
          className="pnlcard-control"
          title="Card settings"
          aria-label="Card settings"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Settings aria-hidden="true" />
        </button>
      </div>

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

      {menuOpen && (
        <div className="pnlcard-menu" ref={menuRef}>
          <div className="pnlcard-menu-row">
            <span className="pnlcard-menu-label">Background</span>
            <div className="pnlcard-menu-actions">
              <button type="button" className="pnlcard-menu-button" onClick={() => fileRef.current?.click()}>
                Choose…
              </button>
              <button
                type="button"
                className="pnlcard-menu-button"
                disabled={custom === null}
                onClick={resetImage}
              >
                Default
              </button>
            </div>
            <input
              ref={fileRef}
              className="pnlcard-file"
              type="file"
              accept="image/*"
              onChange={(event) => {
                pickImage(event.target.files?.[0])
                // Clear the input so picking the same file twice still fires a change.
                event.target.value = ''
              }}
            />
          </div>

          <div className="pnlcard-menu-row">
            <span className="pnlcard-menu-label">Opacity</span>
            <input
              className="pnlcard-slider"
              type="range"
              min={0}
              max={100}
              step={1}
              value={settings.opacity}
              aria-label="Card opacity"
              onChange={(event) => changeOpacity(Number(event.target.value))}
              onPointerUp={commitOpacity}
              onKeyUp={commitOpacity}
              onBlur={commitOpacity}
            />
            <span className="pnlcard-menu-value">{settings.opacity}%</span>
          </div>

          {imageError && <p className="pnlcard-menu-error">{imageError}</p>}
        </div>
      )}

      {/* Purely the corner affordance — the gesture belongs to the card's own handler. */}
      <div className="pnlcard-grip" aria-hidden="true" />
    </section>
  )
}
