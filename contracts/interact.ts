#!/usr/bin/env npx tsx
// Interact with deployed SonoToken on Paseo Asset Hub
//
// Usage:
//   DEPLOYER_KEY=0x... npx tsx contracts/interact.ts <command> [args...]
//
// Commands:
//   info                    - Show token info and balances
//   transfer <to> <amount>  - Transfer SONO tokens
//   send-pas <to> <amount>  - Send PAS (native token) for gas
//   open-channel <amount>   - Open payment channel to service address
//   channel <user>          - Check channel status

import { createWalletClient, createPublicClient, http, defineChain, parseUnits, formatUnits, encodeFunctionData } from 'viem'
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

const CONTRACT = '0x1b3ece804e4414e3bce3ca9a006656b67d07fea1' as `0x${string}`
const SERVICE = '0x496e2db8ddc0bf2ea42bf3c8c5e0b23a9546c225' as `0x${string}`
const DECIMALS = 10

const abi = JSON.parse(readFileSync(join(__dirname, 'out', 'SonoToken.abi'), 'utf-8'))

function getClients(privKey: string) {
  const account = privateKeyToAccount(privKey as `0x${string}`)
  const publicClient = createPublicClient({
    chain: paseoAssetHub,
    transport: http(),
  })
  const walletClient = createWalletClient({
    account,
    chain: paseoAssetHub,
    transport: http(),
  })
  return { account, publicClient, walletClient }
}

async function info(privKey: string) {
  const { account, publicClient } = getClients(privKey)

  const [name, symbol, totalSupply, deployerBal, serviceBal, deployerPas, servicePas] = await Promise.all([
    publicClient.readContract({ address: CONTRACT, abi, functionName: 'name' }) as Promise<string>,
    publicClient.readContract({ address: CONTRACT, abi, functionName: 'symbol' }) as Promise<string>,
    publicClient.readContract({ address: CONTRACT, abi, functionName: 'totalSupply' }) as Promise<bigint>,
    publicClient.readContract({ address: CONTRACT, abi, functionName: 'balanceOf', args: [account.address] }) as Promise<bigint>,
    publicClient.readContract({ address: CONTRACT, abi, functionName: 'balanceOf', args: [SERVICE] }) as Promise<bigint>,
    publicClient.getBalance({ address: account.address }),
    publicClient.getBalance({ address: SERVICE }),
  ])

  console.log(`Token: ${name} (${symbol})`)
  console.log(`Contract: ${CONTRACT}`)
  console.log(`Total supply: ${formatUnits(totalSupply, DECIMALS)} SONO`)
  console.log()
  console.log(`Deployer (${account.address}):`)
  console.log(`  SONO: ${formatUnits(deployerBal, DECIMALS)}`)
  console.log(`  PAS:  ${formatUnits(deployerPas, 18)}`)
  console.log()
  console.log(`Service (${SERVICE}):`)
  console.log(`  SONO: ${formatUnits(serviceBal, DECIMALS)}`)
  console.log(`  PAS:  ${formatUnits(servicePas, 18)}`)
}

async function transfer(privKey: string, to: string, amount: string) {
  const { account, publicClient, walletClient } = getClients(privKey)
  const value = parseUnits(amount, DECIMALS)

  console.log(`Transferring ${amount} SONO to ${to}...`)
  const hash = await walletClient.writeContract({
    address: CONTRACT,
    abi,
    functionName: 'transfer',
    args: [to as `0x${string}`, value],
  })
  console.log(`Tx: ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  console.log(`Confirmed in block ${receipt.blockNumber}, status: ${receipt.status}`)
}

async function sendPas(privKey: string, to: string, amount: string) {
  const { account, publicClient, walletClient } = getClients(privKey)
  const value = parseUnits(amount, 18)

  console.log(`Sending ${amount} PAS to ${to}...`)
  const hash = await walletClient.sendTransaction({
    to: to as `0x${string}`,
    value,
  })
  console.log(`Tx: ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  console.log(`Confirmed in block ${receipt.blockNumber}, status: ${receipt.status}`)
}

async function openChannel(privKey: string, amount: string) {
  const { account, publicClient, walletClient } = getClients(privKey)
  const value = parseUnits(amount, DECIMALS)

  console.log(`Opening channel with ${amount} SONO to service ${SERVICE}...`)
  const hash = await walletClient.writeContract({
    address: CONTRACT,
    abi,
    functionName: 'openChannel',
    args: [SERVICE, value],
  })
  console.log(`Tx: ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  console.log(`Confirmed in block ${receipt.blockNumber}, status: ${receipt.status}`)
}

async function channelStatus(privKey: string, user: string) {
  const { publicClient } = getClients(privKey)

  const result = await publicClient.readContract({
    address: CONTRACT,
    abi,
    functionName: 'getChannel',
    args: [user as `0x${string}`, SERVICE],
  }) as [bigint, bigint, bigint, bigint]

  const [deposit, spent, nonce, expiresAt] = result
  const remaining = deposit - spent

  console.log(`Channel: ${user} → ${SERVICE}`)
  console.log(`  Deposit:   ${formatUnits(deposit, DECIMALS)} SONO`)
  console.log(`  Spent:     ${formatUnits(spent, DECIMALS)} SONO`)
  console.log(`  Remaining: ${formatUnits(remaining, DECIMALS)} SONO`)
  console.log(`  Nonce:     ${nonce}`)
  console.log(`  Expires:   ${expiresAt === 0n ? 'N/A' : new Date(Number(expiresAt) * 1000).toISOString()}`)
}

async function main() {
  const privKey = process.env.DEPLOYER_KEY
  if (!privKey) {
    console.error('Set DEPLOYER_KEY=0x...')
    process.exit(1)
  }

  const [cmd, ...args] = process.argv.slice(2)

  switch (cmd) {
    case 'info':
      await info(privKey)
      break
    case 'transfer':
      if (args.length < 2) { console.error('Usage: transfer <to> <amount>'); process.exit(1) }
      await transfer(privKey, args[0], args[1])
      break
    case 'send-pas':
      if (args.length < 2) { console.error('Usage: send-pas <to> <amount>'); process.exit(1) }
      await sendPas(privKey, args[0], args[1])
      break
    case 'open-channel':
      if (args.length < 1) { console.error('Usage: open-channel <amount>'); process.exit(1) }
      await openChannel(privKey, args[0])
      break
    case 'channel':
      if (args.length < 1) { console.error('Usage: channel <user-address>'); process.exit(1) }
      await channelStatus(privKey, args[0])
      break
    default:
      console.log('Commands: info, transfer, send-pas, open-channel, channel')
  }
}

main().catch(console.error)
