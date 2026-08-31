import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canQuickBuy,
  hasEnoughCash,
  quoteBuy,
  SWAP_MIN_USD,
  usdToBaseUnits,
  USDC_SOL_TOKEN_ID,
} from '~/lib/swap'
import type { Token } from '~/types/token'

function token(overrides: Partial<Token> = {}): Token {
  return {
    key: 'So11111111111111111111111111111111111111112:1399811149',
    address: 'So11111111111111111111111111111111111111112',
    networkId: 1399811149,
    chain: 'solana',
    symbol: 'WSOL',
    name: 'Wrapped SOL',
    ...overrides,
  }
}

const SOLANA_TX = { tx: 'AAAA', feePayerSignature: 'BBBB', feePayerAddress: 'FeePayer111' }

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  window.localStorage.setItem('privy:token', JSON.stringify('jwt-token'))
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

function reply(body: unknown, status = 200) {
  fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body })
}

describe('quoteBuy request', () => {
  it('always spends the Solana USDC cash rail, whatever chain the token is on', async () => {
    reply({ success: true, responseObject: { v1Swap: { swapTransaction: 'AAAA', ...SOLANA_TX } } })
    await quoteBuy(token({ address: '0xabc', networkId: 56, chain: 'bnb' }), 25)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://prod-api.fomo.family/swaps/v2')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.inTokenId).toBe(USDC_SOL_TOKEN_ID)
    expect(body.outTokenId).toBe('0xabc:56')
    expect(body.amount).toBe('25000000')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-token')
  })

  it('refuses an amount below the server floor without asking', async () => {
    const result = await quoteBuy(token(), SWAP_MIN_USD - 0.01)
    expect(result).toEqual({ ok: false, message: `Minimum is $${SWAP_MIN_USD}` })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses when there is no session', async () => {
    window.localStorage.clear()
    const result = await quoteBuy(token(), 10)
    expect(result).toEqual({ ok: false, message: 'Signed out of fomo' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('quoteBuy routes', () => {
  it('reads a same-chain Solana swap, tip transaction and all', async () => {
    reply({
      success: true,
      responseObject: {
        v1Swap: {
          swapTransaction: 'AAAA',
          feePayerSignature: 'BBBB',
          feePayerAddress: 'FeePayer111',
          jitoTipTx: 'TIP',
          expectedOutHumanAmount: 12.5,
          swapUsdValue: 9.98,
          flatFee: 0.2,
          feeTierBps: 0,
        },
      },
    })
    const result = await quoteBuy(token(), 10)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.quote.transaction).toBe('AAAA')
    expect(result.quote.jitoTipTx).toBe('TIP')
    expect(result.quote.expectedOutHumanAmount).toBe(12.5)
    // Same chain: nothing to wait on beyond the transaction itself.
    expect(result.quote.relaySwapId).toBeUndefined()
  })

  it('reads a cross-chain buy as the same Solana transaction plus a relay id', async () => {
    reply({
      success: true,
      responseObject: {
        v2Swap: {
          relayTransaction: { type: 'SOLANA', ...SOLANA_TX, lastValidBlockHeight: 42 },
          relaySwapId: '0xrelay',
          expectedOutHumanAmount: 89.3,
          feeTierBps: 45,
        },
      },
    })
    const result = await quoteBuy(token({ address: '0xabc', networkId: 56 }), 5)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.quote.transaction).toBe('AAAA')
    expect(result.quote.feePayerAddress).toBe('FeePayer111')
    // The relay leg is what makes "filled" mean the token actually arrived.
    expect(result.quote.relaySwapId).toBe('0xrelay')
    expect(result.quote.feeTierBps).toBe(45)
  })

  it('refuses an EVM-origin route rather than half-handling it', async () => {
    reply({
      success: true,
      responseObject: {
        v2Swap: {
          relayTransaction: { type: 'EVM', depositTransaction: { to: '0x1', data: '0x', chainId: 56 } },
          relaySwapId: '0xrelay',
        },
      },
    })
    expect(await quoteBuy(token({ address: '0xabc', networkId: 56 }), 5)).toEqual({
      ok: false,
      message: 'Unsupported swap route',
    })
  })

  it('treats a relay route with no id as incomplete', async () => {
    reply({
      success: true,
      responseObject: { v2Swap: { relayTransaction: { type: 'SOLANA', ...SOLANA_TX } } },
    })
    expect(await quoteBuy(token(), 5)).toEqual({ ok: false, message: 'Incomplete quote' })
  })

  it('treats a swap missing its fee-payer signature as incomplete', async () => {
    reply({ success: true, responseObject: { v1Swap: { swapTransaction: 'AAAA' } } })
    expect(await quoteBuy(token(), 5)).toEqual({ ok: false, message: 'Incomplete quote' })
  })
})

describe('quoteBuy errors', () => {
  it("shows the server's own short message", async () => {
    reply({ success: false, message: 'Swap value $1.00 is below minimum $2.00' }, 400)
    expect(await quoteBuy(token(), 10)).toEqual({
      ok: false,
      message: 'Swap value $1.00 is below minimum $2.00',
    })
  })

  /**
   * The real 422 seen in use: six kilobytes of program log with the reason on one line of it.
   * Reported verbatim it is unreadable; collapsed to "simulation failed" it is useless. The
   * program's own sentence is the thing worth surfacing.
   */
  it("digs the program's own reason out of a reverted simulation", async () => {
    const log = [
      'Swap simulation reverted on-chain: dflow_creator_rewards_bps: Error: ',
      '{"InstructionError":["2",{"Custom":"15001"}]}, # of accounts: ,, logs: [',
      '"Program ComputeBudget111111111111111111111111111111 invoke [1]",',
      '"Program log: Instruction: Swap",',
      `"${'Program log: filler '.repeat(200)}",`,
      '"Program log: AnchorError occurred. Error Code: SlippageLimitExceeded. Error Number: ',
      '15001. Error Message: Slippage limit exceeded.",',
      '"Program DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH failed: custom program error: 0x3a99"]',
    ].join('')
    reply({ success: false, errorCode: 'ERR_SWAP_SIMULATION_REVERTED', message: log }, 422)
    expect(await quoteBuy(token(), 10)).toEqual({
      ok: false,
      message: 'Slippage limit exceeded — try again or use a larger amount',
    })
  })

  it('names an empty wallet when the log actually says so', async () => {
    const log = `Swap simulation reverted on-chain: ${'y'.repeat(3000)} Program log: Error: insufficient funds ${'z'.repeat(1000)}`
    reply({ success: false, message: log }, 422)
    expect(await quoteBuy(token(), 10)).toEqual({
      ok: false,
      message: 'Not enough cash for this swap',
    })
  })

  it('falls back to a plain sentence when the log says nothing recognisable', async () => {
    reply({ success: false, message: `Swap simulation reverted on-chain: ${'x'.repeat(4000)}` }, 422)
    expect(await quoteBuy(token(), 10)).toEqual({
      ok: false,
      message: 'The swap could not be built — try again',
    })
  })

  it('names an expired session rather than a status code', async () => {
    reply({ success: false }, 401)
    expect(await quoteBuy(token(), 10)).toEqual({ ok: false, message: 'Signed out of fomo' })
  })

  it('survives a network failure', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    expect(await quoteBuy(token(), 10)).toEqual({ ok: false, message: 'Network error' })
  })
})

describe('canQuickBuy', () => {
  it('covers every chain the site lists, and nothing else', () => {
    for (const networkId of [1, 56, 143, 4663, 8453, 1399811149]) {
      expect(canQuickBuy(token({ networkId }))).toBe(true)
    }
    expect(canQuickBuy(token({ networkId: 999999 }))).toBe(false)
  })
})

describe('hasEnoughCash', () => {
  it('blocks only when the shortfall is known', () => {
    expect(hasEnoughCash(0.006, 10)).toBe(false)
    expect(hasEnoughCash(10, 10)).toBe(true)
    expect(hasEnoughCash(25, 10)).toBe(true)
    // Balances not loaded: the server is the authority, so the buy goes ahead and it decides.
    expect(hasEnoughCash(undefined, 10)).toBeNull()
  })
})

describe('usdToBaseUnits', () => {
  it('converts dollars to USDC base units, rounding rather than truncating', () => {
    expect(usdToBaseUnits(10)).toBe('10000000')
    expect(usdToBaseUnits(2)).toBe('2000000')
    // 0.1 * 1e6 lands at 100000.00000000001 in binary floating point.
    expect(usdToBaseUnits(0.1)).toBe('100000')
    expect(usdToBaseUnits(1.005)).toBe('1005000')
  })
})
