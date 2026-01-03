import { createSignal, Show } from 'solid-js'
import { getPublicKeyAsync, signAsync } from '@noble/ed25519'
import { argon2id } from '@noble/hashes/argon2.js'
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js'

// Must match backend KEY_DERIVATION_SALT
const KEY_DERIVATION_SALT = new TextEncoder().encode('sonotxt-key-derivation-v1')

const API = import.meta.env.VITE_API_URL || 'https://api.sonotxt.com'

interface Props {
  onClose: () => void
  onLogin: (user: { id: string; nickname?: string; email?: string; balance: number }, token: string) => void
}

type Mode = 'login' | 'register' | 'magic' | 'recover' | 'show-recovery-share'

// 2-of-2 secret sharing using XOR
function splitSecret(secret: Uint8Array): { serverShare: Uint8Array; userShare: Uint8Array } {
  const serverShare = randomBytes(secret.length)
  const userShare = new Uint8Array(secret.length)
  for (let i = 0; i < secret.length; i++) {
    userShare[i] = secret[i] ^ serverShare[i]
  }
  return { serverShare, userShare }
}

function combineShares(serverShare: Uint8Array, userShare: Uint8Array): Uint8Array {
  const secret = new Uint8Array(serverShare.length)
  for (let i = 0; i < serverShare.length; i++) {
    secret[i] = serverShare[i] ^ userShare[i]
  }
  return secret
}

// Encode bytes as words for easier backup (simplified BIP39-like)
const WORDLIST = [
  'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract',
  'absurd', 'abuse', 'access', 'accident', 'account', 'accuse', 'achieve', 'acid',
  'acoustic', 'acquire', 'across', 'act', 'action', 'actor', 'actress', 'actual',
  'adapt', 'add', 'addict', 'address', 'adjust', 'admit', 'adult', 'advance',
  'advice', 'aerobic', 'affair', 'afford', 'afraid', 'again', 'age', 'agent',
  'agree', 'ahead', 'aim', 'air', 'airport', 'aisle', 'alarm', 'album',
  'alcohol', 'alert', 'alien', 'all', 'alley', 'allow', 'almost', 'alone',
  'alpha', 'already', 'also', 'alter', 'always', 'amateur', 'amazing', 'among',
  'amount', 'amused', 'analyst', 'anchor', 'ancient', 'anger', 'angle', 'angry',
  'animal', 'ankle', 'announce', 'annual', 'another', 'answer', 'antenna', 'antique',
  'anxiety', 'any', 'apart', 'apology', 'appear', 'apple', 'approve', 'april',
  'arch', 'arctic', 'area', 'arena', 'argue', 'arm', 'armed', 'armor',
  'army', 'around', 'arrange', 'arrest', 'arrive', 'arrow', 'art', 'artefact',
  'artist', 'artwork', 'ask', 'aspect', 'assault', 'asset', 'assist', 'assume',
  'asthma', 'athlete', 'atom', 'attack', 'attend', 'attitude', 'attract', 'auction',
  'audit', 'august', 'aunt', 'author', 'auto', 'autumn', 'average', 'avocado',
  'avoid', 'awake', 'aware', 'away', 'awesome', 'awful', 'awkward', 'axis',
  'baby', 'bachelor', 'bacon', 'badge', 'bag', 'balance', 'balcony', 'ball',
  'bamboo', 'banana', 'banner', 'bar', 'barely', 'bargain', 'barrel', 'base',
  'basic', 'basket', 'battle', 'beach', 'bean', 'beauty', 'because', 'become',
  'beef', 'before', 'begin', 'behave', 'behind', 'believe', 'below', 'belt',
  'bench', 'benefit', 'best', 'betray', 'better', 'between', 'beyond', 'bicycle',
  'bid', 'bike', 'bind', 'biology', 'bird', 'birth', 'bitter', 'black',
  'blade', 'blame', 'blanket', 'blast', 'bleak', 'bless', 'blind', 'blood',
  'blossom', 'blouse', 'blue', 'blur', 'blush', 'board', 'boat', 'body',
  'boil', 'bomb', 'bone', 'bonus', 'book', 'boost', 'border', 'boring',
  'borrow', 'boss', 'bottom', 'bounce', 'box', 'boy', 'bracket', 'brain',
  'brand', 'brass', 'brave', 'bread', 'breeze', 'brick', 'bridge', 'brief',
  'bright', 'bring', 'brisk', 'broccoli', 'broken', 'bronze', 'broom', 'brother',
  'brown', 'brush', 'bubble', 'buddy', 'budget', 'buffalo', 'build', 'bulb',
  'bulk', 'bullet', 'bundle', 'bunker', 'burden', 'burger', 'burst', 'bus',
  'business', 'busy', 'butter', 'buyer', 'buzz', 'cabbage', 'cabin', 'cable',
]

function bytesToWords(bytes: Uint8Array): string {
  const words: string[] = []
  for (let i = 0; i < bytes.length; i++) {
    words.push(WORDLIST[bytes[i] % WORDLIST.length])
  }
  return words.join(' ')
}

function wordsToBytes(words: string): Uint8Array {
  const wordList = words.trim().toLowerCase().split(/\s+/)
  const bytes = new Uint8Array(wordList.length)
  for (let i = 0; i < wordList.length; i++) {
    const idx = WORDLIST.indexOf(wordList[i])
    if (idx === -1) throw new Error(`Unknown word: ${wordList[i]}`)
    bytes[i] = idx
  }
  return bytes
}

export default function AuthModal(props: Props) {
  const [mode, setMode] = createSignal<Mode>('login')
  const [nickname, setNickname] = createSignal('')
  const [pin, setPin] = createSignal('')
  const [email, setEmail] = createSignal('')
  const [recoveryEmail, setRecoveryEmail] = createSignal('')
  const [recoveryShare, setRecoveryShare] = createSignal('')
  const [serverShareHex, setServerShareHex] = createSignal('')
  const [userShareInput, setUserShareInput] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [derivingKeys, setDerivingKeys] = createSignal(false)
  const [error, setError] = createSignal('')
  const [message, setMessage] = createSignal('')
  const [copiedShare, setCopiedShare] = createSignal(false)

  async function deriveKeypair(nick: string, p: string) {
    setDerivingKeys(true)
    try {
      const secret = `${nick.toLowerCase()}:${p}`
      await new Promise(r => setTimeout(r, 10))
      const seed = argon2id(new TextEncoder().encode(secret), KEY_DERIVATION_SALT, {
        t: 3,
        m: 65536,
        p: 1,
        dkLen: 32,
      })
      const privateKey = seed
      const publicKey = await getPublicKeyAsync(privateKey)
      return { privateKey, publicKey, seed }
    } finally {
      setDerivingKeys(false)
    }
  }

  async function deriveKeypairFromSeed(seed: Uint8Array) {
    const publicKey = await getPublicKeyAsync(seed)
    return { privateKey: seed, publicKey }
  }

  async function signChallengeLocally(nick: string, p: string, challenge: string) {
    const { privateKey } = await deriveKeypair(nick, p)
    const messageBytes = new TextEncoder().encode(challenge)
    const signature = await signAsync(messageBytes, privateKey)
    return bytesToHex(signature)
  }

  async function signChallengeWithSeed(seed: Uint8Array, challenge: string) {
    const messageBytes = new TextEncoder().encode(challenge)
    const signature = await signAsync(messageBytes, seed)
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
      } else if (mode() === 'recover') {
        await handleRecover()
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
    const recEmail = recoveryEmail().trim()

    if (nick.length < 3) throw new Error('Nickname must be at least 3 characters')
    if (p.length < 4) throw new Error('Pin must be at least 4 characters')

    const { publicKey, seed } = await deriveKeypair(nick, p)
    const publicKeyHex = bytesToHex(publicKey)

    // If recovery email provided, create Shamir shares
    let serverShareHex: string | undefined
    if (recEmail) {
      const { serverShare, userShare } = splitSecret(seed)
      serverShareHex = bytesToHex(serverShare)
      setRecoveryShare(bytesToWords(userShare))
    }

    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: nick,
        public_key: publicKeyHex,
        email: recEmail || undefined,
        recovery_share: serverShareHex,
      }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || 'Registration failed')
    }

    // If we have recovery share, show it to user before logging in
    if (recEmail && recoveryShare()) {
      setMode('show-recovery-share')
      return
    }

    await handleLogin()
  }

  async function handleLogin() {
    const nick = nickname().trim()
    const p = pin()

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
    const signature = await signChallengeLocally(nick, p, challenge)

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

    // Response should include server share for Shamir recovery
    const data = await res.json()
    if (data.server_share) {
      setServerShareHex(data.server_share)
      setMessage('Check your email! Enter your recovery words below to complete recovery.')
    } else {
      setMessage('Check your email for the login link!')
    }
  }

  async function handleRecover() {
    const userWords = userShareInput().trim()
    const serverHex = serverShareHex()
    const nick = nickname().trim()

    if (!userWords) throw new Error('Enter your recovery words')
    if (!serverHex) throw new Error('Server share not received. Request magic link first.')
    if (!nick) throw new Error('Enter your nickname')

    // Convert shares back to bytes
    const userShare = wordsToBytes(userWords)
    const serverShare = hexToBytes(serverHex)

    if (userShare.length !== serverShare.length) {
      throw new Error('Invalid recovery words length')
    }

    // Reconstruct the seed
    const seed = combineShares(serverShare, userShare)

    // Get challenge and sign with reconstructed seed
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
    const signature = await signChallengeWithSeed(seed, challenge)

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
      throw new Error(data.error || 'Recovery failed - invalid shares')
    }

    const data = await res.json()
    props.onLogin(
      { id: data.user_id, nickname: data.nickname, email: data.email, balance: data.balance },
      data.token
    )
  }

  async function copyRecoveryShare() {
    await navigator.clipboard.writeText(recoveryShare())
    setCopiedShare(true)
    setTimeout(() => setCopiedShare(false), 2000)
  }

  async function continueAfterRecoveryShare() {
    await handleLogin()
  }

  const inputStyle = {
    width: '100%',
    background: 'transparent',
    border: 'none',
    padding: '8px',
    color: '#ec4899',
    'font-family': 'monospace',
    'font-size': '14px',
    outline: 'none',
  }

  const inputContainerStyle = {
    background: '#0d1117',
    border: '1px solid',
    'border-color': '#010409 #21262d #21262d #010409',
    'box-shadow': 'inset 1px 1px 3px rgba(0,0,0,0.5)',
  }

  const labelStyle = {
    display: 'block',
    'font-size': '10px',
    color: '#8b949e',
    'margin-bottom': '4px',
    'text-transform': 'uppercase',
  }

  return (
    <div
      class="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.9)' }}
      onClick={props.onClose}
    >
      <div
        style={{
          width: '100%',
          'max-width': '320px',
          background: 'linear-gradient(180deg, #21262d 0%, #161b22 100%)',
          border: '1px solid',
          'border-color': '#30363d #0d1117 #0d1117 #30363d',
          'box-shadow': 'inset 1px 1px 0 rgba(255,255,255,0.03), inset -1px -1px 0 rgba(0,0,0,0.3), 0 8px 32px rgba(0,0,0,0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div
          style={{
            background: 'linear-gradient(180deg, #21262d 0%, #161b22 100%)',
            'border-bottom': '1px solid #0d1117',
            padding: '6px 10px',
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
            'font-size': '11px',
            'font-weight': '600',
            'text-transform': 'uppercase',
            'letter-spacing': '1px',
          }}
        >
          <span class="i-mdi-account-key" style={{ width: '16px', height: '16px', color: '#ec4899' }} />
          <span style={{ color: '#fff', flex: '1' }}>
            {mode() === 'register' ? 'Register' :
             mode() === 'magic' ? 'Recovery Email' :
             mode() === 'recover' ? 'Recover Account' :
             mode() === 'show-recovery-share' ? 'Save Recovery Words' :
             'Login'}
          </span>
          <button
            onClick={props.onClose}
            style={{
              background: 'linear-gradient(180deg, #30363d 0%, #21262d 50%, #21262d 50%, #161b22 100%)',
              border: '1px solid',
              'border-color': '#484f58 #0d1117 #0d1117 #484f58',
              color: '#c9d1d9',
              cursor: 'pointer',
              'font-size': '11px',
              'font-weight': '600',
              padding: '2px 8px',
            }}
          >
            X
          </button>
        </div>

        {/* Show recovery share after registration */}
        <Show when={mode() === 'show-recovery-share'}>
          <div style={{ padding: '12px' }}>
            <div style={{
              background: '#1c1917',
              border: '1px solid #78350f',
              padding: '12px',
              'margin-bottom': '12px',
            }}>
              <p style={{ 'font-size': '11px', color: '#fbbf24', 'margin-bottom': '8px', 'font-weight': '600' }}>
                SAVE THESE RECOVERY WORDS
              </p>
              <p style={{ 'font-size': '10px', color: '#d4d4d4', 'margin-bottom': '12px' }}>
                Write these down and store them safely. You'll need them + your email to recover your account if you forget your pin.
              </p>
              <div style={{
                background: '#0d1117',
                border: '1px solid #374151',
                padding: '12px',
                'font-family': 'monospace',
                'font-size': '12px',
                color: '#10b981',
                'word-break': 'break-word',
                'line-height': '1.6',
              }}>
                {recoveryShare()}
              </div>
              <button
                onClick={copyRecoveryShare}
                style={{
                  width: '100%',
                  'margin-top': '8px',
                  background: copiedShare() ? '#065f46' : 'linear-gradient(180deg, #30363d 0%, #21262d 100%)',
                  border: '1px solid',
                  'border-color': '#484f58 #0d1117 #0d1117 #484f58',
                  color: '#fff',
                  cursor: 'pointer',
                  'font-size': '11px',
                  'font-weight': '600',
                  padding: '8px 12px',
                  'text-transform': 'uppercase',
                }}
              >
                {copiedShare() ? 'COPIED!' : 'COPY TO CLIPBOARD'}
              </button>
            </div>
            <button
              onClick={continueAfterRecoveryShare}
              disabled={loading()}
              style={{
                width: '100%',
                background: 'linear-gradient(180deg, #ec4899 0%, #be185d 50%, #be185d 50%, #db2777 100%)',
                border: '1px solid',
                'border-color': '#f472b6 #831843 #831843 #f472b6',
                color: '#fff',
                cursor: 'pointer',
                'font-size': '11px',
                'font-weight': '600',
                padding: '10px 12px',
                'text-transform': 'uppercase',
                'text-shadow': '0 1px 2px rgba(0,0,0,0.3)',
              }}
            >
              {loading() ? 'LOGGING IN...' : 'I SAVED THEM - CONTINUE'}
            </button>
          </div>
        </Show>

        {/* Regular forms */}
        <Show when={mode() !== 'show-recovery-share'}>
          <form onSubmit={handleSubmit} style={{ padding: '12px' }}>
            <Show when={mode() !== 'magic' && mode() !== 'recover'}>
              <div style={{ 'margin-bottom': '12px' }}>
                <label style={labelStyle}>Nickname</label>
                <div style={inputContainerStyle}>
                  <input
                    type="text"
                    style={inputStyle}
                    placeholder="yourname"
                    value={nickname()}
                    onInput={(e) => setNickname(e.currentTarget.value)}
                  />
                </div>
                <Show when={mode() === 'register'}>
                  <p style={{ 'font-size': '9px', color: '#8b949e', 'margin-top': '4px' }}>3-20 chars, letters/numbers/_/-</p>
                </Show>
              </div>

              <div style={{ 'margin-bottom': '12px' }}>
                <label style={labelStyle}>
                  Pin <span style={{ color: '#666' }}>(local only)</span>
                </label>
                <div style={inputContainerStyle}>
                  <input
                    type="password"
                    style={inputStyle}
                    placeholder="****"
                    value={pin()}
                    onInput={(e) => setPin(e.currentTarget.value)}
                  />
                </div>
                <Show when={mode() === 'register'}>
                  <p style={{ 'font-size': '9px', color: '#8b949e', 'margin-top': '4px' }}>Used to derive keys. Cannot be recovered without backup.</p>
                </Show>
              </div>

              <Show when={mode() === 'register'}>
                <div style={{ 'margin-bottom': '12px' }}>
                  <label style={labelStyle}>
                    Recovery Email <span style={{ color: '#666' }}>(recommended)</span>
                  </label>
                  <div style={inputContainerStyle}>
                    <input
                      type="email"
                      style={inputStyle}
                      placeholder="backup@example.com"
                      value={recoveryEmail()}
                      onInput={(e) => setRecoveryEmail(e.currentTarget.value)}
                    />
                  </div>
                  <p style={{ 'font-size': '9px', color: '#8b949e', 'margin-top': '4px' }}>
                    Enables trustless recovery via Shamir secret sharing.
                  </p>
                </div>
              </Show>
            </Show>

            {/* Magic link / Recovery email request */}
            <Show when={mode() === 'magic'}>
              <div style={{ 'margin-bottom': '12px' }}>
                <label style={labelStyle}>Recovery Email</label>
                <div style={inputContainerStyle}>
                  <input
                    type="email"
                    style={inputStyle}
                    placeholder="you@example.com"
                    value={email()}
                    onInput={(e) => setEmail(e.currentTarget.value)}
                  />
                </div>
                <p style={{ 'font-size': '9px', color: '#8b949e', 'margin-top': '4px' }}>
                  We'll send you the server's share of your recovery key.
                </p>
              </div>

              <Show when={serverShareHex()}>
                <div style={{ 'margin-bottom': '12px' }}>
                  <label style={labelStyle}>Your Nickname</label>
                  <div style={inputContainerStyle}>
                    <input
                      type="text"
                      style={inputStyle}
                      placeholder="yourname"
                      value={nickname()}
                      onInput={(e) => setNickname(e.currentTarget.value)}
                    />
                  </div>
                </div>
                <div style={{ 'margin-bottom': '12px' }}>
                  <label style={labelStyle}>Your Recovery Words</label>
                  <div style={inputContainerStyle}>
                    <textarea
                      style={{ ...inputStyle, 'min-height': '80px', resize: 'vertical' }}
                      placeholder="word1 word2 word3..."
                      value={userShareInput()}
                      onInput={(e) => setUserShareInput(e.currentTarget.value)}
                    />
                  </div>
                  <p style={{ 'font-size': '9px', color: '#8b949e', 'margin-top': '4px' }}>
                    Enter the recovery words you saved during registration.
                  </p>
                </div>
              </Show>
            </Show>

            <Show when={error()}>
              <p style={{ color: '#ff6b6b', 'font-size': '10px', 'margin-bottom': '8px' }}>{error()}</p>
            </Show>

            <Show when={message()}>
              <p style={{ color: '#10b981', 'font-size': '10px', 'margin-bottom': '8px' }}>{message()}</p>
            </Show>

            <button
              type="submit"
              disabled={loading()}
              style={{
                width: '100%',
                background: 'linear-gradient(180deg, #ec4899 0%, #be185d 50%, #be185d 50%, #db2777 100%)',
                border: '1px solid',
                'border-color': '#f472b6 #831843 #831843 #f472b6',
                color: '#fff',
                cursor: loading() ? 'wait' : 'pointer',
                'font-size': '11px',
                'font-weight': '600',
                padding: '8px 12px',
                'text-transform': 'uppercase',
                'letter-spacing': '0.5px',
                'margin-bottom': '12px',
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                gap: '8px',
                'text-shadow': '0 1px 2px rgba(0,0,0,0.3)',
                opacity: loading() ? '0.7' : '1',
              }}
            >
              {loading() && <span class="animate-spin">*</span>}
              {derivingKeys()
                ? 'DERIVING...'
                : loading()
                  ? 'VERIFYING...'
                  : mode() === 'register'
                    ? 'CREATE ACCOUNT'
                    : mode() === 'magic'
                      ? serverShareHex() ? 'RECOVER ACCOUNT' : 'SEND RECOVERY EMAIL'
                      : 'LOGIN'}
            </button>
          </form>

          <div
            style={{
              'border-top': '1px solid #0d1117',
              padding: '8px 12px',
              'text-align': 'center',
              'font-size': '10px',
              color: '#8b949e',
            }}
          >
            <Show when={mode() === 'login'}>
              <button
                onClick={() => setMode('register')}
                style={{ background: 'none', border: 'none', color: '#ec4899', cursor: 'pointer' }}
              >
                New? Register
              </button>
              <span style={{ margin: '0 8px' }}>|</span>
              <button
                onClick={() => setMode('magic')}
                style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer' }}
              >
                Forgot pin?
              </button>
            </Show>

            <Show when={mode() === 'register'}>
              <button
                onClick={() => setMode('login')}
                style={{ background: 'none', border: 'none', color: '#ec4899', cursor: 'pointer' }}
              >
                Have account? Login
              </button>
            </Show>

            <Show when={mode() === 'magic'}>
              <button
                onClick={() => { setMode('login'); setServerShareHex(''); setMessage('') }}
                style={{ background: 'none', border: 'none', color: '#ec4899', cursor: 'pointer' }}
              >
                Back to login
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
