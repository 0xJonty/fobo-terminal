/**
 * Transient notifications, dropped down over the middle of the terminal.
 *
 * Quick buy is the only thing that raises them so far, and it raises them for one reason: a buy
 * that did not happen. A failure used to be reported on the button itself, which is the wrong
 * place — the button is 60 pixels wide in a column of a hundred rows, the message never fitted,
 * and by the time the eye found it the row had scrolled. A failure is not a state of the button,
 * it is an event, so it is announced as one.
 *
 * Deliberately not a general logging channel: nothing routine goes here. If everything toasted,
 * nothing would be read.
 */

import { useSyncExternalStore } from 'react'

export type ToastKind = 'error' | 'success'

export interface Toast {
  id: number
  kind: ToastKind
  /** One line. The card is centred and narrow — anything longer is not read. */
  message: string
}

/** Long enough to read a sentence, short enough not to sit over the columns. */
const TOAST_MS = 7_000

/** A burst (one click per row, fast) must not become a wall covering the terminal. */
const MAX_TOASTS = 3

let toasts: readonly Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const timers = new Map<number, number>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function dismissToast(id: number): void {
  const timer = timers.get(id)
  if (timer !== undefined) {
    window.clearTimeout(timer)
    timers.delete(id)
  }
  const next = toasts.filter((toast) => toast.id !== id)
  if (next.length === toasts.length) return
  toasts = next
  emit()
}

export function pushToast(kind: ToastKind, message: string): number {
  const id = nextId++
  // Oldest goes first, so the newest failure is always on screen.
  const kept = toasts.slice(Math.max(0, toasts.length - (MAX_TOASTS - 1)))
  for (const dropped of toasts.slice(0, toasts.length - kept.length)) {
    const timer = timers.get(dropped.id)
    if (timer !== undefined) window.clearTimeout(timer)
    timers.delete(dropped.id)
  }
  toasts = [...kept, { id, kind, message }]
  timers.set(
    id,
    window.setTimeout(() => dismissToast(id), TOAST_MS),
  )
  emit()
  return id
}

/** Used when the terminal hands off: nothing should be left hanging over fomo's own page. */
export function clearToasts(): void {
  for (const timer of timers.values()) window.clearTimeout(timer)
  timers.clear()
  if (toasts.length === 0) return
  toasts = []
  emit()
}

const toastStore = {
  get: (): readonly Toast[] => toasts,
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

export function useToasts(): readonly Toast[] {
  return useSyncExternalStore(toastStore.subscribe, toastStore.get)
}
