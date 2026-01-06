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
    <div class="passkey-auth">
      <Show when={!state.passkey.available}>
        <div class="passkey-unavailable">
          <p>passkey authentication not available on this device.</p>
          <button
            class="link-btn"
            onClick={() => setShowLinuxHelp(!showLinuxHelp())}
          >
            linux users: setup guide
          </button>
          <Show when={showLinuxHelp()}>
            <div class="linux-help">
              <p>
                linux requires additional setup to use tpm-based passkeys in the browser.
                follow this guide to enable prf support:
              </p>
              <a
                href="https://vitorpy.com/blog/2025-12-25-confer-to-linux-tpm-fido2-prf/"
                target="_blank"
                rel="noopener"
              >
                vitorpy.com: linux tpm fido2 prf setup
              </a>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={state.passkey.available}>
        <Show when={!state.passkey.registered}>
          <div class="passkey-register">
            <p>secure your history with a passkey</p>
            <p class="hint">uses your device's biometrics or pin to encrypt data locally</p>
            <button
              onClick={handleRegister}
              disabled={loading()}
              class="primary-btn"
            >
              {loading() ? 'creating...' : 'create passkey'}
            </button>
          </div>
        </Show>

        <Show when={state.passkey.registered && !state.passkey.unlocked}>
          <div class="passkey-unlock">
            <p>unlock with passkey</p>
            <button
              onClick={handleUnlock}
              disabled={loading()}
              class="primary-btn"
            >
              {loading() ? 'verifying...' : 'unlock'}
            </button>
            <button
              onClick={handleClear}
              class="text-btn danger"
            >
              remove passkey
            </button>
          </div>
        </Show>

        <Show when={state.passkey.unlocked}>
          <div class="passkey-unlocked">
            <span class="status">unlocked</span>
            <button onClick={handleLock} class="text-btn">
              lock
            </button>
          </div>
        </Show>
      </Show>

      <Show when={error()}>
        <p class="error">{error()}</p>
      </Show>
    </div>
  )
}
