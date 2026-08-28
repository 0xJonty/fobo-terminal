import { describe, expect, it } from 'vitest'
import {
  base58Encode,
  base64Decode,
  base64Encode,
  messageBytes,
  parseTransaction,
  readCompactU16,
  signatureSlot,
  transactionSignature,
  withSignature,
} from '~/lib/solanaTx'

/**
 * The wire format is parsed by hand rather than with @solana/web3.js (see the module header),
 * so these fixtures are the safety net: a transaction is built byte by byte here, and the
 * parser has to find the same signers and the same message the builder put in.
 */

const SIGNATURE_BYTES = 64
const PUBKEY_BYTES = 32

function compactU16(value: number): number[] {
  const out: number[] = []
  let rest = value
  for (;;) {
    if (rest < 0x80) {
      out.push(rest)
      return out
    }
    out.push((rest & 0x7f) | 0x80)
    rest >>>= 7
  }
}

function key(seed: number): Uint8Array {
  return Uint8Array.from({ length: PUBKEY_BYTES }, (_, i) => (seed * 31 + i) & 0xff)
}

/** A minimal but structurally real v0 transaction with `signers` signature slots. */
function buildTransaction(signers: Uint8Array[], extraKeys: Uint8Array[] = [], versioned = true): Uint8Array {
  const keys = [...signers, ...extraKeys]
  const bytes: number[] = [
    ...compactU16(signers.length),
    ...new Array<number>(signers.length * SIGNATURE_BYTES).fill(0),
  ]
  if (versioned) bytes.push(0x80)
  bytes.push(signers.length, 0, extraKeys.length)
  bytes.push(...compactU16(keys.length))
  for (const k of keys) bytes.push(...k)
  // Stand-in for the blockhash and instructions — the parser never reads past the keys.
  bytes.push(...new Array<number>(32).fill(7))
  return Uint8Array.from(bytes)
}

describe('readCompactU16', () => {
  it('reads one-, two- and three-byte values', () => {
    expect(readCompactU16(Uint8Array.from([0x00]), 0)).toEqual({ value: 0, next: 1 })
    expect(readCompactU16(Uint8Array.from([0x7f]), 0)).toEqual({ value: 127, next: 1 })
    expect(readCompactU16(Uint8Array.from([0x80, 0x01]), 0)).toEqual({ value: 128, next: 2 })
    expect(readCompactU16(Uint8Array.from([0xff, 0xff, 0x03]), 0)).toEqual({ value: 65535, next: 3 })
  })

  it('is null when the bytes run out', () => {
    expect(readCompactU16(Uint8Array.from([0x80]), 0)).toBeNull()
    expect(readCompactU16(Uint8Array.from([]), 0)).toBeNull()
  })
})

describe('base58Encode', () => {
  it('matches known vectors', () => {
    expect(base58Encode(Uint8Array.from([0]))).toBe('1')
    expect(base58Encode(Uint8Array.from([0, 0, 1]))).toBe('112')
    // The system program's all-zero id is 32 ones, which is exactly the leading-zero rule.
    expect(base58Encode(new Uint8Array(32))).toBe('1'.repeat(32))
    expect(base58Encode(Uint8Array.from([1, 2, 3]))).toBe('Ldp')
  })

  it('is empty for no bytes', () => {
    expect(base58Encode(new Uint8Array(0))).toBe('')
  })
})

describe('base64', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = Uint8Array.from({ length: 512 }, (_, i) => (i * 7) & 0xff)
    expect(base64Decode(base64Encode(bytes))).toEqual(bytes)
  })
})

describe('parseTransaction', () => {
  it('finds the signers of a versioned transaction, in slot order', () => {
    const signers = [key(1), key(2)]
    const parsed = parseTransaction(buildTransaction(signers, [key(9)]))
    expect(parsed).not.toBeNull()
    expect(parsed!.signatureCount).toBe(2)
    expect(parsed!.signers).toEqual([base58Encode(signers[0]!), base58Encode(signers[1]!)])
  })

  it('handles a legacy (unversioned) message', () => {
    const signers = [key(3)]
    const parsed = parseTransaction(buildTransaction(signers, [], false))
    expect(parsed!.signers).toEqual([base58Encode(signers[0]!)])
  })

  it('is null for bytes that are not a transaction', () => {
    expect(parseTransaction(new Uint8Array(0))).toBeNull()
    // Claims one signature but carries no message after it.
    expect(parseTransaction(Uint8Array.from([1, ...new Array<number>(64).fill(0)]))).toBeNull()
    // Claims more signers than there are static keys.
    const bytes = Uint8Array.from([
      1,
      ...new Array<number>(64).fill(0),
      0x80,
      4,
      0,
      0,
      1,
      ...key(1),
    ])
    expect(parseTransaction(bytes)).toBeNull()
  })
})

describe('signatureSlot', () => {
  it('picks the slot an address owns, and rejects one it does not', () => {
    const signers = [key(1), key(2)]
    const parsed = parseTransaction(buildTransaction(signers))!
    expect(signatureSlot(parsed, base58Encode(signers[1]!))).toBe(1)
    expect(signatureSlot(parsed, base58Encode(key(99)))).toBe(-1)
  })
})

describe('withSignature', () => {
  const signers = [key(1), key(2)]
  const tx = buildTransaction(signers)
  const parsed = parseTransaction(tx)!
  const signature = Uint8Array.from({ length: SIGNATURE_BYTES }, (_, i) => (i + 1) & 0xff)

  it('writes into the right slot and leaves the message untouched', () => {
    const next = withSignature(tx, parsed, 1, signature)!
    const start = parsed.signaturesOffset + SIGNATURE_BYTES
    expect(next.subarray(start, start + SIGNATURE_BYTES)).toEqual(signature)
    // Slot 0 is still empty, and the message is byte-identical.
    expect(next.subarray(parsed.signaturesOffset, start)).toEqual(new Uint8Array(SIGNATURE_BYTES))
    expect(messageBytes(next, parsed)).toEqual(messageBytes(tx, parsed))
  })

  it('copies rather than mutating, so a quote survives a retry', () => {
    withSignature(tx, parsed, 0, signature)
    expect(tx.subarray(parsed.signaturesOffset, parsed.signaturesOffset + SIGNATURE_BYTES)).toEqual(
      new Uint8Array(SIGNATURE_BYTES),
    )
  })

  it('refuses a bad slot or a wrong-length signature', () => {
    expect(withSignature(tx, parsed, 2, signature)).toBeNull()
    expect(withSignature(tx, parsed, -1, signature)).toBeNull()
    expect(withSignature(tx, parsed, 0, new Uint8Array(63))).toBeNull()
  })
})

describe('transactionSignature', () => {
  it('is base58 of the first signature slot', () => {
    const tx = buildTransaction([key(1), key(2)])
    const parsed = parseTransaction(tx)!
    const signature = Uint8Array.from({ length: SIGNATURE_BYTES }, (_, i) => (i + 3) & 0xff)
    const signed = withSignature(tx, parsed, 0, signature)!
    expect(transactionSignature(signed, parsed)).toBe(base58Encode(signature))
  })
})
