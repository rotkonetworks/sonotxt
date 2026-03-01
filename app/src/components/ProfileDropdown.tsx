import { createSignal, Show } from 'solid-js'
import { useStore } from '../lib/store'

interface Props {
  onLogout: () => void
  onShowProfile: () => void
}

export default function ProfileDropdown(props: Props) {
  const { state: store } = useStore()
  const [open, setOpen] = createSignal(false)

  const formattedBalance = () => {
    if (!store.user) return null
    const bal = store.user.balance
    if (bal >= 1) return `$${bal.toFixed(2)}`
    if (bal >= 0.01) return `${(bal * 100).toFixed(0)}c`
    return `${(bal * 1000).toFixed(1)}m`
  }

  const displayName = () => {
    if (!store.user) return null
    const name = store.user.nickname || store.user.email?.split('@')[0] || 'anon'
    return name.length > 12 ? name.slice(0, 10) + '..' : name
  }

  return (
    <div class="relative">
      <button
        class="flex items-center gap-1.5 px-2 py-1 hover:bg-accent-soft transition-colors"
        onClick={() => setOpen(!open())}
      >
        <span class="text-[10px] text-accent font-mono">{formattedBalance()}</span>
        <span class="text-[10px] text-fg hidden sm:inline font-heading">{displayName()}</span>
        <span class={`i-mdi-chevron-down w-2.5 h-2.5 text-fg-faint transition-transform ${open() ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      <Show when={open()}>
        <div
          class="absolute right-0 top-full mt-1 z-50 min-w-[180px] bg-surface border-2 border-edge shadow-sharp"
        >
          {/* User info header */}
          <div class="px-3 py-2 border-b border-edge-soft">
            <div class="text-xs text-fg font-medium truncate">
              {store.user?.nickname || store.user?.email || 'Anonymous'}
            </div>
            <Show when={store.user?.email && store.user?.nickname}>
              <div class="text-[10px] text-fg-muted truncate">{store.user?.email}</div>
            </Show>
          </div>

          {/* Balance section */}
          <div class="px-3 py-2 border-b border-edge-soft">
            <div class="flex justify-between items-center">
              <span class="text-[10px] text-fg-muted uppercase">Balance</span>
              <span class="text-sm text-accent font-mono">${store.user?.balance.toFixed(2)}</span>
            </div>
          </div>

          {/* Menu items */}
          <div class="py-1">
            <button
              class="w-full px-3 py-2 text-left text-xs text-fg hover:bg-page flex items-center gap-2"
              onClick={() => { setOpen(false); props.onShowProfile() }}
            >
              <span class="i-mdi-account w-4 h-4 text-fg-muted" />
              Profile & Payments
            </button>
            <button
              class="w-full px-3 py-2 text-left text-xs text-fg hover:bg-page flex items-center gap-2"
              onClick={() => { setOpen(false); props.onShowProfile() }}
            >
              <span class="i-mdi-key w-4 h-4 text-fg-muted" />
              API Keys
            </button>
            <button
              class="w-full px-3 py-2 text-left text-xs text-fg hover:bg-page flex items-center gap-2"
              onClick={() => { setOpen(false); props.onShowProfile() }}
            >
              <span class="i-mdi-history w-4 h-4 text-fg-muted" />
              Usage History
            </button>
          </div>

          {/* Logout */}
          <div class="border-t border-edge-soft py-1">
            <button
              class="w-full px-3 py-2 text-left text-xs text-red-600 hover:bg-page flex items-center gap-2"
              onClick={() => { setOpen(false); props.onLogout() }}
            >
              <span class="i-mdi-logout w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </Show>

      {/* Click outside to close */}
      <Show when={open()}>
        <div
          class="fixed inset-0 z-40"
          onClick={() => setOpen(false)}
        />
      </Show>
    </div>
  )
}
