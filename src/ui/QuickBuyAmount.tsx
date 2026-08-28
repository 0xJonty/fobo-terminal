import { useEffect, useRef, useState } from 'react'
import {
  amountForList,
  clampAmount,
  displayStore,
  useDisplaySettings,
} from '~/lib/displayPrefs'
import type { ListKey } from '~/lib/protocol'

/**
 * The buy size for one column, sitting beside its filter button.
 *
 * Per column on purpose: sizing is not one number in practice — small on fresh bonding pairs,
 * larger on Trending — and having to open a dialog to change it between two clicks would defeat
 * the point of a quick buy. A column with no amount of its own shows, and follows, the default
 * from Display settings; typing here pins that column to its own.
 *
 * The value commits as it is typed (so the buttons below update live) but the BOX keeps the raw
 * string until blur, which is what lets "1", "1." and an emptied field exist on the way to a
 * real number.
 */
export function QuickBuyAmount({ list }: { list: ListKey }) {
  const settings = useDisplaySettings()
  const committed = amountForList(settings, list)
  const overridden = settings.quickBuyAmountByList[list] !== undefined

  const [text, setText] = useState(() => String(committed))
  const [editing, setEditing] = useState(false)

  // While the box is not being typed in it mirrors the settings — a change from the dialog, or
  // from another window, has to show up here rather than leaving a stale figure on screen.
  const textRef = useRef(text)
  textRef.current = text
  useEffect(() => {
    if (!editing && textRef.current !== String(committed)) setText(String(committed))
  }, [committed, editing])

  const commit = (raw: string) => {
    setText(raw)
    const parsed = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(parsed)) return
    displayStore.set({
      ...settings,
      quickBuyAmountByList: { ...settings.quickBuyAmountByList, [list]: clampAmount(parsed) },
    })
  }

  /** Clearing the box hands the column back to the default rather than leaving it blank. */
  const finish = () => {
    setEditing(false)
    if (text.trim() === '' || !Number.isFinite(Number(text))) {
      const { [list]: _dropped, ...rest } = settings.quickBuyAmountByList
      displayStore.set({ ...settings, quickBuyAmountByList: rest })
      setText(String(settings.quickBuyAmountUsd))
      return
    }
    setText(String(clampAmount(Number(text))))
  }

  return (
    <label
      className="colamt"
      data-custom={overridden ? 'true' : undefined}
      title={
        overridden
          ? `Quick buy spends $${committed} in this column — clear the box to follow the default`
          : `Quick buy spends the default $${committed} — type here to set this column's own`
      }
    >
      <span className="colamt-mark">$</span>
      <input
        className="colamt-input"
        type="text"
        inputMode="decimal"
        aria-label="Quick buy amount for this column"
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(event) => commit(event.target.value)}
        onBlur={finish}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            // Esc belongs to the box while it has focus; unguarded it dismisses the terminal.
            event.stopPropagation()
            setText(String(committed))
            event.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}
