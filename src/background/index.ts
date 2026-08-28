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

import { SIGN_MESSAGE_TYPE, type SignRequest } from '~/lib/sign'

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
 * constant, a helper) would be undefined by the time it runs. That is why the request shape is
 * re-validated inline rather than shared with lib/sign.ts.
 *
 * Finding the wallet: Privy's embedded wallet is React state, not a global. fomo puts it on a
 * context whose value is `{ fomoUser, solanaWallet, evmWallet, ... }`, so the fiber tree is
 * walked for that value. The object found is the same one fomo's own trade panel signs with,
 * and fomo runs Privy in headless mode, so no wallet modal opens. Only the Solana wallet is
 * ever needed: a buy always spends the Solana cash rail, whatever chain the token is on.
 */
function signInPageWorld(
  request: SignRequest,
): { address: string; signature: string } | { error: string } | Promise<{ address: string; signature: string } | { error: string }> {
  interface Fiber {
    return?: Fiber | null
    child?: Fiber | null
    sibling?: Fiber | null
    memoizedProps?: { value?: unknown } | null
  }
  interface SolanaWallet {
    address?: string
    signMessage?: (input: { message: Uint8Array }) => Promise<{ signature?: Uint8Array } | Uint8Array>
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

  let root = entry as Fiber
  while (root.return) root = root.return

  const seen = new Set<Fiber>()
  const stack: Fiber[] = [root]
  let context: { solanaWallet?: SolanaWallet } | null = null
  let visited = 0
  while (stack.length > 0 && visited < 400000 && !context) {
    const current = stack.pop()
    if (!current || seen.has(current)) continue
    seen.add(current)
    visited += 1
    const value = current.memoizedProps?.value
    if (value && typeof value === 'object' && 'solanaWallet' in value) {
      context = value as { solanaWallet?: SolanaWallet }
    }
    if (current.child) stack.push(current.child)
    if (current.sibling) stack.push(current.sibling)
  }
  if (!context) return { error: 'no-wallet' }

  const wallet = context.solanaWallet
  if (!wallet || typeof wallet.signMessage !== 'function' || typeof wallet.address !== 'string') {
    return { error: 'no-wallet' }
  }

  const binary = atob(request.message)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  const address = wallet.address

  return wallet
    .signMessage({ message: bytes })
    .then((result) => {
      const raw = result instanceof Uint8Array ? result : result?.signature
      if (!raw || raw.length !== 64) return { error: 'bad-signature' }
      let text = ''
      for (let i = 0; i < raw.length; i += 1) text += String.fromCharCode(raw[i]!)
      return { address, signature: btoa(text) }
    })
    .catch((error: unknown) => ({
      error: error instanceof Error && error.message ? error.message.slice(0, 80) : 'sign-failed',
    }))
}

function isSignRequest(value: unknown): value is SignRequest {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return row.kind === 'solana-message' && typeof row.message === 'string'
}

chrome.runtime.onMessage.addListener(
  (message: { type?: string; request?: unknown }, sender, sendResponse) => {
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
    if (!isSignRequest(message.request)) {
      sendResponse({ error: 'bad-request' })
      return
    }

    void chrome.scripting
      .executeScript({
        target: { tabId, frameIds: [sender.frameId ?? 0] },
        world: 'MAIN',
        func: signInPageWorld,
        args: [message.request],
      })
      .then((results) => sendResponse(results[0]?.result ?? { error: 'no-result' }))
      .catch(() => sendResponse({ error: 'no-result' }))

    // Keeps the message channel open for the async reply above.
    return true
  },
)

// Module scope, not script scope — keeps this file's names out of the global namespace.
export {}
