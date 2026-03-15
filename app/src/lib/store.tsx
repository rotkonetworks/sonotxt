// App store with fine-grained reactivity
import { createSignal, createContext, useContext, ParentComponent, batch } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import type { User, Contact } from './api'
import * as api from './api'
import { TeeClient, type AttestationBundle } from './teeClient'
import {
  isPrfAvailable,
  registerPasskey,
  authenticateWithPrf,
  encryptWithPrfKey,
  decryptWithPrfKey,
  storeCredentialId,
  loadCredentialId,
  hasStoredCredential,
  clearCredentialId,
  storeEncryptedData,
  loadEncryptedData,
  type PasskeyCredential,
} from './webauthnPrf'
import * as vault from './vaultClient'
import { saveAudio, loadAudio, deleteAudio, clearAllAudio } from './audioDB'

export interface HistoryItem {
  id: string
  type: 'text' | 'speech' | 'translate'
  text: string
  url: string // blob URL for playback or public URL
  jobId?: string
  vaultId?: string // encrypted vault storage ID (for paid users)
  duration: number
  voice?: string
  date: string
  sourceUrl?: string
  translation?: string
  targetLang?: string
  isEncrypted?: boolean // true if stored encrypted in vault
}

export interface PasskeyState {
  available: boolean
  registered: boolean
  unlocked: boolean
  credential: PasskeyCredential | null
  encryptionKey: Uint8Array | null
}

export interface AppState {
  user: User | null
  freeRemaining: number
  history: HistoryItem[]
  contacts: Contact[]
  pendingInvites: Contact[]
  favorites: string[] // contact_id list, stored locally
  stats: {
    generated: number
    chars: number
  }
  tee: {
    connected: boolean
    attestation: AttestationBundle | null
  }
  passkey: PasskeyState
}

const STORAGE_KEYS = {
  token: 'sonotxt_token',
  history: 'sonotxt_history',
  stats: 'sonotxt_stats',
  favorites: 'sonotxt_favorites',
} as const

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) : fallback
  } catch {
    return fallback
  }
}

function saveToStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

export function createAppStore() {
  const [state, setState] = createStore<AppState>({
    user: null,
    freeRemaining: 1000,
    history: loadFromStorage(STORAGE_KEYS.history, []),
    contacts: [],
    pendingInvites: [],
    favorites: loadFromStorage(STORAGE_KEYS.favorites, []),
    stats: loadFromStorage(STORAGE_KEYS.stats, { generated: 0, chars: 0 }),
    tee: {
      connected: false,
      attestation: null,
    },
    passkey: {
      available: false,
      registered: hasStoredCredential(),
      unlocked: false,
      credential: null,
      encryptionKey: null,
    },
  })

  // TEE client reference (not stored in reactive state since it's a class instance)
  let teeClient: TeeClient | null = null

  const [token, setToken] = createSignal<string | null>(
    localStorage.getItem(STORAGE_KEYS.token)
  )

  const actions = {
    setUser(user: User | null) {
      setState('user', user)
    },

    login(user: User, authToken: string) {
      batch(() => {
        setState('user', user)
        setToken(authToken)
      })
      // Store token as raw string — not via saveToStorage which JSON.stringify wraps it
      localStorage.setItem(STORAGE_KEYS.token, authToken)
    },

    logout() {
      const tok = token()
      batch(() => {
        setState('user', null)
        setToken(null)
      })
      localStorage.removeItem(STORAGE_KEYS.token)
      if (tok) api.logout(tok).catch(() => {})
    },

    setFreeRemaining(amount: number) {
      setState('freeRemaining', amount)
    },

    updateAvatar(avatar: string | null) {
      setState('user', (u) => u ? { ...u, avatar: avatar ?? undefined } : null)
    },

    async loadContacts() {
      const tok = token()
      if (!tok) return
      try {
        const [contacts, pending] = await Promise.all([
          api.listContacts(tok),
          api.listPendingInvites(tok),
        ])
        batch(() => {
          setState('contacts', contacts)
          setState('pendingInvites', pending)
        })
      } catch {}
    },

    toggleFavorite(contactId: string) {
      setState(produce(s => {
        const idx = s.favorites.indexOf(contactId)
        if (idx >= 0) {
          s.favorites.splice(idx, 1)
        } else {
          s.favorites.push(contactId)
        }
      }))
      saveToStorage(STORAGE_KEYS.favorites, state.favorites)
    },

    async sendInvite(opts: { address?: string; nickname?: string; email?: string; message?: string }) {
      const tok = token()
      if (!tok) return
      await api.sendInvite(tok, opts)
      await this.loadContacts()
    },

    async acceptInvite(contactId: string) {
      const tok = token()
      if (!tok) return
      await api.acceptInvite(tok, contactId)
      await this.loadContacts()
    },

    async rejectInvite(contactId: string) {
      const tok = token()
      if (!tok) return
      await api.rejectInvite(tok, contactId)
      await this.loadContacts()
    },

    async removeContact(contactId: string) {
      const tok = token()
      if (!tok) return
      await api.removeContact(tok, contactId)
      setState(produce(s => {
        s.contacts = s.contacts.filter(c => c.contact_id !== contactId)
        s.favorites = s.favorites.filter(f => f !== contactId)
      }))
      saveToStorage(STORAGE_KEYS.favorites, state.favorites)
    },

    async addToHistory(item: Omit<HistoryItem, 'id' | 'date'>) {
      const newItem: HistoryItem = {
        ...item,
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
      }

      // Persist audio blob to IndexedDB
      if (item.url && item.url.startsWith('blob:')) {
        try {
          const res = await fetch(item.url)
          const blob = await res.blob()
          await saveAudio(newItem.id, blob)
        } catch {}
      }

      // Revoke blob URLs of items that will be evicted
      if (state.history.length >= 50) {
        for (const evicted of state.history.slice(49)) {
          if (evicted.url?.startsWith('blob:')) URL.revokeObjectURL(evicted.url)
        }
      }

      setState(
        produce((s) => {
          s.history.unshift(newItem)
          s.history = s.history.slice(0, 50) // Keep last 50
          s.stats.generated++
          s.stats.chars += item.text.length
        })
      )

      saveToStorage(STORAGE_KEYS.history, state.history)
      saveToStorage(STORAGE_KEYS.stats, state.stats)
    },

    async restoreAudioUrls() {
      // Restore blob URLs from IndexedDB for history items
      for (let i = 0; i < state.history.length; i++) {
        const item = state.history[i]
        if (item.url && !item.url.startsWith('blob:')) continue // already a real URL
        try {
          const url = await loadAudio(item.id)
          if (url) {
            setState('history', i, 'url', url)
          } else if (item.url?.startsWith('blob:')) {
            // Stale blob URL from previous session — clear it so UI doesn't show broken play button
            setState('history', i, 'url', '')
          }
        } catch {}
      }
    },

    clearHistory() {
      for (const item of state.history) {
        if (item.url?.startsWith('blob:')) URL.revokeObjectURL(item.url)
      }
      setState('history', [])
      localStorage.removeItem(STORAGE_KEYS.history)
      clearAllAudio().catch(() => {})
    },

    removeFromHistory(id: string) {
      const item = state.history.find((h) => h.id === id)
      if (item?.url?.startsWith('blob:')) URL.revokeObjectURL(item.url)
      deleteAudio(id).catch(() => {})
      setState(
        produce((s) => {
          s.history = s.history.filter((h) => h.id !== id)
        })
      )
      saveToStorage(STORAGE_KEYS.history, state.history)
    },

    async connectTee(wsUrl: string): Promise<AttestationBundle> {
      teeClient = new TeeClient({ wsUrl })
      const attestation = await teeClient.connect()
      batch(() => {
        setState('tee', 'connected', true)
        setState('tee', 'attestation', attestation)
      })
      return attestation
    },

    disconnectTee() {
      if (teeClient) {
        teeClient.disconnect()
        teeClient = null
      }
      batch(() => {
        setState('tee', 'connected', false)
        setState('tee', 'attestation', null)
      })
    },

    getTeeClient() {
      return teeClient
    },

    // Passkey/PRF actions
    async checkPasskeyAvailability() {
      const available = await isPrfAvailable()
      setState('passkey', 'available', available)
      return available
    },

    async registerNewPasskey(username: string) {
      const result = await registerPasskey(username)
      storeCredentialId(result.credential.id)

      batch(() => {
        setState('passkey', 'registered', true)
        setState('passkey', 'unlocked', true)
        setState('passkey', 'credential', result.credential)
        setState('passkey', 'encryptionKey', result.encryptionKey)
      })

      return result
    },

    async unlockWithPasskey() {
      const credentialId = loadCredentialId()
      const encryptionKey = await authenticateWithPrf(credentialId || undefined)

      batch(() => {
        setState('passkey', 'unlocked', true)
        setState('passkey', 'encryptionKey', encryptionKey)
      })

      // Load encrypted history if available
      const encryptedHistory = loadEncryptedData('history')
      if (encryptedHistory && encryptionKey) {
        try {
          const decrypted = await decryptWithPrfKey(encryptionKey, encryptedHistory)
          const history = JSON.parse(decrypted) as HistoryItem[]
          setState('history', history)
        } catch {
          // Decryption failed - might be corrupted or different key
        }
      }

      return encryptionKey
    },

    async saveEncryptedHistory() {
      const key = state.passkey.encryptionKey
      if (!key) return

      const encrypted = await encryptWithPrfKey(key, JSON.stringify(state.history))
      storeEncryptedData('history', encrypted)
    },

    lockPasskey() {
      batch(() => {
        setState('passkey', 'unlocked', false)
        setState('passkey', 'encryptionKey', null)
      })
    },

    clearPasskey() {
      clearCredentialId()
      batch(() => {
        setState('passkey', 'registered', false)
        setState('passkey', 'unlocked', false)
        setState('passkey', 'credential', null)
        setState('passkey', 'encryptionKey', null)
      })
    },

    // Vault actions for encrypted audio storage (paid users)
    async uploadToVault(audioData: ArrayBuffer, text: string, voice: string, duration: number) {
      const authToken = token()
      const prfKey = state.passkey.encryptionKey
      if (!authToken || !prfKey) {
        throw new Error('must be logged in with passkey unlocked')
      }

      const filename = `${Date.now()}-${voice}.opus`
      const result = await vault.uploadEncrypted(authToken, prfKey, audioData, filename, 'audio/opus')

      // Create blob URL for immediate playback
      const blob = new Blob([audioData], { type: 'audio/opus' })
      const blobUrl = URL.createObjectURL(blob)

      // Add to history with vault reference
      const newItem: HistoryItem = {
        id: crypto.randomUUID(),
        type: 'speech',
        text,
        url: blobUrl,
        vaultId: result.id,
        duration,
        voice,
        date: new Date().toISOString(),
        isEncrypted: true,
      }

      // Revoke blob URLs of items that will be evicted
      if (state.history.length >= 50) {
        for (const evicted of state.history.slice(49)) {
          if (evicted.url?.startsWith('blob:')) URL.revokeObjectURL(evicted.url)
        }
      }

      setState(
        produce((s) => {
          s.history.unshift(newItem)
          s.history = s.history.slice(0, 50)
          s.stats.generated++
          s.stats.chars += text.length
        })
      )

      // Save encrypted history metadata
      await this.saveEncryptedHistory()

      return result
    },

    async downloadFromVault(vaultId: string): Promise<ArrayBuffer> {
      const authToken = token()
      const prfKey = state.passkey.encryptionKey
      if (!authToken || !prfKey) {
        throw new Error('must be logged in with passkey unlocked')
      }

      return vault.downloadDecrypted(authToken, prfKey, vaultId)
    },

    async publishFromVault(vaultId: string, storage: 'minio' | 'ipfs' = 'minio') {
      const authToken = token()
      const prfKey = state.passkey.encryptionKey
      if (!authToken || !prfKey) {
        throw new Error('must be logged in with passkey unlocked')
      }

      // Downloads, decrypts, and re-uploads as public
      const result = await vault.publishVaultItem(authToken, vaultId, prfKey, storage)

      // Update history item with public URL
      setState(
        produce((s) => {
          const item = s.history.find((h) => h.vaultId === vaultId)
          if (item) {
            item.url = result.public_url
            item.isEncrypted = false
          }
        })
      )

      await this.saveEncryptedHistory()

      return result
    },

    async deleteFromVault(vaultId: string) {
      const authToken = token()
      if (!authToken) {
        throw new Error('must be logged in')
      }

      await vault.deleteVaultItem(authToken, vaultId)

      // Remove from history
      setState(
        produce((s) => {
          s.history = s.history.filter((h) => h.vaultId !== vaultId)
        })
      )

      await this.saveEncryptedHistory()
    },
  }

  return { state, token, actions }
}

type AppStore = ReturnType<typeof createAppStore>

const StoreContext = createContext<AppStore>()

export const StoreProvider: ParentComponent = (props) => {
  const store = createAppStore()
  return (
    <StoreContext.Provider value={store}>
      {props.children}
    </StoreContext.Provider>
  )
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
