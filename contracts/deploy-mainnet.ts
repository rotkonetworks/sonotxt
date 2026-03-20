#!/usr/bin/env npx tsx
// Deploy SonoToken + SonoProxy + SonoGovernance + AssetSwap to Polkadot Asset Hub (mainnet)
//
// Usage: DEPLOYER_KEY=0x... npx tsx contracts/deploy-mainnet.ts

import { createWalletClient, createPublicClient, http, defineChain, formatUnits, encodeFunctionData } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync } from 'fs'
import { join } from 'path'

const polkadotAssetHub = defineChain({
  id: 420420419,
  name: 'Polkadot Asset Hub',
  nativeCurrency: { name: 'DOT', symbol: 'DOT', decimals: 18 },
  rpcUrls: { default: { http: ['https://eth-asset-hub-polkadot.dotters.network'] } },
  testnet: false,
})

const USDC = '0x0000053900000000000000000000000001200000' as `0x${string}` // asset 1337
const USDT = '0x000007c000000000000000000000000001200000' as `0x${string}` // asset 1984

async function main() {
  const privKey = process.env.DEPLOYER_KEY
  if (!privKey) { console.error('Set DEPLOYER_KEY=0x...'); process.exit(1) }

  const outDir = join(__dirname, 'out')
  const tokenAbi = JSON.parse(readFileSync(join(outDir, 'SonoToken.abi'), 'utf-8'))
  const tokenBytecode = `0x${readFileSync(join(outDir, 'SonoToken.pvm')).toString('hex')}` as `0x${string}`
  const proxyAbi = JSON.parse(readFileSync(join(outDir, 'SonoProxy.abi'), 'utf-8'))
  const proxyBytecode = `0x${readFileSync(join(outDir, 'SonoProxy.pvm')).toString('hex')}` as `0x${string}`
  const govAbi = JSON.parse(readFileSync(join(outDir, 'SonoGovernance.abi'), 'utf-8'))
  const govBytecode = `0x${readFileSync(join(outDir, 'SonoGovernance.pvm')).toString('hex')}` as `0x${string}`
  const swapAbi = JSON.parse(readFileSync(join(outDir, 'AssetSwap.abi'), 'utf-8'))
  const swapBytecode = `0x${readFileSync(join(outDir, 'AssetSwap.pvm')).toString('hex')}` as `0x${string}`

  const account = privateKeyToAccount(privKey as `0x${string}`)
  const publicClient = createPublicClient({ chain: polkadotAssetHub, transport: http() })
  const walletClient = createWalletClient({ account, chain: polkadotAssetHub, transport: http() })

  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`Deployer: ${account.address}`)
  console.log(`Balance: ${formatUnits(balance, 18)} DOT\n`)

  // 1. Deploy SonoToken implementation
  console.log('1. Deploying SonoToken implementation...')
  const implHash = await walletClient.deployContract({ abi: tokenAbi, bytecode: tokenBytecode })
  const implReceipt = await publicClient.waitForTransactionReceipt({ hash: implHash, timeout: 300_000 })
  const implAddress = implReceipt.contractAddress!
  console.log(`   Impl: ${implAddress} (gas: ${implReceipt.gasUsed})`)

  // 2. Deploy proxy with initialize(1B SONO)
  const totalSupply = 1_000_000_000n * 10n ** 10n
  const initData = encodeFunctionData({ abi: tokenAbi, functionName: 'initialize', args: [totalSupply] })

  console.log('\n2. Deploying SonoProxy...')
  const proxyHash = await walletClient.deployContract({ abi: proxyAbi, bytecode: proxyBytecode, args: [implAddress, initData] })
  const proxyReceipt = await publicClient.waitForTransactionReceipt({ hash: proxyHash, timeout: 300_000 })
  const proxyAddress = proxyReceipt.contractAddress!
  console.log(`   Proxy: ${proxyAddress} (gas: ${proxyReceipt.gasUsed})`)

  // 3. Initialize V2
  console.log('\n3. Initializing V2...')
  let h = await walletClient.writeContract({ address: proxyAddress, abi: tokenAbi, functionName: 'initializeV2', args: [account.address] })
  await publicClient.waitForTransactionReceipt({ hash: h })
  console.log('   V2 initialized')

  // 4. Initialize V3
  console.log('\n4. Initializing V3...')
  h = await walletClient.writeContract({ address: proxyAddress, abi: tokenAbi, functionName: 'initializeV3', args: [10000n, 100, 2000, USDC, USDT] })
  await publicClient.waitForTransactionReceipt({ hash: h })
  console.log('   V3 initialized ($0.01, 1% fee, 20% cut)')

  // 5. Set remaining params
  console.log('\n5. Setting params...')
  h = await walletClient.writeContract({ address: proxyAddress, abi: tokenAbi, functionName: 'setBurnBps', args: [9000] })
  await publicClient.waitForTransactionReceipt({ hash: h })
  h = await walletClient.writeContract({ address: proxyAddress, abi: tokenAbi, functionName: 'setTreasury', args: [account.address] })
  await publicClient.waitForTransactionReceipt({ hash: h })
  console.log('   burnBps=9000, treasury=deployer')

  // 6. Deploy SonoGovernance
  console.log('\n6. Deploying SonoGovernance...')
  const govHash = await walletClient.deployContract({ abi: govAbi, bytecode: govBytecode, args: [proxyAddress, account.address] })
  const govReceipt = await publicClient.waitForTransactionReceipt({ hash: govHash, timeout: 300_000 })
  const govAddress = govReceipt.contractAddress!
  console.log(`   Governance: ${govAddress} (gas: ${govReceipt.gasUsed})`)

  // 7. Wire governance
  console.log('\n7. Wiring governance...')
  h = await walletClient.writeContract({ address: proxyAddress, abi: tokenAbi, functionName: 'setGovernance', args: [govAddress] })
  await publicClient.waitForTransactionReceipt({ hash: h })
  console.log('   token.governance = governance')

  // 8. Deploy AssetSwap bridge
  console.log('\n8. Deploying AssetSwap bridge...')
  const swapHash = await walletClient.deployContract({ abi: swapAbi, bytecode: swapBytecode })
  const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash, timeout: 300_000 })
  const swapAddress = swapReceipt.contractAddress!
  console.log(`   AssetSwap: ${swapAddress} (gas: ${swapReceipt.gasUsed})`)

  // 9. Whitelist bridge in governance
  console.log('\n9. Whitelisting bridge in governance...')
  h = await walletClient.writeContract({ address: govAddress, abi: govAbi, functionName: 'setAllowedBridge', args: [swapAddress, true] })
  await publicClient.waitForTransactionReceipt({ hash: h })
  console.log('   bridge whitelisted')

  // 10. Verify
  console.log('\n10. Verifying...')
  const [sym, supply, ownerBal] = await Promise.all([
    publicClient.readContract({ address: proxyAddress, abi: tokenAbi, functionName: 'symbol' }),
    publicClient.readContract({ address: proxyAddress, abi: tokenAbi, functionName: 'totalSupply' }),
    publicClient.readContract({ address: proxyAddress, abi: tokenAbi, functionName: 'balanceOf', args: [account.address] }),
  ]) as [string, bigint, bigint]

  const endBalance = await publicClient.getBalance({ address: account.address })

  console.log(`  Symbol: ${sym}`)
  console.log(`  Supply: ${formatUnits(supply, 10)} SONO`)
  console.log(`  Owner: ${formatUnits(ownerBal, 10)} SONO`)
  console.log(`  DOT remaining: ${formatUnits(endBalance, 18)}`)
  console.log(`  DOT spent: ${formatUnits(balance - endBalance, 18)}`)

  console.log('\n========== MAINNET DEPLOYMENT ==========')
  console.log(`SonoToken proxy:  ${proxyAddress}`)
  console.log(`SonoGovernance:   ${govAddress}`)
  console.log(`AssetSwap bridge: ${swapAddress}`)
  console.log('=========================================')
}

main().catch(console.error)
