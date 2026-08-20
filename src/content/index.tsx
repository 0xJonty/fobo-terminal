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
 * fobo's own address and tab name, shown while the terminal is visible. Unlike the reverted
 * "parking" model, this is a pure mask: replaceState with NO synthetic popstate, so fomo's
 * router never hears about it and keeps rendering the real page underneath. The mask is
 * lifted (URL and title restored) on every handoff, so history entries and Esc always land
 * on real fomo pages.
 */
const PARKED_PATH = '/fobo-terminal'
const TERMINAL_TITLE = 'fobo terminal'

/**
 * fomo's home routes. `/` is the entry; `/token` is the shim its header logo actually links
 * to (verified live: the logo is `<a href="/token">`, and pushing `/token` redirects to the
 * autoload coin page in under 200ms). Both are transit, never destinations: the home intent
 * must not be spent on them, the URL mask must not rewrite their history entries, and a
 * click on a link to either is a home-screen request.
 */
const HOME_PATHS: ReadonlySet<string> = new Set(['/', '/token'])

function isHomePath(path: string): boolean {
  return HOME_PATHS.has(path)
}

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
  // The masked address IS the terminal — fomo has nothing there — so it is always mountable:
  // a reload or bookmark of fomo.family/fobo-terminal opens straight into fobo.
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

/* ---------- URL + title mask ---------- */

/** The real `pathname+search+hash` hidden behind PARKED_PATH while the terminal is visible. */
let maskedPath: string | null = null

/**
 * Point the address bar at fobo's own path. replaceState only — deliberately NO synthetic
 * popstate, so fomo's router keeps its current (real) location and the page underneath stays
 * exactly as it was. Re-asserts on every mount sync: fomo's own history calls (the `/`
 * redirect, canonicalisation) overwrite the displayed URL, and the newest real location must
 * become the one the mask restores. Never masks `/` — fomo's home redirect is about to
 * replace it anyway.
 */
function maskUrl(): void {
  // Never masks a home path — fomo's redirect is about to replace it, and rewriting a
  // transit entry to fobo's address 404s fomo when Back later passes through it.
  if (window.location.pathname === PARKED_PATH || isHomePath(window.location.pathname)) return
  const real = window.location.pathname + window.location.search + window.location.hash
  try {
    window.history.replaceState(null, '', PARKED_PATH)
  } catch {
    return
  }
  maskedPath = real
  lastPath = PARKED_PATH
}

/**
 * Restore the real URL before anything stacks on top of it or the page is handed back. Only
 * rewrites while the displayed URL is still the mask — after a real popstate (browser Back)
 * the current entry is already a real path and must not be touched.
 */
function unmaskUrl(): void {
  if (maskedPath === null) return
  if (window.location.pathname === PARKED_PATH) {
    try {
      window.history.replaceState(null, '', maskedPath)
      lastPath = window.location.pathname
    } catch {
      /* the mask stays; navigation still works, the entry just keeps fobo's address */
    }
  }
  maskedPath = null
}

let maskedTitle: string | null = null
let titleObserver: MutationObserver | null = null

/**
 * Own the tab name while the terminal is visible. fomo rewrites its <title> as routes and
 * data resolve, so the observer keeps re-asserting ours and remembers fomo's newest title as
 * the one to restore on handoff.
 */
function maskTitle(): void {
  if (maskedTitle === null) maskedTitle = document.title
  document.title = TERMINAL_TITLE
  if (titleObserver) return
  const el = document.querySelector('title')
  if (!el) return
  titleObserver = new MutationObserver(() => {
    if (document.title !== TERMINAL_TITLE) {
      maskedTitle = document.title
      document.title = TERMINAL_TITLE
    }
  })
  titleObserver.observe(el, { childList: true, characterData: true, subtree: true })
}

function unmaskTitle(): void {
  titleObserver?.disconnect()
  titleObserver = null
  if (maskedTitle !== null) {
    document.title = maskedTitle
    maskedTitle = null
  }
}

/**
 * The second deliberate exception to "never touch fomo's tree": while the terminal is visible,
 * fomo's page keeps rendering a live token page nobody can see — a TradingView chart and its
 * subscriptions were most of the extension's runtime cost. An isolated-world script cannot
 * (and should not) stop fomo's JS, but content-visibility skips the layout, paint and raster
 * work for its whole tree while leaving state, sockets and React untouched. Inline styles are
 * saved and restored verbatim, exactly like the scroll lock. On restore, a synthetic resize
 * nudges fomo's charts and virtual lists to re-measure — ResizeObservers see zero sizes while
 * content is skipped.
 *
 * Suppression covers fomo's top-level body children at the moment the terminal shows; nodes
 * fomo portals in afterwards (modals, tooltips) stay live, which is what a handoff needs.
 */
let suppressedRender: { el: HTMLElement; value: string }[] | null = null

function suppressPageRender(): void {
  if (suppressedRender) return
  const entries: { el: HTMLElement; value: string }[] = []
  for (const el of document.body.children) {
    if (!(el instanceof HTMLElement)) continue
    if (el.id === HOST_ID || el.id === LAUNCHER_ID) continue
    entries.push({ el, value: el.style.contentVisibility })
    el.style.contentVisibility = 'hidden'
  }
  suppressedRender = entries
}

function restorePageRender(): void {
  if (!suppressedRender) return
  for (const { el, value } of suppressedRender) {
    if (el.isConnected) el.style.contentVisibility = value
  }
  suppressedRender = null
  window.dispatchEvent(new Event('resize'))
}

function unmount(): void {
  root?.unmount()
  root = null
  host?.remove()
  host = null
  document.getElementById(HOST_ID)?.remove()
  unlockPageScroll()
  restorePageRender()
  unmaskTitle()
  unmaskUrl()
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
  restorePageRender()
  unmaskTitle()
  unmaskUrl()
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
  // No header in the page yet (fomo still booting, or a headerless view underneath). Drive
  // fomo home — its `/` redirect boots a real page with the real header — then click the
  // button once it renders. Dismissal comes first, so the landing page cannot remount the
  // terminal over the deposit modal.
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
    suppressPageRender()
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
  suppressPageRender()

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
  // Restore the real URL first, so the destination stacks on a real history entry and Back
  // returns to a real fomo page (which remounts the terminal and re-masks). Also restores
  // the real pathname for the comparison below — while masked it reads as the parked path.
  unmaskUrl()
  // The destination can be the very page the terminal is sitting on: fomo's `/` redirect
  // lands on a coin page, and the top holding (the holdings bar's first chip) tends to be
  // that same coin. There is nothing to push and no popstate to raise — the real page below
  // is already correct; stepping aside IS the navigation. Unmark so sync hides the terminal
  // instead of holding the mount, which read as a dead click.
  if (path === window.location.pathname) {
    unmarkTerminal(path)
    void sync()
    return
  }
  unmarkTerminal(path)
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
    // The intent is spent only once the route has SETTLED off `/`. fomo's home redirect hops
    // through transit paths (a bare `/token`, observed live) and the terminal can mount over
    // one mid-flight; clearing on that first mount consumed the intent before the real
    // landing page arrived, which therefore went unmarked — the terminal flashed up and hid
    // itself, dead until a toolbar toggle re-marked something. The same gate holds the URL
    // mask back so a transit history entry is never rewritten to fobo's address (a stale
    // masked entry 404s fomo when Back passes through it). The route watcher re-runs sync
    // once the path stops moving, so neither the deferred clear nor the mask is lost.
    const settled = routeSettled()
    if (settled && !isHomePath(window.location.pathname)) setPendingHome(false)
    maskTitle()
    if (settled) maskUrl()
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

/**
 * When the path last moved. fomo's home redirect hops through transit paths (observed live:
 * a bare `/token` between `/` and the landing page), so "the route changed" and "the route
 * has arrived" are different events — anything that must happen once per DESTINATION (spending
 * the home intent, masking the URL) waits until the path has been still this long.
 */
const SETTLE_MS = 600
let lastPathChangeAt = Date.now()

function routeSettled(): boolean {
  return Date.now() - lastPathChangeAt >= SETTLE_MS
}

function watchRoute(): void {
  const check = () => {
    const path = window.location.pathname
    if (path === lastPath) {
      // A home request can resolve with no observable path change at all: fomo's `/`
      // redirect can land back on the very page it left (logo-home from the page `/`
      // redirects to), and the whole `/` hop fits inside one poll interval. The armed
      // intent claims the current page from here; sync's mount branch then clears it.
      // Not while the terminal is visible (nothing to claim) and not on `/` itself —
      // the redirect off `/` always produces a real path change for the branch below.
      if (!isHomePath(path) && isPendingHome() && !(host && host.dataset.foboHidden === undefined)) {
        markTerminal(path)
        void sync()
      } else if (
        host &&
        host.dataset.foboHidden === undefined &&
        maskedPath === null &&
        !isHomePath(path) &&
        routeSettled()
      ) {
        // The mount ran before the route settled, so spending the intent and masking the
        // URL were deferred (see sync's mount branch). The path has now been still for a
        // full settle window — re-sync to apply them. maskedPath goes non-null right
        // after, so this fires once per mount.
        void sync()
      }
      return
    }
    lastPathChangeAt = Date.now()
    // While the home intent is armed, every automatic landing is still "the home screen" —
    // fomo can hop more than once (the `/token` shim, address canonicalisation) before
    // settling. Home paths themselves are transit, not destinations: marking one would make
    // it "always mountable" and fight fomo's redirect off it.
    if (isPendingHome() && !isHomePath(path)) markTerminal(path)
    // Landing on a home path (Back past the landing page, or fomo's own redirect passing
    // through) renews the home intent: fomo immediately redirects off it again, and if the
    // autoload token rotated since entry it lands on a DIFFERENT page than the one marked
    // at boot. Without re-arming, that landing is unmarked and the user is stranded.
    // `/token` re-arms unconditionally — it is pure transit, reachable only home-ward
    // (the logo link is intercepted before it navigates). `/` stays gated on its mark:
    // it is only marked by home intent, so this cannot widen the mount set.
    if (path === '/token' || (path === '/' && isTerminalPath('/'))) setPendingHome(true)
    lastPath = path
    void sync()
  }
  window.addEventListener('popstate', check)
  window.addEventListener('hashchange', check)
  window.addEventListener('pageshow', () => {
    // A bfcache restore re-runs nothing, so the same home re-entry case is handled here too.
    lastPath = window.location.pathname
    if (lastPath === '/token' || (lastPath === '/' && isTerminalPath('/'))) setPendingHome(true)
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
    cameFromRoot = ref !== null && ref.origin === window.location.origin && isHomePath(ref.pathname)
  } catch {
    cameFromRoot = false
  }

  const isHomeEntry =
    (entry && entry.redirectCount > 0) ||
    entryPath === '' ||
    entryPath === PARKED_PATH ||
    (entryPath !== null && isHomePath(entryPath)) ||
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

/**
 * fomo's own home links (the header logo, a plain same-origin <a href="/">, verified live)
 * are a home-screen request, and the terminal IS the home screen — so serve it directly:
 * swallow the click before fomo's router sees it and show the terminal over the page we are
 * already on. Letting fomo run its `/` redirect was the fragile version — the redirect
 * resolves inside one poll tick, hops through transit paths, and can land back on the very
 * page it left, so every downstream signal was a race. Capture phase on window runs ahead
 * of fomo's React handlers. Modified clicks (new tab) pass through untouched — the new
 * tab's own entry intent covers those.
 */
window.addEventListener(
  'click',
  (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    // Clicks inside a visible terminal are the terminal's own.
    if (host && host.dataset.foboHidden === undefined) return
    const anchor = event
      .composedPath()
      .find((el): el is HTMLAnchorElement => el instanceof HTMLAnchorElement)
    // An <a> with no href resolves to the current URL, not home — require a real attribute.
    if (!anchor?.getAttribute('href')) return
    let url: URL
    try {
      url = new URL(anchor.href, window.location.origin)
    } catch {
      return
    }
    if (url.origin !== window.location.origin || !isHomePath(url.pathname)) return
    event.preventDefault()
    event.stopPropagation()
    // An explicit summon, same as the launcher: clear any dismissal and claim this page.
    setDismissed(false)
    markTerminal(window.location.pathname)
    void sync()
  },
  { capture: true },
)

/**
 * A document that BOOTED on the masked address means a reload or bookmark of fobo's URL: fomo
 * hydrated its 404 view there, which is no page to sit over (it broke the alerts feed when
 * the old parking model lived on it). Drive fomo home — here the synthetic popstate is wanted,
 * fomo's router follows it, and the normal home-intent flow lands on a real page, mounts, and
 * re-masks the URL.
 */
function recoverFromMaskedLoad(): void {
  if (window.location.pathname !== PARKED_PATH) return
  try {
    window.history.replaceState(null, '', '/')
    window.dispatchEvent(new PopStateEvent('popstate'))
  } catch {
    return
  }
  lastPath = '/'
  markTerminal('/')
  setPendingHome(true)
}

recordEntryIntent()
recoverFromMaskedLoad()
watchRoute()
void sync()
if (isMarketingPage()) waitForSession()
