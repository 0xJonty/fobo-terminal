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
 * Paths where the terminal shows. Everywhere else it stays away.
 *
 * This inverts the earlier model, which recorded the paths to stay away FROM and mounted on
 * everything else. That polarity broke fomo's own internal navigation: clicking a profile (or any
 * in-app link) landed on a path with no record, so the terminal mounted over the exact page the
 * user had just asked for. Away-by-default matches what the terminal is — a home screen. A path
 * earns a mark in exactly three ways: the tab was entered through `/` (the home intent), the user
 * summoned the terminal here (launcher or toolbar), or fomo's `/` redirect landed here mid-boot.
 * Back onto a marked path remounts; everything else is fomo's.
 */
const TERMINAL_KEY = 'fobo:terminal-paths'

/** Bounded so a long session cannot grow this without limit. */
const MARK_LIMIT = 20

function readMarks(): string[] {
  try {
    const raw = window.sessionStorage.getItem(TERMINAL_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : []
  } catch {
    return []
  }
}

function writeMarks(paths: readonly string[]): void {
  try {
    window.sessionStorage.setItem(TERMINAL_KEY, JSON.stringify(paths.slice(-MARK_LIMIT)))
  } catch {
    /* private mode — fall back to in-memory behaviour */
  }
}

function markTerminal(path: string): void {
  const paths = readMarks().filter((p) => p !== path)
  paths.push(path)
  writeMarks(paths)
}

function unmarkTerminal(path: string): void {
  writeMarks(readMarks().filter((p) => p !== path))
}

function isTerminalPath(path: string): boolean {
  return readMarks().includes(path)
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
    // An explicit summon: clear the dismissal and claim this page for the terminal.
    setDismissed(false)
    markTerminal(window.location.pathname)
    removeLauncher()
    void sync()
  })
  document.body.append(button)
  launcher = button
}

/**
 * The one deliberate exception to "never touch fomo's tree": while the terminal is up, the page
 * behind it must not own a scrollbar or receive chained wheel events — the three columns are the
 * only scrollers. The inline overflow styles are saved and restored verbatim, so unmounting
 * leaves the page exactly as found.
 */
let savedOverflow: { html: string; body: string } | null = null

function lockPageScroll(): void {
  if (savedOverflow) return
  savedOverflow = {
    html: document.documentElement.style.overflow,
    body: document.body.style.overflow,
  }
  document.documentElement.style.overflow = 'hidden'
  document.body.style.overflow = 'hidden'
}

function unlockPageScroll(): void {
  if (!savedOverflow) return
  document.documentElement.style.overflow = savedOverflow.html
  document.body.style.overflow = savedOverflow.body
  savedOverflow = null
}

function unmount(): void {
  root?.unmount()
  root = null
  host?.remove()
  host = null
  document.getElementById(HOST_ID)?.remove()
  unlockPageScroll()
}

/**
 * A handoff or dismissal hides the terminal rather than unmounting it. Tearing down threw away
 * the socket and all three lists, so every Back paid a cold reconnect and re-stream behind a
 * skeleton screen. Hiding keeps React and the socket warm; returning is one attribute flip.
 * The window event lets the columns drop their hover-freeze — the cursor was over a row when the
 * click hid us, and mouseleave never fires on a hidden element.
 */
function hide(): void {
  if (!host) return
  host.dataset.foboHidden = ''
  unlockPageScroll()
  window.dispatchEvent(new Event('fobo:hidden'))
}

function dismiss(): void {
  setDismissed(true)
  hide()
  showLauncher()
}

/**
 * "Deposit more" cannot be recreated honestly — it opens fomo's own deposit modal, which lives
 * in fomo's React tree. So the terminal's button drives the real one: find fomo's button in the
 * page below, step out of the way, and click it. If fomo's header is not there (or renamed),
 * nothing happens rather than something invented.
 */
function requestDeposit(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('button')) {
    if (button.textContent?.trim() !== 'Deposit more') continue
    if (button.closest(`#${HOST_ID}`)) continue
    dismiss()
    button.click()
    return
  }
}

function render(): void {
  if (host) {
    delete host.dataset.foboHidden
    lockPageScroll()
    return
  }
  if (document.getElementById(HOST_ID)) return

  host = document.createElement('div')
  host.id = HOST_ID
  const shadow = host.attachShadow({ mode: 'open' })

  const sheet = document.createElement('style')
  sheet.textContent = styles
  shadow.append(sheet)

  const container = document.createElement('div')
  // The percentage-height chain must be unbroken. .shell is height:100%, which resolves to
  // nothing against this div's default auto height — the shell then grows with its content, the
  // columns never overflow, and they never scroll. The host is fixed inset:0, so 100% here pins
  // the whole tree to the viewport and the overflow lands where it belongs: .column-body.
  container.style.height = '100%'
  shadow.append(container)
  document.body.append(host)
  lockPageScroll()

  root = createRoot(container)
  root.render(
    <StrictMode>
      <App onOpen={navigate} onDeposit={requestDeposit} />
    </StrictMode>,
  )
}

/**
 * Client-side navigation out of the terminal. history is shared state across worlds, so
 * pushState from here moves the real URL, and the synthetic PopStateEvent crosses the
 * isolated/main boundary, which is what makes fomo's router re-read location and swap the view —
 * no full page load. Back is a real popstate onto a path that stays marked, so the terminal
 * remounts just as instantly. location.assign survives only as the fallback.
 *
 * Away-by-default means the destination needs no record to open as fomo — but a stale mark from
 * an earlier summon there must not resurrect the terminal over it.
 */
function navigate(href: string): void {
  let path: string
  try {
    path = new URL(href, window.location.origin).pathname
  } catch {
    return
  }
  if (path !== window.location.pathname) unmarkTerminal(path)
  try {
    window.history.pushState(null, '', href)
    window.dispatchEvent(new PopStateEvent('popstate'))
  } catch {
    window.location.assign(href)
    return
  }
  lastPath = window.location.pathname
  void sync()
}

/** Why fobo is or is not on screen. Surfaced so a mount failure is diagnosable from the console. */
type Decision = 'mount' | 'marketing' | 'disabled' | 'dismissed' | 'away'

async function decide(): Promise<Decision> {
  if (isMarketingPage()) return 'marketing'
  if (!(await readEnabled())) return 'disabled'
  if (isDismissed()) return 'dismissed'
  return isTerminalPath(window.location.pathname) ? 'mount' : 'away'
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

  if (decision === 'dismissed' || decision === 'away') {
    hide()
    showLauncher()
    return
  }

  // disabled / marketing: a full teardown is correct here.
  unmount()
  removeLauncher()
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
    const path = window.location.pathname
    if (path === lastPath) return
    if (pendingHomeMark && lastPath === '/') {
      // fomo's redirect off `/` just fired: the home intent follows it to wherever it landed.
      markTerminal(path)
      pendingHomeMark = false
    }
    lastPath = path
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
  // The warm host also exists while hidden on a coin page — only a visible terminal dismisses.
  if (event.key === 'Escape' && host && host.dataset.foboHidden === undefined) dismiss()
})

try {
  chrome.runtime.onMessage.addListener((message: { type?: string; enabled?: boolean }) => {
    if (message?.type !== 'fobo:enabled-changed') return
    if (message.enabled) {
      // A toolbar toggle back on is an explicit summon, same as the launcher.
      setDismissed(false)
      markTerminal(window.location.pathname)
    }
    void sync()
  })
} catch {
  // Orphaned content script from a previous extension version — the fresh one owns messaging.
}

/**
 * Home intent, decided once per tab. Entering through `/` — typed, bookmarked, linked — is the
 * one entry that means "take me to the home screen", and the terminal IS the home screen, so
 * that entry's landing page gets marked. A server-side redirect leaves redirectCount > 0; a
 * client-side one leaves the navigation entry's URL at `/`. Any other first URL (a right-clicked
 * card opened in a new tab, a pasted coin link, a shared profile) is a request for that exact
 * page, and away-by-default already honours it. Reloads and back/forward are not fresh entries —
 * the marks the tab already holds govern those.
 */
let pendingHomeMark = false

function recordEntryIntent(): void {
  const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]
  if (!entry || entry.type !== 'navigate') return

  let entryPath: string | null
  try {
    entryPath = new URL(entry.name).pathname
  } catch {
    entryPath = null
  }
  if (entry.redirectCount === 0 && entryPath !== '/' && entryPath !== '') return

  if (window.location.pathname === '/') {
    // Still on `/` mid-boot: mark it (so the terminal can mount immediately once logged-in
    // state appears) and let the route watcher carry the mark to the redirect's landing page.
    pendingHomeMark = true
    markTerminal('/')
  } else {
    markTerminal(window.location.pathname)
  }
}

recordEntryIntent()
watchRoute()
void sync()
if (isMarketingPage()) waitForSession()
