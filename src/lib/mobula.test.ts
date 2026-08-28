import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The enrichment client's failure path. The module holds per-chain caches, a failure ladder
 * and a one-warning-per-streak flag in module scope, so every test imports it fresh.
 */

const SOL = 1399811149
const KEY = `abc:${SOL}`

function pulseBody() {
  return {
    new: { data: [{ address: 'abc', holdersCount: 42, top10Holdings: 12 }] },
    bonding: { data: [] },
    bonded: { data: [] },
  }
}

function okResponse() {
  return { ok: true, status: 200, json: async () => pulseBody() } as unknown as Response
}

function statusResponse(status: number) {
  return { ok: false, status, json: async () => ({}) } as unknown as Response
}

async function loadModule() {
  vi.resetModules()
  return import('~/lib/mobula')
}

/** Let the retry's timer and the promise chain settle. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(2_000)
}

let fetchMock: ReturnType<typeof vi.fn>
let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  warn.mockRestore()
})

describe('warm', () => {
  it('retries once after a transport failure and keeps the metrics', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(okResponse())
    const { metricsFor, warm } = await loadModule()

    warm([SOL])
    await settle()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(metricsFor(KEY, SOL)?.holdersCount).toBe(42)
    expect(warn).not.toHaveBeenCalled()
  })

  it('retries a server fault but not an answer the server actually gave', async () => {
    fetchMock.mockResolvedValue(statusResponse(503))
    const server = await loadModule()
    server.warm([SOL])
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(statusResponse(404))
    const client = await loadModule()
    client.warm([SOL])
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('names the cause in one warning per streak, with the next attempt', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { warm } = await loadModule()

    warm([SOL])
    await settle()

    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0]?.[0])
    expect(message).toContain('never completed')
    expect(message).toContain('next attempt in 30s')
    // The old wording blamed a CSP that fomo's own header provably allows.
    expect(message).not.toContain('CSP or network')
  })

  it('reports a status the server answered rather than a transport failure', async () => {
    fetchMock.mockResolvedValue(statusResponse(502))
    const { warm } = await loadModule()

    warm([SOL])
    await settle()

    expect(String(warn.mock.calls[0]?.[0])).toContain('the server answered 502')
  })

  it('holds a failed chain off until its backoff expires, then lets it retry', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { warm } = await loadModule()

    warm([SOL])
    await settle()
    const afterFirst = fetchMock.mock.calls.length

    // Still inside the 30s ladder: nothing goes out.
    warm([SOL])
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(afterFirst)

    await vi.advanceTimersByTimeAsync(31_000)
    warm([SOL])
    await settle()
    expect(fetchMock.mock.calls.length).toBeGreaterThan(afterFirst)
  })
})
