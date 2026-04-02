import { createSignal, Show } from 'solid-js'
import { getPublicKeyAsync, signAsync } from '@noble/ed25519'
import { argon2id } from '@noble/hashes/argon2.js'
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js'
import * as api from '../lib/api'
import { ApiError } from '../lib/api'
import { zidAuth } from '../lib/zid-auth'

const KEY_DERIVATION_SALT = new TextEncoder().encode('sonotxt-key-derivation-v1')

interface Props {
  onClose: () => void
  onLogin: (user: { id: string; nickname?: string; email?: string; balance: number }, token: string) => void
  initialMode?: 'email-login' | 'login'
}

type Mode = 'login' | 'register' | 'magic' | 'recover' | 'show-recovery-share' | 'email-login'
const [showLegacy, setShowLegacy] = createSignal(false)

function splitSecret(secret: Uint8Array): { serverShare: Uint8Array; userShare: Uint8Array } {
  const serverShare = randomBytes(secret.length)
  const userShare = new Uint8Array(secret.length)
  for (let i = 0; i < secret.length; i++) {
    userShare[i] = secret[i] ^ serverShare[i]
  }
  return { serverShare, userShare }
}

function combineShares(serverShare: Uint8Array, userShare: Uint8Array): Uint8Array {
  if (serverShare.length !== userShare.length) {
    throw new Error('Share length mismatch')
  }
  const secret = new Uint8Array(serverShare.length)
  for (let i = 0; i < serverShare.length; i++) {
    secret[i] = serverShare[i] ^ userShare[i]
  }
  return secret
}

// Exactly 256 entries — one per byte value, bijective encoding (no modulo needed).
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
    words.push(WORDLIST[bytes[i]])
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
  const [mode, setMode] = createSignal<Mode>(props.initialMode || 'email-login')
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
  const [showPassword, setShowPassword] = createSignal(false)
  const [nickAvailable, setNickAvailable] = createSignal<boolean | null>(null)
  const [nickChecking, setNickChecking] = createSignal(false)

  let nickCheckTimer: ReturnType<typeof setTimeout> | undefined

  function clearError() { if (error()) setError(''); if (message()) setMessage('') }

  function switchMode(m: Mode) {
    setMode(m)
    setError('')
    setMessage('')
    setShowPassword(false)
    if (nickCheckTimer) clearTimeout(nickCheckTimer)
    setNickChecking(false)
    setNickAvailable(null)
  }

  function onNicknameInput(value: string) {
    setNickname(value)
    clearError()
    setNickAvailable(null)
    if (nickCheckTimer) clearTimeout(nickCheckTimer)
    if (mode() === 'register' && value.trim().length >= 3) {
      setNickChecking(true)
      nickCheckTimer = setTimeout(async () => {
        try {
          const { available } = await api.checkNickname(value.trim())
          if (nickname().trim() === value.trim()) {
            setNickAvailable(available)
          }
        } catch {}
        setNickChecking(false)
      }, 400)
    }
  }

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

  async function signChallengeLocally(nick: string, p: string, challenge: string) {
    const { privateKey } = await deriveKeypair(nick, p)
    const messageBytes = new TextEncoder().encode(challenge)
    const signature = await signAsync(messageBytes, privateKey)
    privateKey.fill(0)
    return bytesToHex(signature)
  }

  async function signChallengeWithSeed(seed: Uint8Array, challenge: string) {
    const messageBytes = new TextEncoder().encode(challenge)
    const signature = await signAsync(messageBytes, seed)
    seed.fill(0)
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
      serverShare.fill(0)
      userShare.fill(0)
    }
    seed.fill(0)

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
    serverShare.fill(0)
    userShare.fill(0)
    const { challenge } = await api.getChallenge(nick)
    const signature = await signChallengeWithSeed(seed, challenge)
    // seed zeroed inside signChallengeWithSeed

    const data = await api.verifyChallenge(nick, challenge, signature)
    props.onLogin(
      { id: data.user_id, nickname: data.nickname, email: data.email, balance: data.balance },
      data.token!
    )
  }

  function copyRecoveryShare() {
    navigator.clipboard.writeText(recoveryShare()).then(() => {
      setCopiedShare(true)
      setTimeout(() => setCopiedShare(false), 2000)
    }).catch(() => {})
  }

  async function continueAfterRecoveryShare() {
    await handleLogin()
  }

  return (
    <div
      class="fixed inset-0 flex items-center justify-center z-50 p-4 bg-black/50"
      onClick={() => { if (!loading()) props.onClose() }}
    >
      <div
        class="w-full max-w-xs bg-surface border-2 border-edge shadow-[var(--shadow)] animate-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div class="titlebar">
          <span class="i-mdi-account-key w-4 h-4 text-accent" />
          <span class="text-accent-strong flex-1 font-heading">sign in</span>
          <button onClick={() => { if (!loading()) props.onClose() }} class="text-fg-faint hover:text-accent p-1 transition-colors">
            <span class="i-mdi-close w-4 h-4" />
          </button>
        </div>

        {/* Zafu wallet - primary auth */}
        <Show when={mode() === 'email-login' && !showLegacy()}>
          <div class="p-4 flex flex-col gap-3">
            <button
              onClick={async () => {
                try {
                  const id = await zidAuth.connect()
                  if (id) {
                    const me = await api.zidGetMe()
                    props.onLogin({ id: me.pubkey, balance: me.balance }, 'zid')
                  }
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'failed to connect')
                }
              }}
              disabled={zidAuth.connecting()}
              class="btn-win primary w-full py-3 flex items-center justify-center gap-2 text-[11px] disabled:opacity-60"
            >
              <span class="i-mdi-wallet w-4 h-4" />
              {zidAuth.connecting() ? 'connecting...' : 'connect with zafu'}
            </button>
            <p class="text-[9px] text-fg-faint text-center">
              no email, no password. your wallet is your identity.
            </p>
            <Show when={error()}>
              <p class="text-[10px] text-red-600">{error()}</p>
            </Show>
            <div class="border-t border-edge-soft pt-3 mt-1">
              <button
                onClick={() => setShowLegacy(true)}
                class="bg-transparent border-none text-fg-faint hover:text-accent cursor-pointer text-[9px] transition-colors font-heading uppercase tracking-wider w-full text-center"
              >
                other sign-in options
              </button>
            </div>
          </div>
        </Show>

        {/* Show recovery share after registration */}
        <Show when={mode() === 'show-recovery-share'}>
          <div class="p-4">
            <div class="bg-amber-50 border-2 border-amber-700 p-3 mb-3">
              <div class="flex items-center gap-1.5 mb-2">
                <span class="i-mdi-shield-alert w-4 h-4 text-amber-700" />
                <span class="text-xs text-amber-800 font-heading font-semibold uppercase tracking-wider">Save these words</span>
              </div>
              <p class="text-[10px] text-fg-muted mb-3">
                Write these down. You'll need them + your email to recover your account.
              </p>
              <div class="bg-page border border-edge-soft p-3 font-mono text-xs text-emerald-700 break-words leading-relaxed">
                {recoveryShare()}
              </div>
              <button
                onClick={copyRecoveryShare}
                class={`btn-win w-full mt-2 text-[10px] ${copiedShare() ? 'bg-emerald-100 text-emerald-800' : ''}`}
              >
                {copiedShare() ? 'COPIED!' : 'COPY TO CLIPBOARD'}
              </button>
            </div>
            <button
              onClick={continueAfterRecoveryShare}
              disabled={loading()}
              class="btn-win primary w-full py-2 text-[10px]"
            >
              {loading() ? 'LOGGING IN...' : 'I SAVED THEM — CONTINUE'}
            </button>
          </div>
        </Show>

        {/* Legacy forms - shown after "other sign-in options" or non-email modes */}
        <Show when={mode() !== 'show-recovery-share' && (showLegacy() || mode() !== 'email-login')}>
          <form onSubmit={handleSubmit} class="p-4 flex flex-col gap-3">
            {/* Email login — primary flow */}
            <Show when={mode() === 'email-login'}>
              <div>
                <label class="block text-[10px] text-fg-muted mb-1 font-heading uppercase tracking-wider">Email</label>
                <input
                  type="email"
                  class="w-full px-3 py-2 bg-page border border-edge-soft text-fg font-mono text-sm outline-none placeholder:text-fg-faint focus:border-accent transition-colors"
                  placeholder="you@example.com"
                  value={email()}
                  onInput={(e) => { setEmail(e.currentTarget.value); clearError() }}
                  autofocus
                />
                <p class="text-[9px] text-fg-faint mt-1">
                  We'll email you a login link. No password needed.
                </p>
              </div>
            </Show>

            <Show when={mode() !== 'magic' && mode() !== 'recover' && mode() !== 'email-login'}>
              <div>
                <label class="block text-[10px] text-fg-muted mb-1 font-heading uppercase tracking-wider">Nickname</label>
                <div class="relative">
                  <input
                    type="text"
                    class="w-full px-3 py-2 bg-page border border-edge-soft text-fg font-mono text-sm outline-none placeholder:text-fg-faint focus:border-accent transition-colors"
                    placeholder="yourname"
                    value={nickname()}
                    onInput={(e) => onNicknameInput(e.currentTarget.value)}
                  />
                  <Show when={mode() === 'register' && nickname().trim().length >= 3}>
                    <span class="absolute right-2 top-1/2 -translate-y-1/2">
                      <Show when={nickChecking()}>
                        <span class="i-mdi-loading w-3.5 h-3.5 text-fg-faint animate-spin" />
                      </Show>
                      <Show when={!nickChecking() && nickAvailable() === true}>
                        <span class="i-mdi-check-circle w-3.5 h-3.5 text-emerald-600" />
                      </Show>
                      <Show when={!nickChecking() && nickAvailable() === false}>
                        <span class="i-mdi-close-circle w-3.5 h-3.5 text-red-500" />
                      </Show>
                    </span>
                  </Show>
                </div>
                <Show when={mode() === 'register'}>
                  <p class="text-[9px] mt-1" classList={{ 'text-fg-faint': nickAvailable() !== false, 'text-red-500': nickAvailable() === false }}>
                    {nickAvailable() === false ? 'Nickname taken' : '3-20 chars, letters/numbers/_/-'}
                  </p>
                </Show>
              </div>

              <div>
                <label class="block text-[10px] text-fg-muted mb-1 font-heading uppercase tracking-wider">
                  Password <span class="text-fg-faint">(local only)</span>
                </label>
                <div class="relative">
                  <input
                    type={showPassword() ? 'text' : 'password'}
                    class="w-full px-3 py-2 pr-9 bg-page border border-edge-soft text-fg font-mono text-sm outline-none placeholder:text-fg-faint focus:border-accent transition-colors"
                    placeholder="min 8 characters"
                    value={pin()}
                    onInput={(e) => { setPin(e.currentTarget.value); clearError() }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword())}
                    class="absolute right-2 top-1/2 -translate-y-1/2 bg-transparent border-none text-fg-faint hover:text-fg-muted cursor-pointer p-0 transition-colors"
                    tabIndex={-1}
                  >
                    <span class={`w-3.5 h-3.5 ${showPassword() ? 'i-mdi-eye-off' : 'i-mdi-eye'}`} />
                  </button>
                </div>
                <Show when={mode() === 'register'}>
                  <p class="text-[9px] text-fg-faint mt-1">Derives keys locally. Never sent to server.</p>
                </Show>
              </div>

              <Show when={mode() === 'register'}>
                <div>
                  <label class="block text-[10px] text-fg-muted mb-1 font-heading uppercase tracking-wider">
                    Recovery Email <span class="text-fg-faint">(recommended)</span>
                  </label>
                  <input
                    type="email"
                    class="w-full px-3 py-2 bg-page border border-edge-soft text-fg font-mono text-sm outline-none placeholder:text-fg-faint focus:border-accent transition-colors"
                    placeholder="backup@example.com"
                    value={recoveryEmail()}
                    onInput={(e) => { setRecoveryEmail(e.currentTarget.value); clearError() }}
                  />
                  <p class="text-[9px] text-fg-faint mt-1">
                    Enables recovery via Shamir secret sharing.
                  </p>
                </div>
              </Show>
            </Show>

            {/* Magic link / Recovery */}
            <Show when={mode() === 'magic'}>
              <div>
                <label class="block text-[10px] text-fg-muted mb-1 font-heading uppercase tracking-wider">Recovery Email</label>
                <input
                  type="email"
                  class="w-full px-3 py-2 bg-page border border-edge-soft text-fg font-mono text-sm outline-none placeholder:text-fg-faint focus:border-accent transition-colors"
                  placeholder="you@example.com"
                  value={email()}
                  onInput={(e) => { setEmail(e.currentTarget.value); clearError() }}
                />
                <p class="text-[9px] text-fg-faint mt-1">
                  We'll send you the server's share of your recovery key.
                </p>
              </div>

              <Show when={serverShareHex()}>
                <div>
                  <label class="block text-[10px] text-fg-muted mb-1 font-heading uppercase tracking-wider">Your Nickname</label>
                  <input
                    type="text"
                    class="w-full px-3 py-2 bg-page border border-edge-soft text-fg font-mono text-sm outline-none placeholder:text-fg-faint focus:border-accent transition-colors"
                    placeholder="yourname"
                    value={nickname()}
                    onInput={(e) => { setNickname(e.currentTarget.value); clearError() }}
                  />
                </div>
                <div>
                  <label class="block text-[10px] text-fg-muted mb-1 font-heading uppercase tracking-wider">Your Recovery Words</label>
                  <textarea
                    class="w-full px-3 py-2 bg-page border border-edge-soft text-fg font-mono text-sm outline-none placeholder:text-fg-faint focus:border-accent transition-colors resize-y min-h-20"
                    placeholder="word1 word2 word3..."
                    value={userShareInput()}
                    onInput={(e) => { setUserShareInput(e.currentTarget.value); clearError() }}
                  />
                  <p class="text-[9px] text-fg-faint mt-1">
                    Enter the recovery words you saved during registration.
                  </p>
                </div>
              </Show>
            </Show>

            <Show when={error()}>
              <div class="flex items-start gap-2 bg-red-50 border border-red-200 p-2.5">
                <span class="i-mdi-alert-circle w-3.5 h-3.5 text-red-600 flex-shrink-0 mt-0.5" />
                <p class="text-red-700 text-[10px]">{error()}</p>
              </div>
            </Show>

            <Show when={message()}>
              <div class="flex items-start gap-2 bg-emerald-50 border border-emerald-200 p-2.5">
                <span class="i-mdi-check-circle w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <p class="text-emerald-700 text-[10px]">{message()}</p>
              </div>
            </Show>

            <button
              type="submit"
              disabled={loading()}
              class="btn-win primary w-full py-2.5 flex items-center justify-center gap-2 text-[11px] disabled:opacity-60"
            >
              <Show when={loading()}>
                <span class="i-mdi-loading w-3.5 h-3.5 animate-spin" />
              </Show>
              {derivingKeys()
                ? 'Securing locally...'
                : loading()
                  ? 'Sending...'
                  : mode() === 'email-login'
                    ? 'Send login link'
                    : mode() === 'register'
                      ? 'Create account'
                      : mode() === 'magic'
                        ? serverShareHex() ? 'Recover account' : 'Send recovery email'
                        : 'Login'}
            </button>
          </form>

          {/* Mode switcher footer */}
          <div class="border-t border-edge-soft px-4 py-2.5 flex items-center justify-center gap-2 text-[10px]">
            <Show when={mode() === 'email-login'}>
              <button
                onClick={() => switchMode('login')}
                class="bg-transparent border-none text-fg-muted hover:text-accent cursor-pointer text-[10px] transition-colors font-heading uppercase tracking-wider"
              >
                Use password instead
              </button>
            </Show>

            <Show when={mode() === 'login'}>
              <button
                onClick={() => switchMode('email-login')}
                class="bg-transparent border-none text-accent hover:text-accent-hover cursor-pointer text-[10px] transition-colors font-heading uppercase tracking-wider"
              >
                Email link
              </button>
              <span class="text-fg-faint">&middot;</span>
              <button
                onClick={() => switchMode('register')}
                class="bg-transparent border-none text-accent hover:text-accent-hover cursor-pointer text-[10px] transition-colors font-heading uppercase tracking-wider"
              >
                Register
              </button>
              <span class="text-fg-faint">&middot;</span>
              <button
                onClick={() => switchMode('magic')}
                class="bg-transparent border-none text-fg-muted hover:text-accent cursor-pointer text-[10px] transition-colors font-heading uppercase tracking-wider"
              >
                Forgot?
              </button>
            </Show>

            <Show when={mode() === 'register'}>
              <button
                onClick={() => switchMode('email-login')}
                class="bg-transparent border-none text-accent hover:text-accent-hover cursor-pointer text-[10px] transition-colors font-heading uppercase tracking-wider"
              >
                Email link
              </button>
              <span class="text-fg-faint">&middot;</span>
              <button
                onClick={() => switchMode('login')}
                class="bg-transparent border-none text-accent hover:text-accent-hover cursor-pointer text-[10px] transition-colors font-heading uppercase tracking-wider"
              >
                Already have an account?
              </button>
            </Show>

            <Show when={mode() === 'magic'}>
              <button
                onClick={() => { switchMode('email-login'); setServerShareHex('') }}
                class="bg-transparent border-none text-fg-muted hover:text-accent cursor-pointer text-[10px] transition-colors font-heading uppercase tracking-wider flex items-center gap-1"
              >
                <span class="i-mdi-arrow-left w-3 h-3" />
                Back to login
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
