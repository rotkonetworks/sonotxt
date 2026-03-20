#!/usr/bin/env npx tsx
// Upgrade SonoToken to V3: USDT peg + SONO burn + provider payouts
//
// Changes:
//   - USDT-pegged TXT pricing (txtPriceUsdt)
//   - Protocol fee on TXT purchases → SONO buyback+burn
//   - SONO burned directly on SONO→TXT conversions
//   - Provider payout on settlement (platformCutBps)
//   - withdrawProtocolFees + burnSono for buyback cycle
//
// Usage:
//   DEPLOYER_KEY=0x... npx tsx contracts/upgrade-v3.ts

import { createWalletClient, createPublicClient, http, defineChain, formatUnits, encodeFunctionData } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync } from 'fs'
import { join } from 'path'

const paseoAssetHub = defineChain({
  id: 420420417,
  name: 'Paseo Asset Hub',
  nativeCurrency: { name: 'PAS', symbol: 'PAS', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://eth-asset-hub-paseo.dotters.network'] },
  },
  testnet: true,
})

const PROXY = '0x1b3ece804e4414e3bce3ca9a006656b67d07fea1' as `0x${string}`

// Pallet-assets precompile addresses
const USDC = '0x0000053900000000000000000000000001200000' as `0x${string}` // asset 1337, 6 dec
const USDT = '0x000007c000000000000000000000000001200000' as `0x${string}` // asset 1984, 6 dec

const PROXY_ABI = [
  { type: 'function', name: 'upgradeToAndCall', inputs: [{ name: 'newImplementation', type: 'address' }, { name: 'data', type: 'bytes' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'implementation', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'admin', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
] as const

// V3 init params
const TXT_PRICE_USDT = 10000n       // $0.01 per TXT (USDT has 6 decimals: 10000/1e6 = 0.01)
const PROTOCOL_FEE_BPS = 100        // 1% on TXT purchases → SONO buyback
const PLATFORM_CUT_BPS = 2000       // 20% platform cut on settlements

async function main() {
  const privKey = process.env.DEPLOYER_KEY
  if (!privKey) {
    console.error('Set DEPLOYER_KEY=0x...')
    process.exit(1)
  }

  const outDir = join(__dirname, 'out')
  let implBytecode: `0x${string}`
  let implAbi: any[]
  try {
    const pvmHex = readFileSync(join(outDir, 'SonoToken.pvm')).toString('hex')
    implBytecode = `0x${pvmHex}`
    implAbi = JSON.parse(readFileSync(join(outDir, 'SonoToken.abi'), 'utf-8'))
  } catch {
    console.error('SonoToken artifacts not found. Compile first.')
    process.exit(1)
  }

  const account = privateKeyToAccount(privKey as `0x${string}`)
  const publicClient = createPublicClient({ chain: paseoAssetHub, transport: http() })
  const walletClient = createWalletClient({ account, chain: paseoAssetHub, transport: http() })

  // Verify admin
  const admin = await publicClient.readContract({ address: PROXY, abi: PROXY_ABI, functionName: 'admin' })
  const oldImpl = await publicClient.readContract({ address: PROXY, abi: PROXY_ABI, functionName: 'implementation' })
  console.log(`Proxy: ${PROXY}`)
  console.log(`Admin: ${admin}`)
  console.log(`Current impl: ${oldImpl}`)
  console.log(`Your address: ${account.address}`)

  if (admin.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`\nERROR: You are not the proxy admin!`)
    process.exit(1)
  }

  // Read pre-upgrade state (only V1 fields that exist on current impl)
  const [supply, ownerBal] = await Promise.all([
    publicClient.readContract({ address: PROXY, abi: implAbi, functionName: 'totalSupply' }),
    publicClient.readContract({ address: PROXY, abi: implAbi, functionName: 'balanceOf', args: [account.address] }),
  ]) as [bigint, bigint]
  console.log(`\nPre-upgrade:`)
  console.log(`  Supply: ${formatUnits(supply, 10)} TXT`)
  console.log(`  Owner bal: ${formatUnits(ownerBal, 10)} TXT`)

  // 1. Deploy new implementation
  console.log('\n1. Deploying new implementation...')
  const implHash = await walletClient.deployContract({
    abi: implAbi,
    bytecode: implBytecode,
  })
  const implReceipt = await publicClient.waitForTransactionReceipt({ hash: implHash, timeout: 120_000 })
  const newImpl = implReceipt.contractAddress!
  console.log(`   New impl: ${newImpl}`)
  console.log(`   Gas: ${implReceipt.gasUsed}`)

  // 2. Encode initializeV3 call
  const initV3Data = encodeFunctionData({
    abi: implAbi,
    functionName: 'initializeV3',
    args: [TXT_PRICE_USDT, PROTOCOL_FEE_BPS, PLATFORM_CUT_BPS, USDC, USDT],
  })

  console.log('\n2. Upgrading proxy + calling initializeV3...')
  console.log(`   TXT price: ${Number(TXT_PRICE_USDT) / 1e6} USDT`)
  console.log(`   Protocol fee: ${PROTOCOL_FEE_BPS / 100}%`)
  console.log(`   Platform cut: ${PLATFORM_CUT_BPS / 100}%`)
  const upgradeHash = await walletClient.writeContract({
    address: PROXY,
    abi: PROXY_ABI,
    functionName: 'upgradeToAndCall',
    args: [newImpl, initV3Data],
  })
  const upgradeReceipt = await publicClient.waitForTransactionReceipt({ hash: upgradeHash, timeout: 120_000 })
  console.log(`   Tx: ${upgradeHash}`)
  console.log(`   Status: ${upgradeReceipt.status}`)

  // 3. Verify
  console.log('\n3. Verifying...')
  const newImplCheck = await publicClient.readContract({ address: PROXY, abi: PROXY_ABI, functionName: 'implementation' })
  const [
    supplyAfter, ownerBalAfter, txtPriceUsdt, protocolFeeBps, platformCutBps,
    totalSonoBurned, totalProviderEarnings,
  ] = await Promise.all([
    publicClient.readContract({ address: PROXY, abi: implAbi, functionName: 'totalSupply' }),
    publicClient.readContract({ address: PROXY, abi: implAbi, functionName: 'balanceOf', args: [account.address] }),
    publicClient.readContract({ address: PROXY, abi: implAbi, functionName: 'txtPriceUsdt' }),
    publicClient.readContract({ address: PROXY, abi: implAbi, functionName: 'protocolFeeBps' }),
    publicClient.readContract({ address: PROXY, abi: implAbi, functionName: 'platformCutBps' }),
    publicClient.readContract({ address: PROXY, abi: implAbi, functionName: 'totalSonoBurned' }),
    publicClient.readContract({ address: PROXY, abi: implAbi, functionName: 'totalProviderEarnings' }),
  ]) as [bigint, bigint, bigint, number, number, bigint, bigint]

  console.log(`  Implementation: ${newImplCheck}`)
  console.log(`  Supply: ${formatUnits(supplyAfter, 10)} TXT`)
  console.log(`  Owner bal: ${formatUnits(ownerBalAfter, 10)} TXT`)
  console.log(`  TXT price (USDT): ${Number(txtPriceUsdt) / 1e6}`)
  console.log(`  Protocol fee: ${Number(protocolFeeBps) / 100}%`)
  console.log(`  Platform cut: ${Number(platformCutBps) / 100}%`)
  console.log(`  SONO burned: ${formatUnits(totalSonoBurned, 10)}`)
  console.log(`  Provider earnings: ${formatUnits(totalProviderEarnings, 10)}`)

  if (supply === supplyAfter && ownerBal === ownerBalAfter) {
    console.log('\nUpgrade successful! State preserved, V3 initialized.')
  } else {
    console.log('\nWARNING: State mismatch! Check storage layout.')
  }

  // 4. Quick fuzz test: check quotes work with new pricing
  console.log('\n4. Fuzz test: quotes...')
  const { parseUnits } = await import('viem')

  // Quote buying 1 DOT
  const dotQuote = await publicClient.readContract({
    address: PROXY, abi: implAbi, functionName: 'quoteBuyDot',
    args: [parseUnits('1', 18)],
  }) as bigint
  console.log(`   1 DOT → ${formatUnits(dotQuote, 10)} TXT`)

  // Quote buying 10 USDT
  const usdtQuote = await publicClient.readContract({
    address: PROXY, abi: implAbi, functionName: 'quoteBuyToken',
    args: [USDT, parseUnits('10', 6)],
  }) as bigint
  console.log(`   10 USDT → ${formatUnits(usdtQuote, 10)} TXT`)

  // Quote buying 10 USDC
  const usdcQuote = await publicClient.readContract({
    address: PROXY, abi: implAbi, functionName: 'quoteBuyToken',
    args: [USDC, parseUnits('10', 6)],
  }) as bigint
  console.log(`   10 USDC → ${formatUnits(usdcQuote, 10)} TXT`)
}

main().catch(console.error)
