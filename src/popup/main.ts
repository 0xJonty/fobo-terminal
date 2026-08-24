/**
 * Toolbar popup. Owns the preferences: whether the terminal shows on fomo.family, and the
 * FOMO Panel's visibility, side and alert sound. Width is NOT here — the panel's inner edge
 * is a drag handle. Writing chrome.storage is the whole job — the background worker relays
 * the terminal toggle; the panel settings are watched by the content script directly via
 * chrome.storage.onChanged.
 *
 * Every write is read-modify-write against storage, not against a snapshot taken when the
 * popup opened: the content script commits width, filters and feed groups on its own, and a
 * stale snapshot used to clobber them the moment any switch here was flipped.
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

async function save(patch: Partial<AlertsSettings>): Promise<void> {
  const stored = await readAlertsSettings()
  settings = sanitizeAlertsSettings({ ...stored, ...patch })
  reflect()
  await chrome.storage.sync.set({ [ALERTS_KEY]: settings })
}

void readAlertsSettings().then((stored) => {
  settings = stored
  reflect()
})
reflect()

// Another writer (the terminal's own commits, another window's popup) changes the row here.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !(ALERTS_KEY in changes)) return
  settings = sanitizeAlertsSettings(changes[ALERTS_KEY]?.newValue)
  reflect()
  if (ENABLED_KEY in changes) toggle.checked = changes[ENABLED_KEY]?.newValue !== false
})

alertsToggle.addEventListener('change', () => void save({ enabled: alertsToggle.checked }))
sideLeft.addEventListener('click', () => void save({ side: 'left' }))
sideRight.addEventListener('click', () => void save({ side: 'right' }))
soundToggle.addEventListener('change', () => void save({ sound: soundToggle.checked }))

// Module scope, not script scope — keeps this file's names out of the global namespace.
export {}
