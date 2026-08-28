import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, X, Zap } from 'lucide-react'
import { HIDDEN_EVENT } from '~/lib/host'
import { balances } from '~/lib/session'
import { signWithPageWallet } from '~/lib/sign'
import { quoteBuy, signAndSubmit, SOLANA_NETWORK_ID } from '~/lib/swap'
import type { QuickBuySize } from '~/lib/displayPrefs'
import type { Token } from '~/types/token'

/**
 * The card's buy control: one click spends a fixed amount of the same USDC cash fomo's own
 * trade panel spends, on the row under the cursor.
 *
 * This is the only control in the terminal that moves money, so it is deliberately louder than
 * the rest of the UI about what it just did. It never claims a fill: the swap is submitted, and
 * "sent" is all we can honestly say from here — fomo's balances (already polled) are what
 * confirm it, so a success nudges them to refresh rather than inventing a confirmation.
 *
 * Only Solana rows render one. fomo routes EVM buys through a cross-chain relay wanting an EVM
 * signature; the button being absent is better than a button that always errors.
 */

/** How long a finished state (sent / failed) stays on the button before it resets. */
const RESULT_MS = 6_000
/** How long an armed button waits for the confirming click. */
const ARM_MS = 4_000
/** Balances lag the chain; nudge them twice rather than once. */
const REFRESH_DELAYS_MS = [4_000, 12_000]

type Phase =
  | { kind: 'idle' }
  | { kind: 'armed' }
  | { kind: 'busy' }
  | { kind: 'sent'; signature: string }
  | { kind: 'failed'; message: string }

export function canQuickBuy(token: Token): boolean {
  return token.networkId === SOLANA_NETWORK_ID
}

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
  // Carrying a "sent" tick onto another row would be a lie about that row.
  useEffect(() => setPhase({ kind: 'idle' }), [token.key])

  // A buy in flight must not be reported onto an unmounted (or recycled) button.
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  // Timers for the armed window and the result reset, cleared together.
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

  const buy = useCallback(async () => {
    setPhase({ kind: 'busy' })

    const quoted = await quoteBuy(token, amountUsd)
    if (!live.current) return
    if (!quoted.ok) {
      setPhase({ kind: 'failed', message: quoted.message })
      resetLater({ kind: 'idle' }, RESULT_MS)
      return
    }

    const sent = await signAndSubmit(quoted.quote, signWithPageWallet)
    if (!live.current) return
    if (!sent.ok) {
      setPhase({ kind: 'failed', message: sent.message })
      resetLater({ kind: 'idle' }, RESULT_MS)
      return
    }

    setPhase({ kind: 'sent', signature: sent.signature })
    resetLater({ kind: 'idle' }, RESULT_MS)
    for (const delay of REFRESH_DELAYS_MS) window.setTimeout(() => balances.refresh(), delay)
  }, [token, amountUsd, resetLater])

  const click = (event: React.MouseEvent) => {
    // The whole row is a link into fomo's coin page. Buying must not navigate.
    event.preventDefault()
    event.stopPropagation()

    if (phase.kind === 'busy') return
    if (confirm && phase.kind !== 'armed') {
      setPhase({ kind: 'armed' })
      resetLater({ kind: 'idle' }, ARM_MS)
      return
    }
    void buy()
  }

  const amount = label(amountUsd)
  const title =
    phase.kind === 'sent'
      ? `Sent — ${phase.signature}`
      : phase.kind === 'failed'
        ? phase.message
        : phase.kind === 'armed'
          ? `Click again to buy ${amount} of ${token.symbol || token.name}`
          : `Buy ${amount} of ${token.symbol || token.name}`

  return (
    <button
      type="button"
      className="qbuy"
      data-size={size}
      data-phase={phase.kind}
      title={title}
      aria-label={title}
      disabled={phase.kind === 'busy'}
      onClick={click}
      // The row's own handler runs on click; stopping the pointer here as well keeps a
      // press-and-drag on the button from starting anything on the row underneath.
      onPointerDown={(event) => event.stopPropagation()}
    >
      {phase.kind === 'busy' ? (
        <Loader2 className="qbuy-icon qbuy-spin" />
      ) : phase.kind === 'sent' ? (
        <Check className="qbuy-icon" />
      ) : phase.kind === 'failed' ? (
        <X className="qbuy-icon" />
      ) : (
        <Zap className="qbuy-icon" />
      )}
      <span className="qbuy-label">
        {phase.kind === 'sent'
          ? 'Sent'
          : phase.kind === 'failed'
            ? 'Failed'
            : phase.kind === 'armed'
              ? 'Confirm'
              : amount}
      </span>
    </button>
  )
}
