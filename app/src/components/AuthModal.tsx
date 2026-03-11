import { createSignal, Show } from 'solid-js'
import { getPublicKeyAsync, signAsync } from '@noble/ed25519'
import { argon2id } from '@noble/hashes/argon2.js'
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js'
import * as api from '../lib/api'
import { ApiError } from '../lib/api'

const KEY_DERIVATION_SALT = new TextEncoder().encode('sonotxt-key-derivation-v1')

interface Props {
  onClose: () => void
  onLogin: (user: { id: string; nickname?: string; email?: string; balance: number }, token: string) => void
}

type Mode = 'login' | 'register' | 'magic' | 'recover' | 'show-recovery-share' | 'email-login'

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
  const [mode, setMode] = createSignal<Mode>('email-login')
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

  async function _deriveKeypairFromSeed(seed: Uint8Array) {
    const publicKey = await getPublicKeyAsync(seed)
    return { privateKey: seed, publicKey }
  }
  void _deriveKeypairFromSeed

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
      if (mode() === 'email-login') {
        await handleEmailLogin()
      } else if (mode() === 'magic') {
        await handleMagicLink()
      } else if (mode() === 'register') {
        await handleRegister()
      } else if (mode() === 'recover') {
        await handleRecover()
      } else {
        await handleLogin()
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('An unexpected error occurred')
      }
    }

    setLoading(false)
  }

  async function handleRegister() {
    const nick = nickname().trim()
    const p = pin()
    const recEmail = recoveryEmail().trim()

    if (nick.length < 3) throw new Error('Nickname must be at least 3 characters')
    if (p.length < 8) throw new Error('Password must be at least 8 characters')

    const { publicKey, seed } = await deriveKeypair(nick, p)
    const publicKeyHex = bytesToHex(publicKey)

    let serverShareHex: string | undefined
    if (recEmail) {
      const { serverShare, userShare } = splitSecret(seed)
      serverShareHex = bytesToHex(serverShare)
      setRecoveryShare(bytesToWords(userShare))
    }

    await api.register({
      nickname: nick,
      public_key: publicKeyHex,
      email: recEmail || undefined,
      recovery_share: serverShareHex,
    })

    if (recEmail && recoveryShare()) {
      setMode('show-recovery-share')
      return
    }

    await handleLogin()
  }

  async function handleLogin() {
    const nick = nickname().trim()
    const p = pin()

    const { challenge } = await api.getChallenge(nick)
    const signature = await signChallengeLocally(nick, p, challenge)

    const data = await api.verifyChallenge(nick, challenge, signature)
    props.onLogin(
      { id: data.user_id, nickname: data.nickname, email: data.email, balance: data.balance },
      data.token!
    )
  }

  async function handleMagicLink() {
    const e = email().trim()
    if (!e) throw new Error('Email required')

    const data = await api.requestMagicLink(e)

    if (data.server_share) {
      setServerShareHex(data.server_share)
      setMessage('Check your email! Enter your recovery words below to complete recovery.')
    } else {
      setMessage('Check your email for the login link!')
    }
  }

  async function handleEmailLogin() {
    const e = email().trim()
    if (!e) throw new Error('Email required')
    await api.requestMagicLink(e)
    setMessage('Check your email for a login link!')
  }

  async function handleRecover() {
    const userWords = userShareInput().trim()
    const serverHex = serverShareHex()
    const nick = nickname().trim()

    if (!userWords) throw new Error('Enter your recovery words')
    if (!serverHex) throw new Error('Server share not received. Request magic link first.')
    if (!nick) throw new Error('Enter your nickname')

    const userShare = wordsToBytes(userWords)
    const serverShare = hexToBytes(serverHex)

    if (userShare.length !== serverShare.length) {
      throw new Error('Invalid recovery words length')
    }

    const seed = combineShares(serverShare, userShare)
    const { challenge } = await api.getChallenge(nick)
    const signature = await signChallengeWithSeed(seed, challenge)

    const data = await api.verifyChallenge(nick, challenge, signature)
    props.onLogin(
      { id: data.user_id, nickname: data.nickname, email: data.email, balance: data.balance },
      data.token!
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
    color: 'var(--fg)',
    'font-family': "'IBM Plex Mono', monospace",
    'font-size': '14px',
    outline: 'none',
  }

  const inputContainerStyle = {
    background: 'var(--surface)',
    border: '1px solid var(--border-soft)',
  }

  const labelStyle = {
    display: 'block',
    'font-size': '10px',
    color: 'var(--fg-muted)',
    'margin-bottom': '4px',
    'text-transform': 'uppercase',
    'font-family': "'Space Grotesk', sans-serif",
  }

  return (
    <div
      class="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={props.onClose}
    >
      <div
        class="w-full max-w-xs bg-surface border-2 border-edge shadow-sharp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div class="titlebar">
          <span class="i-mdi-account-key w-4 h-4 text-accent" />
          <span class="text-accent-strong flex-1 font-heading">
            {mode() === 'email-login' ? 'Sign In' :
             mode() === 'register' ? 'Register' :
             mode() === 'magic' ? 'Recovery Email' :
             mode() === 'recover' ? 'Recover Account' :
             mode() === 'show-recovery-share' ? 'Save Recovery Words' :
             'Login'}
          </span>
          <button
            onClick={props.onClose}
            class="btn-win px-2 py-0.5 text-xs"
          >
            X
          </button>
        </div>

        {/* Show recovery share after registration */}
        <Show when={mode() === 'show-recovery-share'}>
          <div style={{ padding: '12px' }}>
            <div class="bg-amber-50 border-2 border-amber-700 p-3 mb-3">
              <p class="text-xs text-amber-800 font-heading font-semibold mb-2">
                SAVE THESE RECOVERY WORDS
              </p>
              <p class="text-[10px] text-fg-muted mb-3">
                Write these down and store them safely. You'll need them + your email to recover your account if you forget your password.
              </p>
              <div class="bg-page border border-edge-soft p-3 font-mono text-xs text-emerald-700" style={{ 'word-break': 'break-word', 'line-height': '1.6' }}>
                {recoveryShare()}
              </div>
              <button
                onClick={copyRecoveryShare}
                class={`btn-win w-full mt-2 ${copiedShare() ? 'bg-emerald-100 text-emerald-800' : ''}`}
              >
                {copiedShare() ? 'COPIED!' : 'COPY TO CLIPBOARD'}
              </button>
            </div>
            <button
              onClick={continueAfterRecoveryShare}
              disabled={loading()}
              class="btn-win primary w-full py-2"
            >
              {loading() ? 'LOGGING IN...' : 'I SAVED THEM - CONTINUE'}
            </button>
          </div>
        </Show>

        {/* Regular forms */}
        <Show when={mode() !== 'show-recovery-share'}>
          <form onSubmit={handleSubmit} style={{ padding: '12px' }}>
            {/* Email login — primary flow */}
            <Show when={mode() === 'email-login'}>
              <div style={{ 'margin-bottom': '12px' }}>
                <label style={labelStyle}>Email</label>
                <div style={inputContainerStyle}>
                  <input
                    type="email"
                    style={inputStyle}
                    placeholder="you@example.com"
                    value={email()}
                    onInput={(e) => setEmail(e.currentTarget.value)}
                    autofocus
                  />
                </div>
                <p class="text-[9px] text-fg-muted mt-1">
                  We'll email you a login link. No password needed.
                </p>
              </div>
            </Show>

            <Show when={mode() !== 'magic' && mode() !== 'recover' && mode() !== 'email-login'}>
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
                  <p class="text-[9px] text-fg-muted mt-1">3-20 chars, letters/numbers/_/-</p>
                </Show>
              </div>

              <div style={{ 'margin-bottom': '12px' }}>
                <label style={labelStyle}>
                  Password <span class="text-fg-faint">(local only)</span>
                </label>
                <div style={inputContainerStyle}>
                  <input
                    type="password"
                    style={inputStyle}
                    placeholder="min 8 characters"
                    value={pin()}
                    onInput={(e) => setPin(e.currentTarget.value)}
                  />
                </div>
                <Show when={mode() === 'register'}>
                  <p class="text-[9px] text-fg-muted mt-1">Used to derive keys locally. Never sent to server. Cannot be recovered without backup.</p>
                </Show>
              </div>

              <Show when={mode() === 'register'}>
                <div style={{ 'margin-bottom': '12px' }}>
                  <label style={labelStyle}>
                    Recovery Email <span class="text-fg-faint">(recommended)</span>
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
                  <p class="text-[9px] text-fg-muted mt-1">
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
                <p class="text-[9px] text-fg-muted mt-1">
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
                  <p class="text-[9px] text-fg-muted mt-1">
                    Enter the recovery words you saved during registration.
                  </p>
                </div>
              </Show>
            </Show>

            <Show when={error()}>
              <div class="bg-red-50 border border-red-200 p-2 mb-2">
                <p class="text-red-700 text-[10px]">{error()}</p>
              </div>
            </Show>

            <Show when={message()}>
              <div class="bg-emerald-50 border border-emerald-200 p-2 mb-2">
                <p class="text-emerald-700 text-[10px]">{message()}</p>
              </div>
            </Show>

            <button
              type="submit"
              disabled={loading()}
              class="btn-win primary w-full py-2 mb-3 flex items-center justify-center gap-2"
              style={{ opacity: loading() ? '0.7' : '1' }}
            >
              {loading() && <span class="animate-spin">*</span>}
              {derivingKeys()
                ? 'DERIVING...'
                : loading()
                  ? 'SENDING...'
                  : mode() === 'email-login'
                    ? 'SEND LOGIN LINK'
                    : mode() === 'register'
                      ? 'CREATE ACCOUNT'
                      : mode() === 'magic'
                        ? serverShareHex() ? 'RECOVER ACCOUNT' : 'SEND RECOVERY EMAIL'
                        : 'LOGIN'}
            </button>
          </form>

          <div class="border-t border-edge-soft px-3 py-2 text-center text-[10px] text-fg-muted">
            <Show when={mode() === 'email-login'}>
              <button
                onClick={() => { setMode('login'); setMessage('') }}
                class="bg-transparent border-none text-fg-muted cursor-pointer text-[10px]"
              >
                Use password instead
              </button>
            </Show>

            <Show when={mode() === 'login'}>
              <button
                onClick={() => { setMode('email-login'); setMessage('') }}
                class="bg-transparent border-none text-accent cursor-pointer text-[10px]"
              >
                Use email link
              </button>
              <span class="mx-2">|</span>
              <button
                onClick={() => setMode('register')}
                class="bg-transparent border-none text-accent cursor-pointer text-[10px]"
              >
                Register
              </button>
              <span class="mx-2">|</span>
              <button
                onClick={() => setMode('magic')}
                class="bg-transparent border-none text-fg-muted cursor-pointer text-[10px]"
              >
                Forgot password?
              </button>
            </Show>

            <Show when={mode() === 'register'}>
              <button
                onClick={() => { setMode('email-login'); setMessage('') }}
                class="bg-transparent border-none text-accent cursor-pointer text-[10px]"
              >
                Use email link
              </button>
              <span class="mx-2">|</span>
              <button
                onClick={() => setMode('login')}
                class="bg-transparent border-none text-accent cursor-pointer text-[10px]"
              >
                Login
              </button>
            </Show>

            <Show when={mode() === 'magic'}>
              <button
                onClick={() => { setMode('email-login'); setServerShareHex(''); setMessage('') }}
                class="bg-transparent border-none text-accent cursor-pointer text-[10px]"
              >
                Back
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
