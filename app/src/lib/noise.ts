// Noise_NK protocol implementation for browser
// NK pattern: N = no initiator static, K = responder static known to initiator
// -> e, es (client sends ephemeral, derives shared secret with server's static)
// <- e, ee (server sends ephemeral, derive shared secret)

import { sha256 } from '@noble/hashes/sha2.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { randomBytes, bytesToHex, hexToBytes } from '@noble/hashes/utils.js'

// ChaCha20-Poly1305 AEAD (noise requires this)
// Using a simple implementation compatible with browser SubtleCrypto
const CHACHA_KEY_SIZE = 32
const CHACHA_NONCE_SIZE = 12
const CHACHA_TAG_SIZE = 16

interface CipherState {
  key: Uint8Array
  nonce: bigint
}

interface SymmetricState {
  ck: Uint8Array // chaining key
  h: Uint8Array  // handshake hash
  cipher: CipherState | null
}

interface HandshakeState {
  ss: SymmetricState
  s: { priv: Uint8Array; pub: Uint8Array } | null // local static (null for NK initiator)
  e: { priv: Uint8Array; pub: Uint8Array } | null // local ephemeral
  rs: Uint8Array | null // remote static (known for NK)
  re: Uint8Array | null // remote ephemeral
  initiator: boolean
  messageIndex: number
}

// Noise constants
const PROTOCOL_NAME = 'Noise_NK_25519_ChaChaPoly_SHA256'
const MAX_NONCE = 0xffffffffffffffffn

// Helper: concat bytes
function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLen = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLen)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

// HKDF for key derivation
function hkdfSha256(salt: Uint8Array, ikm: Uint8Array, length: number): Uint8Array {
  return hkdf(sha256, ikm, salt, undefined, length)
}

// Initialize cipher state
function initCipherState(): CipherState {
  return { key: new Uint8Array(CHACHA_KEY_SIZE), nonce: 0n }
}

// Set cipher key
function setCipherKey(cs: CipherState, key: Uint8Array): void {
  cs.key = key
  cs.nonce = 0n
}

// Encrypt with AEAD
async function encrypt(cs: CipherState, ad: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  if (cs.nonce >= MAX_NONCE) throw new Error('nonce overflow')

  // Build nonce: 4 bytes zero + 8 bytes little-endian counter
  const nonce = new Uint8Array(CHACHA_NONCE_SIZE)
  const view = new DataView(nonce.buffer)
  view.setBigUint64(4, cs.nonce, true)

  // Note: browsers don't support ChaCha20-Poly1305 natively in SubtleCrypto
  // We use a pure JS implementation via @noble/ciphers
  const ciphertext = await chachaPoly1305Encrypt(cs.key, nonce, plaintext, ad)

  cs.nonce++
  return ciphertext
}

// Decrypt with AEAD
async function decrypt(cs: CipherState, ad: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
  if (cs.nonce >= MAX_NONCE) throw new Error('nonce overflow')

  const nonce = new Uint8Array(CHACHA_NONCE_SIZE)
  const view = new DataView(nonce.buffer)
  view.setBigUint64(4, cs.nonce, true)

  const plaintext = await chachaPoly1305Decrypt(cs.key, nonce, ciphertext, ad)

  cs.nonce++
  return plaintext
}

// Initialize symmetric state
function initSymmetricState(): SymmetricState {
  const protocolBytes = new TextEncoder().encode(PROTOCOL_NAME)
  let h: Uint8Array

  if (protocolBytes.length <= 32) {
    h = new Uint8Array(32)
    h.set(protocolBytes)
  } else {
    h = sha256(protocolBytes)
  }

  return {
    ck: h.slice(),
    h: h.slice(),
    cipher: null
  }
}

// Mix key into handshake
function mixKey(ss: SymmetricState, inputKeyMaterial: Uint8Array): void {
  const output = hkdfSha256(ss.ck, inputKeyMaterial, 64)
  ss.ck = output.slice(0, 32)
  const tempK = output.slice(32)

  if (!ss.cipher) ss.cipher = initCipherState()
  setCipherKey(ss.cipher, tempK)
}

// Mix hash
function mixHash(ss: SymmetricState, data: Uint8Array): void {
  ss.h = sha256(concat(ss.h, data))
}

// Encrypt and hash (for handshake payload) - kept for protocol completeness
async function _encryptAndHash(ss: SymmetricState, plaintext: Uint8Array): Promise<Uint8Array> {
  if (!ss.cipher || isKeyEmpty(ss.cipher.key)) {
    mixHash(ss, plaintext)
    return plaintext
  }

  const ciphertext = await encrypt(ss.cipher, ss.h, plaintext)
  mixHash(ss, ciphertext)
  return ciphertext
}
void _encryptAndHash

// Decrypt and hash
async function decryptAndHash(ss: SymmetricState, ciphertext: Uint8Array): Promise<Uint8Array> {
  if (!ss.cipher || isKeyEmpty(ss.cipher.key)) {
    mixHash(ss, ciphertext)
    return ciphertext
  }

  const plaintext = await decrypt(ss.cipher, ss.h, ciphertext)
  mixHash(ss, ciphertext)
  return plaintext
}

function isKeyEmpty(key: Uint8Array): boolean {
  return key.every(b => b === 0)
}

// Split into transport keys
function split(ss: SymmetricState): { send: CipherState; recv: CipherState } {
  const output = hkdfSha256(ss.ck, new Uint8Array(0), 64)

  const send = initCipherState()
  const recv = initCipherState()

  setCipherKey(send, output.slice(0, 32))
  setCipherKey(recv, output.slice(32))

  return { send, recv }
}

// DH operation
function dh(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(privateKey, publicKey)
}

// Generate key pair
function generateKeypair(): { priv: Uint8Array; pub: Uint8Array } {
  const priv = randomBytes(32)
  const pub = x25519.getPublicKey(priv)
  return { priv, pub }
}

// Noise NK Client (browser side)
export class NoiseNKClient {
  private hs: HandshakeState | null = null
  private sendCipher: CipherState | null = null
  private recvCipher: CipherState | null = null

  constructor() {}

  // Initialize handshake with known server static key
  initiate(serverStaticPub: Uint8Array): Uint8Array {
    const ss = initSymmetricState()

    // For NK: prologue includes server's static key in h
    mixHash(ss, serverStaticPub)

    this.hs = {
      ss,
      s: null, // initiator has no static in NK
      e: null,
      rs: serverStaticPub,
      re: null,
      initiator: true,
      messageIndex: 0
    }

    // -> e, es
    // Generate ephemeral
    this.hs.e = generateKeypair()

    // Send e
    mixHash(this.hs.ss, this.hs.e.pub)

    // DH(e, rs) - ephemeral with server's static
    const shared = dh(this.hs.e.priv, this.hs.rs!)
    mixKey(this.hs.ss, shared)

    this.hs.messageIndex = 1

    // Return message: just ephemeral public key (32 bytes)
    return this.hs.e.pub
  }

  // Process server's handshake response
  async complete(serverMsg: Uint8Array): Promise<void> {
    if (!this.hs || this.hs.messageIndex !== 1) {
      throw new Error('invalid handshake state')
    }

    // <- e, ee
    // Read server's ephemeral (first 32 bytes)
    if (serverMsg.length < 32) {
      throw new Error('invalid server message')
    }

    this.hs.re = serverMsg.slice(0, 32)
    mixHash(this.hs.ss, this.hs.re)

    // DH(e, re) - our ephemeral with server's ephemeral
    const shared = dh(this.hs.e!.priv, this.hs.re)
    mixKey(this.hs.ss, shared)

    // Any remaining bytes are encrypted payload (session data from server)
    if (serverMsg.length > 32) {
      const payload = serverMsg.slice(32)
      await decryptAndHash(this.hs.ss, payload)
    }

    // Split into transport keys
    // For initiator: first key is send, second is recv
    const { send, recv } = split(this.hs.ss)
    this.sendCipher = send
    this.recvCipher = recv

    this.hs = null // clear handshake state
  }

  // Encrypt message for transport
  async encrypt(plaintext: Uint8Array): Promise<Uint8Array> {
    if (!this.sendCipher) throw new Error('handshake not complete')
    return chachaPoly1305Encrypt(
      this.sendCipher.key,
      nonceFromCounter(this.sendCipher.nonce++),
      plaintext,
      new Uint8Array(0)
    )
  }

  // Decrypt message from transport
  async decrypt(ciphertext: Uint8Array): Promise<Uint8Array> {
    if (!this.recvCipher) throw new Error('handshake not complete')
    return chachaPoly1305Decrypt(
      this.recvCipher.key,
      nonceFromCounter(this.recvCipher.nonce++),
      ciphertext,
      new Uint8Array(0)
    )
  }
}

function nonceFromCounter(n: bigint): Uint8Array {
  const nonce = new Uint8Array(CHACHA_NONCE_SIZE)
  const view = new DataView(nonce.buffer)
  view.setBigUint64(4, n, true)
  return nonce
}

// ChaCha20-Poly1305 pure JS implementation
// Based on RFC 8439

function u32(arr: Uint8Array, i: number): number {
  return (arr[i] | (arr[i + 1] << 8) | (arr[i + 2] << 16) | (arr[i + 3] << 24)) >>> 0
}

function setU32(arr: Uint8Array, i: number, val: number): void {
  arr[i] = val & 0xff
  arr[i + 1] = (val >>> 8) & 0xff
  arr[i + 2] = (val >>> 16) & 0xff
  arr[i + 3] = (val >>> 24) & 0xff
}

function rotl(v: number, n: number): number {
  return ((v << n) | (v >>> (32 - n))) >>> 0
}

function quarterRound(state: Uint32Array, a: number, b: number, c: number, d: number): void {
  state[a] = (state[a] + state[b]) >>> 0; state[d] = rotl(state[d] ^ state[a], 16)
  state[c] = (state[c] + state[d]) >>> 0; state[b] = rotl(state[b] ^ state[c], 12)
  state[a] = (state[a] + state[b]) >>> 0; state[d] = rotl(state[d] ^ state[a], 8)
  state[c] = (state[c] + state[d]) >>> 0; state[b] = rotl(state[b] ^ state[c], 7)
}

function chachaBlock(key: Uint8Array, counter: number, nonce: Uint8Array): Uint8Array {
  const state = new Uint32Array(16)

  // Constants "expand 32-byte k"
  state[0] = 0x61707865
  state[1] = 0x3320646e
  state[2] = 0x79622d32
  state[3] = 0x6b206574

  // Key
  for (let i = 0; i < 8; i++) {
    state[4 + i] = u32(key, i * 4)
  }

  // Counter
  state[12] = counter >>> 0

  // Nonce
  state[13] = u32(nonce, 0)
  state[14] = u32(nonce, 4)
  state[15] = u32(nonce, 8)

  const working = new Uint32Array(state)

  // 20 rounds (10 double rounds)
  for (let i = 0; i < 10; i++) {
    // Column rounds
    quarterRound(working, 0, 4, 8, 12)
    quarterRound(working, 1, 5, 9, 13)
    quarterRound(working, 2, 6, 10, 14)
    quarterRound(working, 3, 7, 11, 15)
    // Diagonal rounds
    quarterRound(working, 0, 5, 10, 15)
    quarterRound(working, 1, 6, 11, 12)
    quarterRound(working, 2, 7, 8, 13)
    quarterRound(working, 3, 4, 9, 14)
  }

  // Add original state
  for (let i = 0; i < 16; i++) {
    working[i] = (working[i] + state[i]) >>> 0
  }

  // Serialize
  const out = new Uint8Array(64)
  for (let i = 0; i < 16; i++) {
    setU32(out, i * 4, working[i])
  }
  return out
}

function chacha20(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const out = new Uint8Array(plaintext.length)
  let counter = 1 // Start at 1 for encryption

  for (let i = 0; i < plaintext.length; i += 64) {
    const block = chachaBlock(key, counter++, nonce)
    const remaining = Math.min(64, plaintext.length - i)
    for (let j = 0; j < remaining; j++) {
      out[i + j] = plaintext[i + j] ^ block[j]
    }
  }

  return out
}

// Poly1305 MAC
function poly1305(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const r = new BigUint64Array(3)
  const h = new BigUint64Array(3)
  const c = new BigUint64Array(5)

  // Clamp r
  let t0 = BigInt(u32(key, 0)) | (BigInt(u32(key, 4)) << 32n)
  let t1 = BigInt(u32(key, 8)) | (BigInt(u32(key, 12)) << 32n)

  r[0] = t0 & 0x0ffffffc0fffffffn
  r[1] = ((t0 >> 44n) | (t1 << 20n)) & 0x0fffffc0ffffn
  r[2] = (t1 >> 24n) & 0x00ffffffc0fn

  const s0 = BigInt(u32(key, 16)) | (BigInt(u32(key, 20)) << 32n)
  const s1 = BigInt(u32(key, 24)) | (BigInt(u32(key, 28)) << 32n)

  h[0] = 0n; h[1] = 0n; h[2] = 0n

  // Process blocks
  for (let i = 0; i < msg.length; i += 16) {
    const remaining = Math.min(16, msg.length - i)
    let n = 0n

    for (let j = 0; j < remaining; j++) {
      n |= BigInt(msg[i + j]) << BigInt(j * 8)
    }
    n |= 1n << BigInt(remaining * 8) // Add 1 bit

    h[0] += n & 0xfffffffffffn
    h[1] += (n >> 44n) & 0xfffffffffffn
    h[2] += n >> 88n

    // h *= r
    const d0 = h[0] * r[0]
    const d1 = h[0] * r[1] + h[1] * r[0]
    const d2 = h[0] * r[2] + h[1] * r[1] + h[2] * r[0]
    const d3 = h[1] * r[2] + h[2] * r[1]
    const d4 = h[2] * r[2]

    // Reduce mod 2^130 - 5
    c[0] = d0 + (d3 << 44n) * 5n
    c[1] = d1 + (d4 << 44n) * 5n
    c[2] = d2

    c[1] += c[0] >> 44n
    h[0] = c[0] & 0xfffffffffffn
    c[2] += c[1] >> 44n
    h[1] = c[1] & 0xfffffffffffn

    h[2] = c[2] & 0x3ffffffffffn
    h[0] += (c[2] >> 42n) * 5n
    h[1] += h[0] >> 44n
    h[0] &= 0xfffffffffffn
  }

  // Final reduction
  let g0 = h[0] + 5n
  let g1 = h[1] + (g0 >> 44n)
  let g2 = h[2] + (g1 >> 44n) - (1n << 42n)
  g0 &= 0xfffffffffffn
  g1 &= 0xfffffffffffn

  const mask = (g2 >> 63n) - 1n
  g0 &= mask
  g1 &= mask
  g2 &= mask
  const nmask = ~mask
  h[0] = (h[0] & nmask) | g0
  h[1] = (h[1] & nmask) | g1
  h[2] = (h[2] & nmask) | g2

  // Add s
  let f = h[0] + (h[1] << 44n) + (h[2] << 88n) + s0 + (s1 << 64n)

  const tag = new Uint8Array(16)
  for (let i = 0; i < 16; i++) {
    tag[i] = Number((f >> BigInt(i * 8)) & 0xffn)
  }

  return tag
}

function pad16(data: Uint8Array): Uint8Array {
  const rem = data.length % 16
  if (rem === 0) return data
  const padded = new Uint8Array(data.length + (16 - rem))
  padded.set(data)
  return padded
}

async function chachaPoly1305Encrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array
): Promise<Uint8Array> {
  // Generate poly1305 key
  const polyKey = chachaBlock(key, 0, nonce).slice(0, 32)

  // Encrypt
  const ciphertext = chacha20(key, nonce, plaintext)

  // Build MAC input: pad16(aad) || pad16(ciphertext) || len(aad) || len(ciphertext)
  const macInput = concat(
    pad16(aad),
    pad16(ciphertext),
    new Uint8Array(new BigUint64Array([BigInt(aad.length)]).buffer),
    new Uint8Array(new BigUint64Array([BigInt(ciphertext.length)]).buffer)
  )

  const tag = poly1305(polyKey, macInput)

  return concat(ciphertext, tag)
}

async function chachaPoly1305Decrypt(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array
): Promise<Uint8Array> {
  if (ciphertext.length < CHACHA_TAG_SIZE) {
    throw new Error('ciphertext too short')
  }

  const ct = ciphertext.slice(0, -CHACHA_TAG_SIZE)
  const tag = ciphertext.slice(-CHACHA_TAG_SIZE)

  // Generate poly1305 key
  const polyKey = chachaBlock(key, 0, nonce).slice(0, 32)

  // Verify tag
  const macInput = concat(
    pad16(aad),
    pad16(ct),
    new Uint8Array(new BigUint64Array([BigInt(aad.length)]).buffer),
    new Uint8Array(new BigUint64Array([BigInt(ct.length)]).buffer)
  )

  const expectedTag = poly1305(polyKey, macInput)

  // Constant-time compare
  let diff = 0
  for (let i = 0; i < 16; i++) {
    diff |= tag[i] ^ expectedTag[i]
  }
  if (diff !== 0) {
    throw new Error('authentication failed')
  }

  // Decrypt
  return chacha20(key, nonce, ct)
}

export { concat, bytesToHex, hexToBytes }
