#!/usr/bin/env npx tsx
// Deploy SonoToken V4 (single-token SONO) + SonoGovernance to Paseo Asset Hub
//
// 1. Deploy new SonoToken implementation
// 2. Upgrade proxy with initializeV2 + initializeV3
// 3. Deploy SonoGovernance
// 4. Wire: token.setGovernance(governance), token.transferOwnership(governance) [optional]
//
// Usage:
//   DEPLOYER_KEY=0x... npx tsx contracts/deploy-v4.ts

import { createWalletClient, createPublicClient, http, defineChain, formatUnits, encodeFunctionData } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync } from 'fs'
import { join } from 'path'

const paseoAssetHub = defineChain({
  id: 420420417,
  name: 'Paseo Asset Hub',
  nativeCurrency: { name: 'PAS', symbol: 'PAS', decimals: 18 },
  rpcUrls: { default: { http: ['https://eth-asset-hub-paseo.dotters.network'] } },
  testnet: true,
})

const PROXY = '0x1b3ece804e4414e3bce3ca9a006656b67d07fea1' as `0x${string}`
const USDC = '0x0000053900000000000000000000000001200000' as `0x${string}`
const USDT = '0x000007c000000000000000000000000001200000' as `0x${string}`

const PROXY_ABI = [
  { type: 'function', name: 'upgradeToAndCall', inputs: [{ name: 'newImplementation', type: 'address' }, { name: 'data', type: 'bytes' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'implementation', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'admin', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
] as const

async function main() {
  const privKey = process.env.DEPLOYER_KEY
  if (!privKey) { console.error('Set DEPLOYER_KEY=0x...'); process.exit(1) }

  const outDir = join(__dirname, 'out')
  const tokenAbi = JSON.parse(readFileSync(join(outDir, 'SonoToken.abi'), 'utf-8'))
  const tokenBytecode = `0x${readFileSync(join(outDir, 'SonoToken.pvm')).toString('hex')}` as `0x${string}`
  const govAbi = JSON.parse(readFileSync(join(outDir, 'SonoGovernance.abi'), 'utf-8'))
  const govBytecode = `0x${readFileSync(join(outDir, 'SonoGovernance.pvm')).toString('hex')}` as `0x${string}`

  const account = privateKeyToAccount(privKey as `0x${string}`)
  const publicClient = createPublicClient({ chain: paseoAssetHub, transport: http() })
  const walletClient = createWalletClient({ account, chain: paseoAssetHub, transport: http() })

  console.log(`Deployer: ${account.address}`)
  console.log(`Proxy: ${PROXY}`)

  // Verify admin
  const admin = await publicClient.readContract({ address: PROXY, abi: PROXY_ABI, functionName: 'admin' })
  if (admin.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`Not proxy admin! Admin: ${admin}`)
    process.exit(1)
  }

  // Pre-upgrade state
  const [supply, ownerBal] = await Promise.all([
    publicClient.readContract({ address: PROXY, abi: tokenAbi, functionName: 'totalSupply' }),
    publicClient.readContract({ address: PROXY, abi: tokenAbi, functionName: 'balanceOf', args: [account.address] }),
  ]) as [bigint, bigint]
  console.log(`\nPre-upgrade: supply=${formatUnits(supply, 10)}, owner=${formatUnits(ownerBal, 10)}`)

  // 1. Deploy new SonoToken implementation
  console.log('\n1. Deploying SonoToken V4 implementation...')
  const implHash = await walletClient.deployContract({ abi: tokenAbi, bytecode: tokenBytecode })
  const implReceipt = await publicClient.waitForTransactionReceipt({ hash: implHash, timeout: 120_000 })
  const newImpl = implReceipt.contractAddress!
  console.log(`   Impl: ${newImpl} (gas: ${implReceipt.gasUsed})`)

  // 2. Upgrade proxy — call initializeV2 (treasury = deployer)
  // Note: V2 might already be initialized from previous upgrade. If so, just upgrade without init.
  // Try upgrade with V2 init first, if it fails, upgrade without.
  console.log('\n2. Upgrading proxy...')

  // First try: upgrade + initializeV2
  const initV2Data = encodeFunctionData({
    abi: tokenAbi,
    functionName: 'initializeV2',
    args: [account.address],
  })

  try {
    const h = await walletClient.writeContract({
      address: PROXY, abi: PROXY_ABI, functionName: 'upgradeToAndCall',
      args: [newImpl, initV2Data],
    })
    await publicClient.waitForTransactionReceipt({ hash: h })
    console.log('   Upgraded + V2 initialized')
  } catch {
    // V2 already initialized, upgrade without init
    console.log('   V2 already initialized, upgrading without init...')
    const h = await walletClient.writeContract({
      address: PROXY, abi: PROXY_ABI, functionName: 'upgradeToAndCall',
      args: [newImpl, '0x'],
    })
    await publicClient.waitForTransactionReceipt({ hash: h })
    console.log('   Upgraded')
  }

  // Set burnBps and treasury if not set
  try {
    const bps = await publicClient.readContract({ address: PROXY, abi: tokenAbi, functionName: 'burnBps' }) as number
    if (Number(bps) === 0) {
      console.log('   Setting burnBps=9000, treasury...')
      const h1 = await walletClient.writeContract({ address: PROXY, abi: tokenAbi, functionName: 'setBurnBps', args: [9000] })
      await publicClient.waitForTransactionReceipt({ hash: h1 })
      const h2 = await walletClient.writeContract({ address: PROXY, abi: tokenAbi, functionName: 'setTreasury', args: [account.address] })
      await publicClient.waitForTransactionReceipt({ hash: h2 })
      const h3 = await walletClient.writeContract({ address: PROXY, abi: tokenAbi, functionName: 'setMinProviderStake', args: [1000n * 10n**10n] })
      await publicClient.waitForTransactionReceipt({ hash: h3 })
    }
  } catch {}

  // 3. Initialize V3 (if not already)
  console.log('\n3. Initializing V3...')
  try {
    const h = await walletClient.writeContract({
      address: PROXY, abi: tokenAbi, functionName: 'initializeV3',
      args: [10000n, 100, 2000, USDC, USDT], // $0.01, 1% fee, 20% platform cut
    })
    await publicClient.waitForTransactionReceipt({ hash: h })
    console.log('   V3 initialized')
  } catch (e: any) {
    console.log('   V3 already initialized:', e.message?.slice(0, 80))
  }

  // 4. Deploy SonoGovernance
  console.log('\n4. Deploying SonoGovernance...')
  const govHash = await walletClient.deployContract({
    abi: govAbi,
    bytecode: govBytecode,
    args: [PROXY, account.address], // token=proxy, guardian=deployer
  })
  const govReceipt = await publicClient.waitForTransactionReceipt({ hash: govHash, timeout: 120_000 })
  const govAddress = govReceipt.contractAddress!
  console.log(`   Governance: ${govAddress} (gas: ${govReceipt.gasUsed})`)

  // 5. Wire: token.setGovernance(governance)
  console.log('\n5. Wiring governance...')
  const h = await walletClient.writeContract({
    address: PROXY, abi: tokenAbi, functionName: 'setGovernance', args: [govAddress],
  })
  await publicClient.waitForTransactionReceipt({ hash: h })
  console.log('   token.governance = governance contract')

  // 6. Verify
  console.log('\n6. Verifying...')
  const [
    newImplCheck, sym, supplyAfter, ownerBalAfter, burnBps, platformCut, protocolFee, govCheck, sonoPriceUsdt
  ] = await Promise.all([
    publicClient.readContract({ address: PROXY, abi: PROXY_ABI, functionName: 'implementation' }),
    publicClient.readContract({ address: PROXY, abi: tokenAbi, functionName: 'symbol' }),
    publicClient.readContract({ address: PROXY, abi: tokenAbi, functionName: 'totalSupply' }),
    publicClient.readContract({ address: PROXY, abi: tokenAbi, functionName: 'balanceOf', args: [account.address] }),
    publicClient.readContract({ address: PROXY, abi: tokenAbi, functionName: 'burnBps' }),
    publicClient.readContract({ address: PROXY, abi: tokenAbi, functionName: 'platformCutBps' }),
    publicClient.readContract({ address: PROXY, abi: tokenAbi, functionName: 'protocolFeeBps' }),
    publicClient.readContract({ address: PROXY, abi: tokenAbi, functionName: 'governance' }),
    publicClient.readContract({ address: PROXY, abi: tokenAbi, functionName: 'sonoPriceUsdt' }),
  ]) as [string, string, bigint, bigint, number, number, number, string, bigint]

  console.log(`  Symbol: ${sym}`)
  console.log(`  Supply: ${formatUnits(supplyAfter, 10)}`)
  console.log(`  Owner bal: ${formatUnits(ownerBalAfter, 10)}`)
  console.log(`  Burn bps: ${Number(burnBps)}`)
  console.log(`  Platform cut: ${Number(platformCut)}`)
  console.log(`  Protocol fee: ${Number(protocolFee)}`)
  console.log(`  SONO price: ${Number(sonoPriceUsdt) / 1e6} USDT`)
  console.log(`  Governance: ${govCheck}`)
  console.log(`  Implementation: ${newImplCheck}`)

  const ok = supply === supplyAfter && ownerBal === ownerBalAfter
  console.log(`\n${ok ? 'SUCCESS' : 'WARNING: state mismatch'}`)
  console.log(`\nProxy: ${PROXY}`)
  console.log(`Governance: ${govAddress}`)
}

main().catch(console.error)
