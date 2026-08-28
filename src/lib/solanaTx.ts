/**
 * Just enough of Solana's transaction wire format to add one signature to a transaction
 * somebody else built.
 *
 * fomo's server builds the swap, simulates it, and signs it as fee payer; the only thing
 * missing is the user's own signature (see lib/swap.ts). Pulling in @solana/web3.js to splice
 * 64 bytes into a byte array would cost ~120KB of bundle for three field reads, so the format
 * is parsed here instead. It is a fixed, versioned encoding — not a guess:
 *
 *     [compact-u16 signature count][64 bytes x count][message]
 *     message = [0x80|version]?     legacy messages have no prefix byte
 *               [numRequiredSignatures][numReadonlySigned][numReadonlyUnsigned]
 *               [compact-u16 static key count][32 bytes x count]
 *               ...
 *
 * The first `numRequiredSignatures` static keys are the signers, in the same order as the
 * signature slots — which is what lets an address pick out the slot it owns.
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

const PUBKEY_BYTES = 32
const SIGNATURE_BYTES = 64
/** Message header: signers, readonly signers, readonly non-signers. */
const HEADER_BYTES = 3

export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''

  // Leading zero bytes are not carried by the arithmetic below; base58 spells each as "1".
  let zeros = 0
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1

  // Starts EMPTY, not [0]: a seeded zero digit survives to the end for an all-zero input and
  // spells one "1" too many.
  const digits: number[] = []
  for (let i = zeros; i < bytes.length; i += 1) {
    let carry = bytes[i]!
    for (let j = 0; j < digits.length; j += 1) {
      carry += digits[j]! << 8
      digits[j] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }

  let out = '1'.repeat(zeros)
  for (let i = digits.length - 1; i >= 0; i -= 1) out += BASE58_ALPHABET[digits[i]!]
  return out
}

export function base64Decode(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function base64Encode(bytes: Uint8Array): string {
  let binary = ''
  // Chunked: String.fromCharCode(...bytes) blows the argument limit on a big transaction.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/**
 * Solana's compact-u16 (shortvec): 7 bits per byte, little-endian, high bit continues.
 * Returns the value and the offset just past it, or null if the bytes run out.
 */
export function readCompactU16(bytes: Uint8Array, offset: number): { value: number; next: number } | null {
  let value = 0
  let shift = 0
  let cursor = offset
  for (let i = 0; i < 3; i += 1) {
    const byte = bytes[cursor]
    if (byte === undefined) return null
    cursor += 1
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value, next: cursor }
    shift += 7
  }
  return null
}

export interface ParsedTransaction {
  /** Offset of the first signature byte. */
  signaturesOffset: number
  /** How many 64-byte signature slots the transaction carries. */
  signatureCount: number
  /** Offset of the first message byte — everything the signature covers. */
  messageOffset: number
  /** Signer addresses, base58, in signature-slot order. */
  signers: string[]
}

/**
 * Read the parts needed to place a signature. Returns null for anything that does not parse,
 * so a shape we do not understand fails loudly at the call site instead of producing a
 * transaction with a signature written over the wrong bytes.
 */
export function parseTransaction(bytes: Uint8Array): ParsedTransaction | null {
  const header = readCompactU16(bytes, 0)
  if (!header) return null
  const { value: signatureCount, next: signaturesOffset } = header
  if (signatureCount === 0) return null

  const messageOffset = signaturesOffset + signatureCount * SIGNATURE_BYTES
  if (messageOffset >= bytes.length) return null

  // A versioned message leads with 0x80|version; a legacy one starts straight at the header,
  // whose first byte (the signer count) is always well under 0x80.
  let cursor = messageOffset
  if ((bytes[cursor]! & 0x80) !== 0) cursor += 1

  const numRequiredSignatures = bytes[cursor]
  if (numRequiredSignatures === undefined) return null
  cursor += HEADER_BYTES

  const keys = readCompactU16(bytes, cursor)
  if (!keys) return null
  cursor = keys.next
  if (numRequiredSignatures > keys.value) return null
  if (cursor + keys.value * PUBKEY_BYTES > bytes.length) return null

  // Only the signers matter here; the rest of the static keys are never addressed by slot.
  const signers: string[] = []
  for (let i = 0; i < numRequiredSignatures; i += 1) {
    signers.push(base58Encode(bytes.subarray(cursor, cursor + PUBKEY_BYTES)))
    cursor += PUBKEY_BYTES
  }

  return { signaturesOffset, signatureCount, messageOffset, signers }
}

/** The bytes a signer signs: the message, without the signature array in front of it. */
export function messageBytes(bytes: Uint8Array, parsed: ParsedTransaction): Uint8Array {
  return bytes.subarray(parsed.messageOffset)
}

/** Which signature slot belongs to `address`, or -1 when it is not a signer at all. */
export function signatureSlot(parsed: ParsedTransaction, address: string): number {
  return parsed.signers.indexOf(address)
}

/**
 * A copy of the transaction with one signature slot filled in. Copying rather than mutating
 * keeps the original quote intact for a retry.
 */
export function withSignature(
  bytes: Uint8Array,
  parsed: ParsedTransaction,
  slot: number,
  signature: Uint8Array,
): Uint8Array | null {
  if (slot < 0 || slot >= parsed.signatureCount) return null
  if (signature.length !== SIGNATURE_BYTES) return null
  const next = new Uint8Array(bytes)
  next.set(signature, parsed.signaturesOffset + slot * SIGNATURE_BYTES)
  return next
}

/** The transaction's id: base58 of its first signature, exactly what an explorer wants. */
export function transactionSignature(bytes: Uint8Array, parsed: ParsedTransaction): string {
  return base58Encode(
    bytes.subarray(parsed.signaturesOffset, parsed.signaturesOffset + SIGNATURE_BYTES),
  )
}
