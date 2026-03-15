// TEE Client: End-to-end encrypted TTS via WebSocket + Noise_NK protocol
// Connects to kokoro-tee server, verifies attestation, establishes encrypted session
// Protocol: length-prefixed JSON messages matching kokoro-common::Message

import { NoiseNKClient, concat } from './noise'
import { sha256 } from '@noble/hashes/sha2.js'

export interface TeeConfig {
  wsUrl: string // WebSocket URL to TEE server
}

export interface StreamChunk {
  sequence: number
  audio: Uint8Array
  isFinal: boolean
  error?: string
}

export type TeeType = 'Insecure' | 'SevSnp' | 'Tdx'

export interface AttestationBundle {
  quote: Uint8Array
  staticKey: Uint8Array
  bindingSig: Uint8Array
  teeType: TeeType
}

// Message types matching kokoro-common (JSON serialized)
type Message =
  | 'AttestationRequest'
  | { Attestation: AttestationBundleJson }
  | { NoiseHandshake: number[] }
  | { NoiseHandshakeResponse: { handshake: number[]; session_id: number[] } }
  | { EncryptedRequest: number[] }
  | { EncryptedResponse: number[] }
  | { EncryptedStreamRequest: number[] }
  | { EncryptedStreamChunk: number[] }

interface AttestationBundleJson {
  quote: number[]
  static_key: number[]
  binding_sig: number[]
  tee_type: 'SevSnp' | 'Tdx' | 'Insecure'
}

export class TeeClient {
  private config: TeeConfig
  private ws: WebSocket | null = null
  private noise: NoiseNKClient | null = null
  private attestation: AttestationBundle | null = null
  private connected = false
  private messageHandlers: ((msg: Message) => void)[] = []
  private streamCallback: ((chunk: StreamChunk) => void) | null = null

  constructor(config: TeeConfig) {
    this.config = config
  }

  async connect(): Promise<AttestationBundle> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.wsUrl)
        this.ws.binaryType = 'arraybuffer'

        this.ws.onopen = async () => {
          try {
            // Request attestation
            const attestation = await this.requestAttestation()
            this.attestation = attestation

            // Verify attestation binding
            this.verifyAttestation(attestation)

            // Perform Noise handshake
            await this.performHandshake(attestation.staticKey)

            this.connected = true
            resolve(attestation)
          } catch (err) {
            reject(err)
          }
        }

        this.ws.onmessage = (event) => {
          this.handleRawMessage(new Uint8Array(event.data as ArrayBuffer))
        }

        this.ws.onerror = () => {
          reject(new Error('WebSocket error'))
        }

        this.ws.onclose = () => {
          this.connected = false
          this.noise = null
        }
      } catch (err) {
        reject(err)
      }
    })
  }

  private sendMessage(msg: Message): void {
    if (!this.ws) throw new Error('not connected')

    const json = JSON.stringify(msg)
    const jsonBytes = new TextEncoder().encode(json)

    // length-prefixed: 4 bytes LE length + json
    const packet = new Uint8Array(4 + jsonBytes.length)
    const view = new DataView(packet.buffer)
    view.setUint32(0, jsonBytes.length, true)
    packet.set(jsonBytes, 4)

    this.ws.send(packet)
  }

  private handleRawMessage(data: Uint8Array): void {
    if (data.length < 4) return

    const view = new DataView(data.buffer, data.byteOffset)
    const len = view.getUint32(0, true)
    if (len > 10_000_000 || data.length < 4 + len) return

    const jsonBytes = data.slice(4, 4 + len)
    const json = new TextDecoder().decode(jsonBytes)

    try {
      const msg: Message = JSON.parse(json)
      this.handleMessage(msg)
    } catch {
      // ignore malformed messages
    }
  }

  private handleMessage(msg: Message): void {
    // notify waiting handlers
    const handlers = this.messageHandlers
    this.messageHandlers = []
    for (const handler of handlers) {
      handler(msg)
    }

    // handle streaming chunks
    if (typeof msg === 'object' && 'EncryptedStreamChunk' in msg && this.streamCallback) {
      this.handleStreamChunk(msg.EncryptedStreamChunk)
    }
  }

  private waitForMessage<T>(predicate: (msg: Message) => T | null, timeoutMs = 10000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.messageHandlers = this.messageHandlers.filter((h) => h !== handler)
        reject(new Error('message timeout'))
      }, timeoutMs)

      const handler = (msg: Message) => {
        const result = predicate(msg)
        if (result !== null) {
          clearTimeout(timeout)
          resolve(result)
        } else {
          // re-add handler to wait for correct message
          this.messageHandlers.push(handler)
        }
      }

      this.messageHandlers.push(handler)
    })
  }

  private async requestAttestation(): Promise<AttestationBundle> {
    this.sendMessage('AttestationRequest')

    const bundle = await this.waitForMessage((msg) => {
      if (typeof msg === 'object' && 'Attestation' in msg) {
        return msg.Attestation
      }
      return null
    })

    return {
      quote: new Uint8Array(bundle.quote),
      staticKey: new Uint8Array(bundle.static_key),
      bindingSig: new Uint8Array(bundle.binding_sig),
      teeType: bundle.tee_type,
    }
  }

  private verifyAttestation(bundle: AttestationBundle): void {
    // Verify binding signature: H(quote || static_key)
    const toHash = concat(bundle.quote, bundle.staticKey)
    const expected = sha256(toHash)

    // constant-time comparison to prevent timing oracle
    let diff = bundle.bindingSig.length ^ expected.length
    const len = Math.min(bundle.bindingSig.length, expected.length)
    for (let i = 0; i < len; i++) {
      diff |= bundle.bindingSig[i] ^ expected[i]
    }

    if (diff !== 0) {
      throw new Error('attestation binding signature mismatch')
    }

    // For production: verify TEE quote against certificate chain
    if (bundle.teeType === 'Insecure') {
      console.warn('accepting insecure attestation (development mode)')
    }
  }

  private async performHandshake(serverStaticKey: Uint8Array): Promise<void> {
    this.noise = new NoiseNKClient()

    // Initiate handshake
    const msg1 = this.noise.initiate(serverStaticKey)

    this.sendMessage({ NoiseHandshake: Array.from(msg1) })

    const response = await this.waitForMessage((msg) => {
      if (typeof msg === 'object' && 'NoiseHandshakeResponse' in msg) {
        return msg.NoiseHandshakeResponse
      }
      return null
    })

    await this.noise.complete(new Uint8Array(response.handshake))
  }

  private handleStreamChunk(ciphertext: number[]): void {
    if (!this.noise || !this.streamCallback) return

    try {
      const plaintext = this.noise.decrypt(new Uint8Array(ciphertext))
      const text = new TextDecoder().decode(plaintext)
      const chunk = JSON.parse(text) as {
        request_id: number[]
        sequence: number
        audio: number[]
        is_final: boolean
        error?: string
      }

      this.streamCallback({
        sequence: chunk.sequence,
        audio: new Uint8Array(chunk.audio),
        isFinal: chunk.is_final,
        error: chunk.error,
      })
    } catch {
      this.streamCallback({
        sequence: -1,
        audio: new Uint8Array(0),
        isFinal: false,
        error: 'decryption failed',
      })
    }
  }

  async synthesizeStream(
    text: string,
    voice: string,
    speed: number,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<void> {
    if (!this.connected || !this.noise) {
      throw new Error('not connected')
    }

    this.streamCallback = onChunk

    // Create request
    const requestId = new Uint8Array(16)
    crypto.getRandomValues(requestId)

    const request = {
      request_id: Array.from(requestId),
      voice,
      speed,
      text,
      format: 'Opus',
    }

    // Encrypt request
    const plaintext = new TextEncoder().encode(JSON.stringify(request))
    const ciphertext = this.noise.encrypt(plaintext)

    this.sendMessage({ EncryptedStreamRequest: Array.from(ciphertext) })
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.connected = false
    this.noise = null
    this.attestation = null
  }

  isConnected(): boolean {
    return this.connected
  }

  getAttestation(): AttestationBundle | null {
    return this.attestation
  }
}

// Opus decoder for browser playback
export class OpusDecoder {
  private audioContext: AudioContext
  private sampleRate = 24000

  constructor() {
    this.audioContext = new AudioContext({ sampleRate: this.sampleRate })
  }

  async decode(opusData: Uint8Array): Promise<AudioBuffer> {
    // Parse Opus frame format from server:
    // 4 bytes: num_frames (u32 LE)
    // For each frame: 2 bytes length (u16 LE) + frame data

    const view = new DataView(opusData.buffer, opusData.byteOffset)
    const numFrames = view.getUint32(0, true)

    // Collect all PCM samples
    const allSamples: number[] = []

    // Fallback: if this is actually PCM data (format negotiation), just convert
    if (numFrames === 0 || opusData.length < 8) {
      // Assume raw PCM i16 LE
      for (let i = 0; i < opusData.length; i += 2) {
        const sample = view.getInt16(i, true) / 32768
        allSamples.push(sample)
      }
    } else {
      // Try to decode Opus frames
      // This requires WebCodecs support
      console.warn('Opus decoding requires WebCodecs or WASM decoder')
      // For now, return empty buffer
      return this.audioContext.createBuffer(1, 1, this.sampleRate)
    }

    // Create AudioBuffer
    const buffer = this.audioContext.createBuffer(1, allSamples.length, this.sampleRate)
    buffer.getChannelData(0).set(new Float32Array(allSamples))

    return buffer
  }

  async playBuffer(buffer: AudioBuffer): Promise<void> {
    const source = this.audioContext.createBufferSource()
    source.buffer = buffer
    source.connect(this.audioContext.destination)
    source.start()
  }

  getContext(): AudioContext {
    return this.audioContext
  }
}
