/**
 * Toolbar popup. Owns the single preference: whether the terminal shows on fomo.family.
 * Writing chrome.storage is the whole job — the background worker relays the change to open
 * fomo tabs, whose content scripts re-sync.
 */

const ENABLED_KEY = 'fobo:enabled'

const toggle = document.getElementById('enabled') as HTMLInputElement

void chrome.storage.sync.get(ENABLED_KEY).then((stored) => {
  toggle.checked = stored[ENABLED_KEY] !== false
})

toggle.addEventListener('change', () => {
  void chrome.storage.sync.set({ [ENABLED_KEY]: toggle.checked })
})

// Module scope, not script scope — keeps this file's names out of the global namespace.
export {}
