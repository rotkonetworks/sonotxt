// TXT utility token + payment channel contract interaction via viem
//
// Two-token model:
//   SONO — governance, native pallet-assets token (ERC20 precompile)
//   TXT — utility token (this contract), used for payment channels
//
// Network configured via env vars:
//   VITE_CHAIN_ID          — EVM chain ID (default: 420420417 = Paseo Asset Hub)
//   VITE_CHAIN_NAME        — display name
//   VITE_ETH_RPC           — eth-compatible RPC endpoint
//   VITE_SUBSTRATE_RPC     — Substrate WS RPC (for PAPI/Revive.call)
//   VITE_CONTRACT_ADDRESS  — TXT proxy contract
//   VITE_SERVICE_ADDRESS   — sonotxt service address for payment channels

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  webSocket,
  formatUnits,
  parseUnits,
  type Address,
  type Hash,
} from 'viem'
import { defineChain } from 'viem/utils'

const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID || '420420419')
const CHAIN_NAME = import.meta.env.VITE_CHAIN_NAME || 'Polkadot Asset Hub'
const ETH_RPC = import.meta.env.VITE_ETH_RPC || 'https://eth-asset-hub-polkadot.dotters.network'
const IS_TESTNET = CHAIN_ID === 420420417

export const SUBSTRATE_RPC = import.meta.env.VITE_SUBSTRATE_RPC || 'wss://asset-hub-polkadot.dotters.network/'

const nativeCurrency = IS_TESTNET
  ? { name: 'PAS', symbol: 'PAS', decimals: 18 }
  : { name: 'DOT', symbol: 'DOT', decimals: 18 }

export const assetHubChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_NAME,
  nativeCurrency,
  rpcUrls: {
    default: { http: [ETH_RPC] },
  },
  testnet: IS_TESTNET,
})

// Contract address — configurable per network
const CONTRACT_ADDRESS: Address = (import.meta.env.VITE_CONTRACT_ADDRESS || '0xe080346edf54998d9b6843a68be8fdcc342adec5') as Address

const SONO_DECIMALS = 10

// Pallet-assets ERC20 precompile addresses
// Format: [asset_id_be32][12 zero bytes][0x0120][2 zero bytes]
export const TOKENS = {
  USDC:  '0x0000053900000000000000000000000001200000' as Address, // asset 1337, 6 dec
  USDT:  '0x000007c000000000000000000000000001200000' as Address, // asset 1984, 6 dec
} as const

// Minimal ERC20 ABI for precompile tokens
const ERC20_ABI = [
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
] as const

// TXT contract ABI
const SONO_ABI = [
  // ERC20
  { type: 'function', name: 'name', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'symbol', inputs: [], outputs: [{ type: 'string' }], stateMutability: 'view' },
  { type: 'function', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' },
  { type: 'function', name: 'totalSupply', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'transfer', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'approve', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'allowance', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },

  // Payment channels
  { type: 'function', name: 'openChannel', inputs: [{ name: 'service', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'topUp', inputs: [{ name: 'service', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'cooperativeClose', inputs: [{ name: 'user', type: 'address' }, { name: 'spent', type: 'uint256' }, { name: 'nonce', type: 'uint64' }, { name: 'sig', type: 'bytes' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'initiateClose', inputs: [{ name: 'counterparty', type: 'address' }, { name: 'spent', type: 'uint256' }, { name: 'nonce', type: 'uint64' }, { name: 'sig', type: 'bytes' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'dispute', inputs: [{ name: 'user', type: 'address' }, { name: 'service', type: 'address' }, { name: 'spent', type: 'uint256' }, { name: 'nonce', type: 'uint64' }, { name: 'userSig', type: 'bytes' }, { name: 'serviceSig', type: 'bytes' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'finalize', inputs: [{ name: 'user', type: 'address' }, { name: 'service', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'userClose', inputs: [{ name: 'service', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },

  // Buy / Sell
  { type: 'function', name: 'buyWithDot', inputs: [], outputs: [], stateMutability: 'payable' },
  { type: 'function', name: 'buyWithToken', inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'sellForDot', inputs: [{ name: 'txtAmount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },

  // Views
  { type: 'function', name: 'channelId', inputs: [{ name: 'user', type: 'address' }, { name: 'service', type: 'address' }], outputs: [{ type: 'bytes32' }], stateMutability: 'pure' },
  { type: 'function', name: 'getChannel', inputs: [{ name: 'user', type: 'address' }, { name: 'service', type: 'address' }], outputs: [{ name: 'deposit', type: 'uint256' }, { name: 'spent', type: 'uint256' }, { name: 'nonce', type: 'uint64' }, { name: 'expiresAt', type: 'uint64' }], stateMutability: 'view' },
  { type: 'function', name: 'txtPerDot', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'quoteBuyDot', inputs: [{ name: 'dotAmount', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'quoteBuyToken', inputs: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'quoteSellDot', inputs: [{ name: 'txtAmount', type: 'uint256' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'availableReserve', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'disputePeriod', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },

  // SONO Staking
  { type: 'function', name: 'stake', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'unstake', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'claimRewards', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'pendingRewards', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'staked', inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'totalStaked', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'totalBurned', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'circulatingSupply', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'treasuryPool', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'burnBps', inputs: [], outputs: [{ type: 'uint16' }], stateMutability: 'view' },
  { type: 'function', name: 'minProviderStake', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'protocolFeeBps', inputs: [], outputs: [{ type: 'uint16' }], stateMutability: 'view' },
  { type: 'function', name: 'protocolFees', inputs: [{ name: 'token', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'sonoPriceUsdt', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'platformCutBps', inputs: [], outputs: [{ type: 'uint16' }], stateMutability: 'view' },
  { type: 'function', name: 'totalProviderEarnings', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },

  // Provider Registry
  { type: 'function', name: 'registerProvider', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'unregisterProvider', inputs: [], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'providers', inputs: [{ name: 'provider', type: 'address' }], outputs: [{ name: 'registered', type: 'bool' }, { name: 'staked', type: 'uint256' }, { name: 'totalServed', type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'commitPrice', inputs: [{ name: 'priceHash', type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'revokePrice', inputs: [{ name: 'priceHash', type: 'bytes32' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'verifyPrice', inputs: [{ name: 'priceHash', type: 'bytes32' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },

  // Events
  { type: 'event', name: 'Transfer', inputs: [{ name: 'from', type: 'address', indexed: true }, { name: 'to', type: 'address', indexed: true }, { name: 'value', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'ChannelOpened', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'service', type: 'address', indexed: true }, { name: 'deposit', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'ChannelToppedUp', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'service', type: 'address', indexed: true }, { name: 'added', type: 'uint256', indexed: false }, { name: 'total', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'ChannelClosing', inputs: [{ name: 'channelId', type: 'bytes32', indexed: true }, { name: 'initiator', type: 'address', indexed: true }, { name: 'spent', type: 'uint256', indexed: false }, { name: 'expiresAt', type: 'uint64', indexed: false }] },
  { type: 'event', name: 'ChannelSettled', inputs: [{ name: 'channelId', type: 'bytes32', indexed: true }, { name: 'user', type: 'address', indexed: true }, { name: 'service', type: 'address', indexed: true }, { name: 'spent', type: 'uint256', indexed: false }, { name: 'refunded', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'BoughtWithDot', inputs: [{ name: 'buyer', type: 'address', indexed: true }, { name: 'dotAmount', type: 'uint256', indexed: false }, { name: 'txtAmount', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'BoughtWithToken', inputs: [{ name: 'buyer', type: 'address', indexed: true }, { name: 'token', type: 'address', indexed: true }, { name: 'tokenAmount', type: 'uint256', indexed: false }, { name: 'txtAmount', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'SoldForDot', inputs: [{ name: 'seller', type: 'address', indexed: true }, { name: 'txtAmount', type: 'uint256', indexed: false }, { name: 'dotAmount', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'DotPriceUpdated', inputs: [{ name: 'txtPerDot', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'TokenRateUpdated', inputs: [{ name: 'token', type: 'address', indexed: true }, { name: 'txtPerToken', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'SonoStaked', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }, { name: 'total', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'SonoUnstaked', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }, { name: 'total', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'ProviderRegistered', inputs: [{ name: 'provider', type: 'address', indexed: true }, { name: 'staked', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'ProviderUnregistered', inputs: [{ name: 'provider', type: 'address', indexed: true }, { name: 'unstaked', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'RewardClaimed', inputs: [{ name: 'user', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'TxtBurned', inputs: [{ name: 'burned', type: 'uint256', indexed: false }, { name: 'toTreasury', type: 'uint256', indexed: false }, { name: 'newTotalBurned', type: 'uint256', indexed: false }] },
  { type: 'event', name: 'ProviderPaid', inputs: [{ name: 'provider', type: 'address', indexed: true }, { name: 'amount', type: 'uint256', indexed: false }] },
] as const

// --- Clients ---

export function getPublicClient() {
  return createPublicClient({
    chain: assetHubChain,
    transport: http(),
  })
}

export function getWalletClient(account: Address) {
  const provider = (window as any).ethereum
  if (!provider) throw new Error('No Ethereum provider found')
  return createWalletClient({
    account,
    chain: assetHubChain,
    transport: custom(provider),
  })
}

// --- TXT reads ---

export async function getBalance(address: Address): Promise<string> {
  const client = getPublicClient()
  const raw = await client.readContract({
    address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'balanceOf', args: [address],
  })
  return formatUnits(raw, SONO_DECIMALS)
}

export async function getChannel(user: Address, service: Address) {
  const client = getPublicClient()
  const [deposit, spent, nonce, expiresAt] = await client.readContract({
    address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'getChannel', args: [user, service],
  })
  return {
    deposit: formatUnits(deposit, SONO_DECIMALS),
    spent: formatUnits(spent, SONO_DECIMALS),
    remaining: formatUnits(spent > deposit ? 0n : deposit - spent, SONO_DECIMALS),
    nonce,
    expiresAt,
    isOpen: deposit > 0n,
    isClosing: expiresAt > 0n,
  }
}

export async function getTotalSupply(): Promise<string> {
  const client = getPublicClient()
  const raw = await client.readContract({
    address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'totalSupply',
  })
  return formatUnits(raw, SONO_DECIMALS)
}

export async function getTxtPerDot(): Promise<string> {
  const client = getPublicClient()
  const raw = await client.readContract({
    address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'txtPerDot',
  })
  return formatUnits(raw, SONO_DECIMALS)
}

// --- Token balance reads (USDC, USDT, SONO via precompile) ---

export async function getTokenBalance(token: Address, account: Address): Promise<bigint> {
  const client = getPublicClient()
  return client.readContract({
    address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [account],
  })
}

// --- Buy TXT ---

export async function buyWithDot(account: Address, dotAmount: bigint): Promise<Hash> {
  const wallet = getWalletClient(account)
  return wallet.writeContract({
    address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'buyWithDot', value: dotAmount,
  })
}

export async function buyWithToken(account: Address, token: Address, amount: bigint): Promise<Hash> {
  const wallet = getWalletClient(account)
  // First approve the TXT contract to pull the payment token
  await wallet.writeContract({
    address: token, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACT_ADDRESS, amount],
  })
  return wallet.writeContract({
    address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'buyWithToken', args: [token, amount],
  })
}

export async function sellForDot(account: Address, txtAmount: string): Promise<Hash> {
  const wallet = getWalletClient(account)
  return wallet.writeContract({
    address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'sellForDot',
    args: [parseUnits(txtAmount, SONO_DECIMALS)],
  })
}

// --- Quotes ---

export async function quoteBuyDot(dotAmount: bigint): Promise<string> {
  const client = getPublicClient()
  const raw = await client.readContract({
    address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'quoteBuyDot', args: [dotAmount],
  })
  return formatUnits(raw, SONO_DECIMALS)
}

export async function quoteBuyToken(token: Address, amount: bigint): Promise<string> {
  const client = getPublicClient()
  const raw = await client.readContract({
    address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'quoteBuyToken', args: [token, amount],
  })
  return formatUnits(raw, SONO_DECIMALS)
}

export async function quoteSellDot(txtAmount: string): Promise<string> {
  const client = getPublicClient()
  const raw = await client.readContract({
    address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'quoteSellDot',
    args: [parseUnits(txtAmount, SONO_DECIMALS)],
  })
  return formatUnits(raw, 18)
}

// --- Channels ---

export async function openChannel(account: Address, service: Address, amount: string): Promise<Hash> {
  const wallet = getWalletClient(account)
  return wallet.writeContract({
    address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'openChannel',
    args: [service, parseUnits(amount, SONO_DECIMALS)],
  })
}

export async function topUpChannel(account: Address, service: Address, amount: string): Promise<Hash> {
  const wallet = getWalletClient(account)
  return wallet.writeContract({
    address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'topUp',
    args: [service, parseUnits(amount, SONO_DECIMALS)],
  })
}

export async function userCloseChannel(account: Address, service: Address): Promise<Hash> {
  const wallet = getWalletClient(account)
  return wallet.writeContract({
    address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'userClose', args: [service],
  })
}

export async function finalizeChannel(account: Address, user: Address, service: Address): Promise<Hash> {
  const wallet = getWalletClient(account)
  return wallet.writeContract({
    address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'finalize', args: [user, service],
  })
}

export async function transfer(account: Address, to: Address, amount: string): Promise<Hash> {
  const wallet = getWalletClient(account)
  return wallet.writeContract({
    address: CONTRACT_ADDRESS, abi: SONO_ABI, functionName: 'transfer',
    args: [to, parseUnits(amount, SONO_DECIMALS)],
  })
}

// --- Off-chain state signing ---

export async function signChannelState(
  account: Address,
  channelId: `0x${string}`,
  spent: bigint,
  nonce: bigint,
  functionName: 'cooperativeClose' | 'initiateClose' | 'dispute' = 'cooperativeClose',
): Promise<`0x${string}`> {
  const wallet = getWalletClient(account)
  const { keccak256, encodeAbiParameters, parseAbiParameters, toHex } = await import('viem')
  // Domain-separated hash: includes contract address, chain ID, and function name
  const stateHash = keccak256(encodeAbiParameters(
    parseAbiParameters('address, uint256, string, bytes32, uint256, uint64'),
    [CONTRACT_ADDRESS, BigInt(CHAIN_ID), functionName, channelId, spent, nonce],
  ))
  return wallet.signMessage({ account, message: { raw: stateHash as `0x${string}` } })
}

export { SONO_ABI, ERC20_ABI, SONO_DECIMALS, CONTRACT_ADDRESS }
