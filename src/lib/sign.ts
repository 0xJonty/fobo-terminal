/**
 * The one place the terminal crosses into fomo's JavaScript context.
 *
 * The user's wallet is a Privy embedded wallet that lives in fomo's page world; a content
 * script runs in an isolated world and cannot see it. Rather than keep a script permanently
 * in the page — which would leave a signing oracle any page script could postMessage — the
 * background worker injects one self-contained function per click via
 * `chrome.scripting.executeScript({ world: 'MAIN' })`. Its return value comes straight back to
 * the extension, so there is no page-readable channel at all, and nothing of ours stays behind
 * once the call resolves.
 *
 * This module is only the caller. The injected function is in background/index.ts, because
 * that is where `executeScript` runs and the function has to be serialisable from there.
 */

export const SIGN_MESSAGE_TYPE = 'fobo:sign'

export interface SignedMessage {
  /** Base58 address that produced the signature — it picks the transaction's signature slot. */
  address: string
  /** Base64, 64 bytes. */
  signature: string
}

/** Failure text is shown on the button, so it stays short and blames the right thing. */
const REASONS: Readonly<Record<string, string>> = {
  'no-tab': 'No page to sign in',
  'bad-origin': 'Wrong page',
  'no-react': "fomo's page is still loading",
  'no-wallet': 'No fomo wallet on this page',
  'bad-signature': 'Wallet returned no signature',
  'no-result': 'Signing was blocked',
}

/**
 * Ask the page's wallet to sign `messageBase64`. Never throws — a dead extension context (an
 * orphaned content script after a reload) resolves to an error like any other failure.
 */
export async function signWithPageWallet(
  messageBase64: string,
): Promise<SignedMessage | { error: string }> {
  let reply: unknown
  try {
    reply = await chrome.runtime.sendMessage({ type: SIGN_MESSAGE_TYPE, message: messageBase64 })
  } catch {
    return { error: 'Extension reloaded — refresh the page' }
  }

  const row = (typeof reply === 'object' && reply !== null ? reply : {}) as Record<string, unknown>
  if (typeof row.address === 'string' && typeof row.signature === 'string') {
    return { address: row.address, signature: row.signature }
  }
  const code = typeof row.error === 'string' ? row.error : 'no-result'
  return { error: REASONS[code] ?? code }
}
