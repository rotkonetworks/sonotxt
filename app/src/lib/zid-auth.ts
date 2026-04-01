// ZID wallet authentication for sonotxt
// connects via zafu wallet extension, signs auth headers for paid features

import { zid } from '@zafu/zid'
import type { ZidIdentity } from '@zafu/zid'
import { createSignal } from 'solid-js'

const APP_NAME = 'sonotxt'
const AUTH_DOMAIN = 'sonotxt-zid-v1'

const [identity, setIdentity] = createSignal<ZidIdentity | null>(null)
const [connecting, setConnecting] = createSignal(false)
const [error, setError] = createSignal<string | null>(null)

/** connect to zafu wallet via ZID */
async function connect(): Promise<ZidIdentity> {
  setConnecting(true)
  setError(null)
  try {
    const id = await zid.connect({ appName: APP_NAME })
    setIdentity(id)
    return id
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'failed to connect'
    setError(msg)
    throw e
  } finally {
    setConnecting(false)
  }
}

/** disconnect current ZID session */
function disconnect() {
  const id = identity()
  if (id) {
    id.disconnect()
    setIdentity(null)
  }
}

/** build Authorization header value for ZID auth: "zid:<pubkey>:<timestamp>:<signature>" */
async function getAuthHeader(): Promise<string | null> {
  const id = identity()
  if (!id) return null

  const timestamp = Math.floor(Date.now() / 1000).toString()
  const message = `${AUTH_DOMAIN}\n${timestamp}`
  const messageBytes = new TextEncoder().encode(message)
  const signature = await id.sign(messageBytes)

  return `zid:${id.pubkey}:${timestamp}:${signature}`
}

/** get auth headers object for fetch calls (returns empty object if not connected) */
async function getAuthHeaders(): Promise<Record<string, string>> {
  const header = await getAuthHeader()
  if (!header) return {}
  return { Authorization: `Bearer ${header}` }
}

/** check if connected via zafu wallet (not ephemeral) */
function isWalletConnected(): boolean {
  const id = identity()
  return id !== null && id.mode === 'zafu'
}

/** get truncated pubkey for display */
function displayPubkey(): string | null {
  const id = identity()
  if (!id) return null
  const pk = id.walletPubkey || id.pubkey
  if (pk.length <= 12) return pk
  return pk.slice(0, 6) + '..' + pk.slice(-4)
}

export const zidAuth = {
  connect,
  disconnect,
  getAuthHeader,
  getAuthHeaders,
  isWalletConnected,
  displayPubkey,
  // reactive signals
  identity,
  connecting,
  error,
}
