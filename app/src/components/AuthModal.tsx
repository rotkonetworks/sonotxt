import { createSignal, Show } from 'solid-js'
import { getPublicKeyAsync, signAsync } from '@noble/ed25519'
import { argon2id } from '@noble/hashes/argon2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

// Must match backend KEY_DERIVATION_SALT
const KEY_DERIVATION_SALT = new TextEncoder().encode('sonotxt-key-derivation-v1')

const API = import.meta.env.VITE_API_URL || 'https://api.sonotxt.com'

interface Props {
  onClose: () => void
  onLogin: (user: { id: string; nickname?: string; email?: string; balance: number }, token: string) => void
}

type Mode = 'login' | 'register' | 'magic'

export default function AuthModal(props: Props) {
  const [mode, setMode] = createSignal<Mode>('login')
  const [nickname, setNickname] = createSignal('')
  const [pin, setPin] = createSignal('')
  const [email, setEmail] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [derivingKeys, setDerivingKeys] = createSignal(false)
  const [error, setError] = createSignal('')
  const [message, setMessage] = createSignal('')
  // Derive ed25519 keypair from nickname:pin using argon2id (matches backend)
  async function deriveKeypair(nick: string, p: string) {
    setDerivingKeys(true)
    try {
      const secret = `${nick.toLowerCase()}:${p}`
      // argon2id is intentionally slow - give browser a tick to show loading UI
      await new Promise(r => setTimeout(r, 10))
      const seed = argon2id(new TextEncoder().encode(secret), KEY_DERIVATION_SALT, {
        t: 3,     // iterations
        m: 65536, // 64MB memory
        p: 1,     // parallelism
        dkLen: 32,
      })
      const privateKey = seed
      const publicKey = await getPublicKeyAsync(privateKey)
      return { privateKey, publicKey }
    } finally {
      setDerivingKeys(false)
    }
  }

  // Sign a challenge with derived private key
  async function signChallengeLocally(nick: string, p: string, challenge: string) {
    const { privateKey } = await deriveKeypair(nick, p)
    const messageBytes = new TextEncoder().encode(challenge)
    const signature = await signAsync(messageBytes, privateKey)
    return bytesToHex(signature)
  }

  async function handleSubmit(e: Event) {
    e.preventDefault()
    setError('')
    setMessage('')
    setLoading(true)

    try {
      if (mode() === 'magic') {
        await handleMagicLink()
      } else if (mode() === 'register') {
        await handleRegister()
      } else {
        await handleLogin()
      }
    } catch (err: any) {
      setError(err.message)
    }

    setLoading(false)
  }

  async function handleRegister() {
    const nick = nickname().trim()
    const p = pin()

    if (nick.length < 3) throw new Error('Nickname must be at least 3 characters')
    if (p.length < 4) throw new Error('Pin must be at least 4 characters')

    // Derive public key client-side
    const { publicKey } = await deriveKeypair(nick, p)
    const publicKeyHex = bytesToHex(publicKey)

    // Register with nickname + derived public key
    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: nick,
        public_key: publicKeyHex,
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Registration failed')
    }

    // Auto-login after register
    await handleLogin()
  }

  async function handleLogin() {
    const nick = nickname().trim()
    const p = pin()

    // Get challenge from server
    const challengeRes = await fetch(`${API}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: nick }),
    })

    if (!challengeRes.ok) {
      const data = await challengeRes.json().catch(() => ({}))
      throw new Error(data.error || 'User not found')
    }

    const { challenge } = await challengeRes.json()

    // Sign challenge client-side
    const signature = await signChallengeLocally(nick, p, challenge)

    // Verify with server
    const res = await fetch(`${API}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: nick,
        challenge,
        signature,
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Invalid pin')
    }

    const data = await res.json()
    props.onLogin(
      { id: data.user_id, nickname: data.nickname, email: data.email, balance: data.balance },
      data.token
    )
  }

  async function handleMagicLink() {
    const e = email().trim()
    if (!e) throw new Error('Email required')

    const res = await fetch(`${API}/api/auth/magic-link/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: e }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to send magic link')
    }

    setMessage('Check your email for the login link!')
  }

  return (
    <div class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={props.onClose}>
      <div
        class="bg-[#161b22] border border-white/10 p-6 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div class="flex justify-between items-center mb-6">
          <h2 class="text-xl font-semibold">
            {mode() === 'register' ? 'Create Account' : mode() === 'magic' ? 'Magic Link' : 'Login'}
          </h2>
          <button onClick={props.onClose} class="text-white/50 hover:text-white text-xl">&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          <Show when={mode() !== 'magic'}>
            {/* Nickname + Pin mode */}
            <div class="mb-4">
              <label class="block text-sm text-white/60 mb-2">Nickname</label>
              <input
                type="text"
                class="w-full bg-[#0d1117] border border-white/10 px-4 py-3 text-white focus:outline-none focus:border-primary"
                placeholder="yourname"
                value={nickname()}
                onInput={(e) => setNickname(e.currentTarget.value)}
              />
              <Show when={mode() === 'register'}>
                <p class="text-xs text-white/40 mt-1">
                  3-20 characters, letters, numbers, _ and -
                </p>
              </Show>
            </div>

            <div class="mb-4">
              <label class="block text-sm text-white/60 mb-2">
                Pin <span class="text-white/40">(never leaves your device)</span>
              </label>
              <input
                type="password"
                class="w-full bg-[#0d1117] border border-white/10 px-4 py-3 text-white focus:outline-none focus:border-primary"
                placeholder="your secret pin"
                value={pin()}
                onInput={(e) => setPin(e.currentTarget.value)}
              />
              <Show when={mode() === 'register'}>
                <p class="text-xs text-white/40 mt-1">
                  Used locally to derive your keys. Cannot be recovered.
                </p>
              </Show>
            </div>
          </Show>

          <Show when={mode() === 'magic'}>
            {/* Magic link mode */}
            <div class="mb-4">
              <label class="block text-sm text-white/60 mb-2">Email</label>
              <input
                type="email"
                class="w-full bg-[#0d1117] border border-white/10 px-4 py-3 text-white focus:outline-none focus:border-primary"
                placeholder="you@example.com"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
              />
            </div>
          </Show>

          <Show when={error()}>
            <p class="text-[#dc2626] text-sm mb-4">{error()}</p>
          </Show>

          <Show when={message()}>
            <p class="text-[#059669] text-sm mb-4">{message()}</p>
          </Show>

          <button
            type="submit"
            disabled={loading()}
            class="w-full btn-primary py-3 mb-4 flex items-center justify-center gap-2"
          >
            {loading() && (
              <div class="w-4 h-4 border-2 border-white/30 border-t-white animate-spin" />
            )}
            {derivingKeys()
              ? 'Deriving keys...'
              : loading()
                ? 'Verifying...'
                : mode() === 'register'
                  ? 'Create Account'
                  : mode() === 'magic'
                    ? 'Send Link'
                    : 'Login'}
          </button>
        </form>

        <div class="text-center text-sm text-white/50">
          <Show when={mode() === 'login'}>
            <p>
              New here?{' '}
              <button onClick={() => setMode('register')} class="text-primary hover:underline">
                Create account
              </button>
            </p>
            <p class="mt-2">
              <button onClick={() => setMode('magic')} class="text-white/40 hover:text-white">
                Use magic link instead
              </button>
            </p>
          </Show>

          <Show when={mode() === 'register'}>
            <p>
              Have an account?{' '}
              <button onClick={() => setMode('login')} class="text-primary hover:underline">
                Login
              </button>
            </p>
          </Show>

          <Show when={mode() === 'magic'}>
            <p>
              <button onClick={() => setMode('login')} class="text-primary hover:underline">
                Use nickname + pin
              </button>
            </p>
          </Show>
        </div>
      </div>
    </div>
  )
}
