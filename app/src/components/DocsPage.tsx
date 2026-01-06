import { Component, createSignal, For, Show } from 'solid-js'

interface Props {
  onClose: () => void
}

type Section = 'overview' | 'tee' | 'noise' | 'attestation' | 'threat-model'

const DocsPage: Component<Props> = (props) => {
  const [section, setSection] = createSignal<Section>('overview')

  const sections: { id: Section; title: string }[] = [
    { id: 'overview', title: 'Overview' },
    { id: 'tee', title: 'TEE Architecture' },
    { id: 'noise', title: 'Noise Protocol' },
    { id: 'attestation', title: 'Attestation' },
    { id: 'threat-model', title: 'Threat Model' },
  ]

  return (
    <div class="fixed inset-0 bg-black/90 z-50 overflow-auto">
      <div class="min-h-screen p-4 sm:p-8">
        <div class="max-w-4xl mx-auto">
          {/* Header */}
          <div class="flex items-center justify-between mb-6">
            <div class="flex items-center gap-3">
              <span class="i-mdi-shield-lock w-6 h-6 text-purple-400" />
              <h1 class="text-xl sm:text-2xl font-bold text-text-bright">Private TTS Architecture</h1>
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
                class={`px-3 py-1.5 text-xs sm:text-sm whitespace-nowrap rounded transition-all ${
                  section() === s.id
                    ? 'bg-purple-600/40 text-purple-200 border border-purple-500/50'
                    : 'bg-bg-light text-text-dim hover:text-text hover:bg-bg-mid'
                }`}
                onClick={() => setSection(s.id)}
              >
                {s.title}
              </button>
            )}</For>
          </div>

          {/* Content */}
          <div class="panel p-4 sm:p-6 space-y-6 text-sm sm:text-base leading-relaxed">
            <Show when={section() === 'overview'}>
              <div class="space-y-4">
                <h2 class="text-lg font-semibold text-lcd-green">How Private Mode Works</h2>
                <p class="text-text">
                  SonoTxt offers an optional <strong class="text-purple-300">Private Mode</strong> that provides
                  end-to-end encrypted text-to-speech synthesis. When enabled, your text is encrypted in your browser
                  before being sent to our servers, processed inside a hardware-isolated enclave, and the resulting
                  audio is encrypted before being sent back to you.
                </p>

                <div class="panel-inset p-4 space-y-3">
                  <h3 class="text-sm font-semibold text-lcd-yellow">Key Properties</h3>
                  <ul class="space-y-2 text-text-dim">
                    <li class="flex gap-2">
                      <span class="text-lcd-green">1.</span>
                      <span><strong class="text-text">Client-side encryption</strong> - Text never leaves your browser unencrypted</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-lcd-green">2.</span>
                      <span><strong class="text-text">Hardware isolation</strong> - Processing happens in AMD SEV-SNP or Intel TDX enclaves</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-lcd-green">3.</span>
                      <span><strong class="text-text">Cryptographic attestation</strong> - Verify the enclave is running expected code</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-lcd-green">4.</span>
                      <span><strong class="text-text">No logging</strong> - Server cannot see or store your plaintext</span>
                    </li>
                  </ul>
                </div>

                <div class="text-xs text-text-dim border-l-2 border-purple-500/50 pl-3">
                  Private mode uses the same TTS model as standard mode, but wraps all communication
                  in the Noise_NK protocol with keys bound to TEE attestation.
                </div>
              </div>
            </Show>

            <Show when={section() === 'tee'}>
              <div class="space-y-4">
                <h2 class="text-lg font-semibold text-lcd-green">Trusted Execution Environment</h2>
                <p class="text-text">
                  A <strong class="text-purple-300">TEE</strong> (Trusted Execution Environment) is a hardware-isolated
                  region of a processor that provides confidentiality and integrity guarantees. Code and data inside
                  a TEE cannot be observed or modified by the host operating system, hypervisor, or even physical
                  access to the machine.
                </p>

                <div class="grid gap-4 sm:grid-cols-2">
                  <div class="panel-inset p-4">
                    <h3 class="text-sm font-semibold text-lcd-yellow mb-2">AMD SEV-SNP</h3>
                    <p class="text-xs text-text-dim">
                      Secure Encrypted Virtualization with Secure Nested Paging. Encrypts VM memory with per-VM keys,
                      provides integrity protection against memory replay attacks, and generates hardware-signed
                      attestation reports.
                    </p>
                  </div>
                  <div class="panel-inset p-4">
                    <h3 class="text-sm font-semibold text-lcd-yellow mb-2">Intel TDX</h3>
                    <p class="text-xs text-text-dim">
                      Trust Domain Extensions. Similar to SEV-SNP but from Intel. Creates isolated "Trust Domains"
                      with hardware-enforced memory encryption and integrity verification.
                    </p>
                  </div>
                </div>

                <h3 class="text-sm font-semibold text-lcd-yellow mt-6">Architecture Diagram</h3>
                <div class="font-mono text-xs bg-black/50 p-4 rounded border border-border-dark overflow-x-auto">
                  <pre class="text-lcd-green">{`
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
│                     SONOTXT SERVER                           │
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
                <h2 class="text-lg font-semibold text-lcd-green">Noise_NK Protocol</h2>
                <p class="text-text">
                  We use the <strong class="text-purple-300">Noise_NK</strong> handshake pattern for establishing
                  an encrypted channel between your browser and the TEE. "NK" means the server's static key (N)
                  is known to the client before the handshake, and the client is anonymous (K).
                </p>

                <div class="panel-inset p-4 space-y-3">
                  <h3 class="text-sm font-semibold text-lcd-yellow">Cryptographic Primitives</h3>
                  <ul class="space-y-2 text-xs font-mono">
                    <li class="flex gap-3">
                      <span class="text-lcd-green w-24">DH</span>
                      <span class="text-text-dim">X25519 (Curve25519 ECDH)</span>
                    </li>
                    <li class="flex gap-3">
                      <span class="text-lcd-green w-24">CIPHER</span>
                      <span class="text-text-dim">ChaCha20-Poly1305</span>
                    </li>
                    <li class="flex gap-3">
                      <span class="text-lcd-green w-24">HASH</span>
                      <span class="text-text-dim">SHA-256</span>
                    </li>
                    <li class="flex gap-3">
                      <span class="text-lcd-green w-24">KDF</span>
                      <span class="text-text-dim">HKDF-SHA256</span>
                    </li>
                  </ul>
                </div>

                <h3 class="text-sm font-semibold text-lcd-yellow mt-6">Handshake Flow</h3>
                <div class="font-mono text-xs bg-black/50 p-4 rounded border border-border-dark overflow-x-auto">
                  <pre class="text-text-dim">{`
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

                <div class="text-xs text-text-dim border-l-2 border-purple-500/50 pl-3 mt-4">
                  <strong class="text-text">Why Noise_NK?</strong> It provides perfect forward secrecy (compromising
                  the server's static key doesn't reveal past sessions), and requires only a single round-trip
                  for the handshake. The server's static key is bound to the TEE attestation, ensuring you're
                  talking to genuine enclave code.
                </div>
              </div>
            </Show>

            <Show when={section() === 'attestation'}>
              <div class="space-y-4">
                <h2 class="text-lg font-semibold text-lcd-green">Remote Attestation</h2>
                <p class="text-text">
                  <strong class="text-purple-300">Attestation</strong> is the process by which the TEE proves to
                  a remote party (your browser) that it's running specific code in a genuine hardware enclave.
                  This prevents man-in-the-middle attacks where an attacker substitutes a fake server.
                </p>

                <div class="panel-inset p-4 space-y-3">
                  <h3 class="text-sm font-semibold text-lcd-yellow">Attestation Bundle Contents</h3>
                  <ul class="space-y-2 text-xs">
                    <li class="flex gap-3">
                      <span class="text-lcd-green font-mono w-28">quote</span>
                      <span class="text-text-dim">Hardware-signed report from AMD/Intel containing measurement of enclave code</span>
                    </li>
                    <li class="flex gap-3">
                      <span class="text-lcd-green font-mono w-28">staticKey</span>
                      <span class="text-text-dim">Server's Noise static public key (X25519)</span>
                    </li>
                    <li class="flex gap-3">
                      <span class="text-lcd-green font-mono w-28">bindingSig</span>
                      <span class="text-text-dim">SHA256(quote || staticKey) - proves key belongs to this enclave</span>
                    </li>
                    <li class="flex gap-3">
                      <span class="text-lcd-green font-mono w-28">teeType</span>
                      <span class="text-text-dim">SEV-SNP, TDX, or Insecure (development only)</span>
                    </li>
                  </ul>
                </div>

                <h3 class="text-sm font-semibold text-lcd-yellow mt-6">Verification Process</h3>
                <ol class="space-y-3 text-sm">
                  <li class="flex gap-3">
                    <span class="text-lcd-green font-bold">1.</span>
                    <div>
                      <strong class="text-text">Connect to server</strong>
                      <p class="text-text-dim text-xs mt-1">Establish WebSocket connection and request attestation</p>
                    </div>
                  </li>
                  <li class="flex gap-3">
                    <span class="text-lcd-green font-bold">2.</span>
                    <div>
                      <strong class="text-text">Receive attestation bundle</strong>
                      <p class="text-text-dim text-xs mt-1">Server sends quote + static key + binding signature</p>
                    </div>
                  </li>
                  <li class="flex gap-3">
                    <span class="text-lcd-green font-bold">3.</span>
                    <div>
                      <strong class="text-text">Verify binding</strong>
                      <p class="text-text-dim text-xs mt-1">Check that SHA256(quote || staticKey) matches bindingSig</p>
                    </div>
                  </li>
                  <li class="flex gap-3">
                    <span class="text-lcd-green font-bold">4.</span>
                    <div>
                      <strong class="text-text">Verify quote signature</strong>
                      <p class="text-text-dim text-xs mt-1">Validate against AMD/Intel root certificate chain</p>
                    </div>
                  </li>
                  <li class="flex gap-3">
                    <span class="text-lcd-green font-bold">5.</span>
                    <div>
                      <strong class="text-text">Check measurement</strong>
                      <p class="text-text-dim text-xs mt-1">Ensure enclave code hash matches expected value</p>
                    </div>
                  </li>
                  <li class="flex gap-3">
                    <span class="text-lcd-green font-bold">6.</span>
                    <div>
                      <strong class="text-text">Proceed with Noise handshake</strong>
                      <p class="text-text-dim text-xs mt-1">Use the attested static key for encryption</p>
                    </div>
                  </li>
                </ol>

                <div class="text-xs text-text-dim border-l-2 border-purple-500/50 pl-3 mt-4">
                  <strong class="text-text">Current status:</strong> The browser client verifies the binding signature.
                  Full quote verification against AMD/Intel PKI is planned for a future release with server-side
                  verification endpoints.
                </div>
              </div>
            </Show>

            <Show when={section() === 'threat-model'}>
              <div class="space-y-4">
                <h2 class="text-lg font-semibold text-lcd-green">Threat Model</h2>
                <p class="text-text">
                  Understanding what Private Mode protects against (and what it doesn't) is important for
                  making informed decisions about your privacy.
                </p>

                <div class="panel-inset p-4 space-y-3 border-lcd-green/30">
                  <h3 class="text-sm font-semibold text-lcd-green">Protected Against</h3>
                  <ul class="space-y-2 text-xs text-text-dim">
                    <li class="flex gap-2">
                      <span class="text-lcd-green">+</span>
                      <span><strong class="text-text">Server operator</strong> - Cannot see your plaintext even with full server access</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-lcd-green">+</span>
                      <span><strong class="text-text">Network eavesdroppers</strong> - All traffic is encrypted end-to-end</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-lcd-green">+</span>
                      <span><strong class="text-text">Physical access to server</strong> - TEE memory is encrypted by hardware</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-lcd-green">+</span>
                      <span><strong class="text-text">Compromised host OS</strong> - Hypervisor cannot read enclave memory</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-lcd-green">+</span>
                      <span><strong class="text-text">Subpoenas for logs</strong> - No plaintext logs exist to subpoena</span>
                    </li>
                  </ul>
                </div>

                <div class="panel-inset p-4 space-y-3 border-lcd-red/30">
                  <h3 class="text-sm font-semibold text-lcd-red">NOT Protected Against</h3>
                  <ul class="space-y-2 text-xs text-text-dim">
                    <li class="flex gap-2">
                      <span class="text-lcd-red">-</span>
                      <span><strong class="text-text">Hardware vulnerabilities</strong> - TEEs have had side-channel attacks (though mitigated)</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-lcd-red">-</span>
                      <span><strong class="text-text">Compromised client</strong> - Malware on your device can see your text</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-lcd-red">-</span>
                      <span><strong class="text-text">Traffic analysis</strong> - Metadata like timing and message sizes visible</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-lcd-red">-</span>
                      <span><strong class="text-text">Malicious enclave code</strong> - Trust required in our code (open source helps)</span>
                    </li>
                    <li class="flex gap-2">
                      <span class="text-lcd-red">-</span>
                      <span><strong class="text-text">Output correlation</strong> - Same text produces same audio (deterministic)</span>
                    </li>
                  </ul>
                </div>

                <h3 class="text-sm font-semibold text-lcd-yellow mt-6">Known Limitations</h3>
                <div class="space-y-3 text-xs text-text-dim">
                  <p>
                    <strong class="text-text">Side-channel attacks:</strong> Research has shown various attacks
                    on TEEs (SEVered, CacheOut, etc.). We run on latest hardware with mitigations, but no
                    system is perfect. For highly sensitive content, consider additional operational security.
                  </p>
                  <p>
                    <strong class="text-text">Supply chain:</strong> You're trusting AMD/Intel manufactured
                    the hardware correctly, and that our enclave code does what we say. The enclave code is
                    open source for audit.
                  </p>
                  <p>
                    <strong class="text-text">Audio fingerprinting:</strong> The generated audio is deterministic.
                    An attacker who suspects you said X could generate audio for X and compare waveforms.
                    Future versions may add randomization.
                  </p>
                </div>

                <div class="mt-6 p-4 bg-purple-900/20 border border-purple-500/30 rounded">
                  <div class="flex gap-3 items-start">
                    <span class="i-mdi-shield-check w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 class="text-sm font-semibold text-purple-200">Bottom Line</h4>
                      <p class="text-xs text-text-dim mt-1">
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
          <div class="mt-6 text-center text-xs text-text-dim">
            <a href="https://github.com/rotkonetworks/sonotxt" class="hover:text-lcd-green">Source Code</a>
            {' · '}
            <a href="https://noiseprotocol.org/noise.html" class="hover:text-lcd-green">Noise Protocol Spec</a>
            {' · '}
            <a href="https://www.amd.com/en/developer/sev.html" class="hover:text-lcd-green">AMD SEV-SNP</a>
          </div>
        </div>
      </div>
    </div>
  )
}

export default DocsPage
