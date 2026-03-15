import { createSignal, createEffect, Show, For, onCleanup } from 'solid-js'
import { useStore } from '../lib/store'
import * as api from '../lib/api'
import { parseUnits } from 'viem'
import * as evm from '../lib/evm'
import PasskeyAuth from './PasskeyAuth'
import { hasPinLock, setPinLock, removePinLock } from './PinLock'
import { showToast } from './Toast'

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!isFinite(ms) || ms < 0) return 'just now'
  const s = Math.floor(ms / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

interface Props {
  onClose: () => void
}

type Tab = 'overview' | 'deposits' | 'api-keys' | 'history' | 'security' | 'private'

export default function ProfilePage(props: Props) {
  const { state: store, token, actions } = useStore()
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

  // Channel
  const [channelAmount, setChannelAmount] = createSignal('100')
  const [channelLoading, setChannelLoading] = createSignal(false)
  const [channelError, setChannelError] = createSignal<string | null>(null)

  // Buy TXT
  type PayMethod = 'DOT' | 'USDC' | 'USDT' | 'SONO'
  const [payMethod, setPayMethod] = createSignal<PayMethod>('DOT')
  const [buyAmount, setBuyAmount] = createSignal('')
  const [buyQuote, setBuyQuote] = createSignal<string | null>(null)
  const [buyLoading, setBuyLoading] = createSignal(false)
  const [buyError, setBuyError] = createSignal<string | null>(null)
  const [payBalance, setPayBalance] = createSignal<string | null>(null)

  // Avatar
  const AVATARS = [
    { id: 'haru', name: 'Haru', icon: 'i-mdi-face-woman', color: 'text-pink-500' },
    { id: 'hiyori', name: 'Hiyori', icon: 'i-mdi-face-woman-shimmer', color: 'text-purple-500' },
    { id: 'mao', name: 'Mao', icon: 'i-mdi-face-woman-outline', color: 'text-rose-500' },
    { id: 'mark', name: 'Mark', icon: 'i-mdi-face-man', color: 'text-blue-500' },
    { id: 'natori', name: 'Natori', icon: 'i-mdi-face-woman-profile', color: 'text-teal-500' },
    { id: 'rice', name: 'Rice', icon: 'i-mdi-face-agent', color: 'text-amber-500' },
    { id: 'wanko', name: 'Wanko', icon: 'i-mdi-dog', color: 'text-orange-500' },
  ]
  const [avatarSaving, setAvatarSaving] = createSignal(false)

  // Escape to close (blocked during wallet/payment operations)
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && !(e.target as HTMLElement).matches('input,textarea,select') && !channelLoading() && !buyLoading() && !checkoutLoading()) {
      props.onClose()
    }
  }
  window.addEventListener('keydown', onKeyDown)
  onCleanup(() => window.removeEventListener('keydown', onKeyDown))

  async function selectAvatar(id: string | null) {
    const tok = token()
    if (!tok) return
    setAvatarSaving(true)
    try {
      await api.updateProfile(tok, { avatar: id })
      actions.updateAvatar(id)
    } catch {}
    setAvatarSaving(false)
  }

  const tokenDecimals: Record<PayMethod, number> = { DOT: 18, USDC: 6, USDT: 6, SONO: 10 }
  const tokenAddresses: Record<string, import('viem').Address> = {
    USDC: evm.TOKENS.USDC,
    USDT: evm.TOKENS.USDT,
    SONO: evm.TOKENS.SONO,
  }

  // Fetch quote when amount or method changes
  let quoteTimer: ReturnType<typeof setTimeout> | undefined
  let quoteSeq = 0
  onCleanup(() => { if (quoteTimer) clearTimeout(quoteTimer) })
  createEffect(() => {
    const method = payMethod()
    const raw = buyAmount()
    setBuyQuote(null)
    setBuyError(null)
    if (quoteTimer) clearTimeout(quoteTimer)
    const val = parseFloat(raw)
    if (!raw || isNaN(val) || val <= 0) return
    const seq = ++quoteSeq
    quoteTimer = setTimeout(async () => {
      try {
        const dec = tokenDecimals[method]
        const parsed = parseUnits(raw, dec)
        let quote: string
        if (method === 'DOT') {
          quote = await evm.quoteBuyDot(parsed)
        } else {
          quote = await evm.quoteBuyToken(tokenAddresses[method], parsed)
        }
        if (seq === quoteSeq) setBuyQuote(quote)
      } catch {
        if (seq === quoteSeq) setBuyQuote(null)
      }
    }, 400)
  })

  // Fetch payment token balance when method changes
  createEffect(async () => {
    const method = payMethod()
    setPayBalance(null)
    if (!store.user?.wallet_address) return
    try {
      const dec = tokenDecimals[method]
      let bal: bigint
      if (method === 'DOT') {
        bal = await evm.getNativeBalance()
      } else {
        bal = await evm.getTokenBalance(tokenAddresses[method])
      }
      const { formatUnits } = await import('viem')
      setPayBalance(formatUnits(bal, dec))
    } catch {
      setPayBalance(null)
    }
  })

  async function handleBuyTxt() {
    if (buyLoading()) return
    const raw = buyAmount()
    const val = parseFloat(raw)
    if (!raw || isNaN(val) || val <= 0) return
    setBuyLoading(true)
    setBuyError(null)
    try {
      const method = payMethod()
      const dec = tokenDecimals[method]
      const parsed = parseUnits(raw, dec)
      if (method === 'DOT') {
        await evm.buyWithDot(parsed)
      } else {
        await evm.buyWithToken(tokenAddresses[method], parsed)
      }
      showToast('Purchase successful', 'success')
      setBuyAmount('')
      setBuyQuote(null)
    } catch (e: any) {
      setBuyError(e.message || 'Purchase failed')
    }
    setBuyLoading(false)
  }

  // Refresh SONO balance when wallet is connected
  createEffect(() => {
    if (store.user?.wallet_address) {
      evm.refresh().catch(() => {})
    }
  })

  async function handleOpenChannel() {
    const raw = channelAmount().trim()
    const val = parseFloat(raw)
    if (!raw || isNaN(val) || val <= 0) {
      setChannelError('Enter a valid positive amount')
      return
    }
    setChannelLoading(true)
    setChannelError(null)
    try {
      const isTopUp = !!evm.channelInfo()
      if (isTopUp) {
        await evm.topUp(raw)
      } else {
        await evm.openChannel(raw)
      }
      setChannelError(null)
      setChannelAmount('')
      showToast(isTopUp ? 'Channel topped up' : 'Channel opened', 'success')
    } catch (e: any) {
      setChannelError(e.message || 'Transaction failed')
    }
    setChannelLoading(false)
  }

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
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.stripe.com')) throw new Error('Unexpected checkout URL')
      window.location.href = url
    } catch (e) {
      setCheckoutError(e instanceof Error ? e.message : 'Checkout failed')
      setCheckoutLoading(false)
    }
  }

  function copyAddress(addr: string, type: string) {
    navigator.clipboard.writeText(addr).then(() => {
      setCopied(type)
      setTimeout(() => setCopied(null), 2000)
    }).catch(() => {})
  }

  const tabClass = (t: Tab) =>
    `px-3 py-2 cursor-pointer text-[10px] uppercase tracking-wider font-heading border-b-2 transition-colors ${
      tab() === t
        ? 'text-accent border-accent'
        : 'text-fg-muted hover:text-fg border-transparent'
    }`

  return (
    <div
      class="fixed inset-0 flex items-center justify-center z-50 p-4 bg-black/50"
      onClick={() => { if (!channelLoading() && !buyLoading() && !checkoutLoading()) props.onClose() }}
    >
      <div
        class="w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col bg-surface border-2 border-edge shadow-[var(--shadow)] animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div class="titlebar">
          <span class="i-mdi-account-circle w-5 h-5 text-accent" />
          <span class="text-accent-strong flex-1 text-xs font-heading font-semibold">
            {store.user?.nickname || store.user?.email || 'Profile'}
          </span>
          <button
            onClick={() => { if (!channelLoading() && !buyLoading() && !checkoutLoading()) props.onClose() }}
            class="text-fg-faint hover:text-accent p-1 transition-colors"
          >
            <span class="i-mdi-close w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div class="flex border-b border-edge-soft overflow-x-auto scroll-fade">
          <button class={tabClass('overview')} onClick={() => setTab('overview')}>Overview</button>
          <button class={tabClass('deposits')} onClick={() => setTab('deposits')}>Deposits</button>
          <button class={tabClass('api-keys')} onClick={() => setTab('api-keys')}>API Keys</button>
          <button class={tabClass('history')} onClick={() => setTab('history')}>History</button>
          <button class={tabClass('security')} onClick={() => setTab('security')}>Security</button>
          {/* <button class={tabClass('private')} onClick={() => setTab('private')}>Private</button> */}
        </div>

        {/* Content */}
        <div class="flex-1 overflow-y-auto p-4 min-h-[300px]">
          <Show when={loading()}>
            <div class="flex items-center justify-center py-8">
              <span class="i-mdi-loading w-5 h-5 text-accent animate-spin" />
            </div>
          </Show>
          {/* Overview Tab */}
          <Show when={tab() === 'overview'}>
            <div class="space-y-4">
              {/* Balance Card */}
              <div class="panel-inset p-4">
                <div class="text-[10px] text-fg-muted uppercase mb-1 font-heading">Account Balance</div>
                <div class="text-2xl text-accent font-mono">${store.user?.balance.toFixed(2)}</div>
                <Show when={parseFloat(evm.txtBalance()) > 0 || evm.channelInfo()}>
                  <div class="flex items-center gap-2 mt-2 pt-2 border-t border-edge-soft">
                    <span class="i-mdi-currency-eth w-3 h-3 text-fg-muted" />
                    <span class="text-xs text-fg font-mono">{evm.txtBalance()} TXT</span>
                    <Show when={evm.channelInfo()}>
                      <span class="text-[10px] text-accent">({evm.channelInfo()!.remaining} in channel)</span>
                    </Show>
                  </div>
                </Show>
                <div class="flex items-center gap-3 mt-2">
                  <span class="text-[10px] text-fg-muted">
                    ~{((store.user?.balance || 0) / 0.0000016 / 1000).toFixed(0)}k chars @ $1.60/M
                  </span>
                  <Show when={store.user?.wallet_address}>
                    <span class="text-[10px] text-fg-faint flex items-center gap-1">
                      <span class="i-mdi-wallet-outline w-3 h-3" />
                      {store.user!.wallet_address!.slice(0, 6)}...{store.user!.wallet_address!.slice(-4)}
                    </span>
                  </Show>
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

              {/* Avatar Selection */}
              <div class="panel-inset p-3">
                <div class="text-[10px] text-fg-muted uppercase mb-2 font-heading">Call Avatar</div>
                <div class="grid grid-cols-4 gap-2">
                  <button
                    class={`p-2 border-2 text-center transition-all ${
                      !store.user?.avatar
                        ? 'border-accent bg-accent-soft'
                        : 'border-edge-soft hover:border-accent'
                    }`}
                    onClick={() => selectAvatar(null)}
                    disabled={avatarSaving()}
                  >
                    <span class="i-mdi-account-off w-6 h-6 text-fg-faint block mx-auto" />
                    <span class="text-[10px] text-fg-muted block mt-1">None</span>
                  </button>
                  <For each={AVATARS}>
                    {(av) => (
                      <button
                        class={`p-2 border-2 text-center transition-all ${
                          store.user?.avatar === av.id
                            ? 'border-accent bg-accent-soft'
                            : 'border-edge-soft hover:border-accent'
                        }`}
                        onClick={() => selectAvatar(av.id)}
                        disabled={avatarSaving()}
                      >
                        <span class={`${av.icon} w-6 h-6 ${av.color} block mx-auto`} />
                        <span class="text-[10px] text-fg-muted block mt-1">{av.name}</span>
                      </button>
                    )}
                  </For>
                </div>
                <Show when={avatarSaving()}>
                  <div class="text-[10px] text-accent mt-1 animate-pulse font-heading uppercase">Saving...</div>
                </Show>
                <p class="text-[10px] text-fg-faint mt-2">
                  Choose a Live2D avatar for video calls. Your webcam drives the avatar's face tracking.
                </p>
              </div>

              {/* Logout */}
              <button
                class="w-full py-2.5 text-xs text-fg-muted hover:text-red-600 font-heading uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 border border-edge-soft hover:border-red-200"
                onClick={() => {
                  actions.logout()
                  showToast('Logged out', 'success')
                  props.onClose()
                }}
              >
                <span class="i-mdi-logout w-3.5 h-3.5" />
                Sign out
              </button>
            </div>
          </Show>

          {/* Deposits Tab */}
          <Show when={tab() === 'deposits'}>
            <div class="space-y-4">
              {/* TXT Balance */}
              <div class="panel-inset p-4">
                <div class="flex items-center justify-between mb-1">
                  <div class="flex items-center gap-2">
                    <span class="i-mdi-ethereum text-accent w-4 h-4" />
                    <span class="text-xs text-fg font-heading font-semibold">TXT Balance</span>
                  </div>
                  <span class="text-lg text-accent font-mono">{evm.txtBalance()} TXT</span>
                </div>
                <Show when={evm.channelInfo()}>
                  {(ch) => (
                    <div class="text-[10px] text-fg-muted">
                      {ch().remaining} TXT in active channel ({ch().spent} spent of {ch().deposit} deposited)
                    </div>
                  )}
                </Show>
              </div>

              {/* Buy TXT */}
              <div class="panel-inset p-4">
                <div class="flex items-center gap-2 mb-3">
                  <span class="i-mdi-swap-horizontal text-accent w-4 h-4" />
                  <span class="text-xs text-fg font-heading font-semibold">Buy TXT</span>
                </div>

                <Show when={store.user?.wallet_address} fallback={
                  <div class="text-xs text-fg-muted text-center py-2">
                    Connect a wallet to buy TXT tokens
                  </div>
                }>
                  <div class="space-y-3">
                    {/* Payment method selector */}
                    <div class="flex gap-1">
                      {(['DOT', 'USDC', 'USDT', 'SONO'] as const).map(m => (
                        <button
                          class={`flex-1 py-1.5 text-[10px] font-mono border-2 transition-all ${
                            payMethod() === m
                              ? 'border-accent bg-accent-soft text-accent-strong'
                              : 'border-edge-soft bg-surface text-fg-muted hover:border-accent'
                          }`}
                          onClick={() => setPayMethod(m)}
                        >
                          {m}
                        </button>
                      ))}
                    </div>

                    {/* Balance of selected token */}
                    <Show when={payBalance() !== null}>
                      <div class="text-[10px] text-fg-muted">
                        Available: <span class="font-mono text-fg">{payBalance()}</span> {payMethod()}
                      </div>
                    </Show>

                    {/* Amount + buy */}
                    <div class="flex gap-2">
                      <div class="flex-1 relative">
                        <input
                          type="number"
                          class="w-full px-2 py-1.5 pr-12 text-xs bg-surface border border-edge-soft text-fg font-mono"
                          value={buyAmount()}
                          onInput={(e) => setBuyAmount(e.currentTarget.value)}
                          placeholder={`Amount in ${payMethod()}`}
                          step="any"
                        />
                        <span class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-fg-muted font-mono">
                          {payMethod()}
                        </span>
                      </div>
                      <button
                        class="btn-win primary py-1.5 px-3 text-xs"
                        disabled={buyLoading() || !buyAmount()}
                        onClick={handleBuyTxt}
                      >
                        <Show when={buyLoading()} fallback="Buy">
                          <span class="animate-pulse">...</span>
                        </Show>
                      </button>
                    </div>

                    {/* Quote */}
                    <Show when={buyQuote()}>
                      <div class="text-xs text-fg bg-accent-soft border border-accent-muted p-2 font-mono text-center">
                        = {buyQuote()} TXT
                      </div>
                    </Show>

                    <Show when={buyError()}>
                      <div class="text-xs text-red-700 bg-red-50 border border-red-200 p-2">
                        {buyError()}
                      </div>
                    </Show>
                  </div>
                </Show>
              </div>

              {/* Payment Channel */}
              <div class="panel-inset p-4">
                <div class="flex items-center gap-2 mb-3">
                  <span class="i-mdi-lightning-bolt text-accent w-4 h-4" />
                  <span class="text-xs text-fg font-heading font-semibold">Payment Channel</span>
                </div>

                <Show when={store.user?.wallet_address} fallback={
                  <div class="text-xs text-fg-muted text-center py-2">
                    Connect a wallet to manage payment channels
                  </div>
                }>
                  <div class="space-y-3">
                    {/* Channel info */}
                    <Show when={evm.channelInfo()}>
                      {(ch) => {
                        const dep = () => parseFloat(ch().deposit) || 1
                        const spent = () => parseFloat(ch().spent) || 0
                        const pct = () => Math.min(100, (spent() / dep()) * 100)
                        return (
                          <div class="bg-accent-soft border border-accent-muted p-3">
                            <div class="text-[10px] text-accent-strong uppercase font-heading mb-2">Active Channel</div>
                            <div class="grid grid-cols-3 gap-2 text-center">
                              <div>
                                <div class="text-xs text-fg font-mono">{ch().deposit}</div>
                                <div class="text-[9px] text-fg-muted">deposited</div>
                              </div>
                              <div>
                                <div class="text-xs text-fg font-mono">{ch().spent}</div>
                                <div class="text-[9px] text-fg-muted">spent</div>
                              </div>
                              <div>
                                <div class="text-xs text-accent-strong font-mono font-bold">{ch().remaining}</div>
                                <div class="text-[9px] text-fg-muted">remaining</div>
                              </div>
                            </div>
                            <div class="mt-2 h-1.5 bg-page border border-edge-soft rounded-full overflow-hidden">
                              <div
                                class="h-full transition-all duration-300 rounded-full"
                                style={{ width: `${pct()}%`, background: pct() > 80 ? '#ef4444' : pct() > 50 ? '#f59e0b' : 'var(--accent)' }}
                              />
                            </div>
                            <div class="text-[9px] text-fg-faint mt-1 text-right">{pct().toFixed(0)}% used</div>
                          </div>
                        )
                      }}
                    </Show>

                    {/* Open / Top up */}
                    <div class="flex gap-2">
                      <input
                        type="number"
                        class="flex-1 px-2 py-1.5 text-xs bg-surface border border-edge-soft text-fg font-mono"
                        value={channelAmount()}
                        onInput={(e) => setChannelAmount(e.currentTarget.value)}
                        placeholder="TXT amount"
                      />
                      <button
                        class="btn-win primary py-1.5 px-3 text-xs"
                        disabled={channelLoading()}
                        onClick={handleOpenChannel}
                      >
                        <Show when={channelLoading()} fallback={
                          evm.channelInfo() ? 'Top Up' : 'Open Channel'
                        }>
                          <span class="animate-pulse">...</span>
                        </Show>
                      </button>
                    </div>

                    <Show when={channelError()}>
                      <div class="text-xs text-red-700 bg-red-50 border border-red-200 p-2">
                        {channelError()}
                      </div>
                    </Show>

                    <Show when={!evm.channelInfo()}>
                      <div class="text-[10px] text-fg-faint">
                        Open a payment channel to start using sonotxt with TXT tokens.
                        Only 2 on-chain transactions: open and close.
                      </div>
                    </Show>
                  </div>
                </Show>

                <Show when={evm.txError()}>
                  <div class="text-xs text-red-700 bg-red-50 border border-red-200 p-2 mt-2">
                    {evm.txError()}
                  </div>
                </Show>
              </div>

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
                              <span class="text-[9px] text-fg-faint ml-2">{timeAgo(dep.created_at)}</span>
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
                          <Show when={dep.tx_hash}>
                            <div class="text-[10px] mt-1 font-mono truncate">
                              <Show when={dep.chain === 'polkadot_assethub'} fallback={
                                <span class="text-fg-muted">{dep.tx_hash}</span>
                              }>
                                <a
                                  href={`https://assethub-polkadot.subscan.io/extrinsic/${dep.tx_hash}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  class="text-accent hover:text-accent-hover transition-colors"
                                >
                                  {dep.tx_hash}
                                </a>
                              </Show>
                            </div>
                          </Show>
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
                <button class="btn-win primary opacity-50 cursor-not-allowed" disabled>Generate API Key</button>
                <p class="text-[10px] text-fg-faint mt-2">Coming soon</p>
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
                      <div class="flex items-start gap-2">
                        <span class={`flex-shrink-0 mt-0.5 w-3.5 h-3.5 ${
                          item.type === 'speech' ? 'i-mdi-microphone text-accent' :
                          item.type === 'translate' ? 'i-mdi-translate text-purple-500' :
                          'i-mdi-volume-high text-fg-muted'
                        }`} />
                        <div class="flex-1 min-w-0">
                          <div class="text-xs text-fg truncate">{item.text}</div>
                          <div class="flex items-center gap-1.5 mt-1 text-[10px] text-fg-muted">
                            <Show when={item.voice}><span class="font-mono">{({'ryan':'Ryan','serena':'Serena','aiden':'Aiden','vivian':'Vivian','eric':'Eric','dylan':'Dylan','sohee':'Sohee','ono_anna':'Anna','uncle_fu':'Uncle Fu'} as Record<string,string>)[item.voice!] || item.voice}</span><span>&middot;</span></Show>
                            <span>{item.duration > 0 ? `${item.duration.toFixed(1)}s` : ''}</span>
                            <Show when={item.targetLang}><span>&middot;</span><span class="text-purple-400">&rarr; {({'en':'English','zh':'Chinese','ja':'Japanese','ko':'Korean','es':'Spanish','fr':'French','de':'German','pt':'Portuguese','ru':'Russian','ar':'Arabic','hi':'Hindi','fi':'Finnish','th':'Thai','vi':'Vietnamese','it':'Italian','tr':'Turkish'} as Record<string,string>)[item.targetLang!] || item.targetLang}</span></Show>
                          </div>
                        </div>
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
