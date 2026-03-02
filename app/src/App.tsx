import { createSignal, For, Show, onMount, lazy, Suspense, onCleanup, createMemo, createResource } from 'solid-js'
import { ToastContainer, showToast } from './components/Toast'
import { watchJobStatus } from './lib/jobStatus'
import { useStore } from './lib/store'
import * as api from './lib/api'
import type { User, VoicesResponse } from './lib/api'
import ProfileDropdown from './components/ProfileDropdown'
import { Player } from './components/Player'
import { VoiceSelector } from './components/VoiceSelector'
import type { Voice } from './components/VoiceSelector'
import type { StreamChunk } from './lib/teeClient'

const fetchVoicesData = async (): Promise<VoicesResponse> => {
  try {
    return await api.fetchVoices()
  } catch {
    return { voices: [], default: 'en-Mike_man', samples_base_url: '', categories: {} }
  }
}

const AuthModal = lazy(() => import('./components/AuthModal'))
const WalletModal = lazy(() => import('./components/WalletModal'))
const ProfilePage = lazy(() => import('./components/ProfilePage'))
const DocsPage = lazy(() => import('./components/DocsPage'))

function transformVoices(data: VoicesResponse): Record<string, Voice[]> {
  const result: Record<string, Voice[]> = {}
  for (const [category, ids] of Object.entries(data.categories)) {
    result[category] = ids.map(id => {
      let name: string, accent: string, gender: 'M' | 'F'
      if (id.startsWith('en-')) {
        const parts = id.slice(3).split('_')
        name = parts[0]
        accent = 'EN'
        gender = parts[1] === 'woman' ? 'F' : 'M'
      } else {
        const prefix = id.slice(0, 2)
        const rawName = id.slice(3)
        name = rawName.charAt(0).toUpperCase() + rawName.slice(1)
        const regionMap: Record<string, string> = {
          a: 'US', b: 'UK', e: 'EU', f: 'FR', h: 'HI', i: 'IT', j: 'JP', p: 'PT', z: 'ZH',
        }
        accent = regionMap[prefix[0]] || prefix[0].toUpperCase()
        gender = prefix[1] === 'f' ? 'F' : 'M'
      }
      return { id, name, accent, gender }
    })
  }
  return result
}

export default function App() {
  const { state: store, actions } = useStore()

  const [voicesData] = createResource(fetchVoicesData)

  const transformedVoices = createMemo(() => {
    const data = voicesData()
    if (!data || !data.categories) return {}
    return transformVoices(data)
  })

  const allVoices = createMemo(() => Object.values(transformedVoices()).flat())

  const [mode, setMode] = createSignal<'text' | 'url'>('text')
  const [text, setText] = createSignal('')
  const [urlInput, setUrlInput] = createSignal('')
  const [extractedTitle, setExtractedTitle] = createSignal('')
  const [voice, setVoice] = createSignal('en-Mike_man')
  const [loading, setLoading] = createSignal(false)
  const [extracting, setExtracting] = createSignal(false)
  const [status, setStatus] = createSignal('')
  const [audioUrl, setAudioUrl] = createSignal('')
  const [currentJobId, setCurrentJobId] = createSignal('')
  const [audioTitle, setAudioTitle] = createSignal('')
  const [isPlaying, setIsPlaying] = createSignal(false)
  const [dragover, setDragover] = createSignal(false)
  const [showLimitError, setShowLimitError] = createSignal(false)
  const [historyFilter, setHistoryFilter] = createSignal('')
  const [showAuth, setShowAuth] = createSignal(false)
  const [showWallet, setShowWallet] = createSignal(false)
  const [showProfile, setShowProfile] = createSignal(false)
  const [showDocs, setShowDocs] = createSignal(false)
  const [showLoginMenu, setShowLoginMenu] = createSignal(false)

  let textareaRef: HTMLTextAreaElement | undefined

  const samplesBaseUrl = () => voicesData()?.samples_base_url || ''

  const filteredHistory = createMemo(() => {
    const filter = historyFilter().toLowerCase().trim()
    if (!filter) return store.history
    return store.history.filter(item => item.text.toLowerCase().includes(filter))
  })

  onMount(() => {
    const savedToken = localStorage.getItem('sonotxt_token')
    if (savedToken) checkSession(savedToken)

    // fetch free balance for all users
    api.getFreeBalance(savedToken).then(data => {
      actions.setFreeRemaining(data.remaining)
    }).catch(() => {})

    const handleKeydown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'

      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (mode() === 'url' && urlInput().trim() && !extracting()) {
          extractUrl()
        } else if (text().trim() && !loading()) {
          generate()
        }
      }

      if (e.key === 'Escape') {
        if (showAuth()) setShowAuth(false)
      }

      if (!isInput) {
        const num = parseInt(e.key)
        if (!isNaN(num)) {
          e.preventDefault()
          const idx = num === 0 ? 9 : num - 1
          const voices = allVoices()
          if (idx < voices.length) {
            setVoice(voices[idx].id)
          }
        }
      }
    }
    document.addEventListener('keydown', handleKeydown)
    onCleanup(() => document.removeEventListener('keydown', handleKeydown))

    textareaRef?.focus()
  })

  async function checkSession(tok: string) {
    try {
      const data = await api.checkSession(tok)
      actions.login(
        { id: data.user_id, nickname: data.nickname, email: data.email, wallet_address: data.wallet_address, balance: data.balance },
        tok
      )
    } catch {
      actions.logout()
    }
  }

  const charCount = () => text().length

  async function extractUrl() {
    const url = urlInput().trim()
    if (!url) return
    const fullUrl = url.startsWith('http') ? url : `https://${url}`

    setExtracting(true)
    setStatus('FETCHING...')

    try {
      const data = await api.extractUrl(fullUrl)
      setText(data.text)
      setExtractedTitle(data.title || '')
      setMode('text')
      setStatus('')
      showToast(`Extracted ${data.char_count} chars`, 'success')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to extract'
      showToast(message, 'error')
      setStatus('ERROR')
    }

    setExtracting(false)
  }

  let cancelJobWatch: (() => void) | null = null

  async function generatePrivate() {
    const t = text().trim()
    const teeClient = actions.getTeeClient()
    if (!teeClient) return

    setLoading(true)
    setStatus('ENCRYPTING...')
    setAudioUrl('')

    try {
      const audioChunks: Uint8Array[] = []
      let totalBytes = 0

      await teeClient.synthesizeStream(t, voice(), 1.0, (chunk: StreamChunk) => {
        if (chunk.error) {
          throw new Error(chunk.error)
        }
        audioChunks.push(chunk.audio)
        totalBytes += chunk.audio.length
        setStatus(`STREAMING ${Math.round(totalBytes / 1024)}KB`)
      })

      const combined = new Uint8Array(totalBytes)
      let offset = 0
      for (const chunk of audioChunks) {
        combined.set(chunk, offset)
        offset += chunk.length
      }

      const blob = new Blob([combined], { type: 'audio/opus' })
      const blobUrl = URL.createObjectURL(blob)

      setAudioUrl(blobUrl)
      setCurrentJobId('')
      setAudioTitle(t.slice(0, 60) + (t.length > 60 ? '...' : ''))
      setStatus('READY')

      actions.addToHistory({
        text: t.slice(0, 100),
        url: blobUrl,
        duration: 0,
        voice: voice(),
      })

      setLoading(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Private generation failed'
      showToast(message, 'error')
      setStatus('ERROR')
      setLoading(false)
    }
  }

  async function generate() {
    const t = text().trim()
    if (!t) return

    if (store.tee.connected) {
      return generatePrivate()
    }

    if (!store.user && t.length > 1000) {
      showToast('Free tier limited to 1000 chars', 'error')
      return
    }

    cancelJobWatch?.()

    setLoading(true)
    setStatus('CONNECTING...')
    setAudioUrl('')
    setShowLimitError(false)

    const engine = voice().startsWith('en-') ? 'vibevoice-streaming' : 'kokoro'

    try {
      const result = await api.submitTts({ text: t, voice: voice(), engine })
      const { job_id, free_tier_remaining } = result
      if (free_tier_remaining !== undefined) actions.setFreeRemaining(free_tier_remaining)

      await new Promise<void>((resolve, reject) => {
        cancelJobWatch = watchJobStatus(
          job_id,
          (result) => {
            if (result.status === 'Complete' && result.url) {
              setAudioUrl(result.url)
              setCurrentJobId(job_id)
              setAudioTitle(t.slice(0, 60) + (t.length > 60 ? '...' : ''))
              setStatus('READY')

              actions.addToHistory({
                text: t.slice(0, 100),
                url: result.url,
                jobId: job_id,
                duration: result.duration_seconds || 0,
                voice: voice(),
                sourceUrl: urlInput() || undefined
              })
              setLoading(false)
              resolve()
            } else if (result.status === 'Failed') {
              setLoading(false)
              reject(new Error(result.reason || 'Generation failed'))
            } else if (result.status === 'Processing' && result.progress) {
              setStatus(`PROCESSING ${result.progress}%`)
            } else {
              setStatus(result.status?.toUpperCase() || 'WORKING...')
            }
          },
          (error) => {
            setLoading(false)
            reject(error)
          }
        )
      })
    } catch (err) {
      if (err instanceof api.ApiError && err.isLimitExceeded) {
        setShowLimitError(true)
        setStatus('LIMIT')
      } else {
        const message = err instanceof Error ? err.message : 'Request failed'
        showToast(message, 'error')
        setStatus('ERROR')
      }
      setLoading(false)
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragover(false)
    const file = e.dataTransfer?.files[0]
    if (file && (file.type === 'text/plain' || file.name.endsWith('.txt'))) {
      file.text().then(setText)
      setMode('text')
    }
  }

  function onLogin(u: User, tok: string) {
    actions.login(u, tok)
    setShowAuth(false)
    setShowWallet(false)
    const name = u.nickname || u.email || (u.wallet_address ? u.wallet_address.slice(0, 8) + '...' : 'anon')
    showToast(`Welcome, ${name}!`, 'success')
  }

  function logout() {
    actions.logout()
    showToast('Logged out', 'success')
  }

  function downloadAudio() {
    const jobId = currentJobId()
    if (!jobId) return
    const a = document.createElement('a')
    a.href = api.getDownloadUrl(jobId)
    a.download = `sonotxt-${jobId}.mp3`
    a.click()
  }

  async function shareAudio() {
    const url = audioUrl()
    if (!url) return
    if (navigator.share) {
      try {
        await navigator.share({ title: 'SonoTxt Audio', url })
      } catch {}
    } else {
      await navigator.clipboard.writeText(url)
      showToast('Link copied!', 'success')
    }
  }

  function loadAndPlay(url: string, title: string, _duration: number, jobId?: string) {
    setAudioUrl(url)
    setCurrentJobId(jobId || '')
    setAudioTitle(title)
  }

  const statusDisplay = () => {
    if (loading() || extracting()) return <span class="text-accent animate-pulse">{status()}</span>
    if (audioUrl()) return <span class="text-accent">{isPlaying() ? 'PLAYING' : 'PAUSED'}</span>
    return <span class="text-fg-faint">READY</span>
  }

  const historySection = () => (
    <Show when={store.history.length > 0}>
      <div class="flex-1 flex flex-col min-h-0">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-[10px] sm:text-xs text-fg-muted uppercase tracking-wider font-heading">Recent</span>
          <div class="flex-1" />
          <div class="bg-surface border border-edge-soft">
            <input
              type="text"
              class="w-20 sm:w-28 px-2 py-1 bg-transparent text-fg font-mono text-[10px] outline-none placeholder:text-fg-faint"
              placeholder="filter..."
              value={historyFilter()}
              onInput={(e) => setHistoryFilter(e.currentTarget.value)}
            />
          </div>
        </div>
        <div class="flex-1 overflow-y-auto max-h-28 sm:max-h-36 2xl:max-h-none">
          <For each={filteredHistory().slice(0, 10)}>{item => {
            const isSelected = () => audioUrl() === item.url
            return (
              <div
                class={`flex items-center gap-2 py-1 px-1 sm:px-2 text-[10px] sm:text-xs group ${
                  isSelected() ? 'bg-accent-soft text-accent-hover' : 'hover:bg-page text-fg'
                }`}
              >
                <button
                  class="flex-shrink-0 cursor-pointer bg-transparent border-none p-0"
                  onClick={() => loadAndPlay(item.url, item.text, item.duration, item.jobId)}
                  title="Play"
                >
                  <span class={`w-3 h-3 block ${
                    isSelected()
                      ? (isPlaying() ? 'i-mdi-volume-high text-accent animate-pulse' : 'i-mdi-pause text-accent')
                      : 'i-mdi-play text-accent opacity-0 group-hover:opacity-100'
                  }`} />
                </button>
                <span
                  class="flex-1 truncate cursor-pointer"
                  onClick={() => loadAndPlay(item.url, item.text, item.duration, item.jobId)}
                >{item.text}</span>
                <button
                  class="flex-shrink-0 cursor-pointer bg-transparent border-none p-0 opacity-0 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    setText(item.text)
                    setMode('text')
                    textareaRef?.focus()
                  }}
                  title="Edit & Regenerate"
                >
                  <span class="i-mdi-pencil w-3 h-3 text-fg-faint hover:text-accent" />
                </button>
                <span class={`flex-shrink-0 ${isSelected() ? 'text-accent' : 'text-fg-faint'}`}>{Math.round(item.duration)}s</span>
              </div>
            )
          }}</For>
        </div>
      </div>
    </Show>
  )

  return (
    <div class="min-h-screen flex justify-center p-2 sm:p-4 lg:p-6">
     <div class="panel w-full max-w-6xl flex flex-col">
      {/* Titlebar */}
      <header class="titlebar">
        <div class="flex items-center gap-2">
          <div class="i-mdi-waveform text-accent-strong w-4 h-4" />
          <span class="text-accent-strong font-bold">SONOTXT</span>
          <Show when={store.tee.connected}>
            <span class="text-[9px] px-1.5 py-0.5 bg-purple-100 text-purple-700 border border-purple-300"
              title={`TEE: ${store.tee.attestation?.teeType || 'Connected'}`}
            >
              <span class="i-mdi-shield-lock w-2.5 h-2.5 mr-0.5" />
              PRIVATE
            </span>
          </Show>
        </div>

        <div class="flex-1" />

        <div class="flex items-center gap-3">
          <Show when={store.user} fallback={
            <>
              <span class="text-xs text-accent font-mono">{store.freeRemaining} free</span>
              <span class="text-fg-faint">|</span>
              <div class="relative">
                <button
                  onClick={() => setShowLoginMenu(!showLoginMenu())}
                  class="text-fg-muted hover:text-accent font-heading text-[10px] sm:text-xs transition-colors flex items-center gap-0.5"
                >
                  LOGIN
                  <span class={`i-mdi-chevron-down w-2.5 h-2.5 transition-transform ${showLoginMenu() ? 'rotate-180' : ''}`} />
                </button>
                <Show when={showLoginMenu()}>
                  <div class="absolute right-0 top-full mt-1 z-50 min-w-[180px] bg-surface border-2 border-edge shadow-sharp">
                    <button
                      class="w-full px-3 py-2 text-left text-xs text-fg hover:bg-page flex items-center gap-2"
                      onClick={() => { setShowLoginMenu(false); setShowAuth(true) }}
                    >
                      <span class="i-mdi-key w-4 h-4 text-fg-muted" />
                      Nickname + PIN
                    </button>
                    <button
                      class="w-full px-3 py-2 text-left text-xs text-fg hover:bg-page flex items-center gap-2"
                      onClick={() => { setShowLoginMenu(false); setShowWallet(true) }}
                    >
                      <span class="i-mdi-wallet w-4 h-4 text-fg-muted" />
                      Connect Wallet
                    </button>
                  </div>
                  <div class="fixed inset-0 z-40" onClick={() => setShowLoginMenu(false)} />
                </Show>
              </div>
            </>
          }>
            <ProfileDropdown
              onLogout={logout}
              onShowProfile={() => setShowProfile(true)}
            />
          </Show>
        </div>
      </header>

      {/* Body */}
      <div class="flex-1 flex flex-col 2xl:flex-row">
        {/* Main content area */}
        <main class="flex-1 flex flex-col p-2 sm:p-4 lg:p-6">
          {/* Player card — only when audio exists or loading */}
          <Show when={audioUrl() || loading()}>
            <div class="w-full mb-3 sm:mb-4">
              <div class="panel-inset p-2 sm:p-3">
                <div class="flex items-center gap-2 mb-2 text-[10px] sm:text-xs font-heading">
                  {statusDisplay()}
                  <Show when={audioTitle()}>
                    <span class="text-fg truncate flex-1" title={audioTitle()}>
                      {audioTitle()}
                    </span>
                  </Show>
                </div>

                <Show when={extractedTitle()}>
                  <div class="text-[10px] sm:text-xs text-fg mb-2 truncate" title={extractedTitle()}>
                    {extractedTitle()}
                  </div>
                </Show>

                <Player
                  src={audioUrl()}
                  onDownload={downloadAudio}
                  onShare={shareAudio}
                  onPlayStateChange={setIsPlaying}
                />
              </div>
            </div>
          </Show>

          {/* Input card */}
          <div class="w-full lg:flex-1 lg:flex lg:flex-col">
            <div class="panel-inset lg:flex-1 lg:flex lg:flex-col">
              {/* Mobile-only: voice selector inline */}
              <div class="2xl:hidden p-2 border-b border-edge-soft" data-voice-selector>
                <VoiceSelector
                  voices={transformedVoices()}
                  featured={['en-Mike_man', 'af_bella', 'am_adam', 'bf_emma']}
                  selected={voice()}
                  samplesBaseUrl={samplesBaseUrl()}
                  onSelect={setVoice}
                />
              </div>

              {/* Mode tabs */}
              <div class="flex gap-1 p-2 border-b border-edge-soft">
                <button
                  class={`btn-win text-[10px] sm:text-xs flex-1 2xl:flex-none lg:px-4 2xl:px-4 ${mode() === 'text' ? 'primary' : ''}`}
                  onClick={() => setMode('text')}
                >
                  <span class="i-mdi-text w-3 h-3 mr-1" />
                  TEXT
                </button>
                <button
                  class={`btn-win text-[10px] sm:text-xs flex-1 2xl:flex-none lg:px-4 2xl:px-4 ${mode() === 'url' ? 'primary' : ''}`}
                  onClick={() => setMode('url')}
                >
                  <span class="i-mdi-web w-3 h-3 mr-1" />
                  URL
                </button>
              </div>

              {/* URL input */}
              <Show when={mode() === 'url'}>
                <div class="flex">
                  <input
                    type="text"
                    class="flex-1 px-2 sm:px-3 py-2 sm:py-3 bg-transparent text-fg font-mono text-xs sm:text-sm outline-none placeholder:text-fg-faint"
                    placeholder="Enter URL..."
                    value={urlInput()}
                    onInput={(e) => setUrlInput(e.currentTarget.value)}
                    onKeyDown={(e) => e.key === 'Enter' && extractUrl()}
                  />
                  <button
                    class="btn-win primary px-3 sm:px-4"
                    disabled={extracting() || !urlInput().trim()}
                    onClick={extractUrl}
                  >
                    <Show when={extracting()} fallback={
                      <span class="i-mdi-download w-4 h-4" />
                    }>
                      <span class="animate-spin">*</span>
                    </Show>
                  </button>
                </div>
              </Show>

              {/* Text input */}
              <Show when={mode() === 'text'}>
                <div
                  class={`lg:flex-1 lg:flex lg:flex-col ${dragover() ? 'border-accent' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDragover(true) }}
                  onDragLeave={() => setDragover(false)}
                  onDrop={handleDrop}
                >
                  <textarea
                    ref={textareaRef}
                    class="w-full min-h-24 sm:min-h-32 lg:flex-1 p-2 sm:p-3 bg-transparent text-fg font-mono text-xs sm:text-sm resize-y lg:resize-none outline-none placeholder:text-fg-faint"
                    placeholder="Paste or type text here..."
                    value={text()}
                    onInput={(e) => setText(e.currentTarget.value)}
                  />
                </div>
              </Show>

              {/* Footer: char count + voice chip + generate */}
              <div class="flex justify-between items-center px-2 sm:px-3 py-2 border-t border-edge-soft bg-surface">
                <span class={`text-[10px] sm:text-xs font-mono ${charCount() > 1000 ? 'text-red-600' : charCount() > 800 ? 'text-amber-600' : 'text-fg-muted'}`}>
                  {charCount().toLocaleString()} chars
                </span>
                <button
                  class="hidden sm:flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-fg-muted hover:text-accent font-heading transition-colors"
                  onClick={() => {
                    const el = document.querySelector('[data-voice-selector]')
                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }}
                  title="Selected voice"
                >
                  <span class="i-mdi-account-voice w-3 h-3" />
                  {(() => {
                    const v = allVoices().find(v => v.id === voice())
                    return v ? v.name : voice()
                  })()}
                </button>
                <button
                  class="btn-win primary flex items-center gap-1 sm:gap-2 text-[10px] sm:text-xs"
                  disabled={loading() || !text().trim()}
                  onClick={generate}
                >
                  <Show when={loading()} fallback={
                    <span class="i-mdi-waveform w-3 h-3 sm:w-4 sm:h-4" />
                  }>
                    <span class="animate-spin">*</span>
                  </Show>
                  {loading() ? 'GENERATING' : 'GENERATE'}
                </button>
              </div>
            </div>
          </div>

          {/* Free tier limit error */}
          <Show when={showLimitError()}>
            <div class="w-full mt-3">
              <div class="bg-surface border-2 border-edge p-3">
                <div class="flex items-start gap-3">
                  <span class="i-mdi-alert-circle w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div class="flex-1">
                    <div class="text-red-700 text-xs font-heading font-semibold mb-1">FREE TIER LIMIT REACHED</div>
                    <p class="text-fg-muted text-[10px] mb-3">
                      You've used your daily free quota ({store.freeRemaining} chars remaining).
                      {store.user ? ' Add balance to continue.' : ' Login or create an account to add balance.'}
                    </p>
                    <div class="flex gap-2">
                      <Show when={!store.user}>
                        <button
                          class="btn-win primary text-[10px]"
                          onClick={() => { setShowLimitError(false); setShowAuth(true) }}
                        >
                          LOGIN / REGISTER
                        </button>
                      </Show>
                      <Show when={store.user}>
                        <button class="btn-win primary text-[10px]">
                          ADD BALANCE
                        </button>
                      </Show>
                      <button
                        class="btn-win text-[10px]"
                        onClick={() => setShowLimitError(false)}
                      >
                        DISMISS
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Show>

          {/* Mobile-only: history below input */}
          <div class="2xl:hidden w-full mt-3">
            <div class="panel-inset p-2">
              {historySection()}
            </div>
          </div>

          {/* Mobile-only: footer */}
          <div class="2xl:hidden w-full mt-3 text-center">
            <div class="text-[10px] text-fg-muted font-heading">
              {store.stats.generated} generated
              <span class="mx-1">·</span>
              <a href="https://rotko.net" class="hover:text-accent">ROTKO</a>
              <span class="mx-1">·</span>
              <button onClick={() => setShowDocs(true)} class="hover:text-accent bg-transparent border-none font-heading text-[10px] text-fg-muted cursor-pointer p-0">DOCS</button>
            </div>
          </div>
        </main>

        {/* Right sidebar — lg+ only */}
        <aside class="hidden 2xl:flex 2xl:flex-col 2xl:w-72 3xl:w-80 border-l-2 border-edge bg-surface">
          <div class="p-3" data-voice-selector>
            <VoiceSelector
              voices={transformedVoices()}
              featured={['en-Mike_man', 'af_bella', 'am_adam', 'bf_emma']}
              selected={voice()}
              samplesBaseUrl={samplesBaseUrl()}
              onSelect={setVoice}
            />
          </div>

          <div class="flex-1 overflow-y-auto p-3 border-t border-edge-soft">
            {historySection()}
          </div>

          <div class="p-3 border-t border-edge-soft text-[10px] text-fg-muted font-heading">
            <span>{store.stats.generated} generated · {store.stats.chars.toLocaleString()} chars</span>
            <span class="mx-1">·</span>
            <a href="https://rotko.net" class="hover:text-accent">ROTKO</a>
            <span class="mx-1">·</span>
            <button onClick={() => setShowDocs(true)} class="hover:text-accent bg-transparent border-none font-heading text-[10px] text-fg-muted cursor-pointer p-0">DOCS</button>
          </div>
        </aside>
      </div>

      {/* Modals */}
      <Show when={showAuth()}>
        <Suspense fallback={
          <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div class="text-accent animate-pulse font-heading">LOADING...</div>
          </div>
        }>
          <AuthModal onClose={() => setShowAuth(false)} onLogin={onLogin} />
        </Suspense>
      </Show>

      <Show when={showWallet()}>
        <Suspense fallback={
          <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div class="text-accent animate-pulse font-heading">LOADING...</div>
          </div>
        }>
          <WalletModal onClose={() => setShowWallet(false)} onLogin={onLogin} />
        </Suspense>
      </Show>

      <Show when={showProfile()}>
        <Suspense fallback={
          <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div class="text-accent animate-pulse font-heading">LOADING...</div>
          </div>
        }>
          <ProfilePage onClose={() => setShowProfile(false)} />
        </Suspense>
      </Show>

      <Show when={showDocs()}>
        <Suspense fallback={
          <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div class="text-accent animate-pulse font-heading">LOADING...</div>
          </div>
        }>
          <DocsPage onClose={() => setShowDocs(false)} />
        </Suspense>
      </Show>

      <ToastContainer />
     </div>
    </div>
  )
}
