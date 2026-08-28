/**
 * Quick buy: one market buy of a token, funded from the same USDC cash rail fomo's own trade
 * panel spends.
 *
 * Every step here mirrors fomo's own client rather than inventing a trade path. Its bundle
 * has exactly one swap call site, and this is the shape it sends:
 *
 *     POST /swaps/v2 { inTokenId, outTokenId, amount, retry }
 *     buy  -> [USDC, token]      sell -> [token, USDC]
 *
 * The server builds the transaction, simulates it, and signs it as FEE PAYER — the response
 * carries `swapTransaction` plus `feePayerSignature`. The only missing piece is the user's own
 * signature, which their wallet lives in fomo's page to provide (see lib/sign.ts). fomo's fee
 * tier and flat fee are set by that server on its own terms; nothing here touches them.
 *
 * Solana only. fomo routes EVM buys through a relay that wants an EVM signature and a
 * different confirmation flow (`v2Swap` in its response); this asks for a quote it cannot
 * complete rather than pretending, and the button never renders on a non-Solana row.
 */

import { readJwt } from '~/lib/fomoApi'
import { countRequest } from '~/lib/host'
import { SUPPORTED_CHAINS } from '~/lib/protocol'
import {
  base64Decode,
  base64Encode,
  messageBytes,
  parseTransaction,
  signatureSlot,
  transactionSignature,
  withSignature,
} from '~/lib/solanaTx'
import type { Token } from '~/types/token'

const BASE = 'https://prod-api.fomo.family'

/** fomo's Solana network id, and the USDC row its header calls "cash". */
export const SOLANA_NETWORK_ID = 1399811149
export const USDC_SOL_TOKEN_ID = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:1399811149'
const USDC_DECIMALS = 6

/** The server's own floor, quoted back verbatim when a smaller amount is sent. */
export const SWAP_MIN_USD = 2

/**
 * Jito's block engine (bundles, when the quote carries a tip transaction) and Hudson (its
 * plain submit endpoint), both lifted from fomo's bundle. Neither needs a host permission:
 * these run from the content script at fomo's own origin, and both allow it — the same way
 * every other call in this codebase reaches prod-api.
 *
 * fomo sends its bundles with a hardcoded `x-jito-auth` uuid. That is their rate-limit quota,
 * not ours, so the unauthenticated path is used here.
 */
const JITO_BUNDLE_URL = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles'
const HUDSON_URL = 'https://mainnet.hudson.jito.wtf/api/v1/sendTransactionWeb?mev_protection_default=true'

const QUOTE_TIMEOUT_MS = 15_000
const SUBMIT_TIMEOUT_MS = 15_000

/** The fields of fomo's `v1Swap` this flow actually uses. */
export interface SwapQuote {
  /** Base64 transaction, fee-payer-signed, user slot still empty. */
  transaction: string
  feePayerAddress: string
  /** Base64 — the server's own signature, re-attached after ours goes in. */
  feePayerSignature: string
  /** Present when the swap is meant to go out as a Jito bundle. */
  jitoTipTx?: string
  expectedOutHumanAmount?: number
  swapUsdValue?: number
  flatFee?: number
}

export type QuoteResult = { ok: true; quote: SwapQuote } | { ok: false; message: string }

interface SwapEnvelope {
  success?: boolean
  message?: string
  responseObject?: {
    v1Swap?: Record<string, unknown>
    v2Swap?: unknown
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** USD to USDC base units. Rounded, not truncated — $0.10 must not become 99999 units. */
export function usdToBaseUnits(amountUsd: number): string {
  return String(Math.round(amountUsd * 10 ** USDC_DECIMALS))
}

/**
 * Ask fomo to build the buy. Unlike lib/fomoApi's `call`, the message on failure is kept and
 * shown: "below minimum $2.00", "insufficient funds" and a reverted simulation are all things
 * the user needs to read, and collapsing them to a null would leave the button silently dead.
 */
export async function quoteBuy(token: Token, amountUsd: number, signal?: AbortSignal): Promise<QuoteResult> {
  if (token.networkId !== SOLANA_NETWORK_ID) return { ok: false, message: 'Solana tokens only' }
  if (!(amountUsd >= SWAP_MIN_USD)) return { ok: false, message: `Minimum is $${SWAP_MIN_USD}` }

  const jwt = readJwt()
  if (!jwt) return { ok: false, message: 'Signed out of fomo' }

  countRequest('/swaps/v2')
  let response: Response
  try {
    response = await fetch(`${BASE}/swaps/v2`, {
      method: 'POST',
      credentials: 'include',
      signal: signal ?? AbortSignal.timeout(QUOTE_TIMEOUT_MS),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`,
        'X-Supported-Chains': SUPPORTED_CHAINS,
      },
      body: JSON.stringify({
        inTokenId: USDC_SOL_TOKEN_ID,
        outTokenId: `${token.address}:${token.networkId}`,
        amount: usdToBaseUnits(amountUsd),
        retry: 0,
      }),
    })
  } catch {
    return { ok: false, message: 'Network error' }
  }

  let body: SwapEnvelope
  try {
    body = (await response.json()) as SwapEnvelope
  } catch {
    return { ok: false, message: `Quote failed (${response.status})` }
  }

  if (!body.success) return { ok: false, message: quoteError(body, response.status) }

  const v1 = body.responseObject?.v1Swap
  if (!v1) {
    // A v2Swap is fomo's cross-chain relay path, which needs an EVM signature.
    return { ok: false, message: 'Unsupported swap route' }
  }

  const transaction = str(v1.swapTransaction)
  const feePayerAddress = str(v1.feePayerAddress)
  const feePayerSignature = str(v1.feePayerSignature)
  if (!transaction || !feePayerAddress || !feePayerSignature) {
    return { ok: false, message: 'Incomplete quote' }
  }

  return {
    ok: true,
    quote: {
      transaction,
      feePayerAddress,
      feePayerSignature,
      jitoTipTx: str(v1.jitoTipTx),
      expectedOutHumanAmount: num(v1.expectedOutHumanAmount),
      swapUsdValue: num(v1.swapUsdValue),
      flatFee: num(v1.flatFee),
    },
  }
}

/**
 * fomo's own error text where it is short enough to read on a button, and a status code
 * otherwise — its simulation failures arrive as multi-kilobyte program logs.
 */
function quoteError(body: SwapEnvelope, status: number): string {
  const message = body.message?.trim()
  if (message && message.length <= 120) return message
  if (status === 401 || status === 403) return 'Signed out of fomo'
  if (message) return 'Swap simulation failed'
  return `Quote failed (${status})`
}

export type SubmitResult = { ok: true; signature: string } | { ok: false; message: string }

/**
 * Complete the quote with a signature from the user's wallet and send it.
 *
 * `sign` is handed the message bytes (base64) and returns the address that signed alongside
 * the signature — the address is what picks the signature slot, so a wallet other than the one
 * the server built for is caught here instead of producing an invalid transaction.
 */
export async function signAndSubmit(
  quote: SwapQuote,
  sign: (messageBase64: string) => Promise<{ address: string; signature: string } | { error: string }>,
): Promise<SubmitResult> {
  let bytes: Uint8Array
  try {
    bytes = base64Decode(quote.transaction)
  } catch {
    return { ok: false, message: 'Malformed quote' }
  }

  const parsed = parseTransaction(bytes)
  if (!parsed) return { ok: false, message: 'Unreadable transaction' }

  const signed = await sign(base64Encode(messageBytes(bytes, parsed)))
  if ('error' in signed) return { ok: false, message: signed.error }

  const userSlot = signatureSlot(parsed, signed.address)
  if (userSlot < 0) return { ok: false, message: 'Wallet is not a signer on this swap' }

  let next = withSignature(bytes, parsed, userSlot, base64Decode(signed.signature))
  if (!next) return { ok: false, message: 'Signature rejected' }

  // The server's fee-payer signature rides in the response body, not in the transaction it
  // handed back, so it goes in beside ours.
  const feeSlot = signatureSlot(parsed, quote.feePayerAddress)
  if (feeSlot >= 0) {
    const withFee = withSignature(next, parsed, feeSlot, base64Decode(quote.feePayerSignature))
    if (!withFee) return { ok: false, message: 'Fee-payer signature rejected' }
    next = withFee
  }

  const sent = await submit(base64Encode(next), quote.jitoTipTx)
  if (!sent.ok) return sent
  return { ok: true, signature: transactionSignature(next, parsed) }
}

/** Jito bundle when the quote tipped for one, Hudson otherwise — the same fork fomo takes. */
async function submit(transactionBase64: string, jitoTipTx?: string): Promise<{ ok: true } | { ok: false; message: string }> {
  countRequest(jitoTipTx ? 'jito/bundles' : 'hudson/sendTransactionWeb')
  try {
    if (jitoTipTx) {
      const response = await fetch(JITO_BUNDLE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendBundle',
          params: [[transactionBase64, jitoTipTx], { encoding: 'base64' }],
        }),
      })
      if (!response.ok) return { ok: false, message: `Submit failed (${response.status})` }
      const body = (await response.json()) as { error?: { message?: string } }
      if (body.error) return { ok: false, message: body.error.message?.slice(0, 120) ?? 'Bundle rejected' }
      return { ok: true }
    }

    const response = await fetch(HUDSON_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
      body: transactionBase64,
    })
    if (!response.ok) return { ok: false, message: `Submit failed (${response.status})` }
    return { ok: true }
  } catch {
    return { ok: false, message: 'Submit failed' }
  }
}
