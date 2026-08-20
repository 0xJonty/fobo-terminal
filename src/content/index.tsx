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

/**
 * fobo's own address. After a home-intent mount the URL underneath is moved here, so fomo swaps
 * the landing token page for its lightweight 404 view instead of streaming a chart nobody can
 * see behind the overlay. fomo serves its app shell for any unknown path (verified against
 * prod), so reloads and bookmarks of this path boot the session layer normally.
 */
const PARKED_PATH = '/fobo-terminal'

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
  // The reserved path IS the terminal — fomo has nothing there — so it stays mountable
  // forever: bookmarking fomo.family/fobo-terminal opens straight into fobo.
  if (path === PARKED_PATH) return true
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

/**
 * Enabled unless storage explicitly says otherwise. An orphaned context reads as enabled.
 *
 * The read is raced against a timeout: chrome.storage.sync.get from a context that is being
 * invalidated can neither resolve nor reject, and one hung await here silently stalled sync()
 * forever — no mount, no launcher, not even the decision line in the console.
 */
async function readEnabled(): Promise<boolean> {
  if (!extensionAlive()) return true
  try {
    const stored = await Promise.race([
      chrome.storage.sync.get(ENABLED_KEY),
      new Promise<Record<string, unknown>>((resolve) =>
        window.setTimeout(() => resolve({}), 1000),
      ),
    ])
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
function findDepositButton(): HTMLButtonElement | null {
  for (const button of document.querySelectorAll<HTMLButtonElement>('button')) {
    if (button.textContent?.trim() !== 'Deposit more') continue
    if (button.closest(`#${HOST_ID}`)) continue
    return button
  }
  return null
}

const DEPOSIT_POLL_MS = 250
const DEPOSIT_POLL_LIMIT = 32

function requestDeposit(): void {
  const direct = findDepositButton()
  if (direct) {
    dismiss()
    direct.click()
    return
  }
  // Parked: fomo's 404 view under the terminal has no header, so the real button is not in
  // the page. Drive fomo home — its `/` redirect boots a real page with the real header —
  // then click the button once it renders. Dismissal comes first, so the landing page cannot
  // remount the terminal over the deposit modal.
  dismiss()
  try {
    window.history.pushState(null, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
  } catch {
    window.location.assign('/')
    return
  }
  lastPath = window.location.pathname
  let tries = 0
  const timer = window.setInterval(() => {
    tries += 1
    const button = findDepositButton()
    if (button) {
      window.clearInterval(timer)
      button.click()
      return
    }
    if (tries >= DEPOSIT_POLL_LIMIT) window.clearInterval(timer)
  }, DEPOSIT_POLL_MS)
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

/**
 * Move the URL under the mounted terminal to fobo's reserved path. fomo's router follows the
 * synthetic popstate and swaps the landing token page for its 404 view — measured live: ~5.9k
 * DOM nodes, two iframes and the TradingView chart down to ~66 nodes. replaceState, not
 * pushState: the landing page leaves history entirely, so Back walks from the terminal to
 * wherever the user came from, and a coin-click-then-Back returns here warm.
 *
 * Only home-intent mounts park. A summoned terminal (launcher, toolbar toggle) sits over a
 * page the user chose — replacing that page's URL would strand Esc on a 404.
 */
function park(): void {
  if (window.location.pathname === PARKED_PATH) return
  try {
    window.history.replaceState(null, '', PARKED_PATH)
    window.dispatchEvent(new PopStateEvent('popstate'))
  } catch {
    return
  }
  markTerminal(PARKED_PATH)
  lastPath = PARKED_PATH
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
    // Parking waits until fomo has left `/`: its router is still resolving the home redirect
    // there, and swapping the URL mid-hydration risks a fight with it. The intent stays armed
    // meanwhile — the redirect's landing page gets marked and this branch runs again. (This
    // also fixes a bug where a mount that happened while still on `/` consumed the intent, so
    // the redirect landed on an unmarked page and the terminal vanished.)
    if (window.location.pathname !== '/') {
      const fromHomeIntent = isPendingHome()
      setPendingHome(false)
      if (fromHomeIntent) park()
    }
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
    // While the home intent is armed, every automatic landing is still "the home screen" —
    // fomo can hop more than once (`/coin` shim, address canonicalisation) before settling.
    if (isPendingHome()) markTerminal(path)
    // Returning to a marked `/` (Back past the landing page) renews the home intent. fomo
    // immediately redirects off `/` again — and if the #1 trending token rotated since entry,
    // it lands on a DIFFERENT token page than the one marked at boot. Without re-arming, that
    // landing page is unmarked and the user is stranded on a bare fomo page where the terminal
    // used to be. `/` is only ever marked by home intent, so this cannot widen the mount set.
    if (path === '/' && isTerminalPath('/')) setPendingHome(true)
    lastPath = path
    void sync()
  }
  window.addEventListener('popstate', check)
  window.addEventListener('hashchange', check)
  window.addEventListener('pageshow', () => {
    // A bfcache restore re-runs nothing, so the same `/` re-entry case is handled here too.
    lastPath = window.location.pathname
    if (lastPath === '/' && isTerminalPath('/')) setPendingHome(true)
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
 * Home intent. Entering through `/` — typed, bookmarked, linked — is the one entry that means
 * "take me to the home screen", and the terminal IS the home screen, so the entry's landing page
 * gets marked. A server-side redirect leaves redirectCount > 0; a client-side one leaves the
 * navigation entry's URL at `/`. Any other first URL (a right-clicked card opened in a new tab,
 * a pasted coin link, a shared profile) is a request for that exact page, and away-by-default
 * already honours it. Reloads and back/forward are not fresh entries — the marks the tab
 * already holds govern those.
 *
 * The intent used to be a module boolean consumed on the first path change. Two observed fomo
 * behaviours broke that: it sometimes redirects MORE than once before settling (the `/coin`
 * shim, address canonicalisation), and its root error boundary recovers a failed chunk load
 * with a full location.replace — which destroys the document and the boolean with it. Either
 * way the final landing page had no mark, the terminal never appeared, and only a toolbar
 * toggle (which marks the current path) brought it back. So the intent now lives in
 * sessionStorage with a short TTL and keeps marking every automatic landing until the terminal
 * actually mounts. It is cleared by the mount itself, by the user touching the page (their
 * navigations are their own), or by the TTL running out.
 */
const PENDING_HOME_KEY = 'fobo:pending-home'
const PENDING_HOME_TTL_MS = 15_000

/** In-memory fallback so private mode degrades to the old single-document behaviour. */
let pendingHomeMemory = false

function setPendingHome(value: boolean): void {
  pendingHomeMemory = value
  try {
    if (value) window.sessionStorage.setItem(PENDING_HOME_KEY, String(Date.now()))
    else window.sessionStorage.removeItem(PENDING_HOME_KEY)
  } catch {
    /* private mode — pendingHomeMemory carries it */
  }
}

function isPendingHome(): boolean {
  try {
    const raw = window.sessionStorage.getItem(PENDING_HOME_KEY)
    if (!raw) return pendingHomeMemory
    const startedAt = Number(raw)
    if (!Number.isFinite(startedAt) || Date.now() - startedAt > PENDING_HOME_TTL_MS) {
      setPendingHome(false)
      return false
    }
    return true
  } catch {
    return pendingHomeMemory
  }
}

function recordEntryIntent(): void {
  const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[]

  // Reload / back-forward re-runs keep whatever intent and marks the tab already holds — a
  // mid-boot full reload (fomo's chunk-reload recovery) must not strip an in-flight intent.
  if (entry && entry.type !== 'navigate') return

  let entryPath: string | null = null
  if (entry) {
    try {
      entryPath = new URL(entry.name).pathname
    } catch {
      entryPath = null
    }
  }

  // Fallback when the navigation entry is missing or names a deep URL: a same-origin referrer
  // of `/` means this document was reached by fomo redirecting off the home page — the only
  // full-page navigation that starts there — so the home intent survives that hop too.
  let cameFromRoot = false
  try {
    const ref = document.referrer ? new URL(document.referrer) : null
    cameFromRoot = ref !== null && ref.origin === window.location.origin && ref.pathname === '/'
  } catch {
    cameFromRoot = false
  }

  const isHomeEntry =
    (entry && entry.redirectCount > 0) ||
    entryPath === '/' ||
    entryPath === '' ||
    entryPath === PARKED_PATH ||
    cameFromRoot

  if (!isHomeEntry) {
    // A fresh navigation to a specific page is a request for that page: clear any stale intent
    // left by an earlier entry so it cannot mount the terminal over it.
    if (entry) setPendingHome(false)
    return
  }

  // Mark where we stand and keep the intent armed — if fomo redirects (again), the route
  // watcher carries the mark along until the terminal is actually on screen.
  setPendingHome(true)
  markTerminal(window.location.pathname)
}

// The user touching the page means every navigation from here on is theirs — the intent must
// not mount the terminal over a page they clicked to. Capture phase, so no handler below can
// swallow it. A visible terminal is the exception: those clicks are IN the terminal, and
// mid-boot on `/` the intent is still armed waiting for fomo's redirect to land — killing it
// there made the terminal vanish out from under the user's first click.
window.addEventListener(
  'pointerdown',
  () => {
    if (host && host.dataset.foboHidden === undefined) return
    setPendingHome(false)
  },
  { capture: true },
)

recordEntryIntent()
watchRoute()
void sync()
if (isMarketingPage()) waitForSession()
