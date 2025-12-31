import { createSignal, For, Show, onMount, lazy, Suspense, onCleanup } from 'solid-js'
import { ToastContainer, showToast } from './components/Toast'

const API = import.meta.env.VITE_API_URL || 'https://api.sonotxt.com'

// Lazy load auth modal
const AuthModal = lazy(() => import('./components/AuthModal'))

interface HistoryItem {
  text: string
  url: string
  duration: number
  date: string
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

const DEFAULT_VOICES: Voice[] = [
  { id: 'af_bella', name: 'Bella', accent: 'US', gender: 'F' },
  { id: 'af_nicole', name: 'Nicole', accent: 'US', gender: 'F' },
  { id: 'am_adam', name: 'Adam', accent: 'US', gender: 'M' },
  { id: 'am_michael', name: 'Michael', accent: 'US', gender: 'M' },
  { id: 'bf_emma', name: 'Emma', accent: 'UK', gender: 'F' },
  { id: 'bm_george', name: 'George', accent: 'UK', gender: 'M' },
]

export default function App() {
  const [text, setText] = createSignal('')
  const [voice, setVoice] = createSignal('af_bella')
  const [loading, setLoading] = createSignal(false)
  const [status, setStatus] = createSignal('')
  const [audioUrl, setAudioUrl] = createSignal('')
  const [audioDuration, setAudioDuration] = createSignal(0)
  const [history, setHistory] = createSignal<HistoryItem[]>([])
  const [stats, setStats] = createSignal({ generated: 0, chars: 0 })
  const [freeRemaining, setFreeRemaining] = createSignal(1000)
  const [showAuth, setShowAuth] = createSignal(false)
  const [user, setUser] = createSignal<User | null>(null)
  const [dragover, setDragover] = createSignal(false)
  const [showVoices, setShowVoices] = createSignal(false)
  const [previewLoading, setPreviewLoading] = createSignal<string | null>(null)
  const [previewAudio, setPreviewAudio] = createSignal<HTMLAudioElement | null>(null)
  const [voices, setVoices] = createSignal<Voice[]>(DEFAULT_VOICES)

  let textareaRef: HTMLTextAreaElement | undefined

  async function fetchVoices() {
    try {
      const res = await fetch(`${API}/api/voices`)
      const data = await res.json()
      if (data.voices) {
        // Map API response to our Voice format with sample URLs
        const voicesWithMeta = data.voices.map((v: { id: string, sample_url: string }) => {
          const defaultVoice = DEFAULT_VOICES.find(dv => dv.id === v.id)
          return {
            id: v.id,
            name: defaultVoice?.name || v.id.slice(3),
            accent: defaultVoice?.accent || (v.id.startsWith('af') || v.id.startsWith('am') ? 'US' : 'UK'),
            gender: v.id.includes('f_') ? 'F' : 'M',
            sample_url: v.sample_url,
          }
        }).filter((v: Voice) => DEFAULT_VOICES.some(dv => dv.id === v.id))
        setVoices(voicesWithMeta)
      }
    } catch {}
  }

  // Load from localStorage and setup keyboard shortcuts
  onMount(() => {
    const h = localStorage.getItem('sonotxt_history')
    if (h) setHistory(JSON.parse(h))

    const s = localStorage.getItem('sonotxt_stats')
    if (s) setStats(JSON.parse(s))

    const token = localStorage.getItem('sonotxt_token')
    if (token) checkSession(token)

    fetchVoices()

    // Global keyboard shortcuts
    const handleKeydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (text().trim() && !loading()) generate()
      }
      if (e.key === 'Escape') {
        if (showAuth()) setShowAuth(false)
        if (showVoices()) setShowVoices(false)
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
  const charClass = () => {
    const len = charCount()
    if (len > 1000) return 'text-red-400'
    if (len > 800) return 'text-yellow-400'
    return 'text-white/50'
  }

  const selectedVoice = () => voices().find(v => v.id === voice())

  async function generate() {
    const t = text().trim()
    if (!t) return

    if (!user() && t.length > 1000) {
      showToast('Free tier limited to 1000 chars. Login for more!', 'error')
      return
    }

    setLoading(true)
    setStatus('Submitting...')
    setAudioUrl('')

    try {
      const res = await fetch(`${API}/api/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t, voice: voice() }),
      })

      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e.error || 'Request failed')
      }

      const { job_id, free_tier_remaining } = await res.json()
      if (free_tier_remaining !== undefined) {
        setFreeRemaining(free_tier_remaining)
      }

      const result = await pollJob(job_id)
      setAudioUrl(result.url)
      setAudioDuration(result.duration_seconds)
      setStatus('')

      addToHistory(t, result.url, result.duration_seconds)
      setStats(s => {
        const updated = { generated: s.generated + 1, chars: s.chars + t.length }
        localStorage.setItem('sonotxt_stats', JSON.stringify(updated))
        return updated
      })

      showToast('Audio generated!', 'success')
    } catch (e: any) {
      showToast(e.message, 'error')
      setStatus('')
    }

    setLoading(false)
  }

  async function pollJob(jobId: string) {
    for (let i = 0; i < 60; i++) {
      await sleep(1000)
      const res = await fetch(`${API}/api/status?job_id=${jobId}`)
      const data = await res.json()

      if (data.status === 'Complete') {
        return data
      } else if (data.status === 'Failed') {
        throw new Error(data.reason || 'Generation failed')
      }

      setStatus(`${data.status}...`)
    }
    throw new Error('Timeout')
  }

  function previewVoice(voiceId: string) {
    // Stop any playing preview
    previewAudio()?.pause()

    // Find voice with sample URL
    const v = voices().find(voice => voice.id === voiceId)
    if (!v?.sample_url) {
      showToast('Sample not available', 'error')
      return
    }

    setPreviewLoading(voiceId)

    const audio = new Audio(v.sample_url)
    audio.oncanplaythrough = () => {
      setPreviewLoading(null)
      setPreviewAudio(audio)
      audio.play()
    }
    audio.onerror = () => {
      setPreviewLoading(null)
      showToast('Failed to load sample', 'error')
    }
  }

  function selectVoice(voiceId: string) {
    setVoice(voiceId)
    setShowVoices(false)
  }

  function addToHistory(t: string, url: string, duration: number) {
    setHistory(h => {
      const updated = [
        { text: t.slice(0, 100), url, duration, date: new Date().toISOString() },
        ...h.slice(0, 9),
      ]
      localStorage.setItem('sonotxt_history', JSON.stringify(updated))
      return updated
    })
  }

  function playFromHistory(item: HistoryItem) {
    setAudioUrl(item.url)
    setAudioDuration(item.duration)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    setDragover(false)
    const file = e.dataTransfer?.files[0]
    if (file && (file.type === 'text/plain' || file.name.endsWith('.txt'))) {
      file.text().then(setText)
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
    showToast('Logged out', 'info')
  }

  function formatDate(iso: string) {
    const d = new Date(iso)
    const diff = Date.now() - d.getTime()
    if (diff < 60000) return 'now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`
    return d.toLocaleDateString()
  }

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  return (
    <div class="min-h-screen bg-[#0d1117] text-white flex flex-col">
      {/* Header */}
      <header class="flex justify-between items-center px-6 py-4 border-b border-white/10">
        <a href="/" class="flex items-center gap-2 text-lg font-semibold">
          <svg class="w-6 h-6" viewBox="0 0 128 128">
            <rect width="128" height="128" fill="#be185d"/>
            <path d="M40 44h8v40h-8zM56 36h8v56h-8zM72 48h8v32h-8zM88 40h8v48h-8z" fill="#fff"/>
          </svg>
          SonoTxt
        </a>
        <div class="flex items-center gap-3">
          <Show when={user()} fallback={
            <button onClick={() => setShowAuth(true)} class="text-sm text-white/50 hover:text-white px-3 py-2 hover:bg-white/5">
              Login
            </button>
          }>
            <span class="text-sm text-white/50">{user()!.nickname || user()!.email}</span>
            <button onClick={logout} class="text-sm text-white/50 hover:text-white">Logout</button>
          </Show>
          <span class="text-xs bg-[#161b22] border border-white/10 px-3 py-1.5 text-white/50">
            {user() ? `$${user()!.balance.toFixed(2)}` : `Free: ${freeRemaining()}/day`}
          </span>
        </div>
      </header>

      {/* Main */}
      <main class="flex-1 flex flex-col items-center px-6 py-12 max-w-[800px] mx-auto w-full">
        <h1 class="text-2xl font-semibold mb-8">
          Paste text, get audio <span class="text-white/50 font-normal">instantly</span>
        </h1>

        {/* Input */}
        <div
          class={`w-full bg-[#161b22] border mb-4 ${dragover() ? 'border-primary' : 'border-white/10'}`}
          onDragOver={(e) => { e.preventDefault(); setDragover(true) }}
          onDragLeave={() => setDragover(false)}
          onDrop={handleDrop}
        >
          <textarea
            ref={textareaRef}
            class="w-full min-h-[180px] p-5 bg-transparent text-white text-base leading-relaxed resize-y outline-none placeholder:text-white/40"
            placeholder="Paste or type your text here... or drop a .txt file"
            value={text()}
            onInput={(e) => setText(e.currentTarget.value)}
          />
          <div class="flex justify-between items-center px-4 py-3 border-t border-white/10 bg-black/20">
            <div class="flex gap-4 items-center text-sm">
              <span class={charClass()}>{charCount().toLocaleString()} chars</span>

              {/* Voice selector dropdown */}
              <div class="relative group">
                <button class="flex items-center gap-2 bg-[#0d1117] border border-white/10 text-white px-3 py-2 text-sm hover:border-primary transition-colors">
                  <svg class="w-4 h-4 text-white/50" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                  </svg>
                  {selectedVoice()?.name} ({selectedVoice()?.accent})
                  <svg class="w-3 h-3 text-white/40" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7 10l5 5 5-5z"/>
                  </svg>
                </button>

                {/* Dropdown on hover */}
                <div class="absolute bottom-full left-0 mb-2 w-72 bg-[#161b22] border border-white/10 shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  <div class="p-2 max-h-80 overflow-y-auto">
                    <For each={voices()}>{v => (
                      <div
                        class={`flex items-center justify-between p-2 cursor-pointer transition-all ${
                          voice() === v.id ? 'bg-primary/20' : 'hover:bg-white/5'
                        }`}
                        onClick={() => setVoice(v.id)}
                      >
                        <div class="flex items-center gap-2">
                          <div class={`w-6 h-6 flex items-center justify-center text-xs font-medium ${
                            v.gender === 'F' ? 'bg-primary/20 text-primary' : 'bg-white/10 text-white/70'
                          }`}>
                            {v.gender}
                          </div>
                          <div>
                            <div class="text-sm font-medium">{v.name}</div>
                            <div class="text-xs text-white/40">{v.accent}</div>
                          </div>
                        </div>

                        <button
                          onClick={(e) => { e.stopPropagation(); previewVoice(v.id) }}
                          disabled={previewLoading() === v.id}
                          class="p-1.5 bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50"
                          title="Preview"
                        >
                          <Show when={previewLoading() === v.id} fallback={
                            <svg class="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M8 5v14l11-7z"/>
                            </svg>
                          }>
                            <div class="w-3 h-3 border-2 border-white/30 border-t-white animate-spin" />
                          </Show>
                        </button>
                      </div>
                    )}</For>
                  </div>
                </div>
              </div>
            </div>
            <button
              class="btn-primary flex items-center gap-2"
              disabled={loading() || !text().trim()}
              onClick={generate}
              title="Ctrl+Enter"
            >
              <Show when={loading()} fallback={
                <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                </svg>
              }>
                <div class="w-4 h-4 border-2 border-white/30 border-t-white animate-spin" />
              </Show>
              {loading() ? 'Generating...' : 'Generate'}
            </button>
          </div>
        </div>

        <p class="text-sm text-white/40">
          Drop a .txt file or paste · <kbd class="px-1.5 py-0.5 bg-white/10 text-xs">Ctrl</kbd>+<kbd class="px-1.5 py-0.5 bg-white/10 text-xs">Enter</kbd> to generate
        </p>

        {/* Status */}
        <div class="w-full mt-4">
          <Show when={loading()}>
            <div class="flex items-center gap-3 p-4 bg-[#161b22] border border-white/10">
              <div class="w-4 h-4 border-2 border-white/20 border-t-primary animate-spin" />
              <span class="text-sm">{status()}</span>
            </div>
          </Show>

          <Show when={audioUrl()}>
            <div class="bg-[#161b22] border border-white/10 p-4">
              <div class="flex justify-between items-center mb-3">
                <span class="text-sm text-white/50">
                  {Math.round(audioDuration())}s · {charCount().toLocaleString()} chars
                </span>
                <a
                  href={audioUrl()}
                  download="audio.mp3"
                  class="text-sm text-primary hover:bg-primary/10 px-2 py-1"
                >
                  Download
                </a>
              </div>
              <audio class="w-full h-10" controls autoplay src={audioUrl()} />
            </div>
          </Show>
        </div>

        {/* History */}
        <div class="w-full mt-12">
          <h2 class="text-base font-medium text-white/50 mb-4">Recent</h2>
          <Show when={history().length > 0} fallback={
            <p class="text-center py-8 text-white/40 text-sm">No audio generated yet</p>
          }>
            <div class="flex flex-col gap-2">
              <For each={history()}>{item => (
                <div
                  class="bg-[#161b22] border border-white/10 p-3 flex justify-between items-center cursor-pointer hover:border-primary transition-all"
                  onClick={() => playFromHistory(item)}
                >
                  <span class="text-sm truncate flex-1 mr-4">{item.text}</span>
                  <div class="flex gap-3 text-xs text-white/40">
                    <span>{Math.round(item.duration)}s</span>
                    <span>{formatDate(item.date)}</span>
                  </div>
                </div>
              )}</For>
            </div>
          </Show>
        </div>

        {/* Stats */}
        <div class="w-full flex gap-6 mt-12 pt-6 border-t border-white/10">
          <div class="text-center">
            <div class="text-2xl font-semibold">{stats().generated.toLocaleString()}</div>
            <div class="text-xs text-white/50 mt-1">Generated</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-semibold">{stats().chars.toLocaleString()}</div>
            <div class="text-xs text-white/50 mt-1">Characters</div>
          </div>
          <div class="text-center">
            <div class="text-2xl font-semibold">{freeRemaining().toLocaleString()}</div>
            <div class="text-xs text-white/50 mt-1">Free today</div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer class="text-center text-sm text-white/40 py-6 border-t border-white/10">
        <a href="https://rotko.net" class="hover:text-white">Rotko Networks</a>
        {' · '}
        <a href="/extension" class="hover:text-white">Extension</a>
        {' · '}
        <a href="/embed" class="hover:text-white">Embed</a>
      </footer>

      {/* Voice Selection Modal */}
      <Show when={showVoices()}>
        <div class="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={() => setShowVoices(false)}>
          <div class="bg-[#161b22] border border-white/10 p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div class="flex justify-between items-center mb-6">
              <h2 class="text-xl font-semibold">Choose Voice</h2>
              <button onClick={() => setShowVoices(false)} class="text-white/50 hover:text-white text-xl">&times;</button>
            </div>

            <div class="grid gap-2">
              <For each={voices()}>{v => (
                <div
                  class={`flex items-center justify-between p-3 border transition-all cursor-pointer ${
                    voice() === v.id
                      ? 'bg-primary/10 border-primary'
                      : 'bg-black/20 border-white/10 hover:border-white/20'
                  }`}
                  onClick={() => selectVoice(v.id)}
                >
                  <div class="flex items-center gap-3">
                    <div class={`w-8 h-8 flex items-center justify-center text-xs font-medium ${
                      v.gender === 'F' ? 'bg-primary/20 text-primary' : 'bg-white/10 text-white/70'
                    }`}>
                      {v.gender}
                    </div>
                    <div>
                      <div class="font-medium">{v.name}</div>
                      <div class="text-xs text-white/50">{v.accent} English</div>
                    </div>
                  </div>

                  <button
                    onClick={(e) => { e.stopPropagation(); previewVoice(v.id) }}
                    disabled={previewLoading() === v.id}
                    class="p-2 bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50"
                    title="Preview voice"
                  >
                    <Show when={previewLoading() === v.id} fallback={
                      <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5v14l11-7z"/>
                      </svg>
                    }>
                      <div class="w-4 h-4 border-2 border-white/30 border-t-white animate-spin" />
                    </Show>
                  </button>
                </div>
              )}</For>
            </div>

            <p class="text-xs text-white/40 mt-4 text-center">
              Click play to hear a sample of each voice
            </p>
          </div>
        </div>
      </Show>

      {/* Auth Modal */}
      <Show when={showAuth()}>
        <Suspense fallback={
          <div class="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
            <div class="w-6 h-6 border-2 border-white/20 border-t-primary animate-spin" />
          </div>
        }>
          <AuthModal onClose={() => setShowAuth(false)} onLogin={onLogin} />
        </Suspense>
      </Show>

      {/* Toast notifications */}
      <ToastContainer />
    </div>
  )
}
