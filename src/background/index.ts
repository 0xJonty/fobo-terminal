/**
 * Service worker. Deliberately thin.
 *
 * It does NOT fetch data: fomo's API sits behind Cloudflare bot management that rejects
 * non-browser clients, so all data access happens in the page. This worker only relays the
 * popup's on/off preference to open fomo tabs — the popup writes chrome.storage, this
 * broadcasts the change, content scripts re-sync.
 *
 * MV3 terminates this worker when idle, so nothing is cached in module scope — every read
 * goes to chrome.storage.
 */

const ENABLED_KEY = 'fobo:enabled'

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !(ENABLED_KEY in changes)) return
  const enabled = changes[ENABLED_KEY]?.newValue !== false

  void (async () => {
    // Host permission for fomo.family is what lets this URL-filtered query run without the
    // broad "tabs" permission.
    const tabs = await chrome.tabs.query({ url: 'https://fomo.family/*' })
    for (const tab of tabs) {
      if (tab.id === undefined) continue
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'fobo:enabled-changed', enabled })
      } catch {
        // Tab without a content script (still loading, or discarded) — nothing to tell.
      }
    }
  })()
})

// Module scope, not script scope — keeps this file's names out of the global namespace.
export {}
