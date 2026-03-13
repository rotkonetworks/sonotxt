#!/usr/bin/env npx tsx
// Deploy SonoToken via ERC1967 upgrade proxy to Paseo Asset Hub
//
// Prerequisites:
//   1. Install deps: pnpm install
//   2. Compile contracts with resolc (pallet-revive compiler):
//      resolc --solc solc --bin SonoToken.sol -o out/
//      resolc --solc solc --bin SonoProxy.sol -o out/
//      solc --abi SonoToken.sol -o out/
//      solc --abi SonoProxy.sol -o out/
//   3. Fund deployer account with PAS tokens on Paseo Asset Hub
//
// Usage:
//   DEPLOYER_KEY=0x... npx tsx contracts/deploy.ts
//
// The proxy is the address users interact with. To upgrade:
//   1. Deploy new SonoToken implementation
//   2. Call proxy.upgradeToAndCall(newImpl, "0x")

import { createWalletClient, createPublicClient, http, defineChain, encodeFunctionData, formatUnits } from 'viem'
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

async function main() {
  const privKey = process.env.DEPLOYER_KEY
  if (!privKey) {
    console.error('Set DEPLOYER_KEY=0x... (deployer private key with PAS balance)')
    process.exit(1)
  }

  const outDir = join(__dirname, 'out')

  // Read SonoToken artifacts
  let implBytecode: `0x${string}`
  let implAbi: any[]
  try {
    const pvmHex = readFileSync(join(outDir, 'SonoToken.pvm')).toString('hex')
    implBytecode = `0x${pvmHex}`
    implAbi = JSON.parse(readFileSync(join(outDir, 'SonoToken.abi'), 'utf-8'))
  } catch {
    console.error('SonoToken artifacts not found. Compile first with resolc + solc')
    process.exit(1)
  }

  // Read SonoProxy artifacts
  let proxyBytecode: `0x${string}`
  let proxyAbi: any[]
  try {
    const pvmHex = readFileSync(join(outDir, 'SonoProxy.pvm')).toString('hex')
    proxyBytecode = `0x${pvmHex}`
    proxyAbi = JSON.parse(readFileSync(join(outDir, 'SonoProxy.abi'), 'utf-8'))
  } catch {
    console.error('SonoProxy artifacts not found. Compile first with resolc + solc')
    process.exit(1)
  }

  const account = privateKeyToAccount(privKey as `0x${string}`)
  console.log(`Deployer: ${account.address}`)

  const publicClient = createPublicClient({
    chain: paseoAssetHub,
    transport: http(),
  })

  const walletClient = createWalletClient({
    account,
    chain: paseoAssetHub,
    transport: http(),
  })

  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`Balance: ${formatUnits(balance, 18)} PAS\n`)
  if (balance === 0n) {
    console.error('No balance! Get PAS from Paseo faucet first')
    process.exit(1)
  }

  // 1. Deploy implementation (SonoToken)
  // Constructor is disabled (_disableInitializers), so no args needed
  console.log('1. Deploying SonoToken implementation...')
  const implHash = await walletClient.deployContract({
    abi: implAbi,
    bytecode: implBytecode,
  })
  console.log(`   Tx: ${implHash}`)
  const implReceipt = await publicClient.waitForTransactionReceipt({ hash: implHash, timeout: 120_000 })
  const implAddress = implReceipt.contractAddress!
  console.log(`   Implementation: ${implAddress}`)
  console.log(`   Gas: ${implReceipt.gasUsed}\n`)

  // 2. Deploy proxy with initialize() call
  // Total supply: 1,000,000,000 SONO (10 decimals)
  const totalSupply = 1_000_000_000n * 10n ** 10n

  const initData = encodeFunctionData({
    abi: implAbi,
    functionName: 'initialize',
    args: [totalSupply],
  })

  console.log('2. Deploying SonoProxy...')
  console.log(`   Supply: 1,000,000,000 SONO`)
  const proxyHash = await walletClient.deployContract({
    abi: proxyAbi,
    bytecode: proxyBytecode,
    args: [implAddress, initData],
  })
  console.log(`   Tx: ${proxyHash}`)
  const proxyReceipt = await publicClient.waitForTransactionReceipt({ hash: proxyHash, timeout: 120_000 })
  const proxyAddress = proxyReceipt.contractAddress!
  console.log(`   Proxy: ${proxyAddress}`)
  console.log(`   Gas: ${proxyReceipt.gasUsed}\n`)

  // 3. Verify
  console.log('3. Verifying...')
  const [name, symbol, supply, ownerBal, contractOwner] = await Promise.all([
    publicClient.readContract({ address: proxyAddress, abi: implAbi, functionName: 'name' }),
    publicClient.readContract({ address: proxyAddress, abi: implAbi, functionName: 'symbol' }),
    publicClient.readContract({ address: proxyAddress, abi: implAbi, functionName: 'totalSupply' }),
    publicClient.readContract({ address: proxyAddress, abi: implAbi, functionName: 'balanceOf', args: [account.address] }),
    publicClient.readContract({ address: proxyAddress, abi: implAbi, functionName: 'owner' }),
  ]) as [string, string, bigint, bigint, string]

  console.log(`   Name: ${name} (${symbol})`)
  console.log(`   Total supply: ${formatUnits(supply, 10)} SONO`)
  console.log(`   Owner balance: ${formatUnits(ownerBal, 10)} SONO`)
  console.log(`   Owner: ${contractOwner}`)
  console.log(`   Admin: ${account.address}`)

  console.log('\n✓ Deployment complete!')
  console.log(`\nProxy address (use this everywhere): ${proxyAddress}`)
  console.log(`Implementation: ${implAddress}`)
  console.log('\nUpdate CONTRACT_ADDRESS in:')
  console.log(`  app/src/lib/contract.ts  →  '${proxyAddress}'`)
  console.log(`  contracts/interact.ts    →  '${proxyAddress}'`)
}

main().catch(console.error)
