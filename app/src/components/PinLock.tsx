import { createSignal, Show, For, onCleanup } from 'solid-js'

const PIN_HASH_KEY = 'sonotxt_pin_hash'
const PIN_LENGTH = 4

// Use PBKDF2 with 100k iterations to make brute-force of 4-digit PINs expensive
async function hashPin(pin: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
  const salt = enc.encode('sonotxt-pin-v2')
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256)
  return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('')
}

interface Props {
  onUnlock: () => void
}

export function hasPinLock(): boolean {
  return localStorage.getItem(PIN_HASH_KEY) !== null
}

export async function setPinLock(pin: string) {
  localStorage.setItem(PIN_HASH_KEY, await hashPin(pin))
}

export function removePinLock() {
  localStorage.removeItem(PIN_HASH_KEY)
}

async function verifyPin(pin: string): Promise<boolean> {
  const stored = localStorage.getItem(PIN_HASH_KEY)
  if (!stored) return false
  const computed = await hashPin(pin)
  // constant-time comparison to prevent timing oracle
  if (computed.length !== stored.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ stored.charCodeAt(i)
  }
  return diff === 0
}

export default function PinLock(props: Props) {
  const [pin, setPin] = createSignal('')
  const [error, setError] = createSignal(false)
  const [shake, setShake] = createSignal(false)
  const [locked, setLocked] = createSignal(false)
  const [lockRemaining, setLockRemaining] = createSignal(0)
  let failCount = 0
  let lockTimer: ReturnType<typeof setInterval> | undefined

  function press(digit: string) {
    if (pin().length >= PIN_LENGTH || locked()) return
    const next = pin() + digit
    setPin(next)
    setError(false)

    if (next.length === PIN_LENGTH) {
      // Auto-submit when full
      setTimeout(async () => {
        if (await verifyPin(next)) {
          failCount = 0
          props.onUnlock()
        } else {
          failCount++
          setError(true)
          setShake(true)
          setTimeout(() => { setShake(false); setPin('') }, 500)
          // Exponential backoff: 2s, 4s, 8s, 16s, 30s max
          if (failCount >= 3) {
            const delaySec = Math.min(30, Math.pow(2, failCount - 2))
            setLocked(true)
            setLockRemaining(delaySec)
            lockTimer = setInterval(() => {
              setLockRemaining(r => {
                if (r <= 1) { clearInterval(lockTimer); setLocked(false); return 0 }
                return r - 1
              })
            }, 1000)
          }
        }
      }, 100)
    }
  }

  // Keyboard support — stopPropagation prevents App.tsx handlers from firing behind the lock screen
  function onKeyDown(e: KeyboardEvent) {
    e.stopPropagation()
    if (e.key >= '0' && e.key <= '9') press(e.key)
    else if (e.key === 'Backspace') backspace()
  }
  window.addEventListener('keydown', onKeyDown)
  onCleanup(() => { window.removeEventListener('keydown', onKeyDown); if (lockTimer) clearInterval(lockTimer) })

  function backspace() {
    if (locked()) return
    setPin(pin().slice(0, -1))
    setError(false)
  }


  const keys = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['', '0', '⌫'],
  ]

  return (
    <div class="fixed inset-0 z-[100] bg-page flex flex-col items-center justify-center">
      {/* Logo */}
      <div class="flex items-center gap-2 mb-6">
        <div class="i-mdi-waveform text-accent w-6 h-6" />
        <span class="text-accent-strong font-bold text-lg font-heading">sonotxt</span>
      </div>

      <p class="text-xs text-fg-muted font-heading uppercase tracking-wider mb-6">
        Enter PIN to unlock
      </p>

      {/* PIN dots */}
      <div class={`flex items-center justify-center gap-3 mb-2 ${shake() ? 'animate-shake' : ''}`}>
        <For each={Array.from({ length: PIN_LENGTH })}>{(_, i) => (
          <div
            class={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-150 ${
              i() < pin().length
                ? error()
                  ? 'bg-red-500 border-red-600'
                  : 'bg-accent border-accent-strong'
                : 'bg-transparent border-edge'
            }`}
          />
        )}</For>
      </div>

      <Show when={locked()}>
        <p class="text-[10px] text-red-500 font-heading uppercase tracking-wider mb-2">
          Too many attempts — wait {lockRemaining()}s
        </p>
      </Show>
      <Show when={error() && !locked()}>
        <p class="text-[10px] text-red-500 font-heading uppercase tracking-wider mb-2">Wrong PIN</p>
      </Show>

      <div class="h-4" />

      {/* Number pad */}
      <div class="grid grid-cols-3 gap-2 w-56">
        <For each={keys}>{row => (
          <For each={row}>{key => (
            <Show when={key !== ''} fallback={<div />}>
              <button
                type="button"
                class={`h-14 rounded-full font-heading text-lg transition-all select-none active:scale-95 ${
                  key === '⌫'
                    ? 'text-fg-faint hover:text-accent bg-transparent'
                    : 'text-fg hover:bg-accent-soft bg-surface border border-edge-soft active:bg-accent active:text-white'
                }`}
                onClick={() => {
                  if (key === '⌫') backspace()
                  else press(key)
                }}
              >
                {key}
              </button>
            </Show>
          )}</For>
        )}</For>
      </div>
    </div>
  )
}
