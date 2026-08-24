/**
 * A shared, polled, visibility-aware resource.
 *
 * Several components used to own their own timers for the same endpoint: the header and the
 * holdings bar each polled balances every 10s on unaligned clocks, the bottom bar and the
 * watchlist view each polled /watchlist, and three components asked for the current user at
 * mount. A resource holds one value, one timer and a subscriber list; the timer only runs
 * while at least one component is mounted and the terminal is active, and it fires once
 * immediately on (re)activation so the numbers are fresh when the terminal reappears.
 */

import { useSyncExternalStore } from 'react'
import { isActive, subscribeActive } from '~/lib/visibility'

export type ResourceStatus = 'idle' | 'loading' | 'ok' | 'error'

export interface Resource<T> {
  get: () => T | null
  /** idle before the first fetch, loading until it settles, then ok / error by its result. */
  getStatus: () => ResourceStatus
  subscribe: (listener: () => void) => () => void
  /** Fetch now (if active), ignoring the interval. */
  refresh: () => void
}

export function createResource<T>(
  fetcher: () => Promise<T | null>,
  intervalMs: number,
  options: { keepLastOnFailure?: boolean } = {},
): Resource<T> {
  const keepLast = options.keepLastOnFailure ?? true
  let value: T | null = null
  let status: ResourceStatus = 'idle'
  let timer: number | undefined
  let inflight = false
  let unsubscribeActive: (() => void) | undefined
  const listeners = new Set<() => void>()

  function emit(): void {
    for (const listener of listeners) listener()
  }

  async function load(): Promise<void> {
    if (inflight) return
    inflight = true
    if (status === 'idle') {
      status = 'loading'
      emit()
    }
    try {
      const next = await fetcher()
      status = next === null ? 'error' : 'ok'
      if (next !== null || !keepLast) value = next
    } catch {
      status = 'error'
    } finally {
      inflight = false
      emit()
    }
  }

  function start(): void {
    if (timer !== undefined) return
    void load()
    timer = window.setInterval(() => void load(), intervalMs)
  }

  function stop(): void {
    if (timer === undefined) return
    window.clearInterval(timer)
    timer = undefined
  }

  function reconcile(): void {
    if (listeners.size > 0 && isActive()) start()
    else stop()
  }

  return {
    get: () => value,
    getStatus: () => status,
    refresh: () => {
      if (isActive()) void load()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      if (!unsubscribeActive) unsubscribeActive = subscribeActive(reconcile)
      reconcile()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) {
          stop()
          unsubscribeActive?.()
          unsubscribeActive = undefined
        }
      }
    },
  }
}

export function useResource<T>(resource: Resource<T>): T | null {
  return useSyncExternalStore(resource.subscribe, resource.get)
}
