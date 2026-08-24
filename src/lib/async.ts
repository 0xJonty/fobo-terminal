/**
 * A chrome.storage read from a context that is being invalidated can neither resolve nor
 * reject. One hung await used to stall the whole mount decision; every storage reader now
 * races against a timeout and falls back to its default.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false
    const timer = window.setTimeout(() => {
      if (settled) return
      settled = true
      resolve(fallback)
    }, ms)
    promise.then(
      (value) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        resolve(value)
      },
      () => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        resolve(fallback)
      },
    )
  })
}

/** Coalesce a burst of calls into one, `ms` after the last. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: number | undefined
  return (...args: A) => {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = undefined
      fn(...args)
    }, ms)
  }
}
