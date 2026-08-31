import { useEffect } from 'react'
import { AlertTriangle, Check, X } from 'lucide-react'
import { HIDDEN_EVENT } from '~/lib/host'
import { clearToasts, dismissToast, useToasts } from '~/lib/toast'

/**
 * The notification stack: centred, dropping down from the top of the terminal.
 *
 * Centred rather than cornered because these are not status chatter — a quick buy that failed is
 * the single most important thing on screen at the moment it happens, and the columns beneath it
 * are moving. Each card times itself out and can be dismissed early.
 */
export function Toasts() {
  const toasts = useToasts()

  // The terminal hides rather than unmounts across a handoff; a notification must not be left
  // floating over fomo's own page after the terminal has gone.
  useEffect(() => {
    window.addEventListener(HIDDEN_EVENT, clearToasts)
    return () => window.removeEventListener(HIDDEN_EVENT, clearToasts)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div className="toast" key={toast.id} data-kind={toast.kind}>
          {toast.kind === 'error' ? (
            <AlertTriangle className="toast-icon" />
          ) : (
            <Check className="toast-icon" />
          )}
          <span className="toast-message">{toast.message}</span>
          <button
            type="button"
            className="toast-close"
            title="Dismiss"
            aria-label="Dismiss"
            onClick={() => dismissToast(toast.id)}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
