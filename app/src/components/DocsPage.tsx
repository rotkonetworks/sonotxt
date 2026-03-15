import { Component, createSignal, For, Show, onCleanup } from 'solid-js'

interface Props {
  onClose: () => void
}

type Section = 'overview' | 'tee' | 'noise' | 'attestation' | 'threat-model'

const DocsPage: Component<Props> = (props) => {
  const [section, setSection] = createSignal<Section>('overview')
  let contentRef: HTMLDivElement | undefined

  // Escape to close — skip if a modal overlay rendered after this one has focus
  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Escape') return
    // If the event target is inside a different fixed overlay (modal on top), don't close
    const target = e.target as HTMLElement
    if (contentRef && !contentRef.contains(target) && target !== document.body) return
    props.onClose()
  }
  window.addEventListener('keydown', onKeyDown)
  onCleanup(() => window.removeEventListener('keydown', onKeyDown))

  function switchSection(s: Section) {
    setSection(s)
    // Defer scroll until after SolidJS has flushed the DOM update
    queueMicrotask(() => contentRef?.scrollTo({ top: 0, behavior: 'smooth' }))
  }

  const sections: { id: Section; title: string }[] = [
    { id: 'overview', title: 'Overview' },
    { id: 'tee', title: 'TEE Architecture' },
    { id: 'noise', title: 'Noise Protocol' },
    { id: 'attestation', title: 'Attestation' },
    { id: 'threat-model', title: 'Threat Model' },
  ]

  return (
    <div ref={contentRef} class="fixed inset-0 z-50 overflow-auto" style={{ background: 'color-mix(in srgb, var(--bg) 95%, transparent)' }}>
      <div class="min-h-screen p-4 sm:p-8">
        <div class="max-w-4xl mx-auto">
          {/* Header */}
          <div class="flex items-center justify-between mb-6">
            <div class="flex items-center gap-3">
              <span class="i-mdi-shield-lock w-6 h-6 text-purple-500" />
              <h1 class="text-xl sm:text-2xl font-bold text-fg font-heading">Private TTS Architecture</h1>
            </div>
            <button
              class="btn-win p-2"
              onClick={props.onClose}
              title="Close"
            >
              <span class="i-mdi-close w-5 h-5" />
            </button>
          </div>

          {/* Nav */}
          <div class="flex gap-1 mb-6 overflow-x-auto pb-2">
            <For each={sections}>{(s) => (
              <button
                class={`px-3 py-1.5 text-xs sm:text-sm whitespace-nowrap transition-all font-heading ${
                  section() === s.id
                    ? 'bg-accent-soft text-accent-strong border-2 border-edge'
                    : 'bg-surface text-fg-muted hover:text-fg border border-edge-soft'
                }`}
                onClick={() => switchSection(s.id)}
              >
                {s.title}
              </button>
            )}</For>
          </div>

          {/* Content */}
          <div class="panel p-4 sm:p-6 space-y-6 text-sm sm:text-base leading-relaxed">
            <Show when={section() === 'overview'}>
              <div class="space-y-4">
                <h2 class="text-lg font-semibold text-accent font-heading">How Private Mode Works</h2>
                <p class="text-fg">
                  sonotxt offers an optional <strong class="text-purple-600">Private Mode</strong> that provides
                  end-to-end encrypted text-to-speech synthesis. When enabled, your text is encrypted in your browser
                  before being sent to our servers, processed inside a hardware-isolated enclave, and the resulting
                  audio is encrypted before being sent back to you.
                </p>

                <div class="panel-inset p-4 space-y-3">
                  <h3 class="text-sm font-semibold text-accent-strong font-heading">Key Properties</h3>
                  <ul class="space-y-2 text-fg-muted">
                    <li class="flex gap-2">
                      <span class="text-accent">1.</span>
                      <span><strong class="text-fg">Client-side encryption</strong> - Text never leaves your browser unencrypted</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-accent">2.</span>
                      <span><strong class="text-fg">Hardware isolation</strong> - Processing happens in AMD SEV-SNP or Intel TDX enclaves</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-accent">3.</span>
                      <span><strong class="text-fg">Cryptographic attestation</strong> - Verify the enclave is running expected code</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-accent">4.</span>
                      <span><strong class="text-fg">No logging</strong> - Server cannot see or store your plaintext</span>
                    </li>
                  </ul>
                </div>

                <div class="text-xs text-fg-muted border-l-2 border-purple-300 pl-3">
                  Private mode uses the same TTS model as standard mode, but wraps all communication
                  in the Noise_NK protocol with keys bound to TEE attestation.
                </div>
              </div>
            </Show>

            <Show when={section() === 'tee'}>
              <div class="space-y-4">
                <h2 class="text-lg font-semibold text-accent font-heading">Trusted Execution Environment</h2>
                <p class="text-fg">
                  A <strong class="text-purple-600">TEE</strong> (Trusted Execution Environment) is a hardware-isolated
                  region of a processor that provides confidentiality and integrity guarantees. Code and data inside
                  a TEE cannot be observed or modified by the host operating system, hypervisor, or even physical
                  access to the machine.
                </p>

                <div class="grid gap-4 sm:grid-cols-2">
                  <div class="panel-inset p-4">
                    <h3 class="text-sm font-semibold text-accent-strong font-heading mb-2">AMD SEV-SNP</h3>
                    <p class="text-xs text-fg-muted">
                      Secure Encrypted Virtualization with Secure Nested Paging. Encrypts VM memory with per-VM keys,
                      provides integrity protection against memory replay attacks, and generates hardware-signed
                      attestation reports.
                    </p>
                  </div>
                  <div class="panel-inset p-4">
                    <h3 class="text-sm font-semibold text-accent-strong font-heading mb-2">Intel TDX</h3>
                    <p class="text-xs text-fg-muted">
                      Trust Domain Extensions. Similar to SEV-SNP but from Intel. Creates isolated "Trust Domains"
                      with hardware-enforced memory encryption and integrity verification.
                    </p>
                  </div>
                </div>

                <h3 class="text-sm font-semibold text-accent-strong font-heading mt-6">Architecture Diagram</h3>
                <div class="font-mono text-xs bg-page p-4 border border-edge-soft overflow-x-auto">
                  <pre class="text-accent">{`
┌─────────────────────────────────────────────────────────────┐
│                        YOUR BROWSER                          │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐   │
│  │ Text Input  │───>│ Noise_NK     │───>│ WebSocket     │   │
│  │             │    │ Encryption   │    │ Transport     │   │
│  └─────────────┘    └──────────────┘    └───────┬───────┘   │
└─────────────────────────────────────────────────┼───────────┘
                                                  │ encrypted
                                                  ▼
┌─────────────────────────────────────────────────────────────┐
│                     sonotxt server                            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              TEE ENCLAVE (SEV-SNP/TDX)                │   │
│  │  ┌────────────┐  ┌─────────────┐  ┌──────────────┐   │   │
│  │  │ Noise_NK   │  │ TTS Model   │  │ Opus Encoder │   │   │
│  │  │ Decryption │─>│ Inference   │─>│              │   │   │
│  │  └────────────┘  └─────────────┘  └──────┬───────┘   │   │
│  │                                          │            │   │
│  │  ┌────────────────────────────────────┐  │            │   │
│  │  │ Static Key (bound to attestation)  │<─┘            │   │
│  │  └────────────────────────────────────┘               │   │
│  └──────────────────────────────────────────────────────┘   │
│                           │                                  │
│                    HOST CANNOT SEE                           │
│                    ENCLAVE MEMORY                            │
└─────────────────────────────────────────────────────────────┘
`}</pre>
                </div>
              </div>
            </Show>

            <Show when={section() === 'noise'}>
              <div class="space-y-4">
                <h2 class="text-lg font-semibold text-accent font-heading">Noise_NK Protocol</h2>
                <p class="text-fg">
                  We use the <strong class="text-purple-600">Noise_NK</strong> handshake pattern for establishing
                  an encrypted channel between your browser and the TEE. "NK" means the server's static key (N)
                  is known to the client before the handshake, and the client is anonymous (K).
                </p>

                <div class="panel-inset p-4 space-y-3">
                  <h3 class="text-sm font-semibold text-accent-strong font-heading">Cryptographic Primitives</h3>
                  <ul class="space-y-2 text-xs font-mono">
                    <li class="flex gap-3">
                      <span class="text-accent w-24">DH</span>
                      <span class="text-fg-muted">X25519 (Curve25519 ECDH)</span>
                    </li>
                    <li class="flex gap-3">
                      <span class="text-accent w-24">CIPHER</span>
                      <span class="text-fg-muted">ChaCha20-Poly1305</span>
                    </li>
                    <li class="flex gap-3">
                      <span class="text-accent w-24">HASH</span>
                      <span class="text-fg-muted">SHA-256</span>
                    </li>
                    <li class="flex gap-3">
                      <span class="text-accent w-24">KDF</span>
                      <span class="text-fg-muted">HKDF-SHA256</span>
                    </li>
                  </ul>
                </div>

                <h3 class="text-sm font-semibold text-accent-strong font-heading mt-6">Handshake Flow</h3>
                <div class="font-mono text-xs bg-page p-4 border border-edge-soft overflow-x-auto">
                  <pre class="text-fg-muted">{`
1. Client obtains server's static public key (from attestation)

2. Client generates ephemeral keypair (e, E)

3. Client -> Server:  E || encrypt(payload)
   - Derives shared secret: DH(e, S)  where S is server static
   - Encrypts using derived key

4. Server -> Client:  encrypt(response)
   - Server decrypts using its static private key
   - Both sides now have symmetric session keys

5. All subsequent messages use session keys
   - Forward secrecy: ephemeral keys discarded
   - No client authentication (anonymous)`}</pre>
                </div>

                <div class="text-xs text-fg-muted border-l-2 border-purple-300 pl-3 mt-4">
                  <strong class="text-fg">Why Noise_NK?</strong> It provides perfect forward secrecy (compromising
                  the server's static key doesn't reveal past sessions), and requires only a single round-trip
                  for the handshake. The server's static key is bound to the TEE attestation, ensuring you're
                  talking to genuine enclave code.
                </div>
              </div>
            </Show>

            <Show when={section() === 'attestation'}>
              <div class="space-y-4">
                <h2 class="text-lg font-semibold text-accent font-heading">Remote Attestation</h2>
                <p class="text-fg">
                  <strong class="text-purple-600">Attestation</strong> is the process by which the TEE proves to
                  a remote party (your browser) that it's running specific code in a genuine hardware enclave.
                  This prevents man-in-the-middle attacks where an attacker substitutes a fake server.
                </p>

                <div class="panel-inset p-4 space-y-3">
                  <h3 class="text-sm font-semibold text-accent-strong font-heading">Attestation Bundle Contents</h3>
                  <ul class="space-y-2 text-xs">
                    <li class="flex gap-3">
                      <span class="text-accent font-mono w-28">quote</span>
                      <span class="text-fg-muted">Hardware-signed report from AMD/Intel containing measurement of enclave code</span>
                    </li>
                    <li class="flex gap-3">
                      <span class="text-accent font-mono w-28">staticKey</span>
                      <span class="text-fg-muted">Server's Noise static public key (X25519)</span>
                    </li>
                    <li class="flex gap-3">
                      <span class="text-accent font-mono w-28">bindingSig</span>
                      <span class="text-fg-muted">SHA256(quote || staticKey) - proves key belongs to this enclave</span>
                    </li>
                    <li class="flex gap-3">
                      <span class="text-accent font-mono w-28">teeType</span>
                      <span class="text-fg-muted">SEV-SNP, TDX, or Insecure (development only)</span>
                    </li>
                  </ul>
                </div>

                <h3 class="text-sm font-semibold text-accent-strong font-heading mt-6">Verification Process</h3>
                <ol class="space-y-3 text-sm">
                  <li class="flex gap-3">
                    <span class="text-accent font-bold">1.</span>
                    <div>
                      <strong class="text-fg">Connect to server</strong>
                      <p class="text-fg-muted text-xs mt-1">Establish WebSocket connection and request attestation</p>
                    </div>
                  </li>
                  <li class="flex gap-3">
                    <span class="text-accent font-bold">2.</span>
                    <div>
                      <strong class="text-fg">Receive attestation bundle</strong>
                      <p class="text-fg-muted text-xs mt-1">Server sends quote + static key + binding signature</p>
                    </div>
                  </li>
                  <li class="flex gap-3">
                    <span class="text-accent font-bold">3.</span>
                    <div>
                      <strong class="text-fg">Verify binding</strong>
                      <p class="text-fg-muted text-xs mt-1">Check that SHA256(quote || staticKey) matches bindingSig</p>
                    </div>
                  </li>
                  <li class="flex gap-3">
                    <span class="text-accent font-bold">4.</span>
                    <div>
                      <strong class="text-fg">Verify quote signature</strong>
                      <p class="text-fg-muted text-xs mt-1">Validate against AMD/Intel root certificate chain</p>
                    </div>
                  </li>
                  <li class="flex gap-3">
                    <span class="text-accent font-bold">5.</span>
                    <div>
                      <strong class="text-fg">Check measurement</strong>
                      <p class="text-fg-muted text-xs mt-1">Ensure enclave code hash matches expected value</p>
                    </div>
                  </li>
                  <li class="flex gap-3">
                    <span class="text-accent font-bold">6.</span>
                    <div>
                      <strong class="text-fg">Proceed with Noise handshake</strong>
                      <p class="text-fg-muted text-xs mt-1">Use the attested static key for encryption</p>
                    </div>
                  </li>
                </ol>

                <div class="text-xs text-fg-muted border-l-2 border-purple-300 pl-3 mt-4">
                  <strong class="text-fg">Current status:</strong> The browser client verifies the binding signature.
                  Full quote verification against AMD/Intel PKI is planned for a future release with server-side
                  verification endpoints.
                </div>
              </div>
            </Show>

            <Show when={section() === 'threat-model'}>
              <div class="space-y-4">
                <h2 class="text-lg font-semibold text-accent font-heading">Threat Model</h2>
                <p class="text-fg">
                  Understanding what Private Mode protects against (and what it doesn't) is important for
                  making informed decisions about your privacy.
                </p>

                <div class="panel-inset p-4 space-y-3 border-emerald-300">
                  <h3 class="text-sm font-semibold text-emerald-700 font-heading">Protected Against</h3>
                  <ul class="space-y-2 text-xs text-fg-muted">
                    <li class="flex gap-2">
                      <span class="text-emerald-600">+</span>
                      <span><strong class="text-fg">Server operator</strong> - Cannot see your plaintext even with full server access</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-emerald-600">+</span>
                      <span><strong class="text-fg">Network eavesdroppers</strong> - All traffic is encrypted end-to-end</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-emerald-600">+</span>
                      <span><strong class="text-fg">Physical access to server</strong> - TEE memory is encrypted by hardware</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-emerald-600">+</span>
                      <span><strong class="text-fg">Compromised host OS</strong> - Hypervisor cannot read enclave memory</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-emerald-600">+</span>
                      <span><strong class="text-fg">Subpoenas for logs</strong> - No plaintext logs exist to subpoena</span>
                    </li>
                  </ul>
                </div>

                <div class="panel-inset p-4 space-y-3 border-red-300">
                  <h3 class="text-sm font-semibold text-red-700 font-heading">NOT Protected Against</h3>
                  <ul class="space-y-2 text-xs text-fg-muted">
                    <li class="flex gap-2">
                      <span class="text-red-600">-</span>
                      <span><strong class="text-fg">Hardware vulnerabilities</strong> - TEEs have had side-channel attacks (though mitigated)</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-red-600">-</span>
                      <span><strong class="text-fg">Compromised client</strong> - Malware on your device can see your text</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-red-600">-</span>
                      <span><strong class="text-fg">Traffic analysis</strong> - Metadata like timing and message sizes visible</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-red-600">-</span>
                      <span><strong class="text-fg">Malicious enclave code</strong> - Trust required in our code (open source helps)</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-red-600">-</span>
                      <span><strong class="text-fg">Output correlation</strong> - Same text produces same audio (deterministic)</span>
                    </li>
                  </ul>
                </div>

                <h3 class="text-sm font-semibold text-accent-strong font-heading mt-6">Known Limitations</h3>
                <div class="space-y-3 text-xs text-fg-muted">
                  <p>
                    <strong class="text-fg">Side-channel attacks:</strong> Research has shown various attacks
                    on TEEs (SEVered, CacheOut, etc.). We run on latest hardware with mitigations, but no
                    system is perfect. For highly sensitive content, consider additional operational security.
                  </p>
                  <p>
                    <strong class="text-fg">Supply chain:</strong> You're trusting AMD/Intel manufactured
                    the hardware correctly, and that our enclave code does what we say. The enclave code is
                    open source for audit.
                  </p>
                  <p>
                    <strong class="text-fg">Audio fingerprinting:</strong> The generated audio is deterministic.
                    An attacker who suspects you said X could generate audio for X and compare waveforms.
                    Future versions may add randomization.
                  </p>
                </div>

                <div class="mt-6 p-4 bg-purple-50 border-2 border-purple-300">
                  <div class="flex gap-3 items-start">
                    <span class="i-mdi-shield-check w-5 h-5 text-purple-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 class="text-sm font-semibold text-purple-800 font-heading">Bottom Line</h4>
                      <p class="text-xs text-fg-muted mt-1">
                        Private Mode provides strong confidentiality guarantees backed by hardware. It's
                        significantly more private than standard cloud TTS services where the provider can
                        log and analyze your text. For most threat models, it's excellent protection.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </Show>
          </div>

          {/* Footer */}
          <div class="mt-6 text-center text-xs text-fg-muted font-heading">
            <a href="https://github.com/rotkonetworks/sonotxt" target="_blank" rel="noopener noreferrer" class="hover:text-accent">Source Code</a>
            {' · '}
            <a href="https://noiseprotocol.org/noise.html" target="_blank" rel="noopener noreferrer" class="hover:text-accent">Noise Protocol Spec</a>
            {' · '}
            <a href="https://www.amd.com/en/developer/sev.html" target="_blank" rel="noopener noreferrer" class="hover:text-accent">AMD SEV-SNP</a>
          </div>
        </div>
      </div>
    </div>
  )
}

export default DocsPage
