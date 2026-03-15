import { createSignal, Show, onMount } from 'solid-js'
import { useStore } from '../lib/store'

export default function PasskeyAuth() {
  const { state, actions } = useStore()
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [showLinuxHelp, setShowLinuxHelp] = createSignal(false)

  onMount(async () => {
    await actions.checkPasskeyAvailability()
  })

  const handleRegister = async () => {
    setError(null)
    setLoading(true)
    try {
      await actions.registerNewPasskey('sonotxt-user')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'registration failed')
    } finally {
      setLoading(false)
    }
  }

  const handleUnlock = async () => {
    setError(null)
    setLoading(true)
    try {
      await actions.unlockWithPasskey()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'authentication failed')
    } finally {
      setLoading(false)
    }
  }

  const handleLock = () => {
    actions.lockPasskey()
  }

  const handleClear = () => {
    if (confirm('remove passkey? you will need to register again.')) {
      actions.clearPasskey()
    }
  }

  return (
    <div class="text-xs">
      <Show when={!state.passkey.available}>
        <div>
          <p class="text-fg-muted">Passkey authentication not available on this device.</p>
          <button
            class="text-accent text-[11px] hover:underline mt-2 flex items-center gap-1"
            onClick={() => setShowLinuxHelp(!showLinuxHelp())}
          >
            <span class={`i-mdi-chevron-right w-3 h-3 transition-transform ${showLinuxHelp() ? 'rotate-90' : ''}`} />
            Linux users: setup guide
          </button>
          <Show when={showLinuxHelp()}>
            <div class="mt-3 p-3 bg-page border border-edge-soft">
              <p class="text-fg-muted text-[11px]">
                Linux requires additional setup to use TPM-based passkeys in the browser.
                Follow this guide to enable PRF support:
              </p>
              <a
                href="https://vitorpy.com/blog/2025-12-25-confer-to-linux-tpm-fido2-prf/"
                target="_blank"
                rel="noopener noreferrer"
                class="block mt-2 text-accent text-[11px] hover:underline"
              >
                vitorpy.com: Linux TPM FIDO2 PRF setup
              </a>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={state.passkey.available}>
        <Show when={!state.passkey.registered}>
          <div>
            <p class="text-fg">Secure your history with a passkey</p>
            <p class="text-[10px] text-fg-muted mt-1">Uses your device's biometrics or PIN to encrypt data locally</p>
            <button
              onClick={handleRegister}
              disabled={loading()}
              class="w-full mt-3 px-4 py-2.5 bg-accent text-white font-heading text-[10px] uppercase tracking-wider border-2 border-accent-strong hover:bg-accent-hover disabled:opacity-60 disabled:cursor-wait transition-colors"
            >
              {loading() ? 'Creating...' : 'Create passkey'}
            </button>
          </div>
        </Show>

        <Show when={state.passkey.registered && !state.passkey.unlocked}>
          <div>
            <p class="text-fg">Unlock with passkey</p>
            <button
              onClick={handleUnlock}
              disabled={loading()}
              class="w-full mt-3 px-4 py-2.5 bg-accent text-white font-heading text-[10px] uppercase tracking-wider border-2 border-accent-strong hover:bg-accent-hover disabled:opacity-60 disabled:cursor-wait transition-colors"
            >
              {loading() ? 'Verifying...' : 'Unlock'}
            </button>
            <button
              onClick={handleClear}
              class="mt-2 px-2 py-1 text-[10px] text-fg-muted hover:text-red-500 transition-colors"
            >
              Remove passkey
            </button>
          </div>
        </Show>

        <Show when={state.passkey.unlocked}>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-1.5">
              <span class="i-mdi-lock-open w-3.5 h-3.5 text-emerald-600" />
              <span class="text-emerald-700 font-heading text-[10px] uppercase tracking-wider">Unlocked</span>
            </div>
            <button
              onClick={handleLock}
              class="px-2 py-1 text-[10px] text-fg-muted hover:text-fg transition-colors"
            >
              Lock
            </button>
          </div>
        </Show>
      </Show>

      <Show when={error()}>
        <div class="flex items-start gap-1.5 mt-2 p-2 bg-red-50 border border-red-200 text-red-700 text-[11px]">
          <span class="i-mdi-alert-circle w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{error()}</span>
        </div>
      </Show>
    </div>
  )
}
