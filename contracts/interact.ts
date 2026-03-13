#!/usr/bin/env npx tsx
// Interact with deployed SonoToken on Paseo Asset Hub
//
// Usage:
//   DEPLOYER_KEY=0x... npx tsx contracts/interact.ts <command> [args...]
//
// Commands:
//   info                    - Show token info and balances
//   transfer <to> <amount>  - Transfer TXT tokens
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
const SERVICE = '0xe819D7B8c05dE5d1e5E067eBc85DCcB562738E0B' as `0x${string}`
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
  console.log(`Total supply: ${formatUnits(totalSupply, DECIMALS)} TXT`)
  console.log()
  console.log(`Deployer (${account.address}):`)
  console.log(`  TXT: ${formatUnits(deployerBal, DECIMALS)}`)
  console.log(`  PAS: ${formatUnits(deployerPas, 18)}`)
  console.log()
  console.log(`Service (${SERVICE}):`)
  console.log(`  TXT: ${formatUnits(serviceBal, DECIMALS)}`)
  console.log(`  PAS: ${formatUnits(servicePas, 18)}`)
}

async function transfer(privKey: string, to: string, amount: string) {
  const { account, publicClient, walletClient } = getClients(privKey)
  const value = parseUnits(amount, DECIMALS)

  console.log(`Transferring ${amount} TXT to ${to}...`)
  const hash = await walletClient.writeContract({
    address: CONTRACT,
    abi,
    functionName: 'transfer',
    args: [to as `0x${string}`, value],
  })
  console.log(`Tx: ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 })
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
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 })
  console.log(`Confirmed in block ${receipt.blockNumber}, status: ${receipt.status}`)
}

async function openChannel(privKey: string, amount: string) {
  const { account, publicClient, walletClient } = getClients(privKey)
  const value = parseUnits(amount, DECIMALS)

  console.log(`Opening channel with ${amount} TXT to service ${SERVICE}...`)
  const hash = await walletClient.writeContract({
    address: CONTRACT,
    abi,
    functionName: 'openChannel',
    args: [SERVICE, value],
  })
  console.log(`Tx: ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 })
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
  console.log(`  Deposit:   ${formatUnits(deposit, DECIMALS)} TXT`)
  console.log(`  Spent:     ${formatUnits(spent, DECIMALS)} TXT`)
  console.log(`  Remaining: ${formatUnits(remaining, DECIMALS)} TXT`)
  console.log(`  Nonce:     ${nonce}`)
  console.log(`  Expires:   ${expiresAt === 0n ? 'N/A' : new Date(Number(expiresAt) * 1000).toISOString()}`)
}

async function coopClose(serviceKey: string, userKey: string, spent: string) {
  const { keccak256, encodePacked } = await import('viem')

  const userAccount = privateKeyToAccount(userKey as `0x${string}`)
  const serviceAccount = privateKeyToAccount(serviceKey as `0x${string}`)

  const { publicClient } = getClients(serviceKey)

  // Get channel state
  const [deposit, , nonce] = await publicClient.readContract({
    address: CONTRACT, abi, functionName: 'getChannel',
    args: [userAccount.address, serviceAccount.address],
  }) as [bigint, bigint, bigint, bigint]

  if (deposit === 0n) { console.error('No open channel'); process.exit(1) }

  const chId = await publicClient.readContract({
    address: CONTRACT, abi, functionName: 'channelId',
    args: [userAccount.address, serviceAccount.address],
  }) as `0x${string}`

  const spentRaw = parseUnits(spent, DECIMALS)
  const newNonce = nonce + 1n

  // User signs the state
  const stateHash = keccak256(encodePacked(
    ['bytes32', 'uint256', 'uint64'],
    [chId, spentRaw, newNonce],
  ))
  const sig = await userAccount.signMessage({ message: { raw: stateHash as `0x${string}` } })

  console.log(`Cooperative close: ${formatUnits(spentRaw, DECIMALS)} TXT spent`)
  console.log(`  Channel: ${chId}`)
  console.log(`  User: ${userAccount.address}`)
  console.log(`  Service: ${serviceAccount.address}`)

  // Service calls cooperativeClose
  const walletClient = createWalletClient({
    account: serviceAccount,
    chain: paseoAssetHub,
    transport: http(),
  })

  const hash = await walletClient.writeContract({
    address: CONTRACT, abi, functionName: 'cooperativeClose',
    args: [userAccount.address, spentRaw, newNonce, sig],
  })
  console.log(`  Tx: ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 })
  console.log(`  Block: ${receipt.blockNumber}, status: ${receipt.status}`)
}

async function setDotPrice(privKey: string, txtPerDot: string) {
  const { account, publicClient, walletClient } = getClients(privKey)
  const rate = parseUnits(txtPerDot, DECIMALS)
  console.log(`Setting DOT price: 1 DOT = ${txtPerDot} TXT...`)
  const hash = await walletClient.writeContract({
    address: CONTRACT, abi, functionName: 'setDotPrice', args: [rate],
  })
  console.log(`Tx: ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 })
  console.log(`Confirmed in block ${receipt.blockNumber}, status: ${receipt.status}`)
}

async function buyWithDot(privKey: string, dotAmount: string) {
  const { account, publicClient, walletClient } = getClients(privKey)
  const value = parseUnits(dotAmount, 18)

  // Quote first
  const quote = await publicClient.readContract({
    address: CONTRACT, abi, functionName: 'quoteBuyDot', args: [value],
  }) as bigint
  console.log(`Buying TXT with ${dotAmount} DOT (≈ ${formatUnits(quote, DECIMALS)} TXT)...`)

  const hash = await walletClient.writeContract({
    address: CONTRACT, abi, functionName: 'buyWithDot', value,
  })
  console.log(`Tx: ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 })
  console.log(`Confirmed in block ${receipt.blockNumber}, status: ${receipt.status}`)
}

async function userClose(privKey: string, service: string) {
  const { account, publicClient, walletClient } = getClients(privKey)
  const svc = (service || SERVICE) as `0x${string}`
  console.log(`User-closing channel to ${svc}...`)
  const hash = await walletClient.writeContract({
    address: CONTRACT, abi, functionName: 'userClose', args: [svc],
  })
  console.log(`Tx: ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 })
  console.log(`Confirmed in block ${receipt.blockNumber}, status: ${receipt.status}`)
}

async function finalize(privKey: string, user: string, service: string) {
  const { publicClient, walletClient } = getClients(privKey)
  const svc = (service || SERVICE) as `0x${string}`
  console.log(`Finalizing channel ${user} → ${svc}...`)
  const hash = await walletClient.writeContract({
    address: CONTRACT, abi, functionName: 'finalize', args: [user as `0x${string}`, svc],
  })
  console.log(`Tx: ${hash}`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 })
  console.log(`Confirmed in block ${receipt.blockNumber}, status: ${receipt.status}`)
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
    case 'coop-close':
      if (args.length < 2) { console.error('Usage: SERVICE_KEY=0x... coop-close <user-key> <spent>'); process.exit(1) }
      await coopClose(privKey, args[0], args[1])
      break
    case 'set-dot-price':
      if (args.length < 1) { console.error('Usage: set-dot-price <txt-per-dot>'); process.exit(1) }
      await setDotPrice(privKey, args[0])
      break
    case 'buy-dot':
      if (args.length < 1) { console.error('Usage: buy-dot <dot-amount>'); process.exit(1) }
      await buyWithDot(privKey, args[0])
      break
    case 'user-close':
      await userClose(privKey, args[0])
      break
    case 'finalize':
      if (args.length < 1) { console.error('Usage: finalize <user> [service]'); process.exit(1) }
      await finalize(privKey, args[0], args[1])
      break
    default:
      console.log('Commands: info, transfer, send-pas, open-channel, channel, user-close, finalize, coop-close, set-dot-price, buy-dot')
  }
}

main().catch(console.error)
