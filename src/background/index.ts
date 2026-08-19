/**
 * Service worker. Deliberately thin.
 *
 * It does NOT fetch data: fomo's API sits behind Cloudflare bot management that rejects
 * non-browser clients, so all data access happens in the page. This worker only owns the
 * on/off preference and the toolbar toggle.
 *
 * MV3 terminates this worker when idle, so nothing is cached in module scope — every read
 * goes to chrome.storage.
 */

const ENABLED_KEY = 'fobo:enabled'

async function isEnabled(): Promise<boolean> {
  const stored = await chrome.storage.sync.get(ENABLED_KEY)
  // Default on: the extension exists to be the home screen.
  return stored[ENABLED_KEY] !== false
}

async function setEnabled(value: boolean): Promise<void> {
  await chrome.storage.sync.set({ [ENABLED_KEY]: value })
}

chrome.action.onClicked.addListener((tab) => {
  void (async () => {
    const next = !(await isEnabled())
    await setEnabled(next)

    if (tab.id !== undefined) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'fobo:enabled-changed', enabled: next })
      } catch {
        // No content script on this tab (not fomo, or not yet injected) — nothing to tell.
      }
    }
  })()
})
