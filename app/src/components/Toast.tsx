import { createSignal, For } from 'solid-js'

interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

const [toasts, setToasts] = createSignal<ToastItem[]>([])
let nextId = 0

export function showToast(message: string, type: ToastItem['type'] = 'info') {
  const id = nextId++
  setToasts(t => [...t, { id, message, type }])
  setTimeout(() => {
    setToasts(t => t.filter(toast => toast.id !== id))
  }, 3000)
}

export function ToastContainer() {
  return (
    <div class="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      <For each={toasts()}>{toast => (
        <div
          class={`px-4 py-3 text-sm border-2 ${
            toast.type === 'success' ? 'bg-emerald-50 border-emerald-700 text-emerald-800' :
            toast.type === 'error' ? 'bg-red-50 border-red-700 text-red-800' :
            'bg-surface border-edge text-fg'
          }`}
          style="animation: slideIn 0.2s ease-out; box-shadow: var(--shadow)"
        >
          {toast.message}
        </div>
      )}</For>
    </div>
  )
}
