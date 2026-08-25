/**
 * Click-away that survives the CLOSED shadow root.
 *
 * The old idiom — a window pointerdown listener testing `event.composedPath().includes(root)`
 * — silently broke for every dropdown in the terminal: composedPath is truncated at the host
 * for listeners OUTSIDE a closed shadow tree, so a pointerdown inside an open menu read as
 * "outside" and closed it before its click could land. The panel view switcher was stuck on
 * Alerts because no option click ever completed.
 *
 * The fix listens in two places:
 *  - on the shadow root itself (we are inside it, so targets arrive un-retargeted), judging
 *    inside/outside with plain `contains`;
 *  - on window, for pointerdowns on fomo's page around the terminal — skipping events whose
 *    target is the host, because those came from inside and were already judged above.
 */

import { useEffect, useRef, type RefObject } from 'react'

/** Watch for pointerdowns outside `el`; returns the cleanup. Core is React-free for tests. */
export function watchClickAway(el: HTMLElement, onAway: () => void): () => void {
  const rootNode = el.getRootNode()

  const judge = (event: Event) => {
    const target = event.target
    if (target instanceof Node && el.contains(target)) return
    onAway()
  }

  if (rootNode instanceof ShadowRoot) {
    const host = rootNode.host
    const onWindowDown = (event: Event) => {
      // Events from inside the shadow tree reach window retargeted to the host and were
      // already judged (with real targets) by the shadow-root listener.
      if (event.target === host) return
      onAway()
    }
    rootNode.addEventListener('pointerdown', judge)
    window.addEventListener('pointerdown', onWindowDown)
    return () => {
      rootNode.removeEventListener('pointerdown', judge)
      window.removeEventListener('pointerdown', onWindowDown)
    }
  }

  window.addEventListener('pointerdown', judge)
  return () => window.removeEventListener('pointerdown', judge)
}

/** Close-on-click-away for a menu rooted at `ref`, armed only while `active`. */
export function useClickAway<T extends HTMLElement>(
  ref: RefObject<T | null>,
  active: boolean,
  onAway: () => void,
): void {
  // Latest-ref so a new onAway identity does not re-arm the listeners every render.
  const awayRef = useRef(onAway)
  useEffect(() => {
    awayRef.current = onAway
  })
  useEffect(() => {
    if (!active) return
    const el = ref.current
    if (!el) return
    return watchClickAway(el, () => awayRef.current())
  }, [active, ref])
}
