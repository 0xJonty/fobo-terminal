/**
 * "Should the terminal be doing work right now?"
 *
 * The app stays mounted (hidden, not unmounted) across a handoff to fomo's own pages so Back
 * is instant — but that used to mean every poller, the socket reducer and the clocks kept
 * running on top of fomo's token page and in background tabs. This module is the single
 * signal they all pause on: active = the terminal is on screen AND the tab is visible.
 *
 * Plain module state plus subscribers, so it can be read from non-React code (the socket
 * buffer, Mobula warming) and consumed by React via useSyncExternalStore.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'
import { HIDDEN_EVENT, SHOWN_EVENT, isTerminalVisible } from '~/lib/host'

type Listener = () => void

const listeners = new Set<Listener>()
let installed = false

function notify(): void {
  for (const listener of listeners) listener()
}

function install(): void {
  if (installed) return
  installed = true
  window.addEventListener(SHOWN_EVENT, notify)
  window.addEventListener(HIDDEN_EVENT, notify)
  document.addEventListener('visibilitychange', notify)
}

/** True when the terminal is on screen and the tab is not hidden. */
export function isActive(): boolean {
  return isTerminalVisible() && document.visibilityState !== 'hidden'
}

export function subscribeActive(listener: Listener): () => void {
  install()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useTerminalActive(): boolean {
  return useSyncExternalStore(subscribeActive, isActive)
}

/**
 * Run `callback` immediately when the terminal becomes active and then every `intervalMs`
 * while it stays active; nothing runs while hidden. `deps` re-arms the schedule (a new
 * callback identity does not — the latest one is always invoked).
 */
export function useActiveInterval(
  callback: () => void,
  intervalMs: number,
  deps: readonly unknown[] = [],
  enabled = true,
): void {
  const active = useTerminalActive()
  const latest = useRef(callback)
  latest.current = callback

  useEffect(() => {
    if (!active || !enabled) return
    latest.current()
    const id = window.setInterval(() => latest.current(), intervalMs)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is the caller's key
  }, [active, enabled, intervalMs, ...deps])
}
