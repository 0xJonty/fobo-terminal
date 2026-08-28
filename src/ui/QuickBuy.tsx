import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, X, Zap } from 'lucide-react'
import { HIDDEN_EVENT } from '~/lib/host'
import { balances } from '~/lib/session'
import { signSolanaMessage } from '~/lib/sign'
import { confirmBuy, quoteBuy, signAndSubmit } from '~/lib/swap'
import type { QuickBuySize } from '~/lib/displayPrefs'
import type { Token } from '~/types/token'

/**
 * The card's buy control: one click spends a fixed amount of the same USDC cash fomo's own
 * trade panel spends, on the row under the cursor.
 *
 * This is the only control in the terminal that moves money, so it is deliberately louder than
 * the rest of the UI about what it just did — and it does not claim a fill it has not seen. A
 * submitted swap sits at "sent" until the chain says otherwise; only a confirmed deposit (and,
 * for a token on another chain, a filled Relay request) turns it into "filled". A revert, a
 * slippage failure or a refund turns it red and says which.
 */

/**
 * Poll cadences and the ceiling. The deposit is read from the site's own authenticated Solana
 * node, so it can be asked often; Relay's status endpoint is public, deprecated and rate-limited
 * (see lib/chainRpc.ts), so its leg is asked at a quarter of the rate.
 */
const DEPOSIT_POLL_MS = 1_500
const RELAY_POLL_MS = 6_000
const POLL_LIMIT_MS = 120_000
/** How long a settled state (filled / failed) stays before the button resets. */
const RESULT_MS = 8_000
/** How long an armed button waits for the confirming click. */
const ARM_MS = 4_000
/** Balances lag the chain; nudge them once the buy is actually confirmed. */
const REFRESH_DELAY_MS = 2_000

type Phase =
  | { kind: 'idle' }
  | { kind: 'armed' }
  | { kind: 'busy' }
  | { kind: 'pending'; signature: string; relaySwapId?: string }
  | { kind: 'filled'; signature: string }
  | { kind: 'failed'; message: string }

function label(amountUsd: number): string {
  // Whole dollars read better on a dense row; cents only when they are actually set.
  return Number.isInteger(amountUsd) ? `$${amountUsd}` : `$${amountUsd.toFixed(2)}`
}

export function QuickBuy({
  token,
  size,
  amountUsd,
  confirm,
}: {
  token: Token
  size: QuickBuySize
  amountUsd: number
  confirm: boolean
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
  const resetLater = useCallback((next: Phase, ms: number) => {
    if (timer.current !== undefined) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = undefined
      if (live.current) setPhase(next)
    }, ms)
  }, [])
  useEffect(
    () => () => {
      if (timer.current !== undefined) window.clearTimeout(timer.current)
    },
    [],
  )

  // The terminal hides (not unmounts) on a handoff; never come back still armed to spend.
  useEffect(() => {
    const disarm = () => setPhase((current) => (current.kind === 'armed' ? { kind: 'idle' } : current))
    window.addEventListener(HIDDEN_EVENT, disarm)
    return () => window.removeEventListener(HIDDEN_EVENT, disarm)
  }, [])

  /**
   * Confirmation. Runs only while a buy is pending, and gives up after the ceiling rather than
   * polling forever — a timeout leaves the transaction id on the tooltip and says "sent", which
   * is the honest reading of "we stopped watching", not a failure.
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
        resetLater({ kind: 'idle' }, RESULT_MS)
        window.setTimeout(() => balances.refresh(), REFRESH_DELAY_MS)
        return
      }
      if (result.state === 'failed') {
        setPhase({ kind: 'failed', message: result.error ?? 'Failed' })
        resetLater({ kind: 'idle' }, RESULT_MS)
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
    setPhase({ kind: 'busy' })

    const quoted = await quoteBuy(token, amountUsd)
    if (!live.current) return
    if (!quoted.ok) {
      setPhase({ kind: 'failed', message: quoted.message })
      resetLater({ kind: 'idle' }, RESULT_MS)
      return
    }

    const sent = await signAndSubmit(quoted.quote, signSolanaMessage)
    if (!live.current) return
    if (!sent.ok) {
      setPhase({ kind: 'failed', message: sent.message })
      resetLater({ kind: 'idle' }, RESULT_MS)
      return
    }

    // Submitted, not filled. The polling effect above decides which it becomes.
    if (timer.current !== undefined) window.clearTimeout(timer.current)
    setPhase({ kind: 'pending', signature: sent.signature, relaySwapId: sent.relaySwapId })
  }, [token, amountUsd, resetLater])

  const click = (event: React.MouseEvent) => {
    // The whole row is a link into fomo's coin page. Buying must not navigate.
    event.preventDefault()
    event.stopPropagation()

    if (phase.kind === 'busy' || phase.kind === 'pending') return
    if (confirm && phase.kind !== 'armed') {
      setPhase({ kind: 'armed' })
      resetLater({ kind: 'idle' }, ARM_MS)
      return
    }
    void buy()
  }

  const amount = label(amountUsd)
  const name = token.symbol || token.name || 'this token'
  const title =
    phase.kind === 'pending'
      ? `Sent — waiting for confirmation. ${phase.signature}`
      : phase.kind === 'filled'
        ? `Filled — ${phase.signature}`
        : phase.kind === 'failed'
          ? phase.message
          : phase.kind === 'armed'
            ? `Click again to buy ${amount} of ${name}`
            : `Buy ${amount} of ${name}`

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
      ) : phase.kind === 'failed' ? (
        <X className="qbuy-icon" />
      ) : (
        <Zap className="qbuy-icon" />
      )}
      <span className="qbuy-label">
        {phase.kind === 'pending'
          ? 'Sent'
          : phase.kind === 'filled'
            ? 'Filled'
            : phase.kind === 'failed'
              ? 'Failed'
              : phase.kind === 'armed'
                ? 'Confirm'
                : amount}
      </span>
    </button>
  )
}
