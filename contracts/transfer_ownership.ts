import { createWalletClient, createPublicClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { defineChain } from 'viem'

const chain = defineChain({
  id: 420420417,
  name: 'Asset Hub Paseo',
  nativeCurrency: { name: 'PAS', symbol: 'PAS', decimals: 18 },
  rpcUrls: { default: { http: ['https://eth-asset-hub-paseo.dotters.network'] } },
})

const CONTRACT = '0x6b41f2b65a79bea3bde2d735a486b951b4c01b89' as `0x${string}`
const SERVICE = '0x496e2Db8dDC0Bf2eA42BF3C8C5e0B23a9546C225' as `0x${string}`

const abi = [
  { name: 'transferOwnership', type: 'function', inputs: [{ name: 'newOwner', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { name: 'owner', type: 'function', inputs: [], outputs: [{ type: 'address' }], stateMutability: 'view' },
] as const

async function main() {
  const deployer = privateKeyToAccount('0xe8114b5340c127a36228f510cfc02d4b9e4a635a160e019d579d5eaa889b0647')
  console.log('deployer:', deployer.address)

  const publicClient = createPublicClient({ chain, transport: http() })
  const walletClient = createWalletClient({ account: deployer, chain, transport: http() })

  const currentOwner = await publicClient.readContract({ address: CONTRACT, abi, functionName: 'owner' })
  console.log('current owner:', currentOwner)
  console.log('transferring to:', SERVICE)

  const hash = await walletClient.writeContract({
    address: CONTRACT, abi, functionName: 'transferOwnership', args: [SERVICE]
  })
  console.log('tx:', hash)

  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  console.log('status:', receipt.status)

  const newOwner = await publicClient.readContract({ address: CONTRACT, abi, functionName: 'owner' })
  console.log('new owner:', newOwner)
}
main().catch(console.error)
