// PeopleChain identity lookup via direct RPC
// Queries identity.identityOf storage on People Chain

const PEOPLE_RPC = import.meta.env.VITE_PEOPLE_RPC || 'https://sys.dotters.network/people-polkadot'
const PEOPLE_RPC_TESTNET = 'https://sys.dotters.network/people-paseo'

const IS_TESTNET = (import.meta.env.VITE_CHAIN_ID || '420420417') === '420420417'

function rpcUrl(): string {
  return IS_TESTNET ? PEOPLE_RPC_TESTNET : PEOPLE_RPC
}

interface IdentityInfo {
  display: string | null
  email: string | null
  web: string | null
  twitter: string | null
  riot: string | null
  image: string | null
}

// Decode a Data field from identity pallet
// Format: { Raw0-Raw32: hex | None }
function decodeDataField(field: any): string | null {
  if (!field) return null
  if (typeof field === 'string') return field

  // Handle { Raw<N>: "0x..." } or { None: null }
  for (const key of Object.keys(field)) {
    if (key === 'None') return null
    if (key.startsWith('Raw') || key === 'raw') {
      const val = field[key]
      if (typeof val === 'string') {
        if (val.startsWith('0x')) {
          // Hex-encoded string
          try {
            const bytes = new Uint8Array(
              val.slice(2).match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16))
            )
            return new TextDecoder().decode(bytes)
          } catch {
            return val
          }
        }
        return val
      }
    }
  }
  return null
}

/// Look up on-chain identity for an SS58 address via People Chain
export async function lookupIdentity(ss58Address: string): Promise<IdentityInfo | null> {
  try {
    const resp = await fetch(rpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'state_call',
        params: ['IdentityApi_identity', ss58Address],
      }),
    })

    const data = await resp.json()

    // If state_call doesn't work, fall back to storage query
    if (data.error) {
      return await lookupIdentityViaStorage(ss58Address)
    }

    // Parse the result
    if (!data.result) return null
    return parseIdentityResult(data.result)
  } catch {
    return null
  }
}

// Fallback: query identity.identityOf storage directly
async function lookupIdentityViaStorage(ss58Address: string): Promise<IdentityInfo | null> {
  try {
    // Use system.accountInfo to verify, then identity.identityOf
    const resp = await fetch(rpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'identity_identityOf',
        params: [ss58Address],
      }),
    })

    const data = await resp.json()
    if (!data.result) return null

    const info = data.result.info || data.result
    return {
      display: decodeDataField(info.display),
      email: decodeDataField(info.email),
      web: decodeDataField(info.web),
      twitter: decodeDataField(info.twitter),
      riot: decodeDataField(info.riot),
      image: decodeDataField(info.image),
    }
  } catch {
    return null
  }
}

function parseIdentityResult(_hex: string): IdentityInfo | null {
  // TODO: SCALE decode the result when using state_call
  // For now, fall back to RPC method
  return null
}

// Cache identities for 5 minutes
const identityCache = new Map<string, { info: IdentityInfo | null; ts: number }>()
const CACHE_TTL = 5 * 60 * 1000

export async function lookupIdentityCached(ss58Address: string): Promise<IdentityInfo | null> {
  const cached = identityCache.get(ss58Address)
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.info
  }

  const info = await lookupIdentity(ss58Address)
  identityCache.set(ss58Address, { info, ts: Date.now() })
  return info
}
