// Polkadot wallet connection for SolidJS
// Adapted from create-dot-app Vue composable pattern

import { createSignal } from 'solid-js'
import { getWallets as getTalismanWallets } from '@talismn/connect-wallets'
import type { Wallet, WalletAccount } from '@talismn/connect-wallets'

const STORAGE_KEYS = {
  wallet: 'sonotxt_wallet',
  account: 'sonotxt_wallet_account',
} as const

const [wallets, setWallets] = createSignal<Wallet[]>([])
const [connectedWallet, setConnectedWallet] = createSignal<Wallet | null>(null)
const [accounts, setAccounts] = createSignal<WalletAccount[]>([])
const [selectedAccount, setSelectedAccount] = createSignal<WalletAccount | null>(null)
const [connecting, setConnecting] = createSignal(false)
const [error, setError] = createSignal('')

export {
  wallets,
  connectedWallet,
  accounts,
  selectedAccount,
  connecting,
  error,
}

export function getAvailableWallets(): Wallet[] {
  const all = getTalismanWallets()
  setWallets(all)
  return all
}

export async function connectWallet(wallet: Wallet): Promise<WalletAccount[]> {
  setConnecting(true)
  setError('')
  try {
    await wallet.enable('sonotxt')
    setConnectedWallet(wallet)
    localStorage.setItem(STORAGE_KEYS.wallet, wallet.extensionName)

    const accs = await wallet.getAccounts()
    setAccounts(accs)
    return accs
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'failed to connect wallet'
    setError(msg)
    throw e
  } finally {
    setConnecting(false)
  }
}

export function selectAccount(account: WalletAccount) {
  setSelectedAccount(account)
  localStorage.setItem(STORAGE_KEYS.account, account.address)
}

export function disconnect() {
  setConnectedWallet(null)
  setAccounts([])
  setSelectedAccount(null)
  localStorage.removeItem(STORAGE_KEYS.wallet)
  localStorage.removeItem(STORAGE_KEYS.account)
}

export async function signChallenge(challenge: string, address: string): Promise<string> {
  const wallet = connectedWallet()
  if (!wallet) throw new Error('no wallet connected')

  const signer = wallet.signer
  if (!signer?.signRaw) throw new Error('wallet does not support signRaw')

  const result = await signer.signRaw({
    address,
    data: `sonotxt:${challenge}`,
    type: 'bytes',
  })

  return result.signature
}

// Try to reconnect a previously connected wallet on load
export async function tryReconnect(): Promise<boolean> {
  const savedWallet = localStorage.getItem(STORAGE_KEYS.wallet)
  const savedAccount = localStorage.getItem(STORAGE_KEYS.account)
  if (!savedWallet) return false

  const all = getTalismanWallets()
  const wallet = all.find(w => w.extensionName === savedWallet && w.installed)
  if (!wallet) return false

  try {
    await wallet.enable('sonotxt')
    setConnectedWallet(wallet)
    const accs = await wallet.getAccounts()
    setAccounts(accs)

    if (savedAccount) {
      const acc = accs.find(a => a.address === savedAccount)
      if (acc) setSelectedAccount(acc)
    }
    return true
  } catch {
    disconnect()
    return false
  }
}
