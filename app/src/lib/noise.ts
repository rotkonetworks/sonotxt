// Noise_NK protocol implementation for browser
// NK pattern: N = no initiator static, K = responder static known to initiator
// -> e, es (client sends ephemeral, derives shared secret with server's static)
// <- e, ee (server sends ephemeral, derive shared secret)

import { sha256 } from '@noble/hashes/sha2.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { randomBytes, bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { chacha20poly1305 } from '@noble/ciphers/chacha.js'

const CHACHA_KEY_SIZE = 32
const CHACHA_NONCE_SIZE = 12

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

// Build nonce: 4 bytes zero + 8 bytes little-endian counter
function nonceFromCounter(n: bigint): Uint8Array {
  const nonce = new Uint8Array(CHACHA_NONCE_SIZE)
  const view = new DataView(nonce.buffer)
  view.setBigUint64(4, n, true)
  return nonce
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

// Encrypt with AEAD via @noble/ciphers
function encryptAEAD(cs: CipherState, ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
  if (cs.nonce >= MAX_NONCE) throw new Error('nonce overflow')
  const nonce = nonceFromCounter(cs.nonce)
  const cipher = chacha20poly1305(cs.key, nonce, ad)
  const ciphertext = cipher.encrypt(plaintext)
  cs.nonce++
  return ciphertext
}

// Decrypt with AEAD via @noble/ciphers
function decryptAEAD(cs: CipherState, ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  if (cs.nonce >= MAX_NONCE) throw new Error('nonce overflow')
  const nonce = nonceFromCounter(cs.nonce)
  const cipher = chacha20poly1305(cs.key, nonce, ad)
  const plaintext = cipher.decrypt(ciphertext)
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

function isKeyEmpty(key: Uint8Array): boolean {
  return key.every(b => b === 0)
}

// Decrypt and hash
function decryptAndHash(ss: SymmetricState, ciphertext: Uint8Array): Uint8Array {
  if (!ss.cipher || isKeyEmpty(ss.cipher.key)) {
    mixHash(ss, ciphertext)
    return ciphertext
  }

  const plaintext = decryptAEAD(ss.cipher, ss.h, ciphertext)
  mixHash(ss, ciphertext)
  return plaintext
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
      decryptAndHash(this.hs.ss, payload)
    }

    // Split into transport keys
    // For initiator: first key is send, second is recv
    const { send, recv } = split(this.hs.ss)
    this.sendCipher = send
    this.recvCipher = recv

    this.hs = null // clear handshake state
  }

  // Encrypt message for transport
  encrypt(plaintext: Uint8Array): Uint8Array {
    if (!this.sendCipher) throw new Error('handshake not complete')
    if (this.sendCipher.nonce >= MAX_NONCE) throw new Error('nonce overflow')
    const nonce = nonceFromCounter(this.sendCipher.nonce++)
    return chacha20poly1305(this.sendCipher.key, nonce).encrypt(plaintext)
  }

  // Decrypt message from transport
  decrypt(ciphertext: Uint8Array): Uint8Array {
    if (!this.recvCipher) throw new Error('handshake not complete')
    if (this.recvCipher.nonce >= MAX_NONCE) throw new Error('nonce overflow')
    const nonce = nonceFromCounter(this.recvCipher.nonce++)
    return chacha20poly1305(this.recvCipher.key, nonce).decrypt(ciphertext)
  }
}

export { concat, bytesToHex, hexToBytes }
