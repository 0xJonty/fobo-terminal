/**
 * ISOLATED-world content script. Owns the UI.
 *
 * fomo server-renders straight into <body> with no stable mount node, and React Router owns
 * that tree. So we never touch it: we append a sibling host element and render into a shadow
 * root on it. Removing the host restores the page exactly.
 */

import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { App } from '~/content/App'
import styles from '~/content/styles.css?inline'

const HOST_ID = 'fobo-terminal-root'
const LAUNCHER_ID = 'fobo-terminal-launcher'
const ENABLED_KEY = 'fobo:enabled'

/**
 * Dismissal means "the user pressed Esc / Close", nothing else. It is deliberately NOT set when
 * we navigate to a coin: doing that broke the back button, because the flag outlived the
 * navigation and the home screen came back as a bare launcher instead of the terminal.
 *
 * Scoped to the tab via sessionStorage, so a new tab starts on the terminal again.
 */
const DISMISSED_KEY = 'fobo:dismissed'

/**
 * fobo replaces the *home screen*, so it mounts on the home route only. Coin pages, settings and
 * everything else are fomo's own. This is what makes back-navigation work: there is no overlay to
 * dismiss on the way out, so returning home simply mounts again.
 */
function isHomeRoute(): boolean {
  const path = window.location.pathname
  return path === '/' || path === ''
}

function isDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function setDismissed(value: boolean): void {
  try {
    if (value) window.sessionStorage.setItem(DISMISSED_KEY, '1')
    else window.sessionStorage.removeItem(DISMISSED_KEY)
  } catch {
    /* private mode — fall back to in-memory behaviour */
  }
}

/**
 * True while our chrome.* APIs are still usable.
 *
 * Reloading the extension (which a rebuild does on every save) orphans the content script already
 * running in the page: every chrome.* call from then on throws "Extension context invalidated".
 * Unguarded, that killed mount() before it rendered anything and the overlay never appeared again
 * until the host page was reloaded — the "extension breaks and won't work at all" symptom.
 */
function extensionAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id)
  } catch {
    return false
  }
}

/** Enabled unless storage explicitly says otherwise. An orphaned context reads as enabled. */
async function readEnabled(): Promise<boolean> {
  if (!extensionAlive()) return true
  try {
    const stored = await chrome.storage.sync.get(ENABLED_KEY)
    return stored[ENABLED_KEY] !== false
  } catch {
    return true
  }
}

/**
 * fomo's own bootstrap treats this key as the signal that a session exists — it is what
 * decides whether `/` redirects into the app. We use the same signal so fobo never covers
 * the marketing page for a logged-out visitor.
 */
function isLoggedIn(): boolean {
  try {
    const token = window.localStorage.getItem('privy:refresh_token')
    return typeof token === 'string' && token.startsWith('"') && token !== '"deprecated"'
  } catch {
    return false
  }
}

let host: HTMLElement | null = null
let root: Root | null = null
let launcher: HTMLButtonElement | null = null

function removeLauncher(): void {
  launcher?.remove()
  launcher = null
  document.getElementById(LAUNCHER_ID)?.remove()
}

function showLauncher(): void {
  if (launcher || document.getElementById(LAUNCHER_ID)) return
  const button = document.createElement('button')
  button.id = LAUNCHER_ID
  button.textContent = 'fobo'
  button.setAttribute(
    'style',
    [
      'position:fixed',
      'right:1rem',
      'bottom:1rem',
      'z-index:2147483000',
      'background:var(--color-accent-primary,#516af6)',
      'color:#fff',
      'border:0',
      'border-radius:999px',
      'padding:0.5rem 0.875rem',
      'font-size:0.75rem',
      'font-weight:600',
      'cursor:pointer',
      'box-shadow:0 4px 16px rgb(0 0 0 / 0.4)',
    ].join(';'),
  )
  button.addEventListener('click', () => {
    setDismissed(false)
    removeLauncher()
    void sync()
  })
  document.body.append(button)
  launcher = button
}

function unmount(): void {
  root?.unmount()
  root = null
  host?.remove()
  host = null
  document.getElementById(HOST_ID)?.remove()
}

function dismiss(): void {
  setDismissed(true)
  unmount()
  showLauncher()
}

function render(): void {
  if (host || document.getElementById(HOST_ID)) return

  host = document.createElement('div')
  host.id = HOST_ID
  const shadow = host.attachShadow({ mode: 'open' })

  const sheet = document.createElement('style')
  sheet.textContent = styles
  shadow.append(sheet)

  const container = document.createElement('div')
  shadow.append(container)
  document.body.append(host)

  root = createRoot(container)
  root.render(
    <StrictMode>
      <App onDismiss={dismiss} onOpen={navigate} />
    </StrictMode>,
  )
}

/**
 * Opening a coin is a real navigation, not a dismissal. We leave the overlay mounted and let the
 * page unload take it down, so nothing persists that would suppress the terminal on the way back.
 */
function navigate(href: string): void {
  window.location.assign(href)
}

/** Bring the DOM in line with the current route, preference and dismissal state. */
async function sync(): Promise<void> {
  if (!isHomeRoute() || !isLoggedIn()) {
    unmount()
    removeLauncher()
    return
  }

  if (!(await readEnabled())) {
    unmount()
    removeLauncher()
    return
  }

  // The route can change while the storage read is in flight.
  if (!isHomeRoute()) return

  if (isDismissed()) {
    unmount()
    showLauncher()
    return
  }

  removeLauncher()
  render()
}

/**
 * fomo routes client-side, and we are in an isolated world — patching history.pushState here does
 * not see the page's own calls. popstate covers back/forward, pageshow covers a bfcache restore
 * (where the script never re-runs at all), and the poll covers in-app pushState navigation.
 */
let lastPath = window.location.pathname
function watchRoute(): void {
  const check = () => {
    if (window.location.pathname === lastPath) return
    lastPath = window.location.pathname
    void sync()
  }
  window.addEventListener('popstate', check)
  window.addEventListener('hashchange', check)
  window.addEventListener('pageshow', () => {
    lastPath = window.location.pathname
    void sync()
  })
  window.setInterval(check, 300)
}

/**
 * document_idle can still beat fomo writing its session keys, and the old single-shot mount left
 * the terminal absent for the rest of the page's life when it did. Retry briefly, then stop —
 * a genuinely logged-out visitor must not be polled forever.
 */
const LOGIN_RETRY_MS = 500
const LOGIN_RETRY_LIMIT = 20

function waitForSession(): void {
  let tries = 0
  const timer = window.setInterval(() => {
    tries += 1
    if (tries > LOGIN_RETRY_LIMIT || host || launcher || !isHomeRoute() || isLoggedIn()) {
      window.clearInterval(timer)
      if (isLoggedIn()) void sync()
      return
    }
  }, LOGIN_RETRY_MS)
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && host) dismiss()
})

try {
  chrome.runtime.onMessage.addListener((message: { type?: string; enabled?: boolean }) => {
    if (message?.type !== 'fobo:enabled-changed') return
    if (message.enabled) setDismissed(false)
    void sync()
  })
} catch {
  // Orphaned content script from a previous extension version — the fresh one owns messaging.
}

watchRoute()
void sync()
if (!isLoggedIn()) waitForSession()
