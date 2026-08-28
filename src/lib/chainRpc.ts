/**
 * Confirmation for a submitted quick buy.
 *
 * Two legs, because a buy has up to two. Every purchase spends the same Solana USDC cash, so
 * the transaction the user signs always lands on Solana — but when the token lives on another
 * chain, the site routes through Relay, and the Solana deposit confirming only means the money
 * left. The token arriving is a second question with a second answer.
 *
 *   leg 1  Solana   the signed deposit lands (or reverts)      solana-provider.prod-edge
 *   leg 2  Relay    the destination chain is filled            api.relay.link
 *
 * A same-chain Solana buy has only leg 1. Both endpoints are the ones the site's own client
 * polls; the Solana proxy takes the Privy bearer token we already hold, and Relay's status
 * endpoint is public.
 */

import { readJwt } from '~/lib/fomoApi'
import { countRequest } from '~/lib/host'

const SOLANA_RPC = 'https://solana-provider-1.prod-edge.fomo.family'
const RELAY_STATUS = 'https://api.relay.link/requests/v2'

const TIMEOUT_MS = 10_000

export type ConfirmState = 'pending' | 'confirmed' | 'failed'

export interface ConfirmResult {
  state: ConfirmState
  /** Set when `state` is 'failed', short enough to show on a button. */
  error?: string
}

interface SolanaStatusValue {
  confirmationStatus?: string
  err?: unknown
}

/**
 * `getSignatureStatuses` on the site's own Solana proxy.
 *
 * A null entry means the cluster has not seen the signature yet — that is 'pending', never
 * 'failed'. A freshly submitted transaction is routinely invisible for a second or two, and
 * treating that as failure would report a lie on every successful buy.
 */
export async function solanaSignatureStatus(signature: string): Promise<ConfirmResult> {
  const jwt = readJwt()
  if (!jwt) return { state: 'pending' }
  countRequest('solana/getSignatureStatuses')

  let body: { result?: { value?: (SolanaStatusValue | null)[] } }
  try {
    const response = await fetch(SOLANA_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getSignatureStatuses',
        params: [[signature], { searchTransactionHistory: true }],
      }),
    })
    if (!response.ok) return { state: 'pending' }
    body = (await response.json()) as typeof body
  } catch {
    // A failed read says nothing about the transaction. Keep waiting.
    return { state: 'pending' }
  }

  const value = body.result?.value?.[0]
  if (!value) return { state: 'pending' }
  if (value.err !== undefined && value.err !== null) return { state: 'failed', error: solanaError(value.err) }
  const status = value.confirmationStatus
  if (status === 'confirmed' || status === 'finalized') return { state: 'confirmed' }
  return { state: 'pending' }
}

/**
 * Slippage is the failure worth naming — it is the one the user can do something about (raise
 * the amount, or try again on a calmer chart). 0x1771 is the swap programs' shared
 * "SlippageToleranceExceeded" custom error, which is how the site's own client detects it too.
 */
function solanaError(err: unknown): string {
  const text = JSON.stringify(err)
  if (text.includes('1771') || text.toLowerCase().includes('slippage')) return 'Slippage exceeded'
  return 'Swap reverted'
}

/**
 * Relay's own view of a cross-chain request. The status vocabulary is taken from the site's
 * client, which treats 'refund' as a failure — the money comes back, but the buy did not happen
 * and saying "filled" would be wrong.
 *
 * This is `/requests/v2`, which Relay marks deprecated in favour of v3 and rate-limits in stages
 * from 2026-09-01. v3 is not a drop-in: it requires an `x-api-key` header, which this extension
 * has no business inventing. v2 is also what the site's own client still polls, so if it stops
 * answering it stops answering for both of us. Two things keep that from becoming a lie on the
 * button: this leg is polled slowly (see ui/QuickBuy.tsx), and any failure — including a
 * rate-limit — reads as "still waiting", never as a failed buy.
 */
export async function relayStatus(relaySwapId: string): Promise<ConfirmResult> {
  countRequest('relay/requests')
  let body: { requests?: { status?: string; data?: { failureReason?: string } }[] }
  try {
    const response = await fetch(`${RELAY_STATUS}?id=${encodeURIComponent(relaySwapId)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) return { state: 'pending' }
    body = (await response.json()) as typeof body
  } catch {
    return { state: 'pending' }
  }

  const request = body.requests?.[0]
  if (!request) return { state: 'pending' }
  if (request.status === 'success') return { state: 'confirmed' }
  if (request.status === 'failure' || request.status === 'refund') {
    const reason = request.data?.failureReason
    return {
      state: 'failed',
      error: request.status === 'refund' ? 'Refunded — not filled' : (reason ?? 'Relay failed').slice(0, 60),
    }
  }
  return { state: 'pending' }
}
