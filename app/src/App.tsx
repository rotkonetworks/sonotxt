import { createSignal, For, Show, onMount, lazy, Suspense, onCleanup, createMemo } from 'solid-js'
import { ToastContainer, showToast } from './components/Toast'

const API = import.meta.env.VITE_API_URL || 'https://api.sonotxt.com'

const AuthModal = lazy(() => import('./components/AuthModal'))

interface HistoryItem {
  text: string
  url: string
  duration: number
  date: string
  sourceUrl?: string
}

interface User {
  id: string
  nickname?: string
  email?: string
  balance: number
}

interface Voice {
  id: string
  name: string
  accent: string
  gender: string
  sample_url?: string
}

// All available voices organized by category
const ALL_VOICES: Record<string, Voice[]> = {
  'American Female': [
    { id: 'af_bella', name: 'Bella', accent: 'US', gender: 'F' },
    { id: 'af_nicole', name: 'Nicole', accent: 'US', gender: 'F' },
    { id: 'af_sarah', name: 'Sarah', accent: 'US', gender: 'F' },
    { id: 'af_sky', name: 'Sky', accent: 'US', gender: 'F' },
    { id: 'af_nova', name: 'Nova', accent: 'US', gender: 'F' },
    { id: 'af_river', name: 'River', accent: 'US', gender: 'F' },
  ],
  'American Male': [
    { id: 'am_adam', name: 'Adam', accent: 'US', gender: 'M' },
    { id: 'am_michael', name: 'Michael', accent: 'US', gender: 'M' },
    { id: 'am_eric', name: 'Eric', accent: 'US', gender: 'M' },
    { id: 'am_liam', name: 'Liam', accent: 'US', gender: 'M' },
  ],
  'British Female': [
    { id: 'bf_emma', name: 'Emma', accent: 'UK', gender: 'F' },
    { id: 'bf_alice', name: 'Alice', accent: 'UK', gender: 'F' },
    { id: 'bf_lily', name: 'Lily', accent: 'UK', gender: 'F' },
  ],
  'British Male': [
    { id: 'bm_george', name: 'George', accent: 'UK', gender: 'M' },
    { id: 'bm_daniel', name: 'Daniel', accent: 'UK', gender: 'M' },
    { id: 'bm_lewis', name: 'Lewis', accent: 'UK', gender: 'M' },
  ],
}

const FEATURED_VOICES = ['af_river', 'af_sarah', 'am_liam', 'am_eric', 'bf_lily', 'bm_lewis']

export default function App() {
  const [mode, setMode] = createSignal<'text' | 'url'>('text')
  const [text, setText] = createSignal('')
  const [urlInput, setUrlInput] = createSignal('')
  const [extractedTitle, setExtractedTitle] = createSignal('')
  const [voice, setVoice] = createSignal('af_river')
  const [loading, setLoading] = createSignal(false)
  const [extracting, setExtracting] = createSignal(false)
  const [status, setStatus] = createSignal('')
  const [audioUrl, setAudioUrl] = createSignal('')
  const [audioTitle, setAudioTitle] = createSignal('')
  const [audioDuration, setAudioDuration] = createSignal(0)
  const [currentTime, setCurrentTime] = createSignal(0)
  const [isPlaying, setIsPlaying] = createSignal(false)
  const [history, setHistory] = createSignal<HistoryItem[]>([])
  const [stats, setStats] = createSignal({ generated: 0, chars: 0 })
  const [freeRemaining, setFreeRemaining] = createSignal(1000)
  const [showAuth, setShowAuth] = createSignal(false)
  const [user, setUser] = createSignal<User | null>(null)
  const [dragover, setDragover] = createSignal(false)
  const [showAllVoices, setShowAllVoices] = createSignal(false)
  const [previewingVoice, setPreviewingVoice] = createSignal<string | null>(null)
  const [samplesBaseUrl, setSamplesBaseUrl] = createSignal('')
  const [showLimitError, setShowLimitError] = createSignal(false)
  const [historyFilter, setHistoryFilter] = createSignal('')
  const [isDragging, setIsDragging] = createSignal(false)

  let textareaRef: HTMLTextAreaElement | undefined
  let audioRef: HTMLAudioElement | undefined
  let previewAudioRef: HTMLAudioElement | undefined

  const featuredVoices = createMemo(() => {
    const all = Object.values(ALL_VOICES).flat()
    return all.filter(v => FEATURED_VOICES.includes(v.id))
  })

  const selectedVoiceName = createMemo(() => {
    const all = Object.values(ALL_VOICES).flat()
    const found = all.find(v => v.id === voice())
    return found?.name || voice()
  })

  const filteredHistory = createMemo(() => {
    const filter = historyFilter().toLowerCase().trim()
    if (!filter) return history()
    return history().filter(item => item.text.toLowerCase().includes(filter))
  })

  async function fetchVoices() {
    try {
      const res = await fetch(`${API}/api/voices`)
      const data = await res.json()
      if (data.samples_base_url) {
        setSamplesBaseUrl(data.samples_base_url)
      }
    } catch {}
  }

  function previewVoice(voiceId: string) {
    if (!samplesBaseUrl() || !previewAudioRef) return
    const url = `${samplesBaseUrl()}/${voiceId}.mp3`
    previewAudioRef.src = url
    previewAudioRef.play().catch(() => {})
    setPreviewingVoice(voiceId)
  }

  function stopPreview() {
    if (previewAudioRef) {
      previewAudioRef.pause()
      previewAudioRef.currentTime = 0
    }
    setPreviewingVoice(null)
  }

  onMount(() => {
    const h = localStorage.getItem('sonotxt_history')
    if (h) setHistory(JSON.parse(h))

    const s = localStorage.getItem('sonotxt_stats')
    if (s) setStats(JSON.parse(s))

    const token = localStorage.getItem('sonotxt_token')
    if (token) checkSession(token)

    fetchVoices()

    const handleKeydown = (e: KeyboardEvent) => {
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
        if (showAllVoices()) setShowAllVoices(false)
      }
    }
    document.addEventListener('keydown', handleKeydown)
    onCleanup(() => document.removeEventListener('keydown', handleKeydown))

    textareaRef?.focus()
  })

  async function checkSession(token: string) {
    try {
      const res = await fetch(`${API}/api/auth/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (res.ok) {
        const data = await res.json()
        setUser({ id: data.user_id, nickname: data.nickname, email: data.email, balance: data.balance })
      } else {
        localStorage.removeItem('sonotxt_token')
      }
    } catch {}
  }

  const charCount = () => text().length

  async function extractUrl() {
    const url = urlInput().trim()
    if (!url) return

    const fullUrl = url.startsWith('http') ? url : `https://${url}`

    setExtracting(true)
    setStatus('FETCHING...')

    try {
      const res = await fetch(`${API}/api/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: fullUrl }),
      })

      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Failed to extract')
      }

      const data = await res.json()
      setText(data.text)
      setExtractedTitle(data.title || '')
      setMode('text')
      setStatus('')
      showToast(`Extracted ${data.char_count} chars`, 'success')
    } catch (e: any) {
      showToast(e.message, 'error')
      setStatus('ERROR')
    }

    setExtracting(false)
  }

  async function generate() {
    const t = text().trim()
    if (!t) return

    if (!user() && t.length > 1000) {
      showToast('Free tier limited to 1000 chars', 'error')
      return
    }

    setLoading(true)
    setStatus('CONNECTING...')
    setAudioUrl('')
    setShowLimitError(false)

    try {
      const res = await fetch(`${API}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t, voice: voice() }),
      })

      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        // Check if it's a free tier limit error
        if (e.error?.includes('Free tier limit') || e.error?.includes('limit exceeded')) {
          setShowLimitError(true)
          setStatus('LIMIT')
          setLoading(false)
          return
        }
        throw new Error(e.error || 'Request failed')
      }

      const { job_id, free_tier_remaining } = await res.json()
      if (free_tier_remaining !== undefined) setFreeRemaining(free_tier_remaining)

      const result = await pollJob(job_id)
      setAudioUrl(result.url)
      setAudioTitle(t.slice(0, 60) + (t.length > 60 ? '...' : ''))
      setAudioDuration(result.duration_seconds)
      setStatus('READY')
      // Autoplay
      setTimeout(() => audioRef?.play(), 100)

      addToHistory(t, result.url, result.duration_seconds)
      setStats(s => {
        const updated = { generated: s.generated + 1, chars: s.chars + t.length }
        localStorage.setItem('sonotxt_stats', JSON.stringify(updated))
        return updated
      })
    } catch (e: any) {
      showToast(e.message, 'error')
      setStatus('ERROR')
    }

    setLoading(false)
  }

  async function pollJob(jobId: string) {
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 1000))
      const res = await fetch(`${API}/api/status?job_id=${jobId}`)
      const data = await res.json()

      if (data.status === 'Complete') return data
      if (data.status === 'Failed') throw new Error(data.reason || 'Generation failed')

      setStatus(data.status.toUpperCase() + '...')
    }
    throw new Error('Timeout')
  }

  function addToHistory(t: string, url: string, duration: number) {
    setHistory(h => {
      const updated = [
        {
          text: t.slice(0, 100),
          url,
          duration,
          date: new Date().toISOString(),
          sourceUrl: urlInput() || undefined
        },
        ...h.slice(0, 9),
      ]
      localStorage.setItem('sonotxt_history', JSON.stringify(updated))
      return updated
    })
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

  function onLogin(u: User, token: string) {
    setUser(u)
    localStorage.setItem('sonotxt_token', token)
    setShowAuth(false)
    showToast(`Welcome, ${u.nickname || u.email}!`, 'success')
  }

  function logout() {
    setUser(null)
    localStorage.removeItem('sonotxt_token')
    showToast('Logged out', 'success')
  }

  function formatTime(s: number) {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  function togglePlay() {
    if (!audioRef) return
    if (audioRef.paused) audioRef.play()
    else audioRef.pause()
  }

  function stop() {
    if (!audioRef) return
    audioRef.pause()
    audioRef.currentTime = 0
    setIsPlaying(false)
  }

  let progressTrackRef: HTMLDivElement | undefined

  function seekFromEvent(e: MouseEvent) {
    if (!audioRef || !progressTrackRef) return
    const rect = progressTrackRef.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    audioRef.currentTime = pct * audioDuration()
  }

  function handleProgressMouseDown(e: MouseEvent) {
    if (!audioUrl()) return
    setIsDragging(true)
    seekFromEvent(e)

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging()) seekFromEvent(e)
    }
    const handleMouseUp = () => {
      setIsDragging(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  const progressPct = () => audioDuration() ? (currentTime() / audioDuration()) * 100 : 0

  function loadAndPlay(url: string, title: string, duration: number) {
    setAudioUrl(url)
    setAudioTitle(title)
    setAudioDuration(duration)
    setTimeout(() => audioRef?.play(), 100)
  }

  async function downloadAudio() {
    const url = audioUrl()
    if (!url) return
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `sonotxt-${Date.now()}.mp3`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch {
      showToast('Download failed', 'error')
    }
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

  return (
    <div class="min-h-screen flex flex-col items-center justify-center p-2 sm:p-4">
      {/* Hidden preview audio */}
      <audio
        ref={previewAudioRef}
        onEnded={() => setPreviewingVoice(null)}
        class="hidden"
      />

      {/* Main panel - responsive width */}
      <div class="panel w-full max-w-[95vw] sm:max-w-xl">
        {/* Title bar - draggable */}
        <div class="titlebar cursor-move select-none">
          {/* Left: Window controls */}
          <div class="flex gap-0.5">
            <button class="w-3 h-3 bg-lcd-red/80 hover:bg-lcd-red" title="Close" />
            <button class="w-3 h-3 bg-lcd-yellow/80 hover:bg-lcd-yellow" title="Minimize" />
            <button class="w-3 h-3 bg-lcd-green/80 hover:bg-lcd-green" title="Maximize" />
          </div>

          {/* Center: Logo + drag area */}
          <div class="flex-1 flex items-center justify-center gap-2">
            <div class="i-mdi-waveform text-accent w-4 h-4" />
            <span class="text-text-bright">SONOTXT</span>
            <Show when={user()}>
              <span class="text-text-dim hidden sm:inline">-</span>
              <span class="text-lcd-green text-xs truncate max-w-24 hidden sm:inline">
                {user()!.nickname || user()!.email?.split('@')[0]}
              </span>
            </Show>
          </div>

          {/* Right: Balance + Login/Logout */}
          <div class="flex items-center gap-2">
            <span class="text-lcd-yellow text-xs">
              {user() ? `$${user()!.balance.toFixed(2)}` : `${freeRemaining()}`}
            </span>
            <Show when={user()} fallback={
              <button onClick={() => setShowAuth(true)} class="btn-win text-xs px-2" title="Login">
                <span class="i-mdi-login w-3 h-3" />
              </button>
            }>
              <button onClick={logout} class="btn-win text-xs px-2" title="Logout">
                <span class="i-mdi-logout w-3 h-3" />
              </button>
            </Show>
          </div>
        </div>

        {/* LCD Display */}
        <div class="lcd p-2 sm:p-3 m-2">
          <div class="flex justify-center items-center mb-2 text-[10px] sm:text-xs">
            <Show when={loading() || extracting()} fallback={
              <Show when={audioUrl()} fallback={
                <span class="text-lcd-green opacity-60">READY</span>
              }>
                <span class="text-lcd-yellow">{isPlaying() ? 'PLAYING' : 'PAUSED'}</span>
              </Show>
            }>
              <span class="animate-pulse">{status()}</span>
            </Show>
          </div>

          {/* Extracted title */}
          <Show when={extractedTitle()}>
            <div class="text-[10px] sm:text-xs text-lcd-green mb-2 truncate" title={extractedTitle()}>
              {extractedTitle()}
            </div>
          </Show>

          {/* Now playing title */}
          <Show when={audioTitle()}>
            <div class="text-[10px] sm:text-xs text-lcd-green mb-2 truncate text-center" title={audioTitle()}>
              {audioTitle()}
            </div>
          </Show>

          {/* Progress bar - always visible, draggable */}
          <div class="flex items-center gap-2 sm:gap-3 mb-2">
            <span class="text-[10px] sm:text-xs w-8 sm:w-10 text-lcd-pink font-mono">{formatTime(currentTime())}</span>
            <div
              ref={progressTrackRef}
              class={`flex-1 h-5 relative select-none ${audioUrl() ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
              style={{
                background: 'linear-gradient(180deg, #010409 0%, #0d1117 100%)',
                border: '2px solid',
                'border-color': '#010409 #30363d #30363d #010409',
                'box-shadow': 'inset 0 2px 4px rgba(0,0,0,0.5)',
              }}
              onMouseDown={handleProgressMouseDown}
            >
              {/* Fill */}
              <div
                style={{
                  width: `${progressPct()}%`,
                  height: '100%',
                  background: 'linear-gradient(180deg, #f472b6 0%, #ec4899 30%, #be185d 70%, #9f1239 100%)',
                  'box-shadow': '0 0 8px rgba(236, 72, 153, 0.6), inset 0 1px 0 rgba(255,255,255,0.2)',
                  transition: isDragging() ? 'none' : 'width 0.1s ease-out',
                }}
              />
              {/* Draggable thumb */}
              <Show when={audioUrl()}>
                <div
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: `calc(${progressPct()}% - 6px)`,
                    transform: 'translateY(-50%)',
                    width: '12px',
                    height: '18px',
                    background: 'linear-gradient(180deg, #f472b6 0%, #be185d 100%)',
                    border: '1px solid',
                    'border-color': '#f9a8d4 #9f1239 #9f1239 #f9a8d4',
                    'box-shadow': '0 2px 4px rgba(0,0,0,0.3)',
                    cursor: 'grab',
                  }}
                />
              </Show>
            </div>
            <span class="text-[10px] sm:text-xs w-8 sm:w-10 text-right text-lcd-pink font-mono">{formatTime(audioDuration())}</span>
          </div>

          {/* Transport controls - always visible */}
          <div class="flex justify-center gap-1 mb-2">
            <button class="btn-win p-1 sm:p-2" onClick={() => audioRef && (audioRef.currentTime -= 10)} title="Back 10s" disabled={!audioUrl()}>
              <span class="i-mdi-rewind-10 w-3 h-3 sm:w-4 sm:h-4" />
            </button>
            <button class="btn-win p-1 sm:p-2" onClick={stop} title="Stop" disabled={!audioUrl()}>
              <span class="i-mdi-stop w-3 h-3 sm:w-4 sm:h-4" />
            </button>
            <button class="btn-win primary p-1 sm:p-2" onClick={togglePlay} title={isPlaying() ? 'Pause' : 'Play'} disabled={!audioUrl()}>
              <span class={isPlaying() ? 'i-mdi-pause w-4 h-4 sm:w-5 sm:h-5' : 'i-mdi-play w-4 h-4 sm:w-5 sm:h-5'} />
            </button>
            <button class="btn-win p-1 sm:p-2" onClick={() => audioRef && (audioRef.currentTime += 10)} title="Fwd 10s" disabled={!audioUrl()}>
              <span class="i-mdi-fast-forward-10 w-3 h-3 sm:w-4 sm:h-4" />
            </button>
            <div class="w-px h-4 bg-border-light mx-1" />
            <button class="btn-win p-1 sm:p-2" onClick={downloadAudio} title="Download" disabled={!audioUrl()}>
              <span class="i-mdi-download w-3 h-3 sm:w-4 sm:h-4" />
            </button>
            <button class="btn-win p-1 sm:p-2" onClick={shareAudio} title="Share" disabled={!audioUrl()}>
              <span class="i-mdi-share-variant w-3 h-3 sm:w-4 sm:h-4" />
            </button>
          </div>

          {/* Hidden audio element */}
          <audio
            ref={audioRef}
            src={audioUrl()}
            onTimeUpdate={() => setCurrentTime(audioRef?.currentTime || 0)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => { setIsPlaying(false); setCurrentTime(0) }}
            onLoadedMetadata={() => setAudioDuration(audioRef?.duration || 0)}
            class="hidden"
          />
        </div>

        {/* Mode tabs */}
        <div class="px-2 pb-2">
          <div class="flex gap-1">
            <button
              class={`btn-win text-[10px] sm:text-xs flex-1 ${mode() === 'text' ? 'primary' : ''}`}
              onClick={() => setMode('text')}
            >
              <span class="i-mdi-text w-3 h-3 mr-1" />
              TEXT
            </button>
            <button
              class={`btn-win text-[10px] sm:text-xs flex-1 ${mode() === 'url' ? 'primary' : ''}`}
              onClick={() => setMode('url')}
            >
              <span class="i-mdi-web w-3 h-3 mr-1" />
              URL
            </button>
          </div>
        </div>

        {/* Voice selector */}
        <div class="px-2 pb-2">
          <div class="panel-inset p-2">
            <div class="flex justify-between items-center mb-2">
              <div class="text-[10px] sm:text-xs text-text-dim uppercase tracking-wider">
                Voice: <span class="text-lcd-green">{selectedVoiceName()}</span>
              </div>
              <button
                class="btn-win text-[10px]"
                onClick={() => setShowAllVoices(!showAllVoices())}
              >
                {showAllVoices() ? 'LESS' : 'MORE'}
              </button>
            </div>

            {/* Featured voices */}
            <div class="flex flex-wrap gap-1">
              <For each={featuredVoices()}>{v => (
                <button
                  class={`btn-win text-[10px] sm:text-xs relative ${voice() === v.id ? 'primary' : ''}`}
                  onClick={() => setVoice(v.id)}
                  onMouseEnter={() => previewVoice(v.id)}
                  onMouseLeave={stopPreview}
                >
                  <Show when={previewingVoice() === v.id}>
                    <span class="absolute -top-1 -right-1 w-2 h-2 bg-lcd-green rounded-full animate-pulse" />
                  </Show>
                  {v.name}
                </button>
              )}</For>
            </div>

            {/* All voices expandable */}
            <Show when={showAllVoices()}>
              <div class="mt-3 pt-3 border-t border-border-dark space-y-3">
                <For each={Object.entries(ALL_VOICES)}>{([category, voices]) => (
                  <div>
                    <div class="text-[9px] sm:text-[10px] text-text-dim mb-1 uppercase">{category}</div>
                    <div class="flex flex-wrap gap-1">
                      <For each={voices}>{v => (
                        <button
                          class={`btn-win text-[10px] sm:text-xs relative ${voice() === v.id ? 'primary' : ''}`}
                          onClick={() => setVoice(v.id)}
                          onMouseEnter={() => previewVoice(v.id)}
                          onMouseLeave={stopPreview}
                        >
                          <Show when={previewingVoice() === v.id}>
                            <span class="absolute -top-1 -right-1 w-2 h-2 bg-lcd-green rounded-full animate-pulse" />
                          </Show>
                          {v.name}
                        </button>
                      )}</For>
                    </div>
                  </div>
                )}</For>
              </div>
            </Show>
          </div>
        </div>

        {/* URL input */}
        <Show when={mode() === 'url'}>
          <div class="px-2 pb-2">
            <div class="panel-inset">
              <div class="flex">
                <input
                  type="text"
                  class="flex-1 px-2 sm:px-3 py-2 sm:py-3 bg-transparent text-lcd-green font-mono text-xs sm:text-sm outline-none placeholder:text-text-dim"
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
            </div>
          </div>
        </Show>

        {/* Text input */}
        <Show when={mode() === 'text'}>
          <div class="px-2 pb-2">
            <div
              class={`panel-inset ${dragover() ? 'border-accent' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragover(true) }}
              onDragLeave={() => setDragover(false)}
              onDrop={handleDrop}
            >
              <textarea
                ref={textareaRef}
                class="w-full min-h-24 sm:min-h-32 p-2 sm:p-3 bg-transparent text-lcd-green font-mono text-xs sm:text-sm resize-y outline-none placeholder:text-text-dim"
                placeholder="Paste or type text here..."
                value={text()}
                onInput={(e) => setText(e.currentTarget.value)}
              />
              <div class="flex justify-between items-center px-2 sm:px-3 py-2 border-t border-border-dark bg-bg-mid">
                <span class={`text-[10px] sm:text-xs font-mono ${charCount() > 1000 ? 'text-lcd-red' : charCount() > 800 ? 'text-lcd-yellow' : 'text-lcd-green'}`}>
                  {charCount().toLocaleString()} chars
                </span>
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
        </Show>

        {/* Free tier limit error */}
        <Show when={showLimitError()}>
          <div class="px-2 pb-2">
            <div
              style={{
                background: 'linear-gradient(180deg, #1f1315 0%, #170a0c 100%)',
                border: '1px solid',
                'border-color': '#7f1d1d #450a0a #450a0a #7f1d1d',
                padding: '12px',
              }}
            >
              <div class="flex items-start gap-3">
                <span class="i-mdi-alert-circle w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div class="flex-1">
                  <div class="text-red-300 text-xs font-semibold mb-1">FREE TIER LIMIT REACHED</div>
                  <p class="text-red-200/70 text-[10px] mb-3">
                    You've used your daily free quota ({freeRemaining()} chars remaining).
                    {user() ? ' Add balance to continue.' : ' Login or create an account to add balance.'}
                  </p>
                  <div class="flex gap-2">
                    <Show when={!user()}>
                      <button
                        class="btn-win primary text-[10px]"
                        onClick={() => { setShowLimitError(false); setShowAuth(true) }}
                      >
                        LOGIN / REGISTER
                      </button>
                    </Show>
                    <Show when={user()}>
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

        {/* History */}
        <Show when={history().length > 0}>
          <div class="px-2 pb-2">
            <div class="panel-inset p-2">
              <div class="flex items-center gap-2 mb-2">
                <span class="text-[10px] sm:text-xs text-text-dim uppercase tracking-wider">Recent</span>
                <div class="flex-1" />
                <div
                  style={{
                    background: '#0d1117',
                    border: '1px solid',
                    'border-color': '#010409 #21262d #21262d #010409',
                  }}
                >
                  <input
                    type="text"
                    class="w-20 sm:w-28 px-2 py-1 bg-transparent text-lcd-pink font-mono text-[10px] outline-none placeholder:text-text-dim"
                    placeholder="filter..."
                    value={historyFilter()}
                    onInput={(e) => setHistoryFilter(e.currentTarget.value)}
                  />
                </div>
              </div>
              <div class="max-h-28 sm:max-h-36 overflow-y-auto">
              <For each={filteredHistory().slice(0, 10)}>{item => {
                const isSelected = () => audioUrl() === item.url
                return (
                  <div
                    class={`flex items-center gap-2 py-1 px-1 sm:px-2 text-[10px] sm:text-xs group ${
                      isSelected() ? 'bg-accent/20 text-lcd-pink' : 'hover:bg-bg-light text-text'
                    }`}
                  >
                    <button
                      class="flex-shrink-0 cursor-pointer bg-transparent border-none p-0"
                      onClick={() => loadAndPlay(item.url, item.text, item.duration)}
                      title="Play"
                    >
                      <span class={`w-3 h-3 block ${
                        isSelected()
                          ? (isPlaying() ? 'i-mdi-volume-high text-lcd-pink animate-pulse' : 'i-mdi-pause text-lcd-pink')
                          : 'i-mdi-play text-lcd-green opacity-0 group-hover:opacity-100'
                      }`} />
                    </button>
                    <span
                      class="flex-1 truncate cursor-pointer"
                      onClick={() => loadAndPlay(item.url, item.text, item.duration)}
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
                      <span class="i-mdi-pencil w-3 h-3 text-lcd-yellow hover:text-lcd-green" />
                    </button>
                    <span class={`flex-shrink-0 ${isSelected() ? 'text-lcd-pink' : 'text-text-dim'}`}>{Math.round(item.duration)}s</span>
                  </div>
                )
              }}</For>
              </div>
            </div>
          </div>
        </Show>

        {/* Footer stats */}
        <div class="flex justify-center gap-4 sm:gap-6 py-2 sm:py-3 border-t border-border-dark text-[10px] sm:text-xs text-text-dim">
          <span>{stats().generated} generated</span>
          <span>{stats().chars.toLocaleString()} chars</span>
        </div>
      </div>

      {/* Credit */}
      <div class="mt-3 sm:mt-4 text-[10px] sm:text-xs text-text-dim">
        <a href="https://rotko.net" class="hover:text-lcd-green">ROTKO NETWORKS</a>
        {' · '}
        <a href="/embed.js" class="hover:text-lcd-green">EMBED</a>
      </div>

      {/* Auth Modal */}
      <Show when={showAuth()}>
        <Suspense fallback={
          <div class="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
            <div class="text-lcd-green animate-pulse">LOADING...</div>
          </div>
        }>
          <AuthModal onClose={() => setShowAuth(false)} onLogin={onLogin} />
        </Suspense>
      </Show>

      <ToastContainer />
    </div>
  )
}
