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
