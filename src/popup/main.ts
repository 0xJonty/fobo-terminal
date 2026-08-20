/**
 * Toolbar popup. Owns the preferences: whether the terminal shows on fomo.family, and the
 * FOMO Panel's visibility, side and alert sound. Width is NOT here — the panel's inner edge
 * is a drag handle. Writing chrome.storage is the whole job — the background worker relays
 * the terminal toggle; the panel settings are watched by the content script directly via
 * chrome.storage.onChanged.
 */

import {
  ALERTS_KEY,
  readAlertsSettings,
  sanitizeAlertsSettings,
  type AlertsSettings,
} from '~/lib/settings'

const ENABLED_KEY = 'fobo:enabled'

const toggle = document.getElementById('enabled') as HTMLInputElement

void chrome.storage.sync.get(ENABLED_KEY).then((stored) => {
  toggle.checked = stored[ENABLED_KEY] !== false
})

toggle.addEventListener('change', () => {
  void chrome.storage.sync.set({ [ENABLED_KEY]: toggle.checked })
})

/* ---- alerts panel ---- */

const alertsToggle = document.getElementById('alerts-enabled') as HTMLInputElement
const sideLeft = document.getElementById('side-left') as HTMLButtonElement
const sideRight = document.getElementById('side-right') as HTMLButtonElement
const soundToggle = document.getElementById('sound-enabled') as HTMLInputElement

let settings: AlertsSettings = sanitizeAlertsSettings(undefined)

function reflect(): void {
  alertsToggle.checked = settings.enabled
  sideLeft.setAttribute('aria-pressed', String(settings.side === 'left'))
  sideRight.setAttribute('aria-pressed', String(settings.side === 'right'))
  soundToggle.checked = settings.sound
}

function save(patch: Partial<AlertsSettings>): void {
  settings = sanitizeAlertsSettings({ ...settings, ...patch })
  reflect()
  void chrome.storage.sync.set({ [ALERTS_KEY]: settings })
}

void readAlertsSettings().then((stored) => {
  settings = stored
  reflect()
})
reflect()

alertsToggle.addEventListener('change', () => save({ enabled: alertsToggle.checked }))
sideLeft.addEventListener('click', () => save({ side: 'left' }))
sideRight.addEventListener('click', () => save({ side: 'right' }))
soundToggle.addEventListener('change', () => save({ sound: soundToggle.checked }))

// Module scope, not script scope — keeps this file's names out of the global namespace.
export {}
