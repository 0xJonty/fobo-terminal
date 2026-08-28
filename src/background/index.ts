/**
 * Service worker. Deliberately thin.
 *
 * It does NOT fetch data: fomo's API sits behind Cloudflare bot management that rejects
 * non-browser clients, so all data access happens in the page. This worker relays the popup's
 * on/off preference to open fomo tabs — the popup writes chrome.storage, this broadcasts the
 * change, content scripts re-sync — and it is the only context that can inject into fomo's own
 * JavaScript world, which quick buy needs for one signature per click (see lib/sign.ts).
 *
 * MV3 terminates this worker when idle, so nothing is cached in module scope — every read
 * goes to chrome.storage.
 */

import { SIGN_MESSAGE_TYPE } from '~/lib/sign'

const ENABLED_KEY = 'fobo:enabled'

const FOMO_ORIGIN = 'https://fomo.family/'

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync' || !(ENABLED_KEY in changes)) return
  const enabled = changes[ENABLED_KEY]?.newValue !== false

  void (async () => {
    // Host permission for fomo.family is what lets this URL-filtered query run without the
    // broad "tabs" permission.
    const tabs = await chrome.tabs.query({ url: 'https://fomo.family/*' })
    for (const tab of tabs) {
      if (tab.id === undefined) continue
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'fobo:enabled-changed', enabled })
      } catch {
        // Tab without a content script (still loading, or discarded) — nothing to tell.
      }
    }
  })()
})

/* ---------------------------------------------------------------- quick buy: one signature */

/**
 * Runs in fomo's OWN JavaScript world, injected for the duration of a single call and gone
 * again — see lib/sign.ts for why it is not a permanent content script.
 *
 * It must be entirely self-contained: Chrome serialises it with `Function.prototype.toString`
 * and evaluates the text in the page, so anything it closes over here (an import, a module
 * constant, a helper) would be undefined by the time it runs.
 *
 * Finding the wallet: Privy's embedded Solana wallet is React state, not a global. fomo puts
 * it on a context whose value is `{ fomoUser, solanaWallet, evmWallet, ... }`, so the fiber
 * tree is walked for a context value carrying a `solanaWallet` that can sign. The object found
 * is the same one fomo's own trade panel signs with — it exposes `signMessage`, and fomo runs
 * Privy in headless mode, so no wallet modal opens.
 */
function signInPageWorld(messageBase64: string): { address: string; signature: string } | { error: string } | Promise<{ address: string; signature: string } | { error: string }> {
  const decode = (text: string): Uint8Array => {
    const binary = atob(text)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return bytes
  }
  const encode = (bytes: Uint8Array): string => {
    let binary = ''
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!)
    return btoa(binary)
  }

  let entry: unknown = null
  for (const element of document.querySelectorAll('div')) {
    const key = Object.keys(element).find(
      (name) => name.startsWith('__reactContainer$') || name.startsWith('__reactFiber$'),
    )
    if (key) {
      entry = (element as unknown as Record<string, unknown>)[key]
      break
    }
  }
  if (!entry) return { error: 'no-react' }

  interface Fiber {
    return?: Fiber | null
    child?: Fiber | null
    sibling?: Fiber | null
    memoizedProps?: { value?: unknown } | null
  }
  let root = entry as Fiber
  while (root.return) root = root.return

  interface PageWallet {
    address?: string
    signMessage?: (input: { message: Uint8Array }) => Promise<{ signature?: Uint8Array } | Uint8Array>
  }

  const seen = new Set<Fiber>()
  const stack: Fiber[] = [root]
  let wallet: PageWallet | null = null
  let visited = 0
  while (stack.length > 0 && visited < 400000 && !wallet) {
    const current = stack.pop()
    if (!current || seen.has(current)) continue
    seen.add(current)
    visited += 1
    const value = current.memoizedProps?.value
    if (value && typeof value === 'object' && 'solanaWallet' in value) {
      const candidate = (value as { solanaWallet?: PageWallet }).solanaWallet
      if (candidate && typeof candidate.signMessage === 'function' && typeof candidate.address === 'string') {
        wallet = candidate
      }
    }
    if (current.child) stack.push(current.child)
    if (current.sibling) stack.push(current.sibling)
  }
  if (!wallet) return { error: 'no-wallet' }

  // Both members were checked in the walk above; this narrows them for the call, and calling
  // through the object keeps `this` bound to the wallet.
  const found = wallet as Required<PageWallet>
  const address = found.address
  return found
    .signMessage({ message: decode(messageBase64) })
    .then((result) => {
      const raw = result instanceof Uint8Array ? result : result?.signature
      if (!raw) return { error: 'bad-signature' }
      const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
      if (bytes.length !== 64) return { error: 'bad-signature' }
      return { address, signature: encode(bytes) }
    })
    .catch((error: unknown) => ({
      error: error instanceof Error && error.message ? error.message.slice(0, 80) : 'sign-failed',
    }))
}

chrome.runtime.onMessage.addListener(
  (message: { type?: string; message?: string }, sender, sendResponse) => {
    // Only this extension's own content scripts. `sender.id` is the extension id for our own
    // contexts; a web page cannot set it.
    if (sender.id !== chrome.runtime.id) return
    if (message?.type !== SIGN_MESSAGE_TYPE) return

    const tabId = sender.tab?.id
    if (tabId === undefined) {
      sendResponse({ error: 'no-tab' })
      return
    }
    // Injection is scoped to the exact frame that asked, and only on fomo — the same host the
    // manifest already grants. A request from anywhere else is refused rather than injected.
    if (!(sender.tab?.url ?? '').startsWith(FOMO_ORIGIN)) {
      sendResponse({ error: 'bad-origin' })
      return
    }

    void chrome.scripting
      .executeScript({
        target: { tabId, frameIds: [sender.frameId ?? 0] },
        world: 'MAIN',
        func: signInPageWorld,
        args: [String(message.message ?? '')],
      })
      .then((results) => sendResponse(results[0]?.result ?? { error: 'no-result' }))
      .catch(() => sendResponse({ error: 'no-result' }))

    // Keeps the message channel open for the async reply above.
    return true
  },
)

// Module scope, not script scope — keeps this file's names out of the global namespace.
export {}
