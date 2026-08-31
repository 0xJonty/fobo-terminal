import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  CARD_FIELDS,
  CARD_FIELD_HINT,
  CARD_FIELD_LABEL,
  DISPLAY_DEFAULT,
  QUICK_BUY_MAX_USD,
  QUICK_BUY_SIZES,
  QUICK_BUY_SIZE_LABEL,
  type CardField,
  type DisplaySettings as DisplaySettingsValue,
} from '~/lib/displayPrefs'
import { HIDDEN_EVENT } from '~/lib/host'
import { SWAP_MIN_USD } from '~/lib/swap'

/**
 * The Display settings dialog: which data points a token card draws, and how quick buy behaves.
 *
 * Opened from the toolbar popup (the popup only asks — see lib/displayPrefs.ts) and rendered
 * here, inside the terminal, because that is where the cards it describes live: every toggle
 * lands on the columns behind the dialog as it is flipped, with no save step.
 *
 * Like ColumnControls, this never edits its own copy of the state — every interaction calls
 * onChange with the next settings and App owns persistence.
 */

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function DisplaySettings({
  settings,
  onChange,
  onClose,
}: {
  settings: DisplaySettingsValue
  onChange: (next: DisplaySettingsValue) => void
  onClose: () => void
}) {
  // The amount is a raw string while it is being typed, so "1", "1." and an emptied box all
  // round-trip; it commits to the settings on every valid keystroke and is normalised on blur.
  const [amountText, setAmountText] = useState(() => String(settings.quickBuyAmountUsd))
  const panelRef = useRef<HTMLDivElement>(null)

  // Opening the dialog should let Esc close it (and only it) straight away.
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  // The terminal hides rather than unmounts across a handoff; do not come back with the dialog
  // still sitting over fomo's page.
  useEffect(() => {
    window.addEventListener(HIDDEN_EVENT, onClose)
    return () => window.removeEventListener(HIDDEN_EVENT, onClose)
  }, [onClose])

  const setField = (field: CardField, on: boolean) => {
    onChange({ ...settings, fields: { ...settings.fields, [field]: on } })
  }

  const commitAmount = (raw: string) => {
    setAmountText(raw)
    const parsed = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(parsed)) return
    onChange({
      ...settings,
      quickBuyAmountUsd: Math.round(clamp(parsed, SWAP_MIN_USD, QUICK_BUY_MAX_USD) * 100) / 100,
    })
  }

  const amountBad = amountText.trim() !== '' && !Number.isFinite(Number(amountText))

  return (
    <div
      className="dset-backdrop"
      onPointerDown={(event) => {
        // Only a press that starts on the backdrop itself dismisses — a drag that ends there,
        // having started on a control, must not close the dialog under the cursor.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className="dset"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-label="Display settings"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            // Without the stop, Esc would also dismiss the whole terminal.
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <header className="dset-head">
          <h2 className="dset-title">Display settings</h2>
          <button type="button" className="dset-close" title="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </header>

        <div className="dset-body">
          <section className="dset-section">
            <div className="dset-section-label">Token card</div>
            <p className="dset-hint">
              A card only ever draws what its row actually carries — switching a field on cannot
              invent a number fomo did not send.
            </p>
            <div className="dset-fields">
              {CARD_FIELDS.map((field) => (
                <label className="dset-field" key={field}>
                  <input
                    type="checkbox"
                    checked={settings.fields[field]}
                    onChange={(event) => setField(field, event.target.checked)}
                  />
                  <span className="dset-field-label">
                    {CARD_FIELD_LABEL[field]}
                    {CARD_FIELD_HINT[field] && (
                      <span className="dset-field-hint">{CARD_FIELD_HINT[field]}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </section>

          <section className="dset-section">
            <div className="dset-section-label">Quick buy</div>
            <p className="dset-hint">
              One click buys — no confirmation step. Spends the same USDC cash the site&apos;s own
              trade panel spends; its server builds, prices and fees every swap, and the button
              waits for the chain (and Relay, for a token on another chain) before it says filled.
            </p>

            <div className="dset-row">
              <span className="dset-row-label">Button size</span>
              <div className="dset-segment" role="group" aria-label="Quick buy button size">
                {QUICK_BUY_SIZES.map((size) => (
                  <button
                    key={size}
                    type="button"
                    aria-pressed={settings.quickBuySize === size}
                    onClick={() => onChange({ ...settings, quickBuySize: size })}
                  >
                    {QUICK_BUY_SIZE_LABEL[size]}
                  </button>
                ))}
              </div>
            </div>

            <div className="dset-row">
              <span className="dset-row-label">
                Default amount
                <span className="dset-row-hint">
                  USD, minimum ${SWAP_MIN_USD} — each column can override it beside its filter
                </span>
              </span>
              <input
                className="dset-input"
                type="text"
                inputMode="decimal"
                value={amountText}
                data-bad={amountBad ? 'true' : undefined}
                onChange={(event) => commitAmount(event.target.value)}
                onBlur={() => setAmountText(String(settings.quickBuyAmountUsd))}
              />
            </div>
          </section>
        </div>

        <footer className="dset-foot">
          <button type="button" className="dset-reset" onClick={() => onChange(DISPLAY_DEFAULT)}>
            Reset to defaults
          </button>
        </footer>
      </div>
    </div>
  )
}
