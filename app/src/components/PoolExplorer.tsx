import { createSignal, createEffect, onMount, For, Show } from 'solid-js'
import { pools, loading, fetchPools, fetchDotPrice, dotPrice, quoteSwap, executeSwap, addLiquidity, type PoolInfo } from '../lib/assetConversion'
import { selectedAccount } from '../lib/wallet'
import { showToast } from './Toast'
import { t } from '../lib/i18n'

export default function PoolExplorer() {
  const [selectedPool, setSelectedPool] = createSignal<PoolInfo | null>(null)
  const [swapAmount, setSwapAmount] = createSignal('')
  const [swapQuote, setSwapQuote] = createSignal('')
  const [filter, setFilter] = createSignal('')

  onMount(async () => {
    await fetchPools()
    await fetchDotPrice()
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
        <div class="flex items-center gap-3">
          <span class="i-mdi-swap-horizontal w-6 h-6 text-accent" />
          <h2 class="text-lg font-heading uppercase tracking-wider">Swap</h2>
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

        {/* Swap Panel — shows above pool list when a pool is selected */}
        <Show when={selectedPool()}>
          {(pool) => {
            const [swapDirection, setSwapDirection] = createSignal<'1to2' | '2to1'>('1to2')
            const [inputAmount, setInputAmount] = createSignal('')
            const [outputQuote, setOutputQuote] = createSignal<string | null>(null)
            const [swapping, setSwapping] = createSignal(false)
            const [swapError, setSwapError] = createSignal<string | null>(null)

            createEffect(async () => {
              const raw = inputAmount()
              setOutputQuote(null)
              const val = parseFloat(raw)
              if (!raw || isNaN(val) || val <= 0) return

              const p = pool()
              const dir = swapDirection()
              const inAsset = dir === '1to2' ? p.asset1 : p.asset2
              const outAsset = dir === '1to2' ? p.asset2 : p.asset1
              const inDecimals = dir === '1to2' ? p.asset1Decimals : p.asset2Decimals
              const outDecimals = dir === '1to2' ? p.asset2Decimals : p.asset1Decimals

              const amountIn = BigInt(Math.floor(val * 10 ** inDecimals))
              const quote = await quoteSwap(inAsset, outAsset, amountIn)
              if (quote !== null) {
                setOutputQuote((Number(quote) / 10 ** outDecimals).toFixed(outDecimals <= 6 ? 4 : 2))
              }
            })

            async function handleSwap() {
              if (swapping()) return
              const raw = inputAmount()
              const val = parseFloat(raw)
              if (!raw || isNaN(val) || val <= 0) return
              setSwapping(true)
              setSwapError(null)
              try {
                const p = pool()
                const dir = swapDirection()
                const inAsset = dir === '1to2' ? p.asset1 : p.asset2
                const outAsset = dir === '1to2' ? p.asset2 : p.asset1
                const inDecimals = dir === '1to2' ? p.asset1Decimals : p.asset2Decimals
                const amountIn = BigInt(Math.floor(val * 10 ** inDecimals))
                const txHash = await executeSwap([inAsset, outAsset], amountIn, 1n)
                showToast(`Swap executed`, 'success')
                setInputAmount('')
                fetchPools()
              } catch (e: any) {
                setSwapError(e.message || 'Swap failed')
              }
              setSwapping(false)
            }

            const inSymbol = () => swapDirection() === '1to2' ? pool().asset1Symbol : pool().asset2Symbol
            const outSymbol = () => swapDirection() === '1to2' ? pool().asset2Symbol : pool().asset1Symbol

            return (
              <div class="bg-surface border-2 border-accent p-4 shadow-[var(--shadow)]">
                <div class="flex items-center justify-between mb-3">
                  <div class="flex items-center gap-2">
                    <span class="i-mdi-swap-horizontal w-5 h-5 text-accent" />
                    <span class="text-sm font-heading uppercase tracking-wider">Swap</span>
                    <span class="text-xs font-mono text-fg-faint">{pool().asset1Symbol}/{pool().asset2Symbol}</span>
                  </div>
                  <button class="text-fg-faint hover:text-fg text-xs" onClick={() => setSelectedPool(null)}>
                    <span class="i-mdi-close w-4 h-4" />
                  </button>
                </div>
                <div class="space-y-2">
                  <div class="bg-page border border-edge-soft p-3 flex items-center gap-2">
                    <input
                      type="number"
                      class="flex-1 bg-transparent text-lg font-mono text-fg outline-none"
                      placeholder="0.0"
                      value={inputAmount()}
                      onInput={(e) => setInputAmount(e.currentTarget.value)}
                      step="any"
                    />
                    <span class="text-sm font-mono font-bold text-fg">{inSymbol()}</span>
                  </div>
                  <div class="flex justify-center">
                    <button
                      class="p-1 hover:bg-accent-soft rounded transition-colors"
                      onClick={() => setSwapDirection(d => d === '1to2' ? '2to1' : '1to2')}
                    >
                      <span class="i-mdi-swap-vertical w-5 h-5 text-accent" />
                    </button>
                  </div>
                  <div class="bg-page border border-edge-soft p-3 flex items-center gap-2">
                    <span class="flex-1 text-lg font-mono text-accent">{outputQuote() || '0.0'}</span>
                    <span class="text-sm font-mono font-bold text-fg">{outSymbol()}</span>
                  </div>
                  <Show when={outputQuote() && inputAmount()}>
                    <div class="text-[10px] text-fg-faint text-center font-mono">
                      1 {inSymbol()} = {(parseFloat(outputQuote()!) / parseFloat(inputAmount())).toFixed(4)} {outSymbol()}
                    </div>
                  </Show>
                  <Show when={selectedAccount()} fallback={
                    <div class="text-xs text-fg-muted text-center py-2">Connect wallet to swap</div>
                  }>
                    <button
                      class="w-full py-3 text-sm font-heading uppercase tracking-wider bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                      disabled={swapping() || !inputAmount() || !outputQuote()}
                      onClick={handleSwap}
                    >
                      <Show when={!swapping()} fallback={<span class="animate-pulse">Swapping...</span>}>
                        Swap
                      </Show>
                    </button>
                  </Show>
                  <Show when={swapError()}>
                    <div class="text-xs text-red-700 bg-red-50 border border-red-200 p-2">{swapError()}</div>
                  </Show>
                </div>
              </div>
            )
          }}
        </Show>

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

        {/* Hint when no pool selected */}
        <Show when={!selectedPool()}>
          <div class="bg-surface border-2 border-edge p-3 shadow-[var(--shadow)] text-center">
            <p class="text-xs text-fg-faint">
              Select a pool to swap
            </p>
          </div>
        </Show>
      </div>
    </div>
  )
}
