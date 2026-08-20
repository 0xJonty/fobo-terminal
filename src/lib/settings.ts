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

/**
 * The Alerts view's filters, mirroring fomo's own (its alerts-feed-threshold-storage store):
 * min trade size, min trader portfolio value, and a market-cap range, all sent as query
 * params on the trading-activity backfill. Raw user strings so the boxes round-trip; '' is
 * unset. fomo's stock threshold is $1,000 — the default here matches it.
 */
export interface AlertsFilterSettings {
  threshold: string
  minEquity: string
  minMarketCap: string
  maxMarketCap: string
}

export const ALERTS_FILTERS_DEFAULT: AlertsFilterSettings = {
  threshold: '1k',
  minEquity: '',
  minMarketCap: '',
  maxMarketCap: '',
}

export interface AlertsSettings {
  enabled: boolean
  side: 'left' | 'right'
  width: number
  /** fomo's alert ding, replicated for live alerts. Defaults on, like fomo's own. */
  sound: boolean
  /** Feed view: fomo's filter groups the user has switched off (empty = everything). */
  feedDisabledGroups: string[]
  alertsFilters: AlertsFilterSettings
}

export const ALERTS_DEFAULT: AlertsSettings = {
  enabled: true,
  side: 'right',
  width: 340,
  sound: true,
  feedDisabledGroups: [],
  alertsFilters: ALERTS_FILTERS_DEFAULT,
}

function sanitizeFilterString(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 24) : ''
}

/** Clamp and default whatever is in storage, so a bad write can never break the layout. */
export function sanitizeAlertsSettings(raw: unknown): AlertsSettings {
  const row = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const width = typeof row.width === 'number' && Number.isFinite(row.width) ? row.width : ALERTS_DEFAULT.width
  const filters = (
    typeof row.alertsFilters === 'object' && row.alertsFilters !== null ? row.alertsFilters : null
  ) as Record<string, unknown> | null
  return {
    enabled: row.enabled !== false,
    side: row.side === 'left' ? 'left' : 'right',
    width: Math.min(ALERTS_MAX_WIDTH, Math.max(ALERTS_MIN_WIDTH, Math.round(width))),
    sound: row.sound !== false,
    feedDisabledGroups: Array.isArray(row.feedDisabledGroups)
      ? [...new Set(row.feedDisabledGroups)].filter((id): id is string => typeof id === 'string').slice(0, 16)
      : [],
    // A payload written before the filters existed keeps fomo's defaults; a present-but-
    // partial one keeps what it has, '' for the rest.
    alertsFilters: filters
      ? {
          threshold: sanitizeFilterString(filters.threshold),
          minEquity: sanitizeFilterString(filters.minEquity),
          minMarketCap: sanitizeFilterString(filters.minMarketCap),
          maxMarketCap: sanitizeFilterString(filters.maxMarketCap),
        }
      : ALERTS_FILTERS_DEFAULT,
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
