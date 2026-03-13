// TXT contract interaction via PAPI + Polkadot wallet
// Uses Revive.call to call the contract from a Substrate account

import { createSignal } from 'solid-js'
import { createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws-provider/web'
import { connectInjectedExtension } from 'polkadot-api/pjs-signer'
import { paseo_ah } from '@polkadot-api/descriptors'
import {
  createPublicClient,
  http,
  formatUnits,
  encodeFunctionData,
  type Address,
} from 'viem'
import { assetHubChain, SUBSTRATE_RPC, CONTRACT_ADDRESS, TXT_ABI, TXT_DECIMALS } from './contract'
import { connectedWallet, selectedAccount } from './wallet'

// Reactive state
const [txtBalance, setTxtBalance] = createSignal<string>('0')
const [channelInfo, setChannelInfo] = createSignal<{
  deposit: string
  spent: string
  remaining: string
  nonce: number
  isOpen: boolean
  isClosing: boolean
} | null>(null)
const [txPending, setTxPending] = createSignal(false)
const [txError, setTxError] = createSignal<string | null>(null)

// sonotxt service address — where users open channels to
const SONOTXT_SERVICE: Address = (import.meta.env.VITE_SERVICE_ADDRESS || '0xe819D7B8c05dE5d1e5E067eBc85DCcB562738E0B') as Address

// Read-only viem client for contract reads (eth-RPC)
function readClient() {
  return createPublicClient({ chain: assetHubChain, transport: http() })
}

// Get the user's mapped EVM address from their Substrate account
// pallet-revive maps SS58 → H160 deterministically
async function getEvmAddress(): Promise<Address | null> {
  const account = selectedAccount()
  if (!account) return null

  // Use the Revive runtime API to get the mapped address
  try {
    const client = createClient(getWsProvider(SUBSTRATE_RPC))
    const api = client.getTypedApi(paseo_ah)
    const addr = await api.apis.ReviveApi.address(account.address)
    client.destroy()
    return addr as unknown as Address
  } catch {
    return null
  }
}

// Refresh balance and channel info for the connected wallet
async function refresh() {
  const account = selectedAccount()
  if (!account) return

  const evmAddr = await getEvmAddress()
  if (!evmAddr) return

  const client = readClient()

  // Get TXT balance
  const bal = await client.readContract({
    address: CONTRACT_ADDRESS,
    abi: TXT_ABI,
    functionName: 'balanceOf',
    args: [evmAddr],
  })
  setTxtBalance(formatUnits(bal, TXT_DECIMALS))

  // Get channel to sonotxt service
  const [deposit, spent, nonce, expiresAt] = await client.readContract({
    address: CONTRACT_ADDRESS,
    abi: TXT_ABI,
    functionName: 'getChannel',
    args: [evmAddr, SONOTXT_SERVICE],
  })

  if (deposit > 0n) {
    setChannelInfo({
      deposit: formatUnits(deposit, TXT_DECIMALS),
      spent: formatUnits(spent, TXT_DECIMALS),
      remaining: formatUnits(deposit - spent, TXT_DECIMALS),
      nonce: Number(nonce),
      isOpen: true,
      isClosing: expiresAt > 0n,
    })
  } else {
    setChannelInfo(null)
  }
}

// Submit a contract call via Revive.call extrinsic (signed by Polkadot wallet)
async function submitContractCall(functionName: string, args: any[]) {
  const account = selectedAccount()
  const wallet = connectedWallet()
  if (!account || !wallet) throw new Error('No wallet connected')

  setTxPending(true)
  setTxError(null)

  try {
    // Encode the EVM call data
    const data = encodeFunctionData({
      abi: TXT_ABI,
      functionName: functionName as any,
      args: args as any,
    })

    // Connect PAPI to Asset Hub
    const client = createClient(getWsProvider(SUBSTRATE_RPC))
    const api = client.getTypedApi(paseo_ah)

    // Get signer from injected extension
    const ext = await connectInjectedExtension(wallet.extensionName)
    const papiAccounts = ext.getAccounts()
    const signer = papiAccounts.find(a => a.address === account.address)
    if (!signer) throw new Error('Account not found in extension')

    // Submit Revive.call extrinsic
    const tx = api.tx.Revive.call({
      dest: CONTRACT_ADDRESS as any,
      value: 0n,
      weight_limit: { ref_time: 500_000_000_000n, proof_size: 500_000n },
      storage_deposit_limit: 1_000_000_000_000n,
      data: data as any,
    })

    await tx.signAndSubmit(signer.polkadotSigner)

    client.destroy()
    await refresh()
  } catch (e: any) {
    setTxError(e.message || 'Transaction failed')
    throw e
  } finally {
    setTxPending(false)
  }
}

// Open channel to sonotxt
async function openChannel(amount: string) {
  const parsedAmount = BigInt(Math.round(parseFloat(amount) * 10 ** TXT_DECIMALS))
  await submitContractCall('openChannel', [SONOTXT_SERVICE, parsedAmount])
}

// Top up existing channel
async function topUp(amount: string) {
  const parsedAmount = BigInt(Math.round(parseFloat(amount) * 10 ** TXT_DECIMALS))
  await submitContractCall('topUp', [SONOTXT_SERVICE, parsedAmount])
}

export {
  txtBalance,
  channelInfo,
  txPending,
  txError,
  SONOTXT_SERVICE,
  refresh,
  openChannel,
  topUp,
  getEvmAddress,
}
