// Asset Hub AssetConversion pallet interaction
// Uniswap V2 style AMM built into the Polkadot Asset Hub runtime

import { createClient } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws-provider/web'
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
      const sym1 = getAssetSymbol(a1)
      const sym2 = getAssetSymbol(a2)
      const dec1 = getDecimals(a1)
      const dec2 = getDecimals(a2)

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

    result.sort((a, b) => b.tvlUsd - a.tvlUsd)
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

// Fetch DOT price from CoinGecko
export async function fetchDotPrice(): Promise<number> {
  try {
    const resp = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=polkadot&vs_currencies=usd')
    const data = await resp.json()
    const price = data?.polkadot?.usd || 0
    setDotPrice(price)
    return price
  } catch {
    return 0
  }
}
