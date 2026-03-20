// TXT contract interaction via PAPI + Polkadot wallet
// Uses Revive.call to call the contract from a Substrate account

import { createSignal } from 'solid-js'
import { createClient, Binary } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { connectInjectedExtension } from 'polkadot-api/pjs-signer'
import { paseo_ah } from '@polkadot-api/descriptors'
import {
  createPublicClient,
  http,
  webSocket,
  formatUnits,
  parseUnits,
  encodeFunctionData,
  type Address,
} from 'viem'
import { assetHubChain, SUBSTRATE_RPC, CONTRACT_ADDRESS, SONO_ABI, ERC20_ABI, SONO_DECIMALS, TOKENS } from './contract'
import { connectedWallet, selectedAccount } from './wallet'

// Reactive state
const [sonoBalance, setTxtBalance] = createSignal<string>('0')
const [channelInfo, setChannelInfo] = createSignal<{
  deposit: string
  spent: string
  remaining: string
  nonce: bigint
  isOpen: boolean
  isClosing: boolean
} | null>(null)
const [txPending, setTxPending] = createSignal(false)
const [txError, setTxError] = createSignal<string | null>(null)

// sonotxt service address — where users open channels to
const SONOTXT_SERVICE: Address = (import.meta.env.VITE_SERVICE_ADDRESS || '0xe819D7B8c05dE5d1e5E067eBc85DCcB562738E0B') as Address

// Read-only viem client for contract reads (eth-RPC) — singleton
let _readClient: ReturnType<typeof createPublicClient> | null = null
function readClient() {
  if (!_readClient) _readClient = createPublicClient({ chain: assetHubChain, transport: http() })
  return _readClient
}

// Get the user's mapped EVM address from their Substrate account
// pallet-revive maps SS58 → H160 deterministically
async function getEvmAddress(): Promise<Address | null> {
  const account = selectedAccount()
  if (!account) return null

  // Use the Revive runtime API to get the mapped address
  const client = createClient(getWsProvider(SUBSTRATE_RPC))
  try {
    const api = client.getTypedApi(paseo_ah)
    const result = await api.apis.ReviveApi.address(account.address)
    // Result may be Binary or hex string
    if (typeof result === 'string') return result as Address
    if ((result as any).asHex) return (result as any).asHex() as Address
    // Fallback: convert bytes to hex without Node.js Buffer
    const bytes = new Uint8Array(result as any)
    return `0x${[...bytes].map(b => b.toString(16).padStart(2, '0')).join('')}` as Address
  } catch (e) {
    console.error('getEvmAddress failed:', e)
    return null
  } finally {
    client.destroy()
  }
}

// Refresh balance and channel info for the connected wallet
let _refreshing = false
async function refresh() {
  if (_refreshing) return
  _refreshing = true
  try { return await _refreshInner() } finally { _refreshing = false }
}

async function _refreshInner() {
  const account = selectedAccount()
  if (!account) return

  const evmAddr = await getEvmAddress()
  if (!evmAddr) return

  const client = readClient()

  // Get TXT balance
  const bal = await client.readContract({
    address: CONTRACT_ADDRESS,
    abi: SONO_ABI,
    functionName: 'balanceOf',
    args: [evmAddr],
  })
  setTxtBalance(formatUnits(bal, SONO_DECIMALS))

  // Get channel to sonotxt service
  const [deposit, spent, nonce, expiresAt] = await client.readContract({
    address: CONTRACT_ADDRESS,
    abi: SONO_ABI,
    functionName: 'getChannel',
    args: [evmAddr, SONOTXT_SERVICE],
  })

  if (deposit > 0n) {
    setChannelInfo({
      deposit: formatUnits(deposit, SONO_DECIMALS),
      spent: formatUnits(spent, SONO_DECIMALS),
      remaining: formatUnits(spent > deposit ? 0n : deposit - spent, SONO_DECIMALS),
      nonce,
      isOpen: true,
      isClosing: expiresAt > 0n,
    })
  } else {
    setChannelInfo(null)
  }
}

// Submit a contract call via Revive.call extrinsic (signed by Polkadot wallet)
async function submitReviveCall(opts: {
  dest: Address
  abi: readonly any[]
  functionName: string
  args?: any[]
  value?: bigint
}) {
  const account = selectedAccount()
  const wallet = connectedWallet()
  if (!account || !wallet) throw new Error('No wallet connected')

  setTxPending(true)
  setTxError(null)

  let client: ReturnType<typeof createClient> | undefined
  try {
    const data = encodeFunctionData({
      abi: opts.abi,
      functionName: opts.functionName as any,
      args: (opts.args || []) as any,
    })

    client = createClient(getWsProvider(SUBSTRATE_RPC))
    const api = client.getTypedApi(paseo_ah)

    const ext = await connectInjectedExtension(wallet.extensionName)
    const papiAccounts = ext.getAccounts()
    const signer = papiAccounts.find(a => a.address === account.address)
    if (!signer) throw new Error('Account not found in extension')

    const tx = api.tx.Revive.call({
      dest: Binary.fromHex(opts.dest),
      value: opts.value || 0n,
      weight_limit: { ref_time: 500_000_000_000n, proof_size: 500_000n },
      storage_deposit_limit: 1_000_000_000_000n,
      data: Binary.fromHex(data),
    })

    await tx.signAndSubmit(signer.polkadotSigner)
  } catch (e: any) {
    setTxError(e.message || 'Transaction failed')
    throw e
  } finally {
    client?.destroy()
    setTxPending(false)
  }
}

// Shorthand for TXT contract calls
async function submitContractCall(functionName: string, args: any[]) {
  await submitReviveCall({ dest: CONTRACT_ADDRESS, abi: SONO_ABI, functionName, args })
  await refresh()
}

// Open channel to sonotxt
async function openChannel(amount: string) {
  const parsedAmount = parseUnits(amount, SONO_DECIMALS)
  if (parsedAmount <= 0n) throw new Error('Amount must be positive')
  await submitContractCall('openChannel', [SONOTXT_SERVICE, parsedAmount])
}

// Top up existing channel
async function topUp(amount: string) {
  const parsedAmount = parseUnits(amount, SONO_DECIMALS)
  if (parsedAmount <= 0n) throw new Error('Amount must be positive')
  await submitContractCall('topUp', [SONOTXT_SERVICE, parsedAmount])
}

// --- Buy TXT ---

// Buy TXT with native token (DOT/PAS)
async function buyWithDot(amount: bigint) {
  await submitReviveCall({
    dest: CONTRACT_ADDRESS,
    abi: SONO_ABI,
    functionName: 'buyWithDot',
    value: amount,
  })
  await refresh()
}

// Buy TXT with an ERC20 token (USDC, USDT, SONO)
// Two-step: approve then buyWithToken
async function buyWithToken(token: Address, amount: bigint) {
  // Step 1: approve TXT contract to pull tokens
  await submitReviveCall({
    dest: token,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [CONTRACT_ADDRESS, amount],
  })
  // Step 2: buy
  await submitReviveCall({
    dest: CONTRACT_ADDRESS,
    abi: SONO_ABI,
    functionName: 'buyWithToken',
    args: [token, amount],
  })
  await refresh()
}

// --- Quotes (read-only via eth-RPC) ---

async function quoteBuyDot(dotAmount: bigint): Promise<string> {
  const client = readClient()
  const raw = await client.readContract({
    address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'quoteBuyDot', args: [dotAmount],
  })
  return formatUnits(raw, SONO_DECIMALS)
}

async function quoteBuyToken(token: Address, amount: bigint): Promise<string> {
  const client = readClient()
  const raw = await client.readContract({
    address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'quoteBuyToken', args: [token, amount],
  })
  return formatUnits(raw, SONO_DECIMALS)
}

// Fetch token balance for user's EVM address
async function getTokenBalance(token: Address): Promise<bigint> {
  const evmAddr = await getEvmAddress()
  if (!evmAddr) return 0n
  const client = readClient()
  return client.readContract({
    address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [evmAddr],
  })
}

// Get native DOT/PAS balance
async function getNativeBalance(): Promise<bigint> {
  const evmAddr = await getEvmAddress()
  if (!evmAddr) return 0n
  const client = readClient()
  return client.getBalance({ address: evmAddr })
}

// --- SONO Staking ---

const [stakingInfo, setStakingInfo] = createSignal<{
  sonoStaked: string
  pendingRewards: string
  totalStaked: string
  totalBurned: string
  circulatingSupply: string
  treasuryPool: string
  burnBps: number
  minProviderStake: string
  sonoBalance: string
  protocolFeeBps: number
  sonoPriceUsdt: string
  platformCutBps: number
  totalProviderEarnings: string
} | null>(null)

const [providerInfo, setProviderInfo] = createSignal<{
  registered: boolean
  staked: string
  totalServed: string
} | null>(null)

async function refreshStaking() {
  const evmAddr = await getEvmAddress()
  if (!evmAddr) return
  const client = readClient()
  const SONO_DECIMALS = 10

  const [staked, pending, totalStakedVal, burned, circulating, pool, bps, minStake, sonoBal, provider, feeBps, priceUsdt, cutBps, provEarnings] = await Promise.all([
    client.readContract({ address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'staked', args: [evmAddr] }),
    client.readContract({ address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'pendingRewards', args: [evmAddr] }),
    client.readContract({ address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'totalStaked' }),
    client.readContract({ address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'totalBurned' }),
    client.readContract({ address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'circulatingSupply' }),
    client.readContract({ address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'treasuryPool' }),
    client.readContract({ address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'burnBps' }),
    client.readContract({ address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'minProviderStake' }),
    client.readContract({ address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'balanceOf', args: [evmAddr] }),
    client.readContract({ address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'providers', args: [evmAddr] }),
    client.readContract({ address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'protocolFeeBps' }),
    client.readContract({ address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'sonoPriceUsdt' }),
    client.readContract({ address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'platformCutBps' }),
    client.readContract({ address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'totalProviderEarnings' }),
  ])

  setStakingInfo({
    sonoStaked: formatUnits(staked, SONO_DECIMALS),
    pendingRewards: formatUnits(pending, SONO_DECIMALS),
    totalStaked: formatUnits(totalStakedVal, SONO_DECIMALS),
    totalBurned: formatUnits(burned, SONO_DECIMALS),
    circulatingSupply: formatUnits(circulating, SONO_DECIMALS),
    treasuryPool: formatUnits(pool, SONO_DECIMALS),
    burnBps: Number(bps),
    minProviderStake: formatUnits(minStake, SONO_DECIMALS),
    sonoBalance: formatUnits(sonoBal, SONO_DECIMALS),
    protocolFeeBps: Number(feeBps),
    sonoPriceUsdt: (Number(priceUsdt) / 1e6).toFixed(4),
    platformCutBps: Number(cutBps),
    totalProviderEarnings: formatUnits(provEarnings, SONO_DECIMALS),
  })

  const [registered, provStaked, totalServed] = provider as [boolean, bigint, bigint]
  setProviderInfo({
    registered,
    staked: formatUnits(provStaked, SONO_DECIMALS),
    totalServed: formatUnits(totalServed, SONO_DECIMALS),
  })
}

async function stakeSONO(amount: string) {
  const parsed = parseUnits(amount, 10) // SONO has 10 decimals
  if (parsed <= 0n) throw new Error('Amount must be positive')
  // Single token — staking is internal, no approve needed
  await submitContractCall('stake', [parsed])
  await refreshStaking()
}

async function unstakeSONO(amount: string) {
  const parsed = parseUnits(amount, 10)
  if (parsed <= 0n) throw new Error('Amount must be positive')
  await submitContractCall('unstake', [parsed])
  await refreshStaking()
}

async function claimRewards() {
  await submitContractCall('claimRewards', [])
  await refreshStaking()
}

async function registerProvider() {
  await submitContractCall('registerProvider', [])
  await refreshStaking()
}

async function unregisterProvider() {
  await submitContractCall('unregisterProvider', [])
  await refreshStaking()
}

export {
  sonoBalance,
  channelInfo,
  txPending,
  txError,
  stakingInfo,
  providerInfo,
  SONOTXT_SERVICE,
  TOKENS,
  refresh,
  refreshStaking,
  openChannel,
  topUp,
  getEvmAddress,
  buyWithDot,
  buyWithToken,
  quoteBuyDot,
  quoteBuyToken,
  getTokenBalance,
  getNativeBalance,
  stakeSONO,
  unstakeSONO,
  claimRewards,
  registerProvider,
  unregisterProvider,
}
