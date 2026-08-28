/**
 * Toolbar popup. Owns the preferences: whether the terminal shows on fomo.family, the FOMO
 * Panel's visibility, side and alert sound, and whether the PnL card is on. Width is NOT here
 * — the panel's inner edge is a drag handle, and the PnL card's position, size and baseline
 * likewise belong to the card itself. Writing chrome.storage is the whole job — the background
 * worker relays the terminal toggle; the panel settings and the PnL flag are watched by the
 * content script directly via chrome.storage.onChanged.
 *
 * Every write is read-modify-write against storage, not against a snapshot taken when the
 * popup opened: the content script commits width, filters and feed groups on its own, and a
 * stale snapshot used to clobber them the moment any switch here was flipped.
 */

import { PNL_KEY, readPnlSettings, sanitizePnlSettings, savePnlEnabled } from '~/lib/pnlCard'
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

/* ---- PnL card ---- */

const pnlToggle = document.getElementById('pnl-enabled') as HTMLInputElement

void readPnlSettings().then((stored) => {
  pnlToggle.checked = stored.enabled
})

// Another window's popup flipping the same switch.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !(PNL_KEY in changes)) return
  pnlToggle.checked = sanitizePnlSettings(changes[PNL_KEY]?.newValue).enabled
})

// savePnlEnabled is itself read-modify-write, so a drag the terminal has in flight survives.
pnlToggle.addEventListener('change', () => void savePnlEnabled(pnlToggle.checked))

/* ---- Display settings ---- */

/**
 * The dialog itself lives in the terminal, on the page, because that is where the cards it
 * configures are — this only asks for it. The active tab wins when it is already on fomo;
 * otherwise the first open fomo tab does, and it is focused so the dialog is not opened out of
 * sight. With no fomo tab at all there is nothing to configure, and the popup says so rather
 * than opening one uninvited.
 */

const displayButton = document.getElementById('display-settings') as HTMLButtonElement
const displayNote = document.getElementById('display-note') as HTMLParagraphElement

const FOMO_TABS = 'https://fomo.family/*'

async function openDisplaySettings(): Promise<void> {
  displayNote.textContent = ''
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true, url: FOMO_TABS })
  const target = active ?? (await chrome.tabs.query({ url: FOMO_TABS }))[0]
  if (!target?.id) {
    displayNote.textContent = 'Open fomo.family in a tab first.'
    return
  }

  try {
    await chrome.tabs.sendMessage(target.id, { type: 'fobo:open-display-settings' })
  } catch {
    // A tab that has not run the content script yet (still loading, or discarded).
    displayNote.textContent = 'That tab is still loading — try again.'
    return
  }

  if (target.id !== active?.id) {
    await chrome.tabs.update(target.id, { active: true })
    if (target.windowId !== undefined) await chrome.windows.update(target.windowId, { focused: true })
  }
  window.close()
}

displayButton.addEventListener('click', () => {
  displayButton.disabled = true
  void openDisplaySettings().finally(() => {
    displayButton.disabled = false
  })
})

// Module scope, not script scope — keeps this file's names out of the global namespace.
export {}
