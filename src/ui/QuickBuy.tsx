import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, Zap } from 'lucide-react'
import { HIDDEN_EVENT } from '~/lib/host'
import { usdExact } from '~/lib/format'
import { balances } from '~/lib/session'
import { signSolanaMessage } from '~/lib/sign'
import { confirmBuy, hasEnoughCash, quoteBuy, signAndSubmit, SWAP_MIN_USD } from '~/lib/swap'
import { pushToast } from '~/lib/toast'
import type { QuickBuySize } from '~/lib/displayPrefs'
import type { Token } from '~/types/token'

/**
 * The card's buy control: one click spends that column's amount on the row under the cursor.
 *
 * One click, no arming step — it is a quick buy, and a confirm turned it into a slow one. What
 * that gives up in safety is paid back by never claiming a result it has not seen: a submitted
 * swap sits at "Sent" until the chain answers, and only a confirmed deposit (plus, for a token
 * on another chain, a filled Relay request) turns it into "Filled".
 *
 * Failures do NOT land on the button. A 60-pixel control in a scrolling column is the wrong
 * place for a sentence explaining what went wrong, so the button returns to rest and the reason
 * is announced as a notification (lib/toast.ts).
 */

/**
 * Poll cadences and the ceiling. The deposit is read from the site's own authenticated Solana
 * node, so it can be asked often; Relay's status endpoint is public, deprecated and rate-limited
 * (see lib/chainRpc.ts), so its leg is asked at a quarter of the rate.
 */
const DEPOSIT_POLL_MS = 1_500
const RELAY_POLL_MS = 6_000
const POLL_LIMIT_MS = 120_000
/** How long a filled button stays green before it goes back to offering the next buy. */
const RESULT_MS = 6_000
/** Balances lag the chain; nudge them once the buy is actually settled. */
const REFRESH_DELAY_MS = 2_000

type Phase =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'pending'; signature: string; relaySwapId?: string }
  | { kind: 'filled'; signature: string }

function label(amountUsd: number): string {
  // Whole dollars read better on a dense row; cents only when they are actually set.
  return Number.isInteger(amountUsd) ? `$${amountUsd}` : `$${amountUsd.toFixed(2)}`
}

export function QuickBuy({
  token,
  size,
  amountUsd,
}: {
  token: Token
  size: QuickBuySize
  amountUsd: number
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  // Rows are virtualised and recycled, so the same instance can be handed a different token.
  // Carrying a result onto another row would be a lie about that row.
  useEffect(() => setPhase({ kind: 'idle' }), [token.key])

  // A buy in flight must not be reported onto an unmounted (or recycled) button.
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  const timer = useRef<number | undefined>(undefined)
  const resetLater = useCallback((ms: number) => {
    if (timer.current !== undefined) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      if (live.current) setPhase({ kind: 'idle' })
    }, ms)
  }, [])
  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current)
    },
    [],
  )

  // The terminal hides (not unmounts) on a handoff; come back offering a buy, not mid-result.
  useEffect(() => {
    const rest = () => setPhase((current) => (current.kind === 'filled' ? { kind: 'idle' } : current))
    window.addEventListener(HIDDEN_EVENT, rest)
    return () => window.removeEventListener(HIDDEN_EVENT, rest)
  }, [])

  const fail = useCallback((message: string) => {
    pushToast('error', message)
    setPhase({ kind: 'idle' })
  }, [])

  /**
   * Confirmation. Runs only while a buy is pending, and gives up after the ceiling rather than
   * polling forever — a timeout leaves the button at rest with the swap still on chain, which is
   * the honest reading of "we stopped watching", not a failure.
   */
  const pendingSignature = phase.kind === 'pending' ? phase.signature : null
  const pendingRelay = phase.kind === 'pending' ? phase.relaySwapId : undefined
  useEffect(() => {
    if (!pendingSignature) return
    let cancelled = false
    const startedAt = Date.now()

    const tick = async () => {
      const result = await confirmBuy(pendingSignature, pendingRelay)
      if (cancelled || !live.current) return
      if (result.state === 'confirmed') {
        setPhase({ kind: 'filled', signature: pendingSignature })
        resetLater(RESULT_MS)
        window.setTimeout(() => balances.refresh(), REFRESH_DELAY_MS)
        return
      }
      if (result.state === 'failed') {
        pushToast('error', result.error ?? 'The swap did not go through')
        setPhase({ kind: 'idle' })
        // A reverted swap still costs fees and may have moved cash; re-read either way.
        window.setTimeout(() => balances.refresh(), REFRESH_DELAY_MS)
        return
      }
      if (Date.now() - startedAt > POLL_LIMIT_MS) {
        setPhase({ kind: 'idle' })
        return
      }
      handle = window.setTimeout(
        () => void tick(),
        result.leg === 'relay' ? RELAY_POLL_MS : DEPOSIT_POLL_MS,
      )
    }

    let handle = window.setTimeout(() => void tick(), DEPOSIT_POLL_MS)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [pendingSignature, pendingRelay, resetLater])

  const buy = useCallback(async () => {
    /*
     * Cash first. With an empty balance the server still builds a quote and then fails its own
     * simulation with "slippage limit exceeded" — technically true of a route that can output
     * nothing, and completely misleading as an explanation. Saying what is actually wrong costs
     * one read of a number already on screen.
     */
    const cashUsd = balances.get()?.numbers?.cashUsd
    if (hasEnoughCash(cashUsd, amountUsd) === false) {
      pushToast(
        'error',
        `Not enough cash — ${usdExact(cashUsd)} available, ${label(amountUsd)} needed. Deposit USDC to buy.`,
      )
      return
    }

    setPhase({ kind: 'busy' })

    const quoted = await quoteBuy(token, amountUsd)
    if (!live.current) return
    if (!quoted.ok) {
      fail(quoted.message)
      return
    }

    const sent = await signAndSubmit(quoted.quote, signSolanaMessage)
    if (!live.current) return
    if (!sent.ok) {
      fail(sent.message)
      return
    }

    // Submitted, not filled. The polling effect above decides which it becomes.
    if (timer.current !== undefined) window.clearTimeout(timer.current)
    setPhase({ kind: 'pending', signature: sent.signature, relaySwapId: sent.relaySwapId })
  }, [token, amountUsd, fail])

  const click = (event: React.MouseEvent) => {
    // The whole row is a link into fomo's coin page. Buying must not navigate.
    event.preventDefault()
    event.stopPropagation()
    if (phase.kind === 'busy' || phase.kind === 'pending') return
    void buy()
  }

  const amount = label(amountUsd)
  const name = token.symbol || token.name || 'this token'
  const title =
    phase.kind === 'pending'
      ? `Sent — waiting for confirmation. ${phase.signature}`
      : phase.kind === 'filled'
        ? `Filled — ${phase.signature}`
        : `Buy ${amount} of ${name} (minimum $${SWAP_MIN_USD})`

  const busy = phase.kind === 'busy' || phase.kind === 'pending'

  return (
    <button
      type="button"
      className="qbuy"
      data-size={size}
      data-phase={phase.kind}
      title={title}
      aria-label={title}
      disabled={busy}
      onClick={click}
      // The row's own handler runs on click; stopping the pointer here as well keeps a
      // press-and-drag on the button from starting anything on the row underneath.
      onPointerDown={(event) => event.stopPropagation()}
    >
      {busy ? (
        <Loader2 className="qbuy-icon qbuy-spin" />
      ) : phase.kind === 'filled' ? (
        <Check className="qbuy-icon" />
      ) : (
        <Zap className="qbuy-icon" />
      )}
      <span className="qbuy-label">
        {phase.kind === 'pending' ? 'Sent' : phase.kind === 'filled' ? 'Filled' : amount}
      </span>
    </button>
  )
}
