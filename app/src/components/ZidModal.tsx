// ZID wallet connection modal - connect via zafu, view balance, get deposit info
import { createSignal, createEffect, Show, onCleanup } from 'solid-js'
import { zidAuth } from '../lib/zid-auth'
import * as api from '../lib/api'
import { showToast } from './Toast'

interface Props {
  onClose: () => void
  onLogin: (user: { id: string; nickname?: string; balance: number; wallet_address?: string }, token: string) => void
}

type Tab = 'connect' | 'account'

export default function ZidModal(props: Props) {
  const [tab, setTab] = createSignal<Tab>(zidAuth.identity() ? 'account' : 'connect')
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal('')
  const [balance, setBalance] = createSignal<number | null>(null)
  const [depositAddress, setDepositAddress] = createSignal('')
  const [depositMemo, setDepositMemo] = createSignal('')
  const [depositLoading, setDepositLoading] = createSignal(false)
  const [copied, setCopied] = createSignal<string | null>(null)

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape' && !loading()) props.onClose()
  }
  window.addEventListener('keydown', onKeyDown)
  onCleanup(() => window.removeEventListener('keydown', onKeyDown))

  // If already connected, load account info
  createEffect(() => {
    if (zidAuth.identity()) {
      setTab('account')
      loadBalance()
    }
  })

  async function handleConnect() {
    setLoading(true)
    setError('')
    try {
      const id = await zidAuth.connect()

      // Fetch user info from API
      try {
        const me = await api.zidGetMe()
        setBalance(me.balance)

        // Call the parent onLogin with ZID identity mapped to user shape
        const pk = id.walletPubkey || id.pubkey
        props.onLogin(
          {
            id: pk,
            nickname: id.name !== pk.slice(0, 8) ? id.name : undefined,
            balance: me.balance,
            wallet_address: pk,
          },
          `zid:${pk}` // synthetic token so store knows it is authenticated
        )
      } catch {
        // API may not have a ZID account yet - that is fine for free tier
        setBalance(null)
      }

      setTab('account')
      showToast('Zafu wallet connected', 'success')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'connection failed')
    } finally {
      setLoading(false)
    }
  }

  async function loadBalance() {
    try {
      const me = await api.zidGetMe()
      setBalance(me.balance)
    } catch {
      // not registered yet
    }
  }

  async function loadDeposit() {
    setDepositLoading(true)
    try {
      const info = await api.zidGetDepositAddress()
      setDepositAddress(info.address)
      setDepositMemo(info.memo)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'failed to load deposit info', 'error')
    } finally {
      setDepositLoading(false)
    }
  }

  function handleDisconnect() {
    zidAuth.disconnect()
    setTab('connect')
    setBalance(null)
    setDepositAddress('')
    setDepositMemo('')
  }

  async function copyToClipboard(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      showToast('Failed to copy', 'error')
    }
  }

  return (
    <div
      class="fixed inset-0 flex items-center justify-center z-50 p-4 bg-black/50"
      onClick={() => { if (!loading()) props.onClose() }}
    >
      <div
        class="w-full max-w-xs bg-surface border-2 border-edge shadow-[var(--shadow)] animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div class="titlebar">
          <span class="i-mdi-shield-key w-4 h-4 text-accent" />
          <span class="text-accent-strong flex-1 font-heading">
            {tab() === 'connect' ? 'CONNECT WITH ZAFU' : 'ZID ACCOUNT'}
          </span>
          <button
            onClick={() => { if (!loading()) props.onClose() }}
            class="text-fg-faint hover:text-accent p-1 transition-colors"
          >
            <span class="i-mdi-close w-4 h-4" />
          </button>
        </div>

        <div class="p-3">
          {/* Error */}
          <Show when={error()}>
            <div class="text-[10px] text-red-600 mb-2 p-2 bg-red-50 border border-red-200">
              {error()}
            </div>
          </Show>

          {/* Connect tab */}
          <Show when={tab() === 'connect'}>
            <div class="text-center py-4">
              <div class="w-14 h-14 rounded-full bg-accent-soft border-2 border-accent-muted flex items-center justify-center mx-auto mb-3">
                <span class="i-mdi-shield-key w-7 h-7 text-accent" />
              </div>
              <p class="text-xs text-fg mb-1 font-heading uppercase tracking-wider">
                Zafu ZID Wallet
              </p>
              <p class="text-[10px] text-fg-faint mb-4">
                Connect your zafu wallet for paid features. Free tier works without login.
              </p>
              <button
                class="btn-win primary w-full py-2.5 flex items-center justify-center gap-2 text-[11px] disabled:opacity-60"
                disabled={loading()}
                onClick={handleConnect}
              >
                <Show when={loading()}>
                  <span class="i-mdi-loading w-3.5 h-3.5 animate-spin" />
                </Show>
                <Show when={!loading()}>
                  <span class="i-mdi-shield-key w-3.5 h-3.5" />
                </Show>
                {loading() ? 'Connecting...' : 'Connect with zafu'}
              </button>
            </div>
          </Show>

          {/* Account tab */}
          <Show when={tab() === 'account'}>
            {/* Identity */}
            <div class="mb-3 p-2 bg-page border border-edge-soft">
              <div class="flex items-center gap-2 mb-1">
                <span class="i-mdi-shield-check w-4 h-4 text-accent" />
                <span class="text-[10px] text-fg-muted font-heading uppercase tracking-wider">Connected</span>
                <Show when={zidAuth.identity()?.mode === 'zafu'}>
                  <span class="text-[9px] text-accent bg-accent-soft px-1 py-0.5 font-heading uppercase">zafu</span>
                </Show>
                <Show when={zidAuth.identity()?.mode === 'ephemeral'}>
                  <span class="text-[9px] text-fg-faint bg-page px-1 py-0.5 font-heading uppercase border border-edge-soft">ephemeral</span>
                </Show>
              </div>
              <div class="font-mono text-xs text-fg break-all">
                {zidAuth.displayPubkey()}
              </div>
            </div>

            {/* Balance */}
            <div class="mb-3 p-2 bg-page border border-edge-soft flex items-center justify-between">
              <span class="text-[10px] text-fg-muted font-heading uppercase tracking-wider">Balance</span>
              <Show when={balance() !== null} fallback={
                <span class="text-[10px] text-fg-faint"> - </span>
              }>
                <span class="text-sm text-accent font-mono">${balance()!.toFixed(2)}</span>
              </Show>
            </div>

            {/* Deposit section */}
            <Show when={!depositAddress()}>
              <button
                class="btn-win w-full py-2 text-[10px] mb-2 flex items-center justify-center gap-1.5 disabled:opacity-60"
                disabled={depositLoading()}
                onClick={loadDeposit}
              >
                <Show when={depositLoading()}>
                  <span class="i-mdi-loading w-3 h-3 animate-spin" />
                </Show>
                <Show when={!depositLoading()}>
                  <span class="i-mdi-arrow-down-bold w-3 h-3" />
                </Show>
                {depositLoading() ? 'Loading...' : 'Get deposit address'}
              </button>
            </Show>

            <Show when={depositAddress()}>
              <div class="mb-3">
                <div class="text-[10px] text-fg-muted font-heading uppercase tracking-wider mb-1">
                  Deposit ZEC
                </div>

                {/* Address */}
                <div class="p-2 bg-page border border-edge-soft mb-1.5">
                  <div class="text-[9px] text-fg-faint font-heading uppercase tracking-wider mb-0.5">Address</div>
                  <div class="flex items-start gap-1">
                    <div class="font-mono text-[10px] text-fg break-all flex-1 leading-relaxed">
                      {depositAddress()}
                    </div>
                    <button
                      class="flex-shrink-0 p-1 hover:bg-accent-soft transition-colors"
                      onClick={() => copyToClipboard(depositAddress(), 'address')}
                      title="Copy address"
                    >
                      <span class={`w-3 h-3 ${copied() === 'address' ? 'i-mdi-check text-accent' : 'i-mdi-content-copy text-fg-faint'}`} />
                    </button>
                  </div>
                </div>

                {/* Memo */}
                <Show when={depositMemo()}>
                  <div class="p-2 bg-page border border-edge-soft">
                    <div class="text-[9px] text-fg-faint font-heading uppercase tracking-wider mb-0.5">Memo (required)</div>
                    <div class="flex items-start gap-1">
                      <div class="font-mono text-[10px] text-fg break-all flex-1 leading-relaxed">
                        {depositMemo()}
                      </div>
                      <button
                        class="flex-shrink-0 p-1 hover:bg-accent-soft transition-colors"
                        onClick={() => copyToClipboard(depositMemo(), 'memo')}
                        title="Copy memo"
                      >
                        <span class={`w-3 h-3 ${copied() === 'memo' ? 'i-mdi-check text-accent' : 'i-mdi-content-copy text-fg-faint'}`} />
                      </button>
                    </div>
                  </div>
                </Show>

                <p class="text-[9px] text-fg-faint mt-1.5">
                  Send ZEC to this address with the memo above. Balance updates within a few minutes.
                </p>
              </div>
            </Show>

            {/* Actions */}
            <div class="flex gap-1.5">
              <button
                class="btn-win flex-1 py-1.5 text-[10px] flex items-center justify-center gap-1"
                onClick={loadBalance}
              >
                <span class="i-mdi-refresh w-3 h-3" />
                Refresh
              </button>
              <button
                class="btn-win flex-1 py-1.5 text-[10px] text-red-600 flex items-center justify-center gap-1"
                onClick={handleDisconnect}
              >
                <span class="i-mdi-link-off w-3 h-3" />
                Disconnect
              </button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
