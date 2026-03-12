import { createSignal, createEffect, Show, For } from 'solid-js'
import { useStore } from '../lib/store'
import * as api from '../lib/api'
import PasskeyAuth from './PasskeyAuth'
import { hasPinLock, setPinLock, removePinLock } from './PinLock'

interface Props {
  onClose: () => void
}

type Tab = 'overview' | 'deposits' | 'api-keys' | 'history' | 'security' | 'private'

export default function ProfilePage(props: Props) {
  const { state: store, token } = useStore()
  const [tab, setTab] = createSignal<Tab>('overview')
  const [addresses, setAddresses] = createSignal<api.DepositAddresses>({})
  const [deposits, setDeposits] = createSignal<api.DepositEntry[]>([])
  const [loading, setLoading] = createSignal(false)
  const [copied, setCopied] = createSignal<string | null>(null)

  // Stripe checkout
  const [checkoutAmount, setCheckoutAmount] = createSignal(10)
  const [checkoutCurrency, setCheckoutCurrency] = createSignal('eur')
  const [checkoutLoading, setCheckoutLoading] = createSignal(false)
  const [checkoutError, setCheckoutError] = createSignal<string | null>(null)

  // TEE state — uncomment when private mode is ready
  // const [teeUrl, setTeeUrl] = createSignal(localStorage.getItem('tee_url') || 'ws://localhost:4434/ws')
  // const [teeConnecting, setTeeConnecting] = createSignal(false)
  // const [teeError, setTeeError] = createSignal<string | null>(null)

  createEffect(async () => {
    const tok = token()
    if (!tok) return
    setLoading(true)
    try {
      const [addrRes, depsRes] = await Promise.all([
        api.getDepositAddresses(tok),
        api.listDeposits(tok),
      ])
      setAddresses(addrRes)
      setDeposits(depsRes)
    } catch (e) {
      console.error('Failed to fetch payment info:', e)
    }
    setLoading(false)
  })

  async function startStripeCheckout() {
    const tok = token()
    if (!tok) return
    setCheckoutLoading(true)
    setCheckoutError(null)
    try {
      const { url } = await api.createStripeCheckout(tok, checkoutAmount(), checkoutCurrency())
      window.location.href = url
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : 'Checkout failed')
      setCheckoutLoading(false)
    }
  }

  async function copyAddress(addr: string, type: string) {
    await navigator.clipboard.writeText(addr)
    setCopied(type)
    setTimeout(() => setCopied(null), 2000)
  }

  const tabClass = (t: Tab) =>
    `px-4 py-2 border-none cursor-pointer text-xs uppercase tracking-wider font-heading ${
      tab() === t
        ? 'bg-surface text-accent border-b-2 border-accent'
        : 'bg-transparent text-fg-muted hover:text-fg'
    }`

  return (
    <div
      class="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={props.onClose}
    >
      <div
        class="w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col bg-surface border-2 border-edge shadow-sharp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div class="titlebar">
          <span class="i-mdi-account-circle w-5 h-5 text-accent" />
          <span class="text-accent-strong flex-1 text-xs font-heading font-semibold">
            {store.user?.nickname || store.user?.email || 'Profile'}
          </span>
          <button
            onClick={props.onClose}
            class="btn-win px-2 py-0.5 text-xs"
          >
            X
          </button>
        </div>

        {/* Tabs */}
        <div class="flex border-b border-edge-soft overflow-x-auto">
          <button class={tabClass('overview')} onClick={() => setTab('overview')}>Overview</button>
          <button class={tabClass('deposits')} onClick={() => setTab('deposits')}>Deposits</button>
          <button class={tabClass('api-keys')} onClick={() => setTab('api-keys')}>API Keys</button>
          <button class={tabClass('history')} onClick={() => setTab('history')}>History</button>
          <button class={tabClass('security')} onClick={() => setTab('security')}>Security</button>
          {/* <button class={tabClass('private')} onClick={() => setTab('private')}>Private</button> */}
        </div>

        {/* Content */}
        <div class="flex-1 overflow-y-auto p-4" style={{ 'min-height': '300px' }}>
          {/* Overview Tab */}
          <Show when={tab() === 'overview'}>
            <div class="space-y-4">
              {/* Balance Card */}
              <div class="panel-inset p-4">
                <div class="text-[10px] text-fg-muted uppercase mb-1 font-heading">Account Balance</div>
                <div class="text-2xl text-accent font-mono">${store.user?.balance.toFixed(2)}</div>
                <div class="text-[10px] text-fg-muted mt-2">
                  ~{((store.user?.balance || 0) / 0.0000016 / 1000).toFixed(0)}k chars @ $1.60/M
                </div>
              </div>

              {/* Quick Actions */}
              <div class="grid grid-cols-2 gap-2">
                <button
                  class="panel-inset p-3 text-left cursor-pointer hover:bg-accent-soft transition-colors"
                  onClick={() => setTab('deposits')}
                >
                  <span class="i-mdi-wallet-plus text-accent w-5 h-5 mb-2" />
                  <div class="text-xs text-fg">Add Funds</div>
                  <div class="text-[10px] text-fg-muted">Crypto or Card</div>
                </button>
                <button
                  class="panel-inset p-3 text-left cursor-pointer hover:bg-accent-soft transition-colors"
                  onClick={() => setTab('api-keys')}
                >
                  <span class="i-mdi-key text-accent w-5 h-5 mb-2" />
                  <div class="text-xs text-fg">API Access</div>
                  <div class="text-[10px] text-fg-muted">Manage keys</div>
                </button>
              </div>

              {/* Account Info */}
              <div class="panel-inset p-3">
                <div class="text-[10px] text-fg-muted uppercase mb-2 font-heading">Account Details</div>
                <div class="space-y-2 text-xs">
                  <div class="flex justify-between">
                    <span class="text-fg-muted">Nickname</span>
                    <span class="text-fg font-mono">{store.user?.nickname || '-'}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-fg-muted">Email</span>
                    <span class="text-fg">{store.user?.email || '-'}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-fg-muted">Account ID</span>
                    <span class="text-fg font-mono text-[10px]">{store.user?.id?.slice(0, 8)}...</span>
                  </div>
                </div>
              </div>
            </div>
          </Show>

          {/* Deposits Tab */}
          <Show when={tab() === 'deposits'}>
            <div class="space-y-4">
              {/* Card Payment */}
              <div class="panel-inset p-4">
                <div class="flex items-center gap-2 mb-3">
                  <span class="i-mdi-credit-card text-accent w-4 h-4" />
                  <span class="text-xs text-fg font-heading font-semibold">Pay with Card</span>
                </div>

                <div class="flex gap-2 mb-3">
                  {[5, 10, 25, 50].map(amt => (
                    <button
                      class={`flex-1 py-2 text-xs font-mono border-2 transition-all ${
                        checkoutAmount() === amt
                          ? 'border-accent bg-accent-soft text-accent-strong'
                          : 'border-edge-soft bg-surface text-fg-muted hover:border-accent'
                      }`}
                      onClick={() => setCheckoutAmount(amt)}
                    >
                      {checkoutCurrency() === 'eur' ? '\u20AC' : '$'}{amt}
                    </button>
                  ))}
                </div>

                <div class="flex gap-2 mb-3">
                  <select
                    class="px-2 py-1.5 text-xs bg-surface border border-edge-soft text-fg font-mono"
                    value={checkoutCurrency()}
                    onChange={(e) => setCheckoutCurrency(e.currentTarget.value)}
                  >
                    <option value="eur">EUR</option>
                    <option value="usd">USD</option>
                  </select>
                  <button
                    class="flex-1 btn-win primary py-2 text-xs flex items-center justify-center gap-2"
                    disabled={checkoutLoading()}
                    onClick={startStripeCheckout}
                  >
                    <Show when={checkoutLoading()} fallback={
                      <>
                        <span class="i-mdi-lock w-3 h-3" />
                        Pay {checkoutCurrency() === 'eur' ? '\u20AC' : '$'}{checkoutAmount()}
                      </>
                    }>
                      <span class="animate-pulse">Redirecting...</span>
                    </Show>
                  </button>
                </div>

                <div class="text-[10px] text-fg-faint">
                  ~{(checkoutAmount() / 0.0000016 / 1000000).toFixed(1)}M chars at $1.60/M
                </div>

                <Show when={checkoutError()}>
                  <div class="text-xs text-red-700 bg-red-50 border border-red-200 p-2 mt-2">
                    {checkoutError()}
                  </div>
                </Show>
              </div>

              {/* Crypto Deposit Addresses */}
              <div>
                <div class="text-[10px] text-fg-muted uppercase mb-2 font-heading">Crypto Deposits</div>

                <Show when={addresses().polkadot_assethub}>
                  <div class="panel-inset p-3 mb-2">
                    <div class="flex items-center gap-2 mb-2">
                      <span class="i-mdi-circle text-[#e6007a] w-3 h-3" />
                      <span class="text-xs text-fg">Polkadot Asset Hub</span>
                      <span class="text-[10px] text-fg-muted">(USDC/USDT)</span>
                    </div>
                    <div class="flex gap-2">
                      <code class="flex-1 text-[10px] text-accent break-all bg-surface p-2 border border-edge-soft font-mono">
                        {addresses().polkadot_assethub}
                      </code>
                      <button
                        class={`btn-win text-[10px] ${copied() === 'polkadot' ? 'bg-emerald-100 text-emerald-800' : ''}`}
                        onClick={() => copyAddress(addresses().polkadot_assethub!, 'polkadot')}
                      >
                        {copied() === 'polkadot' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </Show>

                <Show when={addresses().penumbra}>
                  <div class="panel-inset p-3 mb-2">
                    <div class="flex items-center gap-2 mb-2">
                      <span class="i-mdi-shield-lock text-purple-400 w-3 h-3" />
                      <span class="text-xs text-fg">Penumbra</span>
                      <span class="text-[10px] text-fg-muted">(Shielded)</span>
                    </div>
                    <div class="flex gap-2">
                      <code class="flex-1 text-[10px] text-accent break-all bg-surface p-2 border border-edge-soft font-mono">
                        {addresses().penumbra}
                      </code>
                      <button
                        class={`btn-win text-[10px] ${copied() === 'penumbra' ? 'bg-emerald-100 text-emerald-800' : ''}`}
                        onClick={() => copyAddress(addresses().penumbra!, 'penumbra')}
                      >
                        {copied() === 'penumbra' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </Show>

                <Show when={!addresses().polkadot_assethub && !addresses().penumbra && !loading()}>
                  <div class="text-xs text-fg-muted p-4 text-center">
                    No crypto deposit addresses available yet.
                  </div>
                </Show>
              </div>

              {/* Recent Deposits */}
              <div>
                <div class="text-[10px] text-fg-muted uppercase mb-2 font-heading">Recent Deposits</div>
                <Show when={deposits().length > 0} fallback={
                  <div class="panel-inset text-xs text-fg-muted p-4 text-center">
                    No deposits yet
                  </div>
                }>
                  <div class="space-y-1">
                    <For each={deposits()}>
                      {(dep) => (
                        <div class="panel-inset p-2">
                          <div class="flex justify-between items-center">
                            <div>
                              <span class="text-xs text-fg">{dep.amount} {dep.asset}</span>
                              <span class="text-[10px] text-fg-muted ml-2">{dep.chain}</span>
                            </div>
                            <span class={`text-[10px] px-2 py-0.5 ${
                              dep.status === 'credited' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                              dep.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                              dep.status === 'pending' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                              'bg-red-50 text-red-700 border border-red-200'
                            }`}>
                              {dep.status}
                            </span>
                          </div>
                          <div class="text-[10px] text-fg-muted mt-1 font-mono truncate">
                            {dep.tx_hash}
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          </Show>

          {/* API Keys Tab */}
          <Show when={tab() === 'api-keys'}>
            <div class="space-y-4">
              <div class="panel-inset p-4">
                <div class="text-xs text-fg mb-2 font-heading">API Access</div>
                <div class="text-[10px] text-fg-muted mb-4">
                  Use API keys to integrate sonotxt TTS into your applications.
                </div>
                <button class="btn-win primary">Generate API Key</button>
              </div>

              <div class="text-[10px] text-fg-muted">
                API documentation coming soon.
              </div>
            </div>
          </Show>

          {/* History Tab */}
          <Show when={tab() === 'history'}>
            <div class="space-y-2">
              <div class="text-[10px] text-fg-muted uppercase mb-2 font-heading">Recent Generations</div>
              <Show when={store.history.length > 0} fallback={
                <div class="panel-inset text-xs text-fg-muted p-4 text-center">
                  No history yet
                </div>
              }>
                <For each={store.history.slice(0, 20)}>
                  {(item) => (
                    <div class="panel-inset p-2">
                      <div class="text-xs text-fg truncate">{item.text.slice(0, 60)}...</div>
                      <div class="flex justify-between mt-1">
                        <span class="text-[10px] text-fg-muted">{item.voice}</span>
                        <span class="text-[10px] text-fg-muted">{item.duration.toFixed(1)}s</span>
                      </div>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </Show>

          {/* Security Tab */}
          <Show when={tab() === 'security'}>
            <div class="space-y-4">
              {/* PIN Lock */}
              {(() => {
                const [pinEnabled, setPinEnabled] = createSignal(hasPinLock())
                const [newPin, setNewPin] = createSignal('')
                const [confirmPin, setConfirmPin] = createSignal('')
                const [pinError, setPinError] = createSignal('')
                const [showPinSetup, setShowPinSetup] = createSignal(false)

                async function handleSetPin() {
                  if (newPin().length !== 4) {
                    setPinError('PIN must be 4 digits')
                    return
                  }
                  if (!/^\d{4}$/.test(newPin())) {
                    setPinError('PIN must be numbers only')
                    return
                  }
                  if (newPin() !== confirmPin()) {
                    setPinError('PINs do not match')
                    return
                  }
                  await setPinLock(newPin())
                  setPinEnabled(true)
                  setShowPinSetup(false)
                  setNewPin('')
                  setConfirmPin('')
                  setPinError('')
                }

                function handleRemovePin() {
                  removePinLock()
                  setPinEnabled(false)
                }

                return (
                  <div class="panel-inset p-4">
                    <div class="flex items-center gap-2 mb-3">
                      <span class="i-mdi-lock text-accent w-5 h-5" />
                      <span class="text-sm text-fg font-heading font-semibold">PIN Lock</span>
                    </div>
                    <p class="text-xs text-fg-muted mb-3">
                      Require a 4-digit PIN to access the app. Stored locally on this device.
                    </p>

                    <Show when={pinEnabled() && !showPinSetup()}>
                      <div class="flex items-center gap-2 mb-3">
                        <span class="i-mdi-check-circle text-emerald-600 w-4 h-4" />
                        <span class="text-xs text-emerald-700">PIN lock enabled</span>
                      </div>
                      <div class="flex gap-2">
                        <button class="btn-win text-xs" onClick={() => setShowPinSetup(true)}>Change PIN</button>
                        <button class="btn-win text-xs text-red-600 hover:text-red-700" onClick={handleRemovePin}>Remove PIN</button>
                      </div>
                    </Show>

                    <Show when={!pinEnabled() && !showPinSetup()}>
                      <button class="btn-win primary text-xs" onClick={() => setShowPinSetup(true)}>Set PIN</button>
                    </Show>

                    <Show when={showPinSetup()}>
                      <div class="space-y-2">
                        <div>
                          <label class="text-[10px] text-fg-muted uppercase font-heading block mb-1">New PIN</label>
                          <input
                            type="password"
                            inputmode="numeric"
                            pattern="[0-9]*"
                            maxLength={4}
                            class="w-full px-3 py-2 bg-surface border border-edge-soft text-fg font-mono text-sm tracking-[0.5em] text-center"
                            placeholder="······"
                            value={newPin()}
                            onInput={(e) => { setNewPin(e.currentTarget.value); setPinError('') }}
                          />
                        </div>
                        <div>
                          <label class="text-[10px] text-fg-muted uppercase font-heading block mb-1">Confirm PIN</label>
                          <input
                            type="password"
                            inputmode="numeric"
                            pattern="[0-9]*"
                            maxLength={4}
                            class="w-full px-3 py-2 bg-surface border border-edge-soft text-fg font-mono text-sm tracking-[0.5em] text-center"
                            placeholder="······"
                            value={confirmPin()}
                            onInput={(e) => { setConfirmPin(e.currentTarget.value); setPinError('') }}
                          />
                        </div>
                        <Show when={pinError()}>
                          <p class="text-[10px] text-red-600">{pinError()}</p>
                        </Show>
                        <div class="flex gap-2">
                          <button class="btn-win primary text-xs" onClick={handleSetPin}>Save PIN</button>
                          <button class="btn-win text-xs" onClick={() => { setShowPinSetup(false); setNewPin(''); setConfirmPin(''); setPinError('') }}>Cancel</button>
                        </div>
                      </div>
                    </Show>
                  </div>
                )
              })()}

              <div class="panel-inset p-4">
                <div class="flex items-center gap-2 mb-3">
                  <span class="i-mdi-fingerprint text-accent w-5 h-5" />
                  <span class="text-sm text-fg font-heading font-semibold">Passkey Authentication</span>
                </div>
                <p class="text-xs text-fg-muted mb-4">
                  Use your device's biometrics (fingerprint, face, or PIN) to encrypt your history locally.
                  No passwords to remember, and your data never leaves your device unencrypted.
                </p>
                <PasskeyAuth />
              </div>

              <div class="panel-inset p-3">
                <div class="text-[10px] text-fg-muted uppercase mb-2 font-heading">Features</div>
                <div class="space-y-2 text-xs">
                  <div class="flex items-center gap-2">
                    <span class="i-mdi-check-circle text-emerald-600 w-4 h-4" />
                    <span class="text-fg-muted">Works on Windows (Hello), macOS (Touch ID), Android, iOS</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="i-mdi-check-circle text-emerald-600 w-4 h-4" />
                    <span class="text-fg-muted">PRF-derived encryption key (AES-256-GCM)</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="i-mdi-check-circle text-emerald-600 w-4 h-4" />
                    <span class="text-fg-muted">Zero knowledge - server never sees your key</span>
                  </div>
                </div>
              </div>
            </div>
          </Show>

          {/* Private Mode Tab — commented out until TEE server is ready
          <Show when={tab() === 'private'}>
            ...
          </Show>
          */}
        </div>
      </div>
    </div>
  )
}
