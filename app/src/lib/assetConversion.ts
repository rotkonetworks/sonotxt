// Asset Hub AssetConversion pallet interaction
// Uniswap V2 style AMM built into the Polkadot Asset Hub runtime

import { createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { createSignal } from 'solid-js'

const WS_RPC = import.meta.env.VITE_SUBSTRATE_RPC || 'wss://asset-hub-polkadot.dotters.network/'
const IS_TESTNET = WS_RPC.includes('paseo')

// Known assets on Asset Hub
export const KNOWN_ASSETS: Record<number, { symbol: string; name: string; decimals: number }> = {
  1984: { symbol: 'USDT', name: 'Tether USD', decimals: 6 },
  1337: { symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  30: { symbol: 'DED', name: 'DOT is Dead', decimals: 10 },
  23: { symbol: 'PINK', name: 'Pink', decimals: 10 },
}

export interface PoolInfo {
  id: string
  asset1: AssetLocation
  asset2: AssetLocation
  asset1Symbol: string
  asset2Symbol: string
  asset1Decimals: number
  asset2Decimals: number
  reserve1: bigint
  reserve2: bigint
  reserve1Human: number
  reserve2Human: number
  price: number // asset2 per asset1
  tvlUsd: number
  // Historical (computed from archive)
  volume24h?: number
  fees24h?: number
  apy?: number
}

export interface AssetLocation {
  parents: number
  interior: any
}

// Reactive state
export const [pools, setPools] = createSignal<PoolInfo[]>([])
export const [loading, setLoading] = createSignal(false)
export const [dotPrice, setDotPrice] = createSignal(0)

function getAssetId(location: AssetLocation): number | null {
  const interior = location.interior
  if (interior?.type === 'X2') {
    const vals = interior.value
    if (vals?.[0]?.type === 'PalletInstance' && vals[0].value === 50 && vals?.[1]?.type === 'GeneralIndex') {
      return Number(vals[1].value)
    }
  }
  return null
}

function getAssetSymbol(location: AssetLocation): string {
  if (location.parents === 1 && location.interior?.type === 'Here') return IS_TESTNET ? 'PAS' : 'DOT'
  const id = getAssetId(location)
  if (id !== null && KNOWN_ASSETS[id]) return KNOWN_ASSETS[id].symbol
  if (id !== null) return `#${id}`
  if (location.parents === 2) {
    const inner = location.interior
    if (inner?.type === 'X2' && inner.value?.[0]?.type === 'GlobalConsensus') {
      const chain = inner.value[0].value
      if (chain?.type === 'Ethereum') return 'ETH-bridged'
    }
    if (inner?.type === 'X1' && inner.value?.type === 'GlobalConsensus') {
      if (inner.value.value?.type === 'Kusama') return 'KSM'
    }
  }
  if (location.interior?.type === 'X1' && location.interior.value?.type === 'Parachain') {
    return `Para#${location.interior.value.value}`
  }
  return '???'
}

function getDecimals(location: AssetLocation): number {
  if (location.parents === 1 && location.interior?.type === 'Here') return 10
  const id = getAssetId(location)
  if (id !== null && KNOWN_ASSETS[id]) return KNOWN_ASSETS[id].decimals
  return 10 // default for DOT-like assets
}

// Cache for on-chain asset metadata
const assetMetadataCache: Record<number, { symbol: string; name: string; decimals: number }> = {}

// Fetch asset metadata from chain for unknown assets
async function fetchAssetMetadata(assetId: number): Promise<{ symbol: string; name: string; decimals: number } | null> {
  if (KNOWN_ASSETS[assetId]) return KNOWN_ASSETS[assetId]
  if (assetMetadataCache[assetId]) return assetMetadataCache[assetId]
  try {
    const client = getClient()
    const unsafeApi = client.getUnsafeApi()
    const meta = await unsafeApi.query.Assets.Metadata.getValue(assetId)
    if (meta) {
      const symbol = typeof meta.symbol === 'string' ? meta.symbol :
        meta.symbol?.asText?.() || meta.symbol?.asBytes ? new TextDecoder().decode(meta.symbol.asBytes()) : `#${assetId}`
      const name = typeof meta.name === 'string' ? meta.name :
        meta.name?.asText?.() || meta.name?.asBytes ? new TextDecoder().decode(meta.name.asBytes()) : symbol
      const decimals = Number(meta.decimals || 0)
      const entry = { symbol, name, decimals }
      assetMetadataCache[assetId] = entry
      return entry
    }
  } catch {}
  return null
}

let _client: ReturnType<typeof createClient> | null = null
function getClient() {
  if (!_client) _client = createClient(getWsProvider(WS_RPC))
  return _client
}

export async function fetchPools(): Promise<PoolInfo[]> {
  setLoading(true)
  try {
    const client = getClient()
    const unsafeApi = client.getUnsafeApi()

    const rawPools = await unsafeApi.query.AssetConversion.Pools.getEntries()
    const result: PoolInfo[] = []

    for (const pool of rawPools) {
      const [a1, a2] = pool.keyArgs[0]
      let sym1 = getAssetSymbol(a1)
      let sym2 = getAssetSymbol(a2)
      let dec1 = getDecimals(a1)
      let dec2 = getDecimals(a2)

      // Fetch on-chain metadata for unknown assets
      const id1 = getAssetId(a1)
      const id2 = getAssetId(a2)
      if (id1 !== null && (sym1.startsWith('#') || sym1 === '???')) {
        const meta = await fetchAssetMetadata(id1)
        if (meta) { sym1 = meta.symbol; dec1 = meta.decimals }
      }
      if (id2 !== null && (sym2.startsWith('#') || sym2 === '???')) {
        const meta = await fetchAssetMetadata(id2)
        if (meta) { sym2 = meta.symbol; dec2 = meta.decimals }
      }

      try {
        const reserves = await unsafeApi.apis.AssetConversionApi.get_reserves(a1, a2)
        if (!reserves) continue
        const [r1, r2] = reserves as [bigint, bigint]
        if (r1 === 0n) continue

        const r1Human = Number(r1) / 10 ** dec1
        const r2Human = Number(r2) / 10 ** dec2
        const price = r2Human / r1Human

        // Estimate TVL in USD
        let tvlUsd = 0
        if (sym1 === 'DOT' || sym1 === 'PAS') {
          tvlUsd = r1Human * dotPrice() * 2
        } else if (sym2 === 'USDT' || sym2 === 'USDC') {
          tvlUsd = r2Human * 2
        }

        result.push({
          id: `${sym1}-${sym2}`,
          asset1: a1,
          asset2: a2,
          asset1Symbol: sym1,
          asset2Symbol: sym2,
          asset1Decimals: dec1,
          asset2Decimals: dec2,
          reserve1: r1,
          reserve2: r2,
          reserve1Human: r1Human,
          reserve2Human: r2Human,
          price,
          tvlUsd,
        })
      } catch {}
    }

    // Sort by native (DOT/PAS) reserve — largest liquidity first, no USD dependency
    result.sort((a, b) => {
      const aDot = (a.asset1Symbol === 'DOT' || a.asset1Symbol === 'PAS') ? a.reserve1Human : 0
      const bDot = (b.asset1Symbol === 'DOT' || b.asset1Symbol === 'PAS') ? b.reserve1Human : 0
      return bDot - aDot
    })
    setPools(result)
    return result
  } finally {
    setLoading(false)
  }
}

// Quote a swap
export async function quoteSwap(
  assetIn: AssetLocation,
  assetOut: AssetLocation,
  amountIn: bigint,
): Promise<bigint | null> {
  const client = getClient()
  const unsafeApi = client.getUnsafeApi()
  try {
    const result = await unsafeApi.apis.AssetConversionApi.quote_price_exact_tokens_for_tokens(
      assetIn, assetOut, amountIn, true
    )
    return result as bigint | null
  } catch {
    return null
  }
}

// Derive DOT price directly from on-chain pool reserves.
// Reads from the pools we already fetch — no API, no middleman.
export async function fetchDotPrice(): Promise<number> {
  // If pools are already loaded, derive price from DOT/USDT or DOT/USDC pool
  const loaded = pools()
  if (loaded.length > 0) {
    for (const pool of loaded) {
      const s1 = pool.asset1Symbol
      const s2 = pool.asset2Symbol
      // DOT paired with a stablecoin
      if ((s1 === 'DOT' || s1 === 'PAS') && (s2 === 'USDT' || s2 === 'USDC')) {
        const price = pool.price // stablecoin per DOT
        if (price > 0) { setDotPrice(price); return price }
      }
      if ((s2 === 'DOT' || s2 === 'PAS') && (s1 === 'USDT' || s1 === 'USDC')) {
        const price = 1 / pool.price
        if (price > 0) { setDotPrice(price); return price }
      }
    }
  }
  // Pools not loaded yet or no stablecoin pool — return current
  return dotPrice()
}

// Execute a swap via AssetConversion pallet (requires connected wallet)
export async function executeSwap(
  path: AssetLocation[],
  amountIn: bigint,
  amountOutMin: bigint,
): Promise<string> {
  const { connectInjectedExtension } = await import('polkadot-api/pjs-signer')
  const { connectedWallet, selectedAccount } = await import('./wallet')
  const { paseo_ah } = await import('@polkadot-api/descriptors')

  const account = selectedAccount()
  const wallet = connectedWallet()
  if (!account || !wallet) throw new Error('No wallet connected')

  const client = getClient()
  const api = client.getTypedApi(paseo_ah)

  const ext = await connectInjectedExtension(wallet.extensionName)
  const papiAccounts = ext.getAccounts()
  const signer = papiAccounts.find(a => a.address === account.address)
  if (!signer) throw new Error('Account not found in extension')

  const tx = api.tx.AssetConversion.swap_exact_tokens_for_tokens({
    path,
    amount_in: amountIn,
    amount_out_min: amountOutMin,
    send_to: { type: 'Id' as const, value: account.address },
    keep_alive: true,
  })

  const result = await tx.signAndSubmit(signer.polkadotSigner)
  return result.txHash
}

// Add liquidity to a pool
export async function addLiquidity(
  asset1: AssetLocation,
  asset2: AssetLocation,
  amount1Desired: bigint,
  amount2Desired: bigint,
  amount1Min: bigint,
  amount2Min: bigint,
): Promise<string> {
  const { connectInjectedExtension } = await import('polkadot-api/pjs-signer')
  const { connectedWallet, selectedAccount } = await import('./wallet')
  const { paseo_ah } = await import('@polkadot-api/descriptors')

  const account = selectedAccount()
  const wallet = connectedWallet()
  if (!account || !wallet) throw new Error('No wallet connected')

  const client = getClient()
  const api = client.getTypedApi(paseo_ah)

  const ext = await connectInjectedExtension(wallet.extensionName)
  const papiAccounts = ext.getAccounts()
  const signer = papiAccounts.find(a => a.address === account.address)
  if (!signer) throw new Error('Account not found in extension')

  const tx = api.tx.AssetConversion.add_liquidity({
    asset1,
    asset2,
    amount1_desired: amount1Desired,
    amount2_desired: amount2Desired,
    amount1_min: amount1Min,
    amount2_min: amount2Min,
    mint_to: { type: 'Id' as const, value: account.address },
  })

  const result = await tx.signAndSubmit(signer.polkadotSigner)
  return result.txHash
}

// Remove liquidity from a pool
export async function removeLiquidity(
  asset1: AssetLocation,
  asset2: AssetLocation,
  lpTokenBurn: bigint,
  amount1Min: bigint,
  amount2Min: bigint,
): Promise<string> {
  const { connectInjectedExtension } = await import('polkadot-api/pjs-signer')
  const { connectedWallet, selectedAccount } = await import('./wallet')
  const { paseo_ah } = await import('@polkadot-api/descriptors')

  const account = selectedAccount()
  const wallet = connectedWallet()
  if (!account || !wallet) throw new Error('No wallet connected')

  const client = getClient()
  const api = client.getTypedApi(paseo_ah)

  const ext = await connectInjectedExtension(wallet.extensionName)
  const papiAccounts = ext.getAccounts()
  const signer = papiAccounts.find(a => a.address === account.address)
  if (!signer) throw new Error('Account not found in extension')

  const tx = api.tx.AssetConversion.remove_liquidity({
    asset1,
    asset2,
    lp_token_burn: lpTokenBurn,
    amount1_min_receive: amount1Min,
    amount2_min_receive: amount2Min,
    withdraw_to: { type: 'Id' as const, value: account.address },
  })

  const result = await tx.signAndSubmit(signer.polkadotSigner)
  return result.txHash
}
