/**
 * The one place the terminal's host element is named. `content/index.tsx` creates it and flips
 * `data-fobo-hidden` across handoffs; everything else only ever asks "is the terminal on
 * screen right now?" through here, so the id and the hidden convention cannot drift apart.
 */

export const HOST_ID = 'fobo-terminal-root'
export const LAUNCHER_ID = 'fobo-terminal-launcher'

/** Dispatched on window when the terminal becomes visible / is hidden behind fomo's page. */
export const SHOWN_EVENT = 'fobo:shown'
export const HIDDEN_EVENT = 'fobo:hidden'

/** True while the host exists and is not hidden behind fomo's page. */
export function isTerminalVisible(): boolean {
  const host = document.getElementById(HOST_ID)
  return host !== null && host.dataset.foboHidden === undefined
}

/* ---------- diagnostics on the host element ---------- */

/**
 * The shadow root is closed and content-script fetches never show up in the page's Resource
 * Timing, so from outside (the opencli harness, a curious user in DevTools) the terminal is a
 * black box. These attributes on the host are the deliberate window into it: per-kind request
 * counters and the socket state. Strings only, cheap to write, nothing sensitive.
 */
const requestCounts: Record<string, number> = {}

/** Count one outbound request of `kind` (e.g. "balances", "pulse"). */
export function countRequest(kind: string): void {
  requestCounts[kind] = (requestCounts[kind] ?? 0) + 1
  const host = document.getElementById(HOST_ID)
  if (host) host.dataset.foboRequests = JSON.stringify(requestCounts)
}

/** Publish a diagnostic value, e.g. setDiag('socket', 'authenticated'). */
export function setDiag(key: string, value: string): void {
  const host = document.getElementById(HOST_ID)
  if (host) host.dataset[`fobo${key.charAt(0).toUpperCase()}${key.slice(1)}`] = value
}
