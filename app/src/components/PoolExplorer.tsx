import { createSignal, onMount, For, Show } from 'solid-js'
import { pools, loading, fetchPools, fetchDotPrice, dotPrice, type PoolInfo } from '../lib/assetConversion'
import { t } from '../lib/i18n'

export default function PoolExplorer() {
  const [selectedPool, setSelectedPool] = createSignal<PoolInfo | null>(null)
  const [swapAmount, setSwapAmount] = createSignal('')
  const [swapQuote, setSwapQuote] = createSignal('')
  const [filter, setFilter] = createSignal('')

  onMount(async () => {
    await fetchDotPrice()
    await fetchPools()
  })

  const filteredPools = () => {
    const f = filter().toLowerCase()
    if (!f) return pools()
    return pools().filter(p =>
      p.asset1Symbol.toLowerCase().includes(f) ||
      p.asset2Symbol.toLowerCase().includes(f) ||
      p.id.toLowerCase().includes(f)
    )
  }

  const totalTvl = () => pools().reduce((sum, p) => sum + p.tvlUsd, 0)
  const totalPools = () => pools().length

  return (
    <div class="flex-1 flex flex-col min-h-0 px-4 sm:px-6 py-4">
      <div class="w-full max-w-4xl mx-auto flex-1 flex flex-col gap-4 min-h-0">

        {/* Header */}
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-3">
            <span class="i-mdi-swap-horizontal w-6 h-6 text-accent" />
            <h2 class="text-lg font-heading uppercase tracking-wider">Asset Hub Liquidity</h2>
          </div>
          <p class="text-xs text-fg-faint leading-relaxed">
            Polkadot Asset Hub has a built-in Uniswap V2 AMM (AssetConversion pallet).
            Provide liquidity, earn swap fees. No bridges, no external chains — native DOT, USDT, USDC.
          </p>
        </div>

        {/* Stats bar */}
        <div class="flex gap-4 flex-wrap">
          <div class="bg-surface border-2 border-edge px-4 py-2 shadow-[var(--shadow)]">
            <div class="text-[10px] text-fg-faint font-heading uppercase tracking-wider">Pools</div>
            <div class="text-lg font-mono text-accent">{loading() ? '...' : totalPools()}</div>
          </div>
          <div class="bg-surface border-2 border-edge px-4 py-2 shadow-[var(--shadow)]">
            <div class="text-[10px] text-fg-faint font-heading uppercase tracking-wider">Total TVL</div>
            <div class="text-lg font-mono text-accent">${loading() ? '...' : totalTvl().toLocaleString('en', { maximumFractionDigits: 0 })}</div>
          </div>
          <div class="bg-surface border-2 border-edge px-4 py-2 shadow-[var(--shadow)]">
            <div class="text-[10px] text-fg-faint font-heading uppercase tracking-wider">DOT Price</div>
            <div class="text-lg font-mono text-accent">${dotPrice().toFixed(2)}</div>
          </div>
          <div class="bg-surface border-2 border-edge px-4 py-2 shadow-[var(--shadow)]">
            <div class="text-[10px] text-fg-faint font-heading uppercase tracking-wider">Chain</div>
            <div class="text-lg font-mono text-fg">Asset Hub</div>
          </div>
        </div>

        {/* Filter */}
        <div class="flex items-center gap-2">
          <span class="i-mdi-magnify w-4 h-4 text-fg-faint" />
          <input
            type="text"
            class="flex-1 px-3 py-1.5 bg-surface border-2 border-edge text-fg font-mono text-sm outline-none focus:border-accent transition-colors"
            placeholder="Filter pools... (USDT, USDC, DOT)"
            value={filter()}
            onInput={(e) => setFilter(e.currentTarget.value)}
          />
          <button
            class="px-3 py-1.5 bg-surface border-2 border-edge text-fg-faint hover:text-accent font-heading text-[10px] uppercase tracking-wider transition-colors"
            onClick={() => { fetchDotPrice(); fetchPools() }}
          >
            <span class={`i-mdi-refresh w-4 h-4 ${loading() ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Pool list */}
        <div class="flex-1 overflow-y-auto min-h-0">
          <Show when={!loading()} fallback={
            <div class="flex items-center justify-center py-12">
              <div class="flex items-center gap-2 text-fg-faint">
                <span class="i-mdi-loading w-5 h-5 animate-spin" />
                <span class="text-xs font-heading uppercase tracking-wider">Loading pools...</span>
              </div>
            </div>
          }>
            <div class="flex flex-col gap-1">
              {/* Header */}
              <div class="flex items-center gap-2 px-3 py-1 text-[10px] text-fg-faint font-heading uppercase tracking-wider">
                <span class="w-32">Pool</span>
                <span class="flex-1 text-right">Reserves</span>
                <span class="w-24 text-right">Price</span>
                <span class="w-24 text-right">TVL</span>
              </div>

              <For each={filteredPools()}>
                {(pool) => (
                  <button
                    class={`flex items-center gap-2 px-3 py-2.5 border-2 transition-colors text-left ${
                      selectedPool()?.id === pool.id
                        ? 'bg-accent-soft border-accent'
                        : 'bg-surface border-edge hover:border-accent-muted'
                    }`}
                    onClick={() => setSelectedPool(selectedPool()?.id === pool.id ? null : pool)}
                  >
                    <span class="w-32 font-mono text-sm font-bold text-fg">
                      {pool.asset1Symbol}/{pool.asset2Symbol}
                    </span>
                    <span class="flex-1 text-right text-[11px] font-mono text-fg-faint">
                      {pool.reserve1Human.toLocaleString('en', { maximumFractionDigits: 0 })} / {pool.reserve2Human.toLocaleString('en', { maximumFractionDigits: pool.asset2Decimals <= 6 ? 2 : 0 })}
                    </span>
                    <span class="w-24 text-right text-[11px] font-mono text-fg">
                      {pool.price < 0.001 ? pool.price.toExponential(2) : pool.price.toFixed(pool.price < 1 ? 4 : 2)}
                    </span>
                    <span class={`w-24 text-right text-[11px] font-mono ${pool.tvlUsd > 1000 ? 'text-accent' : 'text-fg-faint'}`}>
                      ${pool.tvlUsd.toLocaleString('en', { maximumFractionDigits: 0 })}
                    </span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Developer section */}
        <div class="bg-surface border-2 border-edge p-4 shadow-[var(--shadow)]">
          <div class="flex items-center gap-2 mb-2">
            <span class="i-mdi-code-braces w-4 h-4 text-accent" />
            <span class="text-xs font-heading uppercase tracking-wider text-accent">For developers</span>
          </div>
          <p class="text-[11px] text-fg-faint leading-relaxed mb-2">
            AssetConversion is a Uniswap V2 AMM built into the Polkadot Asset Hub runtime.
            No smart contract deployment needed — it's a substrate pallet with native access to all Asset Hub tokens.
          </p>
          <div class="flex flex-wrap gap-2">
            <a
              href="https://wiki.polkadot.network/docs/build-protocol-info#asset-hub"
              target="_blank"
              class="px-2.5 py-1 text-[10px] text-fg-faint hover:text-accent bg-page border border-edge-soft hover:border-accent-muted font-mono transition-colors"
            >
              Polkadot Wiki
            </a>
            <a
              href="https://assethub-polkadot.subscan.io/"
              target="_blank"
              class="px-2.5 py-1 text-[10px] text-fg-faint hover:text-accent bg-page border border-edge-soft hover:border-accent-muted font-mono transition-colors"
            >
              Subscan Explorer
            </a>
            <code class="px-2.5 py-1 text-[10px] text-fg-faint bg-page border border-edge-soft font-mono">
              api.tx.AssetConversion.swap_exact_tokens_for_tokens()
            </code>
          </div>
        </div>
      </div>
    </div>
  )
}
