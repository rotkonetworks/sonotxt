import { createSignal, createEffect, Show, For } from 'solid-js'
import { useStore } from '../lib/store'
import PasskeyAuth from './PasskeyAuth'

interface Props {
  onClose: () => void
}

type Tab = 'overview' | 'deposits' | 'api-keys' | 'history' | 'security' | 'private'

interface Deposit {
  id: string
  chain: string
  tx_hash: string
  asset: string
  amount: number
  status: string
  created_at: string
}

interface DepositAddresses {
  polkadot_assethub?: string
  penumbra?: string
}

const API = import.meta.env.VITE_API_URL || 'https://api.sonotxt.com'

export default function ProfilePage(props: Props) {
  const { state: store, token, actions } = useStore()
  const [tab, setTab] = createSignal<Tab>('overview')
  const [addresses, setAddresses] = createSignal<DepositAddresses>({})
  const [deposits, setDeposits] = createSignal<Deposit[]>([])
  const [loading, setLoading] = createSignal(false)
  const [copied, setCopied] = createSignal<string | null>(null)

  // Private mode local UI state (connection status is in store)
  const [teeUrl, setTeeUrl] = createSignal(localStorage.getItem('tee_url') || 'ws://localhost:4434/ws')
  const [teeConnecting, setTeeConnecting] = createSignal(false)
  const [teeError, setTeeError] = createSignal<string | null>(null)

  // Fetch deposit addresses and history
  createEffect(async () => {
    if (!token()) return
    setLoading(true)
    try {
      const [addrRes, depsRes] = await Promise.all([
        fetch(`${API}/payments/addresses`, {
          headers: { Authorization: `Bearer ${token()}` }
        }).then(r => r.json()),
        fetch(`${API}/payments/deposits`, {
          headers: { Authorization: `Bearer ${token()}` }
        }).then(r => r.json())
      ])
      setAddresses(addrRes)
      setDeposits(depsRes)
    } catch (e) {
      console.error('Failed to fetch payment info:', e)
    }
    setLoading(false)
  })

  async function copyAddress(addr: string, type: string) {
    await navigator.clipboard.writeText(addr)
    setCopied(type)
    setTimeout(() => setCopied(null), 2000)
  }

  const tabStyle = (t: Tab) => ({
    padding: '8px 16px',
    background: tab() === t ? '#21262d' : 'transparent',
    border: 'none',
    'border-bottom': tab() === t ? '2px solid #ec4899' : '2px solid transparent',
    color: tab() === t ? '#fff' : '#8b949e',
    cursor: 'pointer',
    'font-size': '11px',
    'text-transform': 'uppercase',
    'letter-spacing': '0.5px',
  })

  return (
    <div
      class="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.9)' }}
      onClick={props.onClose}
    >
      <div
        class="w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col"
        style={{
          background: 'linear-gradient(180deg, #21262d 0%, #161b22 100%)',
          border: '1px solid',
          'border-color': '#30363d #0d1117 #0d1117 #30363d',
          'box-shadow': '0 8px 32px rgba(0,0,0,0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            background: 'linear-gradient(180deg, #21262d 0%, #161b22 100%)',
            'border-bottom': '1px solid #0d1117',
            padding: '8px 12px',
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
          }}
        >
          <span class="i-mdi-account-circle" style={{ width: '20px', height: '20px', color: '#ec4899' }} />
          <span style={{ color: '#fff', flex: '1', 'font-size': '12px', 'font-weight': '600' }}>
            {store.user?.nickname || store.user?.email || 'Profile'}
          </span>
          <button
            onClick={props.onClose}
            style={{
              background: 'linear-gradient(180deg, #30363d 0%, #21262d 100%)',
              border: '1px solid',
              'border-color': '#484f58 #0d1117 #0d1117 #484f58',
              color: '#c9d1d9',
              cursor: 'pointer',
              'font-size': '11px',
              padding: '2px 8px',
            }}
          >
            X
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', 'border-bottom': '1px solid #21262d', 'overflow-x': 'auto' }}>
          <button style={tabStyle('overview')} onClick={() => setTab('overview')}>Overview</button>
          <button style={tabStyle('deposits')} onClick={() => setTab('deposits')}>Deposits</button>
          <button style={tabStyle('api-keys')} onClick={() => setTab('api-keys')}>API Keys</button>
          <button style={tabStyle('history')} onClick={() => setTab('history')}>History</button>
          <button style={tabStyle('security')} onClick={() => setTab('security')}>Security</button>
          <button style={tabStyle('private')} onClick={() => setTab('private')}>Private</button>
        </div>

        {/* Content */}
        <div class="flex-1 overflow-y-auto p-4" style={{ 'min-height': '300px' }}>
          {/* Overview Tab */}
          <Show when={tab() === 'overview'}>
            <div class="space-y-4">
              {/* Balance Card */}
              <div style={{
                background: '#0d1117',
                border: '1px solid #21262d',
                padding: '16px',
              }}>
                <div class="text-[10px] text-text-dim uppercase mb-1">Account Balance</div>
                <div class="text-2xl text-lcd-green font-mono">${store.user?.balance.toFixed(2)}</div>
                <div class="text-[10px] text-text-dim mt-2">
                  ~{((store.user?.balance || 0) / 0.0000016 / 1000).toFixed(0)}k chars @ $1.60/M
                </div>
              </div>

              {/* Quick Actions */}
              <div class="grid grid-cols-2 gap-2">
                <button
                  class="p-3 text-left"
                  style={{
                    background: 'linear-gradient(180deg, #21262d 0%, #161b22 100%)',
                    border: '1px solid #30363d',
                  }}
                  onClick={() => setTab('deposits')}
                >
                  <span class="i-mdi-wallet-plus text-accent w-5 h-5 mb-2" />
                  <div class="text-xs text-text-bright">Add Funds</div>
                  <div class="text-[10px] text-text-dim">Crypto or Card</div>
                </button>
                <button
                  class="p-3 text-left"
                  style={{
                    background: 'linear-gradient(180deg, #21262d 0%, #161b22 100%)',
                    border: '1px solid #30363d',
                  }}
                  onClick={() => setTab('api-keys')}
                >
                  <span class="i-mdi-key text-accent w-5 h-5 mb-2" />
                  <div class="text-xs text-text-bright">API Access</div>
                  <div class="text-[10px] text-text-dim">Manage keys</div>
                </button>
              </div>

              {/* Account Info */}
              <div style={{
                background: '#0d1117',
                border: '1px solid #21262d',
                padding: '12px',
              }}>
                <div class="text-[10px] text-text-dim uppercase mb-2">Account Details</div>
                <div class="space-y-2 text-xs">
                  <div class="flex justify-between">
                    <span class="text-text-dim">Nickname</span>
                    <span class="text-text-bright font-mono">{store.user?.nickname || '-'}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-text-dim">Email</span>
                    <span class="text-text-bright">{store.user?.email || '-'}</span>
                  </div>
                  <div class="flex justify-between">
                    <span class="text-text-dim">Account ID</span>
                    <span class="text-text-bright font-mono text-[10px]">{store.user?.id?.slice(0, 8)}...</span>
                  </div>
                </div>
              </div>
            </div>
          </Show>

          {/* Deposits Tab */}
          <Show when={tab() === 'deposits'}>
            <div class="space-y-4">
              {/* Crypto Addresses */}
              <div>
                <div class="text-[10px] text-text-dim uppercase mb-2">Deposit Addresses</div>

                {/* Polkadot Asset Hub */}
                <Show when={addresses().polkadot_assethub}>
                  <div style={{
                    background: '#0d1117',
                    border: '1px solid #21262d',
                    padding: '12px',
                    'margin-bottom': '8px',
                  }}>
                    <div class="flex items-center gap-2 mb-2">
                      <span class="i-mdi-circle text-[#e6007a] w-3 h-3" />
                      <span class="text-xs text-text-bright">Polkadot Asset Hub</span>
                      <span class="text-[10px] text-text-dim">(USDC/USDT)</span>
                    </div>
                    <div class="flex gap-2">
                      <code class="flex-1 text-[10px] text-lcd-green break-all bg-bg-dark p-2 rounded">
                        {addresses().polkadot_assethub}
                      </code>
                      <button
                        class="px-2 text-[10px]"
                        style={{
                          background: copied() === 'polkadot' ? '#065f46' : '#21262d',
                          border: '1px solid #30363d',
                          color: '#fff',
                        }}
                        onClick={() => copyAddress(addresses().polkadot_assethub!, 'polkadot')}
                      >
                        {copied() === 'polkadot' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </Show>

                {/* Penumbra */}
                <Show when={addresses().penumbra}>
                  <div style={{
                    background: '#0d1117',
                    border: '1px solid #21262d',
                    padding: '12px',
                  }}>
                    <div class="flex items-center gap-2 mb-2">
                      <span class="i-mdi-shield-lock text-purple-400 w-3 h-3" />
                      <span class="text-xs text-text-bright">Penumbra</span>
                      <span class="text-[10px] text-text-dim">(Shielded)</span>
                    </div>
                    <div class="flex gap-2">
                      <code class="flex-1 text-[10px] text-lcd-green break-all bg-bg-dark p-2 rounded">
                        {addresses().penumbra}
                      </code>
                      <button
                        class="px-2 text-[10px]"
                        style={{
                          background: copied() === 'penumbra' ? '#065f46' : '#21262d',
                          border: '1px solid #30363d',
                          color: '#fff',
                        }}
                        onClick={() => copyAddress(addresses().penumbra!, 'penumbra')}
                      >
                        {copied() === 'penumbra' ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </Show>

                <Show when={!addresses().polkadot_assethub && !addresses().penumbra && !loading()}>
                  <div class="text-xs text-text-dim p-4 text-center">
                    No deposit addresses available yet.
                  </div>
                </Show>
              </div>

              {/* Recent Deposits */}
              <div>
                <div class="text-[10px] text-text-dim uppercase mb-2">Recent Deposits</div>
                <Show when={deposits().length > 0} fallback={
                  <div class="text-xs text-text-dim p-4 text-center" style={{ background: '#0d1117', border: '1px solid #21262d' }}>
                    No deposits yet
                  </div>
                }>
                  <div class="space-y-1">
                    <For each={deposits()}>
                      {(dep) => (
                        <div style={{
                          background: '#0d1117',
                          border: '1px solid #21262d',
                          padding: '8px 12px',
                        }}>
                          <div class="flex justify-between items-center">
                            <div>
                              <span class="text-xs text-text-bright">{dep.amount} {dep.asset}</span>
                              <span class="text-[10px] text-text-dim ml-2">{dep.chain}</span>
                            </div>
                            <span class={`text-[10px] px-2 py-0.5 rounded ${
                              dep.status === 'confirmed' ? 'bg-green-900/50 text-green-400' :
                              dep.status === 'pending' ? 'bg-yellow-900/50 text-yellow-400' :
                              'bg-red-900/50 text-red-400'
                            }`}>
                              {dep.status}
                            </span>
                          </div>
                          <div class="text-[10px] text-text-dim mt-1 font-mono truncate">
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
              <div style={{
                background: '#0d1117',
                border: '1px solid #21262d',
                padding: '16px',
              }}>
                <div class="text-xs text-text-bright mb-2">API Access</div>
                <div class="text-[10px] text-text-dim mb-4">
                  Use API keys to integrate SonoTxt TTS into your applications.
                </div>
                <button style={{
                  background: 'linear-gradient(180deg, #ec4899 0%, #be185d 100%)',
                  border: '1px solid #f472b6',
                  color: '#fff',
                  padding: '8px 16px',
                  'font-size': '11px',
                  cursor: 'pointer',
                }}>
                  Generate API Key
                </button>
              </div>

              <div class="text-[10px] text-text-dim">
                API documentation coming soon.
              </div>
            </div>
          </Show>

          {/* History Tab */}
          <Show when={tab() === 'history'}>
            <div class="space-y-2">
              <div class="text-[10px] text-text-dim uppercase mb-2">Recent Generations</div>
              <Show when={store.history.length > 0} fallback={
                <div class="text-xs text-text-dim p-4 text-center" style={{ background: '#0d1117', border: '1px solid #21262d' }}>
                  No history yet
                </div>
              }>
                <For each={store.history.slice(0, 20)}>
                  {(item) => (
                    <div style={{
                      background: '#0d1117',
                      border: '1px solid #21262d',
                      padding: '8px 12px',
                    }}>
                      <div class="text-xs text-text-bright truncate">{item.text.slice(0, 60)}...</div>
                      <div class="flex justify-between mt-1">
                        <span class="text-[10px] text-text-dim">{item.voice}</span>
                        <span class="text-[10px] text-text-dim">{item.duration.toFixed(1)}s</span>
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
              {/* Passkey Section */}
              <div style={{
                background: '#0d1117',
                border: '1px solid #21262d',
                padding: '16px',
              }}>
                <div class="flex items-center gap-2 mb-3">
                  <span class="i-mdi-fingerprint text-accent w-5 h-5" />
                  <span class="text-sm text-text-bright font-semibold">Passkey Authentication</span>
                </div>
                <p class="text-xs text-text-dim mb-4">
                  Use your device's biometrics (fingerprint, face, or PIN) to encrypt your history locally.
                  No passwords to remember, and your data never leaves your device unencrypted.
                </p>
                <PasskeyAuth />
              </div>

              {/* Features List */}
              <div style={{
                background: '#0d1117',
                border: '1px solid #21262d',
                padding: '12px',
              }}>
                <div class="text-[10px] text-text-dim uppercase mb-2">Features</div>
                <div class="space-y-2 text-xs">
                  <div class="flex items-center gap-2">
                    <span class="i-mdi-check-circle text-green-400 w-4 h-4" />
                    <span class="text-text-dim">Works on Windows (Hello), macOS (Touch ID), Android, iOS</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="i-mdi-check-circle text-green-400 w-4 h-4" />
                    <span class="text-text-dim">PRF-derived encryption key (AES-256-GCM)</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="i-mdi-check-circle text-green-400 w-4 h-4" />
                    <span class="text-text-dim">Zero knowledge - server never sees your key</span>
                  </div>
                </div>
              </div>
            </div>
          </Show>

          {/* Private Mode Tab */}
          <Show when={tab() === 'private'}>
            <div class="space-y-4">
              {/* Description */}
              <div style={{
                background: '#0d1117',
                border: '1px solid #21262d',
                padding: '16px',
              }}>
                <div class="flex items-center gap-2 mb-2">
                  <span class="i-mdi-shield-lock text-purple-400 w-5 h-5" />
                  <span class="text-sm text-text-bright font-semibold">Private TTS Mode</span>
                </div>
                <p class="text-xs text-text-dim mb-3">
                  Connect directly to a TEE (Trusted Execution Environment) server for end-to-end encrypted inference.
                  Your text is encrypted in the browser using Noise protocol before being sent to the TEE,
                  ensuring the server operator cannot read your data.
                </p>
                <div class="flex items-center gap-2 text-[10px]">
                  <span class="i-mdi-check-circle text-green-400 w-3 h-3" />
                  <span class="text-text-dim">E2E Encrypted (Noise_NK)</span>
                  <span class="i-mdi-check-circle text-green-400 w-3 h-3 ml-2" />
                  <span class="text-text-dim">TEE Attested (SEV-SNP/TDX)</span>
                </div>
              </div>

              {/* Connection Form */}
              <div style={{
                background: '#0d1117',
                border: '1px solid #21262d',
                padding: '16px',
              }}>
                <div class="text-[10px] text-text-dim uppercase mb-3">Server Configuration</div>
                <div class="space-y-3">
                  <div>
                    <label class="text-[10px] text-text-dim block mb-1">WebSocket URL</label>
                    <input
                      type="text"
                      class="w-full px-3 py-2 bg-bg-dark border border-border-dark text-lcd-green font-mono text-xs rounded"
                      placeholder="ws://localhost:4434/ws"
                      value={teeUrl()}
                      onInput={(e) => {
                        setTeeUrl(e.currentTarget.value)
                        localStorage.setItem('tee_url', e.currentTarget.value)
                      }}
                    />
                  </div>

                  <Show when={teeError()}>
                    <div class="text-xs text-red-400 bg-red-900/20 p-2 rounded">
                      {teeError()}
                    </div>
                  </Show>

                  <Show when={store.tee.connected && store.tee.attestation}>
                    <div class="bg-green-900/20 border border-green-800 p-3 rounded">
                      <div class="flex items-center gap-2 text-green-400 text-xs mb-2">
                        <span class="i-mdi-check-circle w-4 h-4" />
                        Connected &amp; Verified
                      </div>
                      <div class="space-y-1 text-[10px]">
                        <div class="flex justify-between">
                          <span class="text-text-dim">TEE Type</span>
                          <span class="text-lcd-green font-mono">{store.tee.attestation?.teeType}</span>
                        </div>
                        <div class="flex justify-between">
                          <span class="text-text-dim">Static Key</span>
                          <span class="text-lcd-green font-mono truncate ml-2" style={{ 'max-width': '200px' }}>
                            {Array.from(store.tee.attestation?.staticKey.slice(0, 8) || []).map(b => b.toString(16).padStart(2, '0')).join('')}...
                          </span>
                        </div>
                      </div>
                    </div>
                  </Show>

                  <button
                    style={{
                      background: store.tee.connected
                        ? 'linear-gradient(180deg, #dc2626 0%, #991b1b 100%)'
                        : 'linear-gradient(180deg, #7c3aed 0%, #5b21b6 100%)',
                      border: '1px solid',
                      'border-color': store.tee.connected ? '#f87171' : '#a78bfa',
                      color: '#fff',
                      padding: '10px 20px',
                      'font-size': '11px',
                      cursor: teeConnecting() ? 'wait' : 'pointer',
                      width: '100%',
                    }}
                    disabled={teeConnecting()}
                    onClick={async () => {
                      if (store.tee.connected) {
                        actions.disconnectTee()
                        return
                      }

                      setTeeConnecting(true)
                      setTeeError(null)
                      try {
                        await actions.connectTee(teeUrl())
                      } catch (err) {
                        setTeeError(err instanceof Error ? err.message : 'Connection failed')
                      }
                      setTeeConnecting(false)
                    }}
                  >
                    <Show when={teeConnecting()} fallback={
                      store.tee.connected ? 'Disconnect' : 'Connect to TEE'
                    }>
                      <span class="animate-pulse">Connecting...</span>
                    </Show>
                  </button>
                </div>
              </div>

              {/* Warning */}
              <div class="text-[10px] text-text-dim">
                <span class="i-mdi-information-outline w-3 h-3 inline-block mr-1" />
                Private mode requires a running kokoro-tee server. In insecure mode, attestation is simulated.
              </div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
