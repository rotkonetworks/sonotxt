import { createSignal, Show } from 'solid-js'
import { useStore } from '../lib/store'

interface Props {
  onLogout: () => void
  onShowProfile: () => void
}

export default function ProfileDropdown(props: Props) {
  const { state: store } = useStore()
  const [open, setOpen] = createSignal(false)

  // Format balance nicely
  const formattedBalance = () => {
    if (!store.user) return null
    const bal = store.user.balance
    if (bal >= 1) return `$${bal.toFixed(2)}`
    if (bal >= 0.01) return `${(bal * 100).toFixed(0)}c`
    return `${(bal * 1000).toFixed(1)}m`
  }

  // Truncate display name
  const displayName = () => {
    if (!store.user) return null
    const name = store.user.nickname || store.user.email?.split('@')[0] || 'anon'
    return name.length > 12 ? name.slice(0, 10) + '..' : name
  }

  return (
    <div class="relative">
      <button
        class="flex items-center gap-1.5 px-2 py-1 hover:bg-bg-light rounded transition-colors"
        onClick={() => setOpen(!open())}
      >
        {/* Avatar placeholder */}
        <div class="w-5 h-5 rounded-full bg-accent/30 flex items-center justify-center text-[10px] text-accent font-bold">
          {(store.user?.nickname?.[0] || store.user?.email?.[0] || '?').toUpperCase()}
        </div>

        {/* Name - hidden on mobile */}
        <span class="text-xs text-text-bright hidden sm:inline">{displayName()}</span>

        {/* Balance */}
        <span class="text-xs text-lcd-green font-mono">{formattedBalance()}</span>

        {/* Chevron */}
        <span class={`i-mdi-chevron-down w-3 h-3 text-text-dim transition-transform ${open() ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      <Show when={open()}>
        <div
          class="absolute right-0 top-full mt-1 z-50 min-w-[180px]"
          style={{
            background: 'linear-gradient(180deg, #21262d 0%, #161b22 100%)',
            border: '1px solid',
            'border-color': '#30363d #0d1117 #0d1117 #30363d',
            'box-shadow': '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          {/* User info header */}
          <div class="px-3 py-2 border-b border-border-dark">
            <div class="text-xs text-text-bright font-medium truncate">
              {store.user?.nickname || store.user?.email || 'Anonymous'}
            </div>
            <Show when={store.user?.email && store.user?.nickname}>
              <div class="text-[10px] text-text-dim truncate">{store.user?.email}</div>
            </Show>
          </div>

          {/* Balance section */}
          <div class="px-3 py-2 border-b border-border-dark">
            <div class="flex justify-between items-center">
              <span class="text-[10px] text-text-dim uppercase">Balance</span>
              <span class="text-sm text-lcd-green font-mono">${store.user?.balance.toFixed(2)}</span>
            </div>
          </div>

          {/* Menu items */}
          <div class="py-1">
            <button
              class="w-full px-3 py-2 text-left text-xs text-text hover:bg-bg-light flex items-center gap-2"
              onClick={() => { setOpen(false); props.onShowProfile() }}
            >
              <span class="i-mdi-account w-4 h-4 text-text-dim" />
              Profile & Payments
            </button>
            <button
              class="w-full px-3 py-2 text-left text-xs text-text hover:bg-bg-light flex items-center gap-2"
              onClick={() => { setOpen(false); props.onShowProfile() }}
            >
              <span class="i-mdi-key w-4 h-4 text-text-dim" />
              API Keys
            </button>
            <button
              class="w-full px-3 py-2 text-left text-xs text-text hover:bg-bg-light flex items-center gap-2"
              onClick={() => { setOpen(false); props.onShowProfile() }}
            >
              <span class="i-mdi-history w-4 h-4 text-text-dim" />
              Usage History
            </button>
          </div>

          {/* Logout */}
          <div class="border-t border-border-dark py-1">
            <button
              class="w-full px-3 py-2 text-left text-xs text-lcd-red hover:bg-bg-light flex items-center gap-2"
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
