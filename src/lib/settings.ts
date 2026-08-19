/**
 * The alerts panel's user preferences, stored in chrome.storage.sync so they follow the
 * user's Chrome profile. The popup writes them; the content script reads and watches them
 * directly — chrome.storage events reach isolated-world scripts without a background relay.
 */

export const ALERTS_KEY = 'fobo:alerts'

export const ALERTS_MIN_WIDTH = 280
export const ALERTS_MAX_WIDTH = 480

export interface AlertsSettings {
  enabled: boolean
  side: 'left' | 'right'
  width: number
}

export const ALERTS_DEFAULT: AlertsSettings = { enabled: true, side: 'right', width: 340 }

/** Clamp and default whatever is in storage, so a bad write can never break the layout. */
export function sanitizeAlertsSettings(raw: unknown): AlertsSettings {
  const row = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const width = typeof row.width === 'number' && Number.isFinite(row.width) ? row.width : ALERTS_DEFAULT.width
  return {
    enabled: row.enabled !== false,
    side: row.side === 'left' ? 'left' : 'right',
    width: Math.min(ALERTS_MAX_WIDTH, Math.max(ALERTS_MIN_WIDTH, Math.round(width))),
  }
}

/** Defaults when the extension context is gone (orphaned content script) or storage throws. */
export async function readAlertsSettings(): Promise<AlertsSettings> {
  try {
    const stored = await chrome.storage.sync.get(ALERTS_KEY)
    return sanitizeAlertsSettings(stored[ALERTS_KEY])
  } catch {
    return ALERTS_DEFAULT
  }
}

/** Watch for popup changes. Returns an unsubscribe; a dead context returns a no-op. */
export function watchAlertsSettings(onChange: (settings: AlertsSettings) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'sync' || !(ALERTS_KEY in changes)) return
    onChange(sanitizeAlertsSettings(changes[ALERTS_KEY]?.newValue))
  }
  try {
    chrome.storage.onChanged.addListener(listener)
    return () => {
      try {
        chrome.storage.onChanged.removeListener(listener)
      } catch {
        /* context already gone */
      }
    }
  } catch {
    return () => {}
  }
}
