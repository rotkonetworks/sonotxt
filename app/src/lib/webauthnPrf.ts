// WebAuthn PRF (Pseudo-Random Function) for client-side key derivation
// Uses passkey + salt to derive deterministic encryption keys
// No server-side secrets - all encryption happens client-side

const RP_ID = typeof window !== 'undefined' ? window.location.hostname : 'sonotxt.com'
const RP_NAME = 'sonotxt'

// Fixed salt for deriving encryption key (same salt = same key)
const ENCRYPTION_SALT = new Uint8Array([
  0x53, 0x6f, 0x6e, 0x6f, 0x54, 0x78, 0x74, 0x2d,
  0x50, 0x52, 0x46, 0x2d, 0x53, 0x61, 0x6c, 0x74,
  0x2d, 0x76, 0x31, 0x2e, 0x30, 0x2d, 0x32, 0x30,
  0x32, 0x35, 0x2d, 0x30, 0x31, 0x2d, 0x30, 0x37,
]) // "SonoTxt-PRF-Salt-v1.0-2025-01-07"

export interface PasskeyCredential {
  id: string // base64url encoded credential ID
  publicKey: string // base64url encoded public key
  createdAt: number
}

export interface PrfResult {
  encryptionKey: Uint8Array // 32-byte key derived from PRF
  credential: PasskeyCredential
}

// Check if WebAuthn PRF is available
export async function isPrfAvailable(): Promise<boolean> {
  if (!window.PublicKeyCredential) return false

  try {
    // Check for platform authenticator
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
    return available
  } catch {
    return false
  }
}

// Register a new passkey with PRF support
export async function registerPasskey(username: string): Promise<PrfResult> {
  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const userId = new TextEncoder().encode(username)

  const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
    challenge,
    rp: {
      name: RP_NAME,
      id: RP_ID,
    },
    user: {
      id: userId,
      name: username,
      displayName: username,
    },
    pubKeyCredParams: [
      { alg: -7, type: 'public-key' },   // ES256
      { alg: -257, type: 'public-key' }, // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'required',
    },
    timeout: 60000,
    attestation: 'none',
    extensions: {
      prf: {},
    } as AuthenticationExtensionsClientInputs,
  }

  const credential = await navigator.credentials.create({
    publicKey: publicKeyCredentialCreationOptions,
  }) as PublicKeyCredential

  if (!credential) {
    throw new Error('failed to create credential')
  }

  const response = credential.response as AuthenticatorAttestationResponse

  // Check if PRF is enabled
  const extensions = credential.getClientExtensionResults() as { prf?: { enabled: boolean } }
  if (!extensions.prf?.enabled) {
    throw new Error('PRF extension not supported by authenticator')
  }

  // Store credential info
  const credentialData: PasskeyCredential = {
    id: arrayBufferToBase64Url(credential.rawId),
    publicKey: arrayBufferToBase64Url(response.getPublicKey() || new ArrayBuffer(0)),
    createdAt: Date.now(),
  }

  // Now authenticate to get PRF output
  const prfKey = await authenticateWithPrf(credentialData.id)

  return {
    encryptionKey: prfKey,
    credential: credentialData,
  }
}

// Authenticate with existing passkey and get PRF-derived key
export async function authenticateWithPrf(credentialId?: string): Promise<Uint8Array> {
  const challenge = crypto.getRandomValues(new Uint8Array(32))

  const allowCredentials: PublicKeyCredentialDescriptor[] = credentialId
    ? [{ type: 'public-key', id: base64UrlToArrayBuffer(credentialId) }]
    : []

  const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
    challenge,
    rpId: RP_ID,
    timeout: 60000,
    userVerification: 'required',
    allowCredentials: allowCredentials.length > 0 ? allowCredentials : undefined,
    extensions: {
      prf: {
        eval: {
          first: ENCRYPTION_SALT,
        },
      },
    } as AuthenticationExtensionsClientInputs,
  }

  const assertion = await navigator.credentials.get({
    publicKey: publicKeyCredentialRequestOptions,
  }) as PublicKeyCredential

  if (!assertion) {
    throw new Error('authentication failed')
  }

  // Get PRF output
  const extensions = assertion.getClientExtensionResults() as {
    prf?: { results?: { first?: ArrayBuffer } }
  }

  const prfOutput = extensions.prf?.results?.first
  if (!prfOutput) {
    throw new Error('PRF output not available')
  }

  return new Uint8Array(prfOutput)
}

// Encrypt data with PRF-derived key using AES-GCM
export async function encryptWithPrfKey(
  key: Uint8Array,
  plaintext: string
): Promise<string> {
  const keyBuffer = new Uint8Array(key).buffer as ArrayBuffer
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  )

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encoded = new TextEncoder().encode(plaintext)

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    encoded
  )

  // Combine IV + ciphertext and encode as base64
  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(ciphertext), iv.length)

  return arrayBufferToBase64(combined)
}

// Decrypt data with PRF-derived key
export async function decryptWithPrfKey(
  key: Uint8Array,
  encrypted: string
): Promise<string> {
  const combined = base64ToArrayBuffer(encrypted)
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)

  const keyBuffer = new Uint8Array(key).buffer as ArrayBuffer
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  )

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertext
  )

  return new TextDecoder().decode(decrypted)
}

// Storage helpers - stores encrypted data locally
const STORAGE_PREFIX = 'sonotxt_prf_'

export function storeEncryptedData(key: string, encryptedData: string): void {
  localStorage.setItem(STORAGE_PREFIX + key, encryptedData)
}

export function loadEncryptedData(key: string): string | null {
  return localStorage.getItem(STORAGE_PREFIX + key)
}

export function clearEncryptedData(key: string): void {
  localStorage.removeItem(STORAGE_PREFIX + key)
}

// Store credential ID for auto-login
export function storeCredentialId(credentialId: string): void {
  localStorage.setItem(STORAGE_PREFIX + 'credential_id', credentialId)
}

export function loadCredentialId(): string | null {
  return localStorage.getItem(STORAGE_PREFIX + 'credential_id')
}

export function clearCredentialId(): void {
  localStorage.removeItem(STORAGE_PREFIX + 'credential_id')
}

// Check if user has registered passkey
export function hasStoredCredential(): boolean {
  return loadCredentialId() !== null
}

// Utility: ArrayBuffer <-> Base64URL
function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

function arrayBufferToBase64(buffer: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < buffer.length; i++) {
    binary += String.fromCharCode(buffer[i])
  }
  return btoa(binary)
}

function base64ToArrayBuffer(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
