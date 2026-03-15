import { createSignal, For, Show } from 'solid-js'

interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
  exiting?: boolean
}

const [toasts, setToasts] = createSignal<ToastItem[]>([])
let nextId = 0

export function showToast(message: string, type: ToastItem['type'] = 'info') {
  const id = nextId++
  setToasts(t => [...t, { id, message, type }])
  setTimeout(() => {
    setToasts(t => t.map(toast => toast.id === id ? { ...toast, exiting: true } : toast))
    setTimeout(() => {
      setToasts(t => t.filter(toast => toast.id !== id))
    }, 200)
  }, 3300)
}

function toastIcon(type: ToastItem['type']) {
  switch (type) {
    case 'success': return 'i-mdi-check-circle'
    case 'error': return 'i-mdi-alert-circle'
    default: return 'i-mdi-information'
  }
}

export function ToastContainer() {
  return (
    <div class="fixed bottom-4 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-4 z-50 flex flex-col gap-2 w-[90%] sm:w-auto max-w-sm">
      <For each={toasts()}>{toast => (
        <div
          class={`relative flex items-center gap-2.5 px-4 py-2.5 text-xs border-2 shadow-[var(--shadow)] font-heading uppercase tracking-wider ${
            toast.type === 'success' ? 'bg-emerald-50 border-emerald-700 text-emerald-800' :
            toast.type === 'error' ? 'bg-red-50 border-red-700 text-red-800' :
            'bg-surface border-edge text-fg'
          }`}
          style={`animation: ${toast.exiting ? 'toast-out 0.2s ease-in forwards' : 'toast-in 0.25s ease-out'}`}
        >
          <span class={`${toastIcon(toast.type)} w-4 h-4 flex-shrink-0`} />
          <span class="flex-1">{toast.message}</span>
          <button
            class="p-0.5 opacity-50 hover:opacity-100 transition-opacity flex-shrink-0"
            onClick={() => setToasts(t => t.filter(x => x.id !== toast.id))}
          >
            <span class="i-mdi-close w-3 h-3" />
          </button>
          {/* Auto-dismiss countdown bar */}
          <Show when={!toast.exiting}>
            <div class="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden">
              <div
                class={`h-full ${
                  toast.type === 'success' ? 'bg-emerald-600' :
                  toast.type === 'error' ? 'bg-red-600' :
                  'bg-fg-faint'
                }`}
                style="animation: toast-countdown 3.3s linear forwards; transform-origin: left"
              />
            </div>
          </Show>
        </div>
      )}</For>
    </div>
  )
}
