// Encrypted vault storage client
// Encrypts audio with PRF-derived key before upload
// Server never sees unencrypted content

const API = import.meta.env.VITE_API_URL || 'https://api.sonotxt.com'

export interface VaultItem {
  id: string
  filename: string
  size_bytes: number
  content_type: string
  is_public: boolean
  public_url: string | null
  created_at: string
}

export interface VaultListResponse {
  items: VaultItem[]
  total_bytes: number
  quota_bytes: number
}

export interface UploadResponse {
  id: string
  size_bytes: number
}

export interface PublishResponse {
  public_url: string
  cost: number
  ipfs_cid: string | null
}

// Validate item IDs to prevent path injection from corrupted localStorage
function validateItemId(id: string): string {
  if (id.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Invalid vault item ID')
  return id
}

// Encrypt and upload audio to vault
export async function uploadEncrypted(
  token: string,
  prfKey: Uint8Array,
  audioData: ArrayBuffer,
  filename: string,
  contentType: string = 'audio/opus'
): Promise<UploadResponse> {
  // Encrypt the audio with PRF key
  const encrypted = await encryptAudioWithKey(prfKey, new Uint8Array(audioData))

  // Convert to ArrayBuffer to avoid SharedArrayBuffer type issues
  const encryptedBuffer = encrypted.buffer.slice(
    encrypted.byteOffset,
    encrypted.byteOffset + encrypted.byteLength
  ) as ArrayBuffer

  const response = await fetch(
    `${API}/vault?filename=${encodeURIComponent(filename)}&content_type=${encodeURIComponent(contentType)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: encryptedBuffer,
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Upload failed' }))
    throw new Error(error.error || 'Upload failed')
  }

  return response.json()
}

// Download and decrypt audio from vault
export async function downloadDecrypted(
  token: string,
  prfKey: Uint8Array,
  itemId: string
): Promise<ArrayBuffer> {
  const response = await fetch(`${API}/vault/${validateItemId(itemId)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`)
  }

  const encrypted = await response.arrayBuffer()
  try {
    return await decryptAudioWithKey(prfKey, new Uint8Array(encrypted))
  } catch {
    throw new Error('Decryption failed — wrong key or corrupted data')
  }
}

// List vault items
export async function listVaultItems(token: string): Promise<VaultListResponse> {
  const response = await fetch(`${API}/vault`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    throw new Error('Failed to list vault items')
  }

  return response.json()
}

// Delete vault item
export async function deleteVaultItem(token: string, itemId: string): Promise<void> {
  const response = await fetch(`${API}/vault/${validateItemId(itemId)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    throw new Error('Failed to delete item')
  }
}

// Publish item (make it public - costs money)
// If prfKey provided, decrypts and uploads decrypted version
// Otherwise just marks encrypted file as public (client must decrypt on playback)
export async function publishVaultItem(
  token: string,
  itemId: string,
  prfKey?: Uint8Array,
  storage: 'minio' | 'ipfs' = 'minio'
): Promise<PublishResponse> {
  let body: { storage: string; decrypted_data?: string }

  if (prfKey) {
    // Download, decrypt, and re-upload as public
    const decrypted = await downloadDecrypted(token, prfKey, itemId)
    const base64 = arrayBufferToBase64(decrypted)
    body = { storage, decrypted_data: base64 }
  } else {
    body = { storage }
  }

  const response = await fetch(`${API}/vault/${validateItemId(itemId)}/publish`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Publish failed' }))
    throw new Error(error.error || 'Publish failed')
  }

  return response.json()
}

// Internal: encrypt audio with AES-GCM using PRF key
async function encryptAudioWithKey(key: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const keyBuffer = new Uint8Array(key).buffer as ArrayBuffer
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  )

  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintextBuffer = new Uint8Array(plaintext).buffer as ArrayBuffer
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    plaintextBuffer
  )

  // Combine IV + ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength)
  combined.set(iv)
  combined.set(new Uint8Array(ciphertext), iv.length)

  return combined
}

// Internal: decrypt audio with AES-GCM using PRF key
async function decryptAudioWithKey(key: Uint8Array, encrypted: Uint8Array): Promise<ArrayBuffer> {
  if (encrypted.length < 28) throw new Error('encrypted data too short') // 12 IV + 16 auth tag minimum
  const iv = new Uint8Array(encrypted.slice(0, 12))
  const ciphertext = new Uint8Array(encrypted.slice(12))

  const keyBuffer = new Uint8Array(key).buffer as ArrayBuffer
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  )

  const ciphertextBuffer = ciphertext.buffer.slice(
    ciphertext.byteOffset,
    ciphertext.byteOffset + ciphertext.byteLength
  ) as ArrayBuffer

  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertextBuffer
  )
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}
