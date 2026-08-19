import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Column } from '~/ui/Column'
import { TopBar } from '~/ui/TopBar'
import { MAX_ROWS, applyDiff } from '~/lib/listStore'
import { createFomoSocket, type SocketStatus } from '~/lib/fomoSocket'
import { metricsFor, warm } from '~/lib/mobula'
import { LIST_KEYS, LIST_LABEL, type ListKey } from '~/lib/protocol'
import { tokenKey, type Token } from '~/types/token'

type Lists = Record<ListKey, Token[]>

const EMPTY: Lists = { 'pre-graduated': [], graduated: [], trending: [] }

/** How long a newly inserted row stays highlighted. */
const FRESH_MS = 900

export function App({ onOpen }: { onOpen: (href: string) => void }) {
  const [lists, setLists] = useState<Lists>(EMPTY)
  const [status, setStatus] = useState<SocketStatus>('connecting')
  const [freshKeys, setFreshKeys] = useState<ReadonlySet<string>>(new Set())
  const freshTimers = useRef(new Map<string, number>())

  const markFresh = useCallback((key: string) => {
    setFreshKeys((current) => {
      if (current.has(key)) return current
      const next = new Set(current)
      next.add(key)
      return next
    })

    const timers = freshTimers.current
    const existing = timers.get(key)
    if (existing) window.clearTimeout(existing)
    timers.set(
      key,
      window.setTimeout(() => {
        timers.delete(key)
        setFreshKeys((current) => {
          if (!current.has(key)) return current
          const next = new Set(current)
          next.delete(key)
          return next
        })
      }, FRESH_MS),
    )
  }, [])

  // One socket, all three topics. See lib/fomoSocket.ts for why we connect rather than observe.
  useEffect(() => {
    const close = createFomoSocket({
      onStatus: setStatus,
      onDiff: (list, diff) => {
        if (diff.kind === 'new') {
          const raw = diff.update as { token?: { address?: string; networkId?: number } }
          const address = raw?.token?.address
          const networkId = raw?.token?.networkId
          if (typeof address === 'string' && typeof networkId === 'number') {
            markFresh(tokenKey(address, networkId))
          }
        }
        setLists((current) => ({ ...current, [list]: applyDiff(current[list], diff) }))
      },
    })
    return close
  }, [markFresh])

  useEffect(() => {
    const timers = freshTimers.current
    return () => {
      for (const id of timers.values()) window.clearTimeout(id)
      timers.clear()
    }
  }, [])

  // Warm Mobula for whichever chains are actually on screen, then re-render when it lands.
  const [enrichStamp, setEnrichStamp] = useState(0)
  const networkIds = useMemo(() => {
    const ids = new Set<number>()
    for (const key of LIST_KEYS) {
      for (const token of lists[key].slice(0, MAX_ROWS)) ids.add(token.networkId)
    }
    return [...ids].sort().join(',')
  }, [lists])

  useEffect(() => {
    if (!networkIds) return
    const ids = networkIds.split(',').map(Number)

    warm(ids)
    const settle = window.setTimeout(() => setEnrichStamp((n) => n + 1), 2_000)
    const id = window.setInterval(() => {
      warm(ids)
      setEnrichStamp((n) => n + 1)
    }, 30_000)
    return () => {
      window.clearTimeout(settle)
      window.clearInterval(id)
    }
  }, [networkIds])

  /**
   * Left join: fomo owns membership and order, Mobula only decorates.
   * The 100-row cap is applied here, at the render boundary, exactly as fomo does it.
   */
  const enriched = useMemo(() => {
    void enrichStamp
    const decorate = (rows: Token[]) =>
      rows.slice(0, MAX_ROWS).map((token) => {
        const metrics = metricsFor(token.key, token.networkId)
        return metrics ? { ...token, metrics } : token
      })
    return {
      'pre-graduated': decorate(lists['pre-graduated']),
      graduated: decorate(lists.graduated),
      trending: decorate(lists.trending),
    } satisfies Lists
  }, [lists, enrichStamp])

  const open = useCallback(
    (token: Token) => {
      // Navigation mechanics (client-side pushState with a full-load fallback) and the handoff
      // bookkeeping both live in content/index.tsx — this only builds the href. Nothing is
      // dismissed on the way out, so Back remounts the terminal.
      onOpen(`/tokens/${token.chain}/${token.address}`)
    },
    [onOpen],
  )

  const totalRows = LIST_KEYS.reduce((sum, key) => sum + lists[key].length, 0)

  return (
    <div className="shell">
      <TopBar status={status} onNavigate={onOpen} />

      <div className="columns">
        {LIST_KEYS.map((key) => (
          <Column
            key={key}
            title={LIST_LABEL[key]}
            tokens={enriched[key]}
            loading={totalRows === 0 && status !== 'unauthenticated'}
            showBond={key === 'pre-graduated'}
            freshKeys={freshKeys}
            onOpen={open}
          />
        ))}
      </div>
    </div>
  )
}
