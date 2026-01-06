import { createSignal, For, Show, onMount, lazy, Suspense, onCleanup, createMemo, createResource } from 'solid-js'
import { ToastContainer, showToast } from './components/Toast'
import { watchJobStatus } from './lib/jobStatus'
import { useStore } from './lib/store'
import * as api from './lib/api'
import type { User } from './lib/api'
import ProfileDropdown from './components/ProfileDropdown'
import type { StreamChunk } from './lib/teeClient'

// Fetch voices with createResource - auto-cached, suspense-ready
const fetchVoicesData = async () => {
  try {
    const data = await api.fetchVoices()
    return data
  } catch {
    return { voices: {}, samples_base_url: '' }
  }
}

const AuthModal = lazy(() => import('./components/AuthModal'))
const ProfilePage = lazy(() => import('./components/ProfilePage'))
const DocsPage = lazy(() => import('./components/DocsPage'))

interface Voice {
  id: string
  name: string
  accent: string
  gender: string
  markup: number // multiplier over deepinfra base ($0.80/M)
}

// deepinfra kokoro base: $0.80/M chars = $0.0000008/char
const DEEPINFRA_BASE = 0.0000008
const US_MARKUP = 2.0   // $1.60/M chars
const UK_MARKUP = 2.7   // $2.16/M (2x * 1.35 gbp/usd)

// All voices in a flat list for jukebox navigation
const VOICES: Voice[] = [
  // American Female
  { id: 'af_bella', name: 'Bella', accent: 'US', gender: 'F', markup: US_MARKUP },
  { id: 'af_nicole', name: 'Nicole', accent: 'US', gender: 'F', markup: US_MARKUP },
  { id: 'af_sarah', name: 'Sarah', accent: 'US', gender: 'F', markup: US_MARKUP },
  { id: 'af_sky', name: 'Sky', accent: 'US', gender: 'F', markup: US_MARKUP },
  { id: 'af_nova', name: 'Nova', accent: 'US', gender: 'F', markup: US_MARKUP },
  { id: 'af_river', name: 'River', accent: 'US', gender: 'F', markup: US_MARKUP },
  // American Male
  { id: 'am_adam', name: 'Adam', accent: 'US', gender: 'M', markup: US_MARKUP },
  { id: 'am_michael', name: 'Michael', accent: 'US', gender: 'M', markup: US_MARKUP },
  { id: 'am_eric', name: 'Eric', accent: 'US', gender: 'M', markup: US_MARKUP },
  { id: 'am_liam', name: 'Liam', accent: 'US', gender: 'M', markup: US_MARKUP },
  // British Female - gbp markup
  { id: 'bf_emma', name: 'Emma', accent: 'UK', gender: 'F', markup: UK_MARKUP },
  { id: 'bf_alice', name: 'Alice', accent: 'UK', gender: 'F', markup: UK_MARKUP },
  { id: 'bf_lily', name: 'Lily', accent: 'UK', gender: 'F', markup: UK_MARKUP },
  // British Male - gbp markup
  { id: 'bm_george', name: 'George', accent: 'UK', gender: 'M', markup: UK_MARKUP },
  { id: 'bm_daniel', name: 'Daniel', accent: 'UK', gender: 'M', markup: UK_MARKUP },
  { id: 'bm_lewis', name: 'Lewis', accent: 'UK', gender: 'M', markup: UK_MARKUP },
]

export default function App() {
  // Use global store for user/history/stats
  const { state: store, actions } = useStore()

  // Voices resource - auto-fetched, cached
  const [voicesData] = createResource(fetchVoicesData)

  // Local UI state
  const [mode, setMode] = createSignal<'text' | 'url'>('text')
  const [text, setText] = createSignal('')
  const [urlInput, setUrlInput] = createSignal('')
  const [extractedTitle, setExtractedTitle] = createSignal('')
  const [voice, setVoice] = createSignal('af_river')
  const [loading, setLoading] = createSignal(false)
  const [extracting, setExtracting] = createSignal(false)
  const [status, setStatus] = createSignal('')
  const [audioUrl, setAudioUrl] = createSignal('')
  const [currentJobId, setCurrentJobId] = createSignal('')
  const [audioTitle, setAudioTitle] = createSignal('')
  const [audioDuration, setAudioDuration] = createSignal(0)
  const [currentTime, setCurrentTime] = createSignal(0)
  const [isPlaying, setIsPlaying] = createSignal(false)
  const [dragover, setDragover] = createSignal(false)
  const [showLimitError, setShowLimitError] = createSignal(false)
  const [historyFilter, setHistoryFilter] = createSignal('')
  const [isDragging, setIsDragging] = createSignal(false)
  const [seekPreviewPct, setSeekPreviewPct] = createSignal<number | null>(null) // null = not seeking
  const [hoverPct, setHoverPct] = createSignal<number | null>(null) // for tooltip on hover
  const [showAuth, setShowAuth] = createSignal(false)
  const [showProfile, setShowProfile] = createSignal(false)
  const [showDocs, setShowDocs] = createSignal(false)

  let textareaRef: HTMLTextAreaElement | undefined
  let audioRef: HTMLAudioElement | undefined
  let previewAudioRef: HTMLAudioElement | undefined

  // Derived: samples base URL from resource
  const samplesBaseUrl = () => voicesData()?.samples_base_url || ''

  // Derived: current voice index and data
  const voiceIndex = createMemo(() => VOICES.findIndex(v => v.id === voice()))
  const currentVoice = createMemo(() => VOICES[voiceIndex()] || VOICES[0])

  // Derived: filtered history from store
  const filteredHistory = createMemo(() => {
    const filter = historyFilter().toLowerCase().trim()
    if (!filter) return store.history
    return store.history.filter(item => item.text.toLowerCase().includes(filter))
  })

  // Play sample for voice
  function playSample(voiceId: string) {
    if (!samplesBaseUrl() || !previewAudioRef) return
    const url = `${samplesBaseUrl()}/${voiceId}.mp3`
    previewAudioRef.src = url
    previewAudioRef.play().catch(() => {})
  }

  // Jukebox navigation
  function prevVoice() {
    const idx = voiceIndex()
    const newIdx = idx <= 0 ? VOICES.length - 1 : idx - 1
    const newVoice = VOICES[newIdx]
    setVoice(newVoice.id)
    playSample(newVoice.id)
  }

  function nextVoice() {
    const idx = voiceIndex()
    const newIdx = idx >= VOICES.length - 1 ? 0 : idx + 1
    const newVoice = VOICES[newIdx]
    setVoice(newVoice.id)
    playSample(newVoice.id)
  }

  function selectVoice(voiceId: string) {
    setVoice(voiceId)
    playSample(voiceId)
  }

  onMount(() => {
    // Check for existing session token
    const savedToken = localStorage.getItem('sonotxt_token')
    if (savedToken) checkSession(savedToken)

    const handleKeydown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'

      // Ctrl+Enter to generate
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (mode() === 'url' && urlInput().trim() && !extracting()) {
          extractUrl()
        } else if (text().trim() && !loading()) {
          generate()
        }
      }

      // Escape to close modals
      if (e.key === 'Escape') {
        if (showAuth()) setShowAuth(false)
      }

      // Voice selection with number keys (when not typing)
      if (!isInput) {
        const num = parseInt(e.key)
        if (!isNaN(num)) {
          e.preventDefault()
          // 1-9 = voices 0-8, 0 = voice 9
          const idx = num === 0 ? 9 : num - 1
          if (idx < VOICES.length) {
            selectVoice(VOICES[idx].id)
          }
        }
      }

      // Player controls (only when not typing)
      if (!isInput && audioUrl()) {
        if (e.key === ' ') {
          e.preventDefault()
          togglePlay()
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault()
          seekByPercent(-10)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          seekByPercent(10)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          if (audioRef) audioRef.volume = Math.min(1, audioRef.volume + 0.1)
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          if (audioRef) audioRef.volume = Math.max(0, audioRef.volume - 0.1)
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
        { id: data.user_id, nickname: data.nickname, email: data.email, balance: data.balance },
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

      // Combine chunks into single buffer
      const combined = new Uint8Array(totalBytes)
      let offset = 0
      for (const chunk of audioChunks) {
        combined.set(chunk, offset)
        offset += chunk.length
      }

      // Create blob URL for playback
      const blob = new Blob([combined], { type: 'audio/opus' })
      const blobUrl = URL.createObjectURL(blob)

      setAudioUrl(blobUrl)
      setCurrentJobId('')
      setAudioTitle(t.slice(0, 60) + (t.length > 60 ? '...' : ''))
      setStatus('READY')
      setTimeout(() => audioRef?.play(), 100)

      // Add to local history (no server-side tracking for private mode)
      actions.addToHistory({
        text: t.slice(0, 100),
        url: blobUrl,
        duration: 0, // Duration calculated after decode
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

    // Use TEE if connected
    if (store.tee.connected) {
      return generatePrivate()
    }

    if (!store.user && t.length > 1000) {
      showToast('Free tier limited to 1000 chars', 'error')
      return
    }

    // Cancel any existing job watch
    cancelJobWatch?.()

    setLoading(true)
    setStatus('CONNECTING...')
    setAudioUrl('')
    setShowLimitError(false)

    try {
      const result = await api.submitTts({ text: t, voice: voice() })
      const { job_id, free_tier_remaining } = result
      if (free_tier_remaining !== undefined) actions.setFreeRemaining(free_tier_remaining)

      // Use WebSocket with API fallback
      await new Promise<void>((resolve, reject) => {
        cancelJobWatch = watchJobStatus(
          job_id,
          (result) => {
            if (result.status === 'Complete' && result.url) {
              setAudioUrl(result.url)
              setCurrentJobId(job_id)
              setAudioTitle(t.slice(0, 60) + (t.length > 60 ? '...' : ''))
              setAudioDuration(result.duration_seconds || 0)
              setStatus('READY')
              setTimeout(() => audioRef?.play(), 100)

              // Update store (persists automatically, increments stats)
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
    showToast(`Welcome, ${u.nickname || u.email}!`, 'success')
  }

  function logout() {
    actions.logout()
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

  // Seek by percentage (for buttons and keyboard)
  function seekByPercent(deltaPct: number) {
    if (!audioRef || !audioDuration()) return
    const deltaTime = (deltaPct / 100) * audioDuration()
    audioRef.currentTime = Math.max(0, Math.min(audioDuration(), audioRef.currentTime + deltaTime))
    setCurrentTime(audioRef.currentTime)
  }

  // Smooth progress updates using requestAnimationFrame
  let rafId: number | null = null

  function startProgressAnimation() {
    function update() {
      if (audioRef && !audioRef.paused) {
        setCurrentTime(audioRef.currentTime)
        rafId = requestAnimationFrame(update)
      }
    }
    rafId = requestAnimationFrame(update)
  }

  function stopProgressAnimation() {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  let progressTrackRef: HTMLDivElement | undefined

  // Get percentage from mouse/touch event
  function getPctFromEvent(e: MouseEvent | TouchEvent): number {
    if (!progressTrackRef) return 0
    const rect = progressTrackRef.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX : e.clientX
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * 100
  }

  // Actually seek the audio (only called on release)
  function seekToPercent(pct: number) {
    if (!audioRef) return
    const newTime = (pct / 100) * audioDuration()
    audioRef.currentTime = newTime
    setCurrentTime(newTime)
  }

  function handleProgressMouseDown(e: MouseEvent) {
    if (!audioUrl()) return
    e.preventDefault()
    const pct = getPctFromEvent(e)
    setIsDragging(true)
    setSeekPreviewPct(pct)

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging()) return
      const pct = getPctFromEvent(e)
      setSeekPreviewPct(pct)
    }

    const handleMouseUp = (e: MouseEvent) => {
      const finalPct = getPctFromEvent(e)
      seekToPercent(finalPct)
      setIsDragging(false)
      setSeekPreviewPct(null)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  function handleProgressTouchStart(e: TouchEvent) {
    if (!audioUrl()) return
    e.preventDefault()
    const pct = getPctFromEvent(e)
    setIsDragging(true)
    setSeekPreviewPct(pct)
  }

  function handleProgressTouchMove(e: TouchEvent) {
    if (!isDragging()) return
    e.preventDefault()
    const pct = getPctFromEvent(e)
    setSeekPreviewPct(pct)
  }

  function handleProgressTouchEnd(e: TouchEvent) {
    if (!isDragging()) return
    e.preventDefault()
    const pct = seekPreviewPct() ?? 0
    seekToPercent(pct)
    setIsDragging(false)
    setSeekPreviewPct(null)
  }

  function handleProgressHover(e: MouseEvent) {
    if (isDragging()) return
    const pct = getPctFromEvent(e)
    setHoverPct(pct)
  }

  function handleProgressLeave() {
    if (!isDragging()) setHoverPct(null)
  }

  const progressPct = () => audioDuration() ? (currentTime() / audioDuration()) * 100 : 0

  function loadAndPlay(url: string, title: string, duration: number, jobId?: string) {
    setAudioUrl(url)
    setCurrentJobId(jobId || '')
    setAudioTitle(title)
    setAudioDuration(duration)
    setTimeout(() => audioRef?.play(), 100)
  }

  function downloadAudio() {
    const jobId = currentJobId()
    if (!jobId) return
    // use api proxy which sets Content-Disposition: attachment
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

  return (
    <div class="min-h-screen flex flex-col items-center justify-center p-2 sm:p-4">
      {/* Hidden preview audio */}
      <audio
        ref={previewAudioRef}
        class="hidden"
      />

      {/* Main panel - responsive width with horizontal resize on desktop */}
      <div class="panel w-full max-w-[95vw] sm:max-w-xl lg:max-w-4xl xl:max-w-6xl lg:resize-x lg:overflow-auto" style={{ "min-width": "320px" }}>
        {/* Title bar */}
        <div class="titlebar cursor-move select-none">
          {/* Left: Window controls */}
          <div class="flex gap-0.5 w-20">
            <button class="w-3 h-3 bg-lcd-red/80 hover:bg-lcd-red" title="Close" />
            <button class="w-3 h-3 bg-lcd-yellow/80 hover:bg-lcd-yellow" title="Minimize" />
            <button class="w-3 h-3 bg-lcd-green/80 hover:bg-lcd-green" title="Maximize" />
          </div>

          {/* Center: Logo */}
          <div class="flex-1 flex items-center justify-center gap-2">
            <div class="i-mdi-waveform text-accent w-4 h-4" />
            <span class="text-text-bright font-medium">SONOTXT</span>
            <Show when={store.tee.connected}>
              <span class="text-[9px] px-1.5 py-0.5 bg-purple-600/30 text-purple-300 border border-purple-500/50 rounded"
                title={`TEE: ${store.tee.attestation?.teeType || 'Connected'}`}
              >
                <span class="i-mdi-shield-lock w-2.5 h-2.5 mr-0.5" />
                PRIVATE
              </span>
            </Show>
          </div>

          {/* Right: Free tier counter or Profile dropdown */}
          <div class="flex items-center justify-end gap-2 w-20 sm:w-32 lg:w-40">
            <Show when={store.user} fallback={
              <>
                <span class="text-[10px] text-text-dim hidden sm:inline">FREE</span>
                <span class="text-xs text-lcd-green font-mono">{store.freeRemaining}</span>
                <button onClick={() => setShowAuth(true)} class="btn-win text-xs px-2 py-1" title="Login">
                  <span class="i-mdi-account-plus w-3 h-3" />
                </button>
              </>
            }>
              <ProfileDropdown
                onLogout={logout}
                onShowProfile={() => setShowProfile(true)}
              />
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

          {/* Modern Player - SoundCloud style */}
          <div class="flex items-center gap-3 mb-3">
            {/* Play/Pause button */}
            <button
              class={`w-10 h-10 sm:w-12 sm:h-12 rounded-full flex items-center justify-center transition-all ${
                audioUrl()
                  ? 'bg-accent hover:bg-accent/80 text-white cursor-pointer'
                  : 'bg-bg-light text-text-dim cursor-not-allowed'
              }`}
              onClick={togglePlay}
              disabled={!audioUrl()}
            >
              <span class={`${isPlaying() ? 'i-mdi-pause' : 'i-mdi-play'} w-5 h-5 sm:w-6 sm:h-6`} />
            </button>

            {/* Waveform/Progress area */}
            <div class="flex-1 flex flex-col gap-1">
              {/* Progress bar */}
              <div
                ref={progressTrackRef}
                class={`h-8 sm:h-10 relative select-none rounded ${audioUrl() ? 'cursor-pointer' : 'opacity-40'}`}
                style={{ background: '#1a1f26' }}
                onMouseDown={handleProgressMouseDown}
                onMouseMove={handleProgressHover}
                onMouseLeave={handleProgressLeave}
                onTouchStart={handleProgressTouchStart}
                onTouchMove={handleProgressTouchMove}
                onTouchEnd={handleProgressTouchEnd}
              >
                {/* Waveform placeholder - grey bars */}
                <div class="absolute inset-0 flex items-end justify-around px-1 opacity-30">
                  <For each={Array(40).fill(0)}>{(_, i) => (
                    <div
                      class="w-1 bg-text-dim rounded-t"
                      style={{ height: `${30 + Math.sin(i() * 0.5) * 25 + Math.random() * 20}%` }}
                    />
                  )}</For>
                </div>

                {/* Played portion overlay */}
                <div
                  class="absolute inset-y-0 left-0 overflow-hidden rounded-l"
                  style={{ width: `${seekPreviewPct() ?? progressPct()}%` }}
                >
                  <div class="absolute inset-0 flex items-end justify-around px-1" style={{ width: `${100 / ((seekPreviewPct() ?? progressPct()) / 100 || 1)}%` }}>
                    <For each={Array(40).fill(0)}>{(_, i) => (
                      <div
                        class="w-1 bg-accent rounded-t"
                        style={{ height: `${30 + Math.sin(i() * 0.5) * 25 + Math.random() * 20}%` }}
                      />
                    )}</For>
                  </div>
                </div>

                {/* Hover indicator line */}
                <Show when={hoverPct() !== null && !isDragging()}>
                  <div
                    class="absolute inset-y-0 w-0.5 bg-white/50"
                    style={{ left: `${hoverPct()}%` }}
                  />
                </Show>

                {/* Playhead line */}
                <Show when={audioUrl()}>
                  <div
                    class="absolute inset-y-0 w-0.5 bg-white"
                    style={{
                      left: `${seekPreviewPct() ?? progressPct()}%`,
                      'box-shadow': '0 0 4px rgba(255,255,255,0.5)',
                    }}
                  />
                </Show>

                {/* Time tooltip */}
                <Show when={(hoverPct() !== null || isDragging()) && audioDuration() > 0}>
                  <div
                    class="absolute -top-7 px-2 py-0.5 bg-bg-dark border border-border-light rounded text-xs text-text-bright font-mono"
                    style={{
                      left: `${seekPreviewPct() ?? hoverPct() ?? 0}%`,
                      transform: 'translateX(-50%)',
                    }}
                  >
                    {formatTime(((seekPreviewPct() ?? hoverPct() ?? 0) / 100) * audioDuration())}
                  </div>
                </Show>
              </div>

              {/* Time display */}
              <div class="flex justify-between text-[10px] sm:text-xs text-text-dim font-mono">
                <span>{formatTime(currentTime())}</span>
                <span>{formatTime(audioDuration())}</span>
              </div>
            </div>

            {/* Action buttons */}
            <div class="flex gap-1">
              <button
                class="p-2 text-text-dim hover:text-text-bright transition-colors disabled:opacity-30"
                onClick={downloadAudio}
                disabled={!currentJobId()}
                title="Download"
              >
                <span class="i-mdi-download w-4 h-4 sm:w-5 sm:h-5" />
              </button>
              <button
                class="p-2 text-text-dim hover:text-text-bright transition-colors disabled:opacity-30"
                onClick={shareAudio}
                disabled={!audioUrl()}
                title="Share"
              >
                <span class="i-mdi-share-variant w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            </div>
          </div>

          {/* Hidden audio element */}
          <audio
            ref={audioRef}
            src={audioUrl()}
            preload="auto"
            onPlay={() => { setIsPlaying(true); startProgressAnimation() }}
            onPause={() => { setIsPlaying(false); stopProgressAnimation() }}
            onEnded={() => { setIsPlaying(false); stopProgressAnimation(); setCurrentTime(0) }}
            onLoadedMetadata={() => setAudioDuration(audioRef?.duration || 0)}
            onSeeked={() => setCurrentTime(audioRef?.currentTime || 0)}
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

        {/* Voice selector - jukebox style */}
        <div class="px-2 pb-2">
          <div class="panel-inset p-2">
            {/* Jukebox display */}
            <div class="flex items-center gap-2">
              {/* Prev button */}
              <button
                class="btn-win p-2"
                onClick={prevVoice}
                title="Previous voice (←)"
              >
                <span class="i-mdi-chevron-left w-4 h-4" />
              </button>

              {/* Voice display */}
              <div
                class="flex-1 text-center py-2 px-3"
                style={{
                  background: 'linear-gradient(180deg, #010409 0%, #0d1117 100%)',
                  border: '2px solid',
                  'border-color': '#010409 #30363d #30363d #010409',
                  'box-shadow': 'inset 0 2px 4px rgba(0,0,0,0.5)',
                }}
              >
                <div class="text-lg sm:text-xl text-lcd-green font-bold tracking-wide">
                  {currentVoice().name}
                </div>
                <div class="flex justify-center items-center gap-3 text-[10px] sm:text-xs mt-1">
                  <span class="text-text-dim">
                    {currentVoice().accent} · {currentVoice().gender === 'F' ? '♀' : '♂'}
                  </span>
                  <span class="text-lcd-yellow font-mono">
                    ${(DEEPINFRA_BASE * currentVoice().markup * 1000000).toFixed(2)}/M
                  </span>
                </div>
                <div class="text-[9px] text-text-dim mt-1">
                  {voiceIndex() + 1} / {VOICES.length}
                </div>
              </div>

              {/* Next button */}
              <button
                class="btn-win p-2"
                onClick={nextVoice}
                title="Next voice (→)"
              >
                <span class="i-mdi-chevron-right w-4 h-4" />
              </button>
            </div>

            {/* Quick select - hidden on mobile, grouped by accent on larger screens */}
            <div class="hidden sm:block mt-2 space-y-1">
              {/* US voices */}
              <div class="flex items-center gap-1 flex-wrap">
                <span class="text-[9px] text-text-dim w-5">US</span>
                <For each={VOICES.filter(v => v.accent === 'US')}>{(v) => (
                  <button
                    class={`px-1.5 py-0.5 text-[9px] rounded transition-all ${
                      voice() === v.id
                        ? 'bg-accent text-white'
                        : 'bg-bg-light hover:bg-bg-mid text-text-dim hover:text-text'
                    }`}
                    onClick={() => selectVoice(v.id)}
                    title={`${v.name} - ${v.gender === 'F' ? 'Female' : 'Male'}`}
                  >
                    {v.name.slice(0, 3)}
                  </button>
                )}</For>
              </div>
              {/* UK voices */}
              <div class="flex items-center gap-1 flex-wrap">
                <span class="text-[9px] text-text-dim w-5">UK</span>
                <For each={VOICES.filter(v => v.accent === 'UK')}>{(v) => (
                  <button
                    class={`px-1.5 py-0.5 text-[9px] rounded transition-all ${
                      voice() === v.id
                        ? 'bg-accent text-white'
                        : 'bg-bg-light hover:bg-bg-mid text-text-dim hover:text-text'
                    }`}
                    onClick={() => selectVoice(v.id)}
                    title={`${v.name} - ${v.gender === 'F' ? 'Female' : 'Male'}`}
                  >
                    {v.name.slice(0, 3)}
                  </button>
                )}</For>
              </div>
            </div>
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
                  {charCount() > 0 && (
                    <span class="text-lcd-yellow ml-2">
                      ~${(charCount() * DEEPINFRA_BASE * currentVoice().markup).toFixed(4)}
                    </span>
                  )}
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

        {/* History */}
        <Show when={store.history.length > 0}>
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
                      onClick={() => loadAndPlay(item.url, item.text, item.duration, item.jobId)}
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
          <span>{store.stats.generated} generated</span>
          <span>{store.stats.chars.toLocaleString()} chars</span>
        </div>
      </div>

      {/* Credit */}
      <div class="mt-3 sm:mt-4 text-[10px] sm:text-xs text-text-dim">
        <a href="https://rotko.net" class="hover:text-lcd-green">ROTKO NETWORKS</a>
        {' · '}
        <button onClick={() => setShowDocs(true)} class="hover:text-purple-300">DOCS</button>
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

      <Show when={showProfile()}>
        <Suspense fallback={
          <div class="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
            <div class="text-lcd-green animate-pulse">LOADING...</div>
          </div>
        }>
          <ProfilePage onClose={() => setShowProfile(false)} />
        </Suspense>
      </Show>

      <Show when={showDocs()}>
        <Suspense fallback={
          <div class="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
            <div class="text-lcd-green animate-pulse">LOADING...</div>
          </div>
        }>
          <DocsPage onClose={() => setShowDocs(false)} />
        </Suspense>
      </Show>

      <ToastContainer />
    </div>
  )
}
