import { createSignal, For, Show } from 'solid-js'
import type { Wallet, WalletAccount } from '@talismn/connect-wallets'
import {
  getAvailableWallets,
  connectWallet,
  selectAccount as selectWalletAccount,
  signChallenge,
  disconnect,
} from '../lib/wallet'
import * as api from '../lib/api'
import { showToast } from './Toast'

interface Props {
  onClose: () => void
  onLogin: (user: { id: string; nickname?: string; email?: string; wallet_address?: string; balance: number }, token: string) => void
}

type Step = 'wallets' | 'accounts' | 'signing'

export default function WalletModal(props: Props) {
  const [step, setStep] = createSignal<Step>('wallets')
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal('')

  const wallets = getAvailableWallets()
  const installed = () => wallets.filter(w => w.installed)
  const notInstalled = () => wallets.filter(w => !w.installed)

  const [walletAccounts, setWalletAccounts] = createSignal<WalletAccount[]>([])

  async function handleConnect(wallet: Wallet) {
    setLoading(true)
    setError('')
    try {
      const accs = await connectWallet(wallet)
      setWalletAccounts(accs)
      if (accs.length === 1) {
        await handleSelectAccount(accs[0])
      } else {
        setStep('accounts')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to connect')
    } finally {
      setLoading(false)
    }
  }

  async function handleSelectAccount(account: WalletAccount) {
    selectWalletAccount(account)
    setStep('signing')
    setLoading(true)
    setError('')

    try {
      const { challenge } = await api.walletChallenge(account.address)
      const signature = await signChallenge(challenge, account.address)
      const auth = await api.walletVerify(account.address, challenge, signature)

      if (auth.token) {
        props.onLogin(
          {
            id: auth.user_id,
            nickname: auth.nickname,
            email: auth.email,
            wallet_address: auth.wallet_address,
            balance: auth.balance,
          },
          auth.token
        )
        showToast(`Wallet connected`, 'success')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'auth failed')
      setStep('accounts')
      disconnect()
    } finally {
      setLoading(false)
    }
  }

  function truncateAddress(addr: string): string {
    if (addr.length <= 16) return addr
    return addr.slice(0, 6) + '...' + addr.slice(-6)
  }

  return (
    <div
      class="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={props.onClose}
    >
      <div
        class="w-full max-w-xs bg-surface border-2 border-edge shadow-sharp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div class="titlebar">
          <span class="i-mdi-wallet w-4 h-4 text-accent" />
          <span class="text-accent-strong flex-1 font-heading">
            {step() === 'wallets' ? 'CONNECT WALLET' : step() === 'accounts' ? 'SELECT ACCOUNT' : 'SIGNING...'}
          </span>
          <button
            onClick={props.onClose}
            class="btn-win px-2 py-0.5 text-xs"
          >
            X
          </button>
        </div>

        <div style={{ padding: '12px' }}>
          {/* Error */}
          <Show when={error()}>
            <div class="text-[10px] text-red-600 mb-2 p-2 bg-red-50 border border-red-200">
              {error()}
            </div>
          </Show>

          {/* Step 1: Wallet list */}
          <Show when={step() === 'wallets'}>
            <Show when={installed().length > 0}>
              <div class="text-[10px] text-fg-muted uppercase mb-2 font-heading">Installed</div>
              <div class="flex flex-col gap-1.5 mb-3">
                <For each={installed()}>{(wallet) => (
                  <button
                    class="flex items-center gap-2 p-2 w-full text-left hover:bg-page border border-edge-soft transition-colors"
                    disabled={loading()}
                    onClick={() => handleConnect(wallet)}
                  >
                    <img
                      src={wallet.logo.src}
                      alt={wallet.logo.alt}
                      class="w-6 h-6"
                    />
                    <span class="flex-1 text-xs text-fg font-heading">{wallet.title}</span>
                    <Show when={loading()} fallback={
                      <span class="text-[10px] text-accent font-heading">CONNECT</span>
                    }>
                      <span class="text-[10px] text-accent animate-pulse">...</span>
                    </Show>
                  </button>
                )}</For>
              </div>
            </Show>

            <Show when={notInstalled().length > 0}>
              <div class="text-[10px] text-fg-muted uppercase mb-2 font-heading">Available</div>
              <div class="flex flex-col gap-1.5">
                <For each={notInstalled().slice(0, 4)}>{(wallet) => (
                  <a
                    href={wallet.installUrl}
                    target="_blank"
                    rel="noopener"
                    class="flex items-center gap-2 p-2 opacity-50 hover:opacity-75 border border-edge-soft transition-opacity"
                  >
                    <img
                      src={wallet.logo.src}
                      alt={wallet.logo.alt}
                      class="w-6 h-6 grayscale"
                    />
                    <span class="flex-1 text-xs text-fg-muted font-heading">{wallet.title}</span>
                    <span class="text-[10px] text-fg-faint font-heading">INSTALL</span>
                  </a>
                )}</For>
              </div>
            </Show>

            <Show when={installed().length === 0 && notInstalled().length === 0}>
              <div class="text-xs text-fg-muted text-center py-4">
                No Polkadot wallets detected.
                <br />
                <a href="https://talisman.xyz" target="_blank" rel="noopener" class="text-accent hover:underline">
                  Install Talisman
                </a>
              </div>
            </Show>
          </Show>

          {/* Step 2: Account list */}
          <Show when={step() === 'accounts'}>
            <div class="text-[10px] text-fg-muted uppercase mb-2 font-heading">Select Account</div>
            <div class="flex flex-col gap-1 max-h-60 overflow-y-auto">
              <For each={walletAccounts()}>{(account) => (
                <button
                  class="flex items-center gap-2 p-2 w-full text-left hover:bg-page border border-edge-soft transition-colors"
                  onClick={() => handleSelectAccount(account)}
                >
                  <span class="i-mdi-account-circle w-5 h-5 text-fg-muted" />
                  <div class="flex-1 min-w-0">
                    <div class="text-xs text-fg font-heading truncate">{account.name || 'Account'}</div>
                    <div class="text-[10px] text-fg-faint font-mono truncate">{truncateAddress(account.address)}</div>
                  </div>
                </button>
              )}</For>
            </div>
            <button
              class="mt-2 text-[10px] text-fg-muted hover:text-accent font-heading"
              onClick={() => { disconnect(); setStep('wallets') }}
            >
              BACK
            </button>
          </Show>

          {/* Step 3: Signing */}
          <Show when={step() === 'signing'}>
            <div class="text-center py-6">
              <span class="i-mdi-loading w-6 h-6 text-accent animate-spin block mx-auto mb-2" />
              <div class="text-xs text-fg-muted font-heading">SIGN THE CHALLENGE</div>
              <div class="text-[10px] text-fg-faint mt-1">Check your wallet extension</div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  )
}
