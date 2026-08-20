/**
 * The FOMO Panel's user preferences, stored in chrome.storage.sync so they follow the
 * user's Chrome profile. The popup writes them; the content script reads and watches them
 * directly — chrome.storage events reach isolated-world scripts without a background relay.
 * The width is the one setting the content script also writes: it is dragged on the panel
 * edge, not set in the popup.
 */

export const ALERTS_KEY = 'fobo:alerts'

export const ALERTS_MIN_WIDTH = 280
export const ALERTS_MAX_WIDTH = 560

export interface AlertsSettings {
  enabled: boolean
  side: 'left' | 'right'
  width: number
  /** fomo's alert ding, replicated for live alerts. Defaults on, like fomo's own. */
  sound: boolean
}

export const ALERTS_DEFAULT: AlertsSettings = { enabled: true, side: 'right', width: 340, sound: true }

/** Clamp and default whatever is in storage, so a bad write can never break the layout. */
export function sanitizeAlertsSettings(raw: unknown): AlertsSettings {
  const row = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const width = typeof row.width === 'number' && Number.isFinite(row.width) ? row.width : ALERTS_DEFAULT.width
  return {
    enabled: row.enabled !== false,
    side: row.side === 'left' ? 'left' : 'right',
    width: Math.min(ALERTS_MAX_WIDTH, Math.max(ALERTS_MIN_WIDTH, Math.round(width))),
    sound: row.sound !== false,
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

/** Fire-and-forget write; an orphaned context just means the preference does not persist. */
export function saveAlertsSettings(settings: AlertsSettings): void {
  try {
    void chrome.storage.sync.set({ [ALERTS_KEY]: settings })
  } catch {
    /* context already gone */
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

/* ---------------------------------------------------------------- panel view (per tab) */

/** The three views the FOMO Panel switches between. */
export type PanelView = 'alerts' | 'watchlist' | 'feed'

export const PANEL_VIEWS: readonly PanelView[] = ['alerts', 'watchlist', 'feed']

export const PANEL_VIEW_LABEL: Readonly<Record<PanelView, string>> = {
  alerts: 'Alerts',
  watchlist: 'Watchlist',
  feed: 'Feed',
}

/**
 * The chosen view is tab-scoped session state, like the terminal path marks: it survives
 * refreshes of this tab but does not follow the profile around.
 */
const PANEL_VIEW_KEY = 'fobo:panel-view'

export function readPanelView(): PanelView {
  try {
    const raw = window.sessionStorage.getItem(PANEL_VIEW_KEY)
    return PANEL_VIEWS.includes(raw as PanelView) ? (raw as PanelView) : 'alerts'
  } catch {
    return 'alerts'
  }
}

export function savePanelView(view: PanelView): void {
  try {
    window.sessionStorage.setItem(PANEL_VIEW_KEY, view)
  } catch {
    /* private mode — the view just resets on reload */
  }
}
