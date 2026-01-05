// App store with fine-grained reactivity
import { createSignal, createContext, useContext, ParentComponent, batch } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import type { User } from './api'

export interface HistoryItem {
  id: string
  text: string
  url: string
  jobId?: string
  duration: number
  voice?: string
  date: string
  sourceUrl?: string
}

export interface AppState {
  user: User | null
  freeRemaining: number
  history: HistoryItem[]
  stats: {
    generated: number
    chars: number
  }
}

const STORAGE_KEYS = {
  token: 'sonotxt_token',
  history: 'sonotxt_history',
  stats: 'sonotxt_stats',
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
    stats: loadFromStorage(STORAGE_KEYS.stats, { generated: 0, chars: 0 }),
  })

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
      saveToStorage(STORAGE_KEYS.token, authToken)
    },

    logout() {
      batch(() => {
        setState('user', null)
        setToken(null)
      })
      localStorage.removeItem(STORAGE_KEYS.token)
    },

    setFreeRemaining(amount: number) {
      setState('freeRemaining', amount)
    },

    addToHistory(item: Omit<HistoryItem, 'id' | 'date'>) {
      const newItem: HistoryItem = {
        ...item,
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
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

    clearHistory() {
      setState('history', [])
      localStorage.removeItem(STORAGE_KEYS.history)
    },

    removeFromHistory(id: string) {
      setState(
        produce((s) => {
          s.history = s.history.filter((h) => h.id !== id)
        })
      )
      saveToStorage(STORAGE_KEYS.history, state.history)
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
