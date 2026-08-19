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

/** Set when the user presses Esc or Close. Tab-scoped. */
const DISMISSED_KEY = 'fobo:dismissed'

/**
 * Paths fobo deliberately navigated to, so it can stay out of the way on the coin page the user
 * asked for.
 *
 * This replaces an earlier "mount on `/` only" rule, which never fired: fomo redirects `/`
 * straight to a coin page, so the home route the rule waited for does not exist in practice.
 *
 * Recording the destination rather than a global "dismissed" flag is also what makes Back work.
 * The flag used to outlive the navigation, so returning from a coin found fobo suppressed; a
 * per-path record only suppresses the coin page itself, and every other entry in the history
 * (including the one the user came from) mounts normally.
 */
const HANDOFF_KEY = 'fobo:handoff'

/** Bounded so a long session cannot grow this without limit. */
const HANDOFF_LIMIT = 20

function readHandoffs(): string[] {
  try {
    const raw = window.sessionStorage.getItem(HANDOFF_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

function writeHandoffs(paths: readonly string[]): void {
  try {
    window.sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(paths.slice(-HANDOFF_LIMIT)))
  } catch {
    /* private mode — fall back to in-memory behaviour */
  }
}

function rememberHandoff(path: string): void {
  const paths = readHandoffs().filter((p) => p !== path)
  paths.push(path)
  writeHandoffs(paths)
}

function forgetHandoff(path: string): void {
  writeHandoffs(readHandoffs().filter((p) => p !== path))
}

function isHandoff(path: string): boolean {
  return readHandoffs().includes(path)
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
 * Unguarded, that killed mount() before it rendered anything.
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
 * fomo's own bootstrap treats this key as the signal that a session exists. We only use it to keep
 * fobo off the logged-out marketing page at `/` — anywhere deeper means the app itself is running,
 * so a key rename upstream cannot lock the overlay out of the whole site.
 */
function isLoggedIn(): boolean {
  try {
    const token = window.localStorage.getItem('privy:refresh_token')
    return typeof token === 'string' && token.startsWith('"') && token !== '"deprecated"'
  } catch {
    return false
  }
}

function isMarketingPage(): boolean {
  const path = window.location.pathname
  return (path === '/' || path === '') && !isLoggedIn()
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
    // An explicit summon overrides both suppression reasons for this page.
    setDismissed(false)
    forgetHandoff(window.location.pathname)
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
 * Opening a coin is a handoff, not a dismissal: we record the destination so fobo stays out of the
 * way there, and leave the overlay mounted so the page unload takes it down. Nothing global is
 * set, so every other history entry — the one Back returns to included — still mounts.
 */
function navigate(href: string): void {
  try {
    rememberHandoff(new URL(href, window.location.origin).pathname)
  } catch {
    /* keep navigating even if we could not record it */
  }
  window.location.assign(href)
}

/** Why fobo is or is not on screen. Surfaced so a mount failure is diagnosable from the console. */
type Decision = 'mount' | 'marketing' | 'disabled' | 'dismissed' | 'handoff'

async function decide(): Promise<Decision> {
  if (isMarketingPage()) return 'marketing'
  if (!(await readEnabled())) return 'disabled'
  if (isDismissed()) return 'dismissed'
  if (isHandoff(window.location.pathname)) return 'handoff'
  return 'mount'
}

let lastDecision: Decision | null = null

/** Bring the DOM in line with the current path, preference and dismissal state. */
async function sync(): Promise<void> {
  const decision = await decide()

  if (decision !== lastDecision) {
    lastDecision = decision
    console.info(`[fobo] ${decision} — ${window.location.pathname}`)
  }

  if (decision === 'mount') {
    removeLauncher()
    render()
    return
  }

  unmount()
  if (decision === 'dismissed' || decision === 'handoff') showLauncher()
  else removeLauncher()
}

/**
 * fomo routes client-side, and we are in an isolated world — patching history.pushState here does
 * not see the page's own calls. popstate covers back/forward, pageshow covers a bfcache restore
 * (where the script never re-runs at all), and the poll covers in-app pushState navigation and the
 * redirect off `/` that happens before fomo has finished booting.
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
 * document_idle can still beat fomo writing its session keys, and a single-shot mount left the
 * terminal absent for the rest of the page's life when it did. Retry briefly, then stop — a
 * genuinely logged-out visitor must not be polled forever.
 */
const SESSION_RETRY_MS = 500
const SESSION_RETRY_LIMIT = 20

function waitForSession(): void {
  let tries = 0
  const timer = window.setInterval(() => {
    tries += 1
    if (tries > SESSION_RETRY_LIMIT || host || launcher || !isMarketingPage()) {
      window.clearInterval(timer)
      void sync()
    }
  }, SESSION_RETRY_MS)
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && host) dismiss()
})

try {
  chrome.runtime.onMessage.addListener((message: { type?: string; enabled?: boolean }) => {
    if (message?.type !== 'fobo:enabled-changed') return
    if (message.enabled) {
      // A toolbar toggle back on is an explicit summon, same as the launcher.
      setDismissed(false)
      forgetHandoff(window.location.pathname)
    }
    void sync()
  })
} catch {
  // Orphaned content script from a previous extension version — the fresh one owns messaging.
}

watchRoute()
void sync()
if (isMarketingPage()) waitForSession()
