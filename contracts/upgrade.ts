#!/usr/bin/env npx tsx
// Upgrade SonoToken to a new implementation via ERC1967 proxy
//
// Prerequisites:
//   1. Compile new SonoToken: resolc --solc solc --bin SonoToken.sol -o out/
//   2. Admin key must match the proxy admin
//
// Usage:
//   DEPLOYER_KEY=0x... PROXY=0x... npx tsx contracts/upgrade.ts

import { createWalletClient, createPublicClient, http, defineChain, formatUnits } from 'viem'
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

const PROXY_ABI = [
  { type: 'function', name: 'upgradeToAndCall', inputs: [{ name: 'newImplementation', type: 'address' }, { name: 'data', type: 'bytes' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'implementation', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
  { type: 'function', name: 'admin', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
] as const

async function main() {
  const privKey = process.env.DEPLOYER_KEY
  const proxyAddr = process.env.PROXY
  if (!privKey || !proxyAddr) {
    console.error('Set DEPLOYER_KEY=0x... and PROXY=0x...')
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
  const proxy = proxyAddr as `0x${string}`

  const publicClient = createPublicClient({ chain: paseoAssetHub, transport: http() })
  const walletClient = createWalletClient({ account, chain: paseoAssetHub, transport: http() })

  // Verify admin
  const admin = await publicClient.readContract({ address: proxy, abi: PROXY_ABI, functionName: 'admin' })
  const oldImpl = await publicClient.readContract({ address: proxy, abi: PROXY_ABI, functionName: 'implementation' })
  console.log(`Proxy: ${proxy}`)
  console.log(`Admin: ${admin}`)
  console.log(`Current impl: ${oldImpl}`)

  if (admin.toLowerCase() !== account.address.toLowerCase()) {
    console.error(`\nERROR: You are not the proxy admin!`)
    console.error(`  Your address: ${account.address}`)
    console.error(`  Proxy admin:  ${admin}`)
    process.exit(1)
  }

  // Read current state before upgrade
  const [supply, ownerBal] = await Promise.all([
    publicClient.readContract({ address: proxy, abi: implAbi, functionName: 'totalSupply' }),
    publicClient.readContract({ address: proxy, abi: implAbi, functionName: 'balanceOf', args: [account.address] }),
  ]) as [bigint, bigint]
  console.log(`\nPre-upgrade state:`)
  console.log(`  Total supply: ${formatUnits(supply, 10)} SONO`)
  console.log(`  Owner balance: ${formatUnits(ownerBal, 10)} SONO`)

  // 1. Deploy new implementation
  console.log('\n1. Deploying new implementation...')
  const implHash = await walletClient.deployContract({
    abi: implAbi,
    bytecode: implBytecode,
  })
  const implReceipt = await publicClient.waitForTransactionReceipt({ hash: implHash })
  const newImpl = implReceipt.contractAddress!
  console.log(`   New impl: ${newImpl}`)

  // 2. Upgrade proxy
  console.log('\n2. Upgrading proxy...')
  const upgradeHash = await walletClient.writeContract({
    address: proxy,
    abi: PROXY_ABI,
    functionName: 'upgradeToAndCall',
    args: [newImpl, '0x'],
  })
  await publicClient.waitForTransactionReceipt({ hash: upgradeHash })
  console.log(`   Tx: ${upgradeHash}`)

  // 3. Verify
  const newImplCheck = await publicClient.readContract({ address: proxy, abi: PROXY_ABI, functionName: 'implementation' })
  const [supplyAfter, ownerBalAfter] = await Promise.all([
    publicClient.readContract({ address: proxy, abi: implAbi, functionName: 'totalSupply' }),
    publicClient.readContract({ address: proxy, abi: implAbi, functionName: 'balanceOf', args: [account.address] }),
  ]) as [bigint, bigint]

  console.log(`\nPost-upgrade:`)
  console.log(`  Implementation: ${newImplCheck}`)
  console.log(`  Total supply: ${formatUnits(supplyAfter, 10)} SONO`)
  console.log(`  Owner balance: ${formatUnits(ownerBalAfter, 10)} SONO`)

  if (supply === supplyAfter && ownerBal === ownerBalAfter) {
    console.log('\n✓ Upgrade successful! State preserved.')
  } else {
    console.log('\n⚠ WARNING: State mismatch! Check storage layout compatibility.')
  }
}

main().catch(console.error)
