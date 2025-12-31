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
          class={`px-4 py-3 text-sm shadow-lg ${
            toast.type === 'success' ? 'bg-[#059669] text-white' :
            toast.type === 'error' ? 'bg-[#dc2626] text-white' :
            'bg-[#161b22] border border-white/10 text-white'
          }`}
          style="animation: slideIn 0.2s ease-out"
        >
          {toast.message}
        </div>
      )}</For>
    </div>
  )
}
