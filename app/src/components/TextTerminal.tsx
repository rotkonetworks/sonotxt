import { createSignal, createEffect, For, Show, onMount, onCleanup } from 'solid-js'
import type { HistoryItem } from '../lib/store'

const API = import.meta.env.VITE_API_URL || 'https://api.sonotxt.com'
const SPEECH_URL = import.meta.env.VITE_SPEECH_URL || `${API}/api/voice`
const LLM_URL = import.meta.env.VITE_LLM_URL || `${API}/api/voice`

interface Props {
  onHistoryAdd?: (item: Omit<HistoryItem, 'id' | 'date'>) => void
  initialText?: string
  initialVoice?: string
  initialLang?: string
  onVoiceChange?: (voice: string) => void
}

const SPEAKERS = [
  { id: 'ryan', name: 'Ryan' },
  { id: 'serena', name: 'Serena' },
  { id: 'aiden', name: 'Aiden' },
  { id: 'vivian', name: 'Vivian' },
  { id: 'eric', name: 'Eric' },
  { id: 'dylan', name: 'Dylan' },
  { id: 'sohee', name: 'Sohee' },
  { id: 'ono_anna', name: 'Anna' },
  { id: 'uncle_fu', name: 'Uncle Fu' },
]

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'fi', name: 'Finnish' },
  { code: 'th', name: 'Thai' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'it', name: 'Italian' },
  { code: 'tr', name: 'Turkish' },
]

function looksLikeUrl(text: string): boolean {
  const t = text.trim()
  if (t.includes('\n')) return false
  return /^https?:\/\//i.test(t) || /^www\.\S+\.\w{2,}/i.test(t)
}

export default function TextTerminal(props: Props) {
  const [text, setText] = createSignal(props.initialText || sessionStorage.getItem('sonotxt_draft') || '')
  const [translatedText, setTranslatedText] = createSignal('')
  const [speaker, setSpeaker] = createSignal(props.initialVoice || sessionStorage.getItem('sonotxt_voice') || 'ryan')
  const [loading, setLoading] = createSignal(false)
  const [status, setStatus] = createSignal('')
  const [audioUrl, setAudioUrl] = createSignal('')
  const [isPlaying, setIsPlaying] = createSignal(false)
  const [translateEnabled, setTranslateEnabled] = createSignal(!!props.initialLang || sessionStorage.getItem('sonotxt_translate') === '1')
  const [targetLang, setTargetLang] = createSignal(props.initialLang || sessionStorage.getItem('sonotxt_lang') || 'en')
  const [audioProgress, setAudioProgress] = createSignal(0)
  const [audioTime, setAudioTime] = createSignal(0)
  const [audioDuration, setAudioDuration] = createSignal(0)
  const [synthProgress, setSynthProgress] = createSignal(0)
  const [synthTotal, setSynthTotal] = createSignal(0)
  const [dragOver, setDragOver] = createSignal(false)
  const RATES = [0.75, 1, 1.25, 1.5, 2] as const
  const [ttsRate, setTtsRate] = createSignal((() => {
    const stored = parseFloat(sessionStorage.getItem('sonotxt_rate') || '1')
    return RATES.includes(stored as typeof RATES[number]) ? stored : 1
  })())
  const [genElapsed, setGenElapsed] = createSignal(0)
  const [copied, setCopied] = createSignal(false)
  const [translationCopied, setTranslationCopied] = createSignal(false)
  const [shared, setShared] = createSignal(false)
  const [genDone, setGenDone] = createSignal(false)
  const [genVoice, setGenVoice] = createSignal('')
  const [audioPartial, setAudioPartial] = createSignal(false)
  const [audioSize, setAudioSize] = createSignal(0)
  const [genLang, setGenLang] = createSignal('')
  const [confirmClear, setConfirmClear] = createSignal(false)
  const [pasteFlash, setPasteFlash] = createSignal(false)
  let pasteFlashTimer: ReturnType<typeof setTimeout> | undefined

  // React to prop changes (when opening from history — only when non-empty)
  createEffect(() => {
    if (props.initialText) setText(props.initialText)
  })
  createEffect(() => {
    if (props.initialVoice) setSpeaker(props.initialVoice)
  })
  createEffect(() => { sessionStorage.setItem('sonotxt_voice', speaker()); props.onVoiceChange?.(speaker()) })
  createEffect(() => sessionStorage.setItem('sonotxt_translate', translateEnabled() ? '1' : '0'))
  createEffect(() => sessionStorage.setItem('sonotxt_lang', targetLang()))
  createEffect(() => sessionStorage.setItem('sonotxt_rate', String(ttsRate())))
  // Debounced draft auto-save — survives page refresh
  let draftTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    const t = text()
    if (draftTimer) clearTimeout(draftTimer)
    draftTimer = setTimeout(() => { sessionStorage.setItem('sonotxt_draft', t); draftTimer = undefined }, 500)
  })
  createEffect(() => {
    if (props.initialLang) {
      setTranslateEnabled(true)
      setTargetLang(props.initialLang)
    }
  })

  let textareaRef: HTMLTextAreaElement | undefined
  let audioRef: HTMLAudioElement | undefined
  let seekDragged = false
  let abortController: AbortController | null = null
  let statusTimer: ReturnType<typeof setTimeout> | undefined
  let genTimer: ReturnType<typeof setInterval> | undefined
  let clearTimer: ReturnType<typeof setTimeout> | undefined

  // Tab title shows progress while generating
  const DEFAULT_TITLE = 'sonotxt - text to speech'
  createEffect(() => {
    if (loading() && synthTotal() > 0) {
      const eta = synthProgress() >= 2 && genElapsed() > 0
        ? Math.round((genElapsed() / synthProgress()) * (synthTotal() - synthProgress()))
        : 0
      const etaStr = eta > 0 ? ` ~${eta < 60 ? `${eta}s` : `${Math.ceil(eta / 60)}m`}` : ''
      const voiceName = SPEAKERS.find(s => s.id === speaker())?.name || speaker()
      document.title = `(${synthProgress()}/${synthTotal()}${etaStr} · ${voiceName}) sonotxt`
    } else if (loading()) {
      const voiceName = SPEAKERS.find(s => s.id === speaker())?.name || speaker()
      document.title = `(... · ${voiceName}) sonotxt`
    } else if (isPlaying() && audioDuration() > 0) {
      document.title = `▶ ${ttsRate() !== 1 ? ttsRate() + 'x ' : ''}${formatTime(audioTime())} sonotxt`
    } else {
      document.title = DEFAULT_TITLE
    }
  })
  onCleanup(() => { document.title = DEFAULT_TITLE })

  // Auto-clear status messages after generation completes
  createEffect(() => {
    if (loading()) {
      if (statusTimer) { clearTimeout(statusTimer); statusTimer = undefined }
      return
    }
    if (status()) {
      if (statusTimer) clearTimeout(statusTimer)
      statusTimer = setTimeout(() => setStatus(''), status().startsWith('Ready') ? 3000 : 5000)
    }
  })

  function autoGrow() {
    if (!textareaRef) return
    textareaRef.style.height = 'auto'
    textareaRef.style.height = textareaRef.scrollHeight + 'px'
  }

  // Auto-resize textarea whenever text changes (covers programmatic setText, file drop, clear, URL extract)
  createEffect(() => {
    text() // track dependency
    requestAnimationFrame(autoGrow)
  })

  onMount(() => {
    // Auto-focus textarea when entering TTS mode (desktop only — avoids mobile keyboard popup)
    if (window.matchMedia('(min-width: 640px)').matches) {
      textareaRef?.focus()
    }
  })

  // Keyboard shortcuts: Escape stops, Space toggles play/pause
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (loading()) {
        cancelGeneration()
      } else if (isPlaying() && audioRef) {
        audioRef.pause()
        audioRef.currentTime = 0
        setAudioProgress(0)
        setAudioTime(0)
      }
    }
    if (e.code === 'Space' && audioUrl() && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
      e.preventDefault()
      togglePlay()
    }
    if (e.key === 'r' && !e.repeat && audioUrl() && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
      const cur = ttsRate()
      const next = RATES[(RATES.indexOf(cur as typeof RATES[number]) + 1) % RATES.length]
      setTtsRate(next)
      if (audioRef) audioRef.playbackRate = next
    }
    if (audioUrl() && audioRef?.duration && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
      e.preventDefault()
      audioRef.currentTime = Math.max(0, Math.min(audioRef.duration, audioRef.currentTime + (e.key === 'ArrowRight' ? 5 : -5)))
    }
  }
  onMount(() => window.addEventListener('keydown', onKeyDown))
  onCleanup(() => window.removeEventListener('keydown', onKeyDown))

  onCleanup(() => {
    abortController?.abort()
    abortController = null
    if (statusTimer) { clearTimeout(statusTimer); statusTimer = undefined }
    if (genTimer) { clearInterval(genTimer); genTimer = undefined }
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = undefined }
    if (pasteFlashTimer) { clearTimeout(pasteFlashTimer); pasteFlashTimer = undefined }
    if (draftTimer) { clearTimeout(draftTimer); sessionStorage.setItem('sonotxt_draft', text()); draftTimer = undefined }
    audioRef?.pause()
    const url = audioUrl()
    if (url) URL.revokeObjectURL(url)
  })

  async function extractUrl(url: string, signal?: AbortSignal): Promise<string> {
    const fullUrl = url.startsWith('http') ? url : `https://${url}`
    if (!/^https?:\/\//i.test(fullUrl)) throw new Error('Only http/https URLs are supported')
    // Block private/reserved IPs as defense-in-depth against SSRF
    const u = new URL(fullUrl)
    const h = u.hostname.replace(/^\[|\]$/g, '')
    if (
      /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.|169\.254\.)/.test(h) ||
      /^(localhost|localhost\..*)$/i.test(h) ||
      /^(::1?$|::ffff:|fe80:|fc00:|fd[0-9a-f]{2}:|100::|198\.18\.|198\.19\.)/i.test(h) ||
      h === '0.0.0.0' || h === '[::]' || h === '[::1]'
    ) {
      throw new Error('Private/reserved addresses are not allowed')
    }
    setStatus('Fetching article...')
    const res = await fetch(`${API}/api/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fullUrl }),
      signal,
    })
    if (!res.ok) throw new Error(`Extract error ${res.status}`)
    const data = await res.json()
    return data.text || ''
  }

  async function translateText(sourceText: string, signal?: AbortSignal): Promise<string> {
    const target = LANGUAGES.find(l => l.code === targetLang())
    if (!target) throw new Error('Invalid target language')
    const targetName = target.name
    setStatus('Translating...')
    const res = await fetch(`${LLM_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: `You are a translator. Translate the following text to ${targetName}. Only output the translation, nothing else. Preserve paragraph breaks.` },
          { role: 'user', content: sourceText },
        ]
      }),
      signal,
    })
    if (!res.ok) throw new Error(`Translation error ${res.status}`)
    const data = await res.json()
    return data.response || data.full_response || ''
  }

  function cancelGeneration() {
    abortController?.abort()
    abortController = null
  }

  async function generate() {
    let t = text().trim()
    if (!t || loading()) return

    abortController = new AbortController()
    const signal = abortController.signal
    if (audioRef) { audioRef.pause(); audioRef.currentTime = 0 }
    setIsPlaying(false)
    setGenDone(false)
    setConfirmClear(false)
    if (clearTimer) { clearTimeout(clearTimer); clearTimer = undefined }
    setLoading(true)
    setGenElapsed(0)
    setSynthTotal(0)
    setSynthProgress(0)
    genTimer = setInterval(() => setGenElapsed(e => e + 1), 1000)
    const oldUrl = audioUrl()
    if (oldUrl) URL.revokeObjectURL(oldUrl)
    setAudioUrl('')
    setAudioProgress(0)
    setAudioTime(0)
    setAudioDuration(0)
    setTranslatedText('')
    setAudioPartial(false)

    const audioBuffers: ArrayBuffer[] = []
    let ttsText = t

    try {
      // Auto-detect URL and extract
      if (looksLikeUrl(t)) {
        const extracted = await extractUrl(t, signal)
        setText(extracted)
        t = extracted
        if (!t) throw new Error('No text extracted from URL')
      }

      ttsText = t

      if (translateEnabled()) {
        ttsText = await translateText(t, signal)
        setTranslatedText(ttsText)
      }

      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')

      // Cap content at 50k chars and 200 sentences to prevent runaway TTS
      if (ttsText.length > 50_000) ttsText = ttsText.slice(0, 50_000)
      const allSentences = ttsText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [ttsText]
      const sentences = allSentences.slice(0, 200)
      const ttsLang = translateEnabled() ? targetLang() : 'auto'
      setSynthTotal(sentences.length)
      setSynthProgress(0)

      for (let i = 0; i < sentences.length; i++) {
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError')
        const s = sentences[i].trim()
        if (!s) continue
        setStatus(`Synthesizing ${i + 1}/${sentences.length}...`)
        const res = await fetch(`${SPEECH_URL}/synthesize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: s,
            speaker: speaker(),
            language: ttsLang,
          }),
          signal,
        })
        if (!res.ok) throw new Error(`TTS error ${res.status}`)
        const data = await res.json()
        let binary: string
        try {
          binary = atob(data.audio_base64)
        } catch {
          console.warn(`Skipping sentence ${i + 1}: invalid base64`)
          continue
        }
        const bytes = new Uint8Array(binary.length)
        for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j)
        audioBuffers.push(bytes.buffer)
        setSynthProgress(i + 1)
      }

      if (!audioBuffers.length) throw new Error('No audio generated')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Keep partial audio if we synthesized anything before cancel
        if (audioBuffers.length > 0) {
          setAudioPartial(true)
          setStatus(`Cancelled — kept ${audioBuffers.length} of ${synthTotal()} chunks`)
        } else {
          setStatus('Cancelled')
        }
      } else {
        setStatus(`Error: ${(err instanceof Error ? err.message : 'Something went wrong').slice(0, 200)}`)
      }
    }

    // Build final audio from whatever we have (full result or partial on cancel)
    if (audioBuffers.length > 0) {
      const totalLen = audioBuffers.reduce((sum, b) => sum + b.byteLength, 0)
      const combined = new Uint8Array(totalLen)
      let offset = 0
      for (const buf of audioBuffers) {
        combined.set(new Uint8Array(buf), offset)
        offset += buf.byteLength
      }

      const blob = new Blob([combined], { type: 'audio/wav' })
      const url = URL.createObjectURL(blob)
      setAudioUrl(url)
      setAudioSize(blob.size)
      setGenVoice(speaker())
      setGenLang(translateEnabled() ? targetLang() : '')
      if (synthProgress() >= synthTotal()) {
        const voiceName = SPEAKERS.find(s => s.id === speaker())?.name || speaker()
        setStatus(genElapsed() > 0 ? `Ready · ${voiceName} · ${genElapsed()}s` : `Ready · ${voiceName}`)
        setGenDone(true)
        setTimeout(() => setGenDone(false), 2000)
      }
      // Auto-play the result
      requestAnimationFrame(() => { if (audioRef) { audioRef.playbackRate = ttsRate(); audioRef.play().catch(() => {}) } })

      // Estimate duration from WAV blob size (24kHz 16-bit mono = 48000 bytes/sec, minus 44-byte header per chunk)
      const estDuration = Math.round(Math.max(0, totalLen - audioBuffers.length * 44) / 48000)
      props.onHistoryAdd?.({
        type: translateEnabled() ? 'translate' : 'text',
        text: t,
        url,
        duration: estDuration,
        voice: speaker(),
        ...(translateEnabled() ? { translation: ttsText, targetLang: targetLang() } : {}),
      })
    }
    abortController = null
    if (genTimer) { clearInterval(genTimer); genTimer = undefined }
    setLoading(false)
  }

  function togglePlay() {
    if (!audioRef) return
    if (isPlaying()) audioRef.pause()
    else audioRef.play().catch(() => {})
  }

  function formatTime(s: number): string {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const isUrl = () => looksLikeUrl(text().trim())

  return (
    <div class="flex-1 flex flex-col min-h-0">
      {/* Content area */}
      <div class="flex-1 flex flex-col min-h-0 px-4 sm:px-6 py-4">
        <div class="w-full max-w-3xl mx-auto flex-1 flex flex-col gap-3">

          {/* Translate toggle + language */}
          <div class="flex items-center gap-2">
            <button
              class={`px-3 py-1.5 font-heading text-xs uppercase tracking-wider border-2 transition-all ${
                loading()
                  ? 'opacity-50 cursor-not-allowed border-edge'
                  : translateEnabled()
                  ? 'bg-accent text-white border-edge shadow-[2px_2px_0_0_var(--border)]'
                  : 'bg-surface text-fg-muted hover:text-accent border-edge'
              }`}
              onClick={() => !loading() && setTranslateEnabled(!translateEnabled())}
            >
              <span class="i-mdi-translate w-3 h-3 mr-1" />
              Translate
            </button>

            <Show when={translateEnabled()}>
              <span class="text-fg-faint">→</span>
              <select
                class={`px-2 py-1.5 bg-surface border-2 border-edge text-fg font-heading text-xs uppercase tracking-wider outline-none focus:border-accent transition-colors ${loading() ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                value={targetLang()}
                onChange={(e) => setTargetLang(e.currentTarget.value)}
                disabled={loading()}
              >
                <For each={LANGUAGES}>
                  {(lang) => <option value={lang.code}>{lang.name}</option>}
                </For>
              </select>
            </Show>

            <div class="flex-1" />
            <Show when={status() && !loading()}>
              <span class="text-xs text-fg-faint font-mono">{status()}</span>
            </Show>
            <Show when={loading() && synthTotal() > 0}>
              <div class="flex items-center gap-2">
                <span class="text-[10px] text-fg-muted font-mono">{synthProgress()}/{synthTotal()}</span>
                <div class="w-20 h-1.5 bg-accent-soft overflow-hidden">
                  <div
                    class="h-full bg-accent transition-all duration-300"
                    style={{ width: `${(synthProgress() / synthTotal()) * 100}%` }}
                  />
                </div>
              </div>
            </Show>
          </div>

          {/* Textarea */}
          <div
            class={`flex-1 flex flex-col bg-surface border-2 shadow-[var(--shadow)] transition-colors relative ${
              loading() ? 'border-accent/60' : pasteFlash() ? 'border-emerald-500' : dragOver() ? 'border-accent bg-accent-soft/30' : 'border-edge'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) }}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              if (loading()) return
              const file = e.dataTransfer?.files[0]
              if (file && file.type.startsWith('text/')) {
                file.text().then(content => setText(content.slice(0, 100_000)))
              }
            }}
          >
            <Show when={dragOver() && !loading()}>
              <div class="absolute inset-0 z-10 bg-accent-soft/80 flex flex-col items-center justify-center pointer-events-none animate-fade-in">
                <span class="i-mdi-file-document-arrow-right w-10 h-10 text-accent mb-2" />
                <span class="text-accent font-heading text-sm uppercase tracking-wider">Drop text file</span>
                <span class="text-accent/60 text-[10px] font-heading uppercase tracking-wider mt-1">any text file accepted</span>
              </div>
            </Show>
            <div class="flex items-center gap-2 px-4 py-2 border-b border-edge-soft">
              <span class="i-mdi-text w-3.5 h-3.5 text-fg-faint" />
              <span class="text-[10px] text-fg-faint font-heading uppercase tracking-wider">Input</span>
              <div class="flex-1" />
              <Show when={text().trim()} fallback={
                <span class="text-[10px] text-fg-faint font-heading uppercase tracking-wider flex items-center gap-1">
                  <Show when={dragOver()} fallback={
                    <><span class="i-mdi-link w-3 h-3" />URLs auto-extract</>
                  }>
                    <span class="i-mdi-file-document-outline w-3 h-3 text-accent" />
                    <span class="text-accent">Drop to load</span>
                  </Show>
                </span>
              }>
                <button
                  class={`transition-colors p-0.5 ${confirmClear() ? 'text-red-500 hover:text-red-600' : 'text-fg-faint hover:text-accent'}`}
                  onClick={() => {
                    if (audioUrl() && !confirmClear()) {
                      setConfirmClear(true)
                      if (clearTimer) clearTimeout(clearTimer)
                      clearTimer = setTimeout(() => { setConfirmClear(false); clearTimer = undefined }, 3000)
                      return
                    }
                    setConfirmClear(false)
                    if (clearTimer) { clearTimeout(clearTimer); clearTimer = undefined }
                    if (audioRef) { audioRef.pause(); audioRef.currentTime = 0 }
                    setIsPlaying(false)
                    const oldUrl = audioUrl()
                    if (oldUrl) URL.revokeObjectURL(oldUrl)
                    setText('')
                    setAudioUrl('')
                    setAudioProgress(0)
                    setAudioTime(0)
                    setAudioDuration(0)
                    setTranslatedText('')
                    setStatus('')
                    requestAnimationFrame(() => textareaRef?.focus())
                  }}
                  title={confirmClear() ? 'Tap again to clear' : 'Clear'}
                >
                  <Show when={confirmClear()} fallback={
                    <span class="i-mdi-close w-3.5 h-3.5" />
                  }>
                    <span class="text-[9px] font-heading uppercase tracking-wider animate-pulse">Clear?</span>
                  </Show>
                </button>
              </Show>
            </div>
            <textarea
              ref={textareaRef}
              class={`flex-1 w-full p-4 bg-transparent text-fg font-serif text-base sm:text-lg lg:text-xl leading-relaxed resize-none outline-none placeholder:text-fg-faint min-h-[120px] sm:min-h-[200px] ${loading() ? 'opacity-60 cursor-not-allowed' : ''}`}
              placeholder={translateEnabled()
                ? `Paste text or a URL to translate to ${LANGUAGES.find(l => l.code === targetLang())?.name}...`
                : 'Paste text or a URL to convert to speech...'
              }
              value={text()}
              onInput={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
                  if (loading()) cancelGeneration()
                  else generate()
                }
              }}
              onPaste={(e) => {
                const pasted = e.clipboardData?.getData('text') || ''
                if (pasted.length > 0 && !loading()) {
                  setPasteFlash(true)
                  if (pasteFlashTimer) clearTimeout(pasteFlashTimer)
                  pasteFlashTimer = setTimeout(() => { setPasteFlash(false); pasteFlashTimer = undefined }, 600)
                }
                if (looksLikeUrl(pasted.trim()) && !text().trim()) {
                  // Auto-generate when pasting a URL into empty textarea
                  setTimeout(() => generate(), 50)
                }
              }}
              readOnly={loading()}
            />
            <Show when={!text().trim() && !loading() && !audioUrl()}>
              <div class="flex flex-wrap gap-1.5 px-4 pb-3 -mt-2">
                {([
                  'The quick brown fox jumps over the lazy dog near the riverbank.',
                  'In a hole in the ground there lived a hobbit.',
                  'To be, or not to be, that is the question.',
                ] as const).map(sample => (
                  <button
                    class="px-2.5 py-1 text-[10px] text-fg-faint hover:text-accent bg-page border border-edge-soft hover:border-accent-muted font-serif transition-colors"
                    onClick={() => { setText(sample); requestAnimationFrame(() => textareaRef?.focus()) }}
                  >
                    {sample.slice(0, 50)}{sample.length > 50 ? '...' : ''}
                  </button>
                ))}
              </div>
            </Show>
            <Show when={text().length > 0}>
              <div class="h-px bg-edge-soft mx-4">
                <div
                  class={`h-full transition-all duration-300 ${
                    text().length > 5000 ? 'bg-red-500' : text().length > 3000 ? 'bg-amber-500' : 'bg-accent/40'
                  }`}
                  style={{ width: `${Math.min(100, (text().length / 50000) * 100)}%` }}
                />
              </div>
            </Show>
            <div class="flex items-center justify-between px-4 py-2 border-t border-edge-soft">
              <div class="flex items-center gap-2">
                <span class={`text-xs font-mono ${
                  text().length >= 50000 ? 'text-red-600 animate-pulse' : text().length > 40000 ? 'text-red-600' : text().length > 3000 ? 'text-amber-600' : 'text-fg-faint'
                }`}>
                  {text().length.toLocaleString()} chars
                  {text().length >= 50000 ? ' (limit)' : text().length > 40000 ? ` / 50k` : ''}
                </span>
                <Show when={text().trim().length > 0}>
                  <span class="text-[10px] text-fg-faint font-mono">&middot; {text().trim().split(/\s+/).length} {text().trim().split(/\s+/).length === 1 ? 'word' : 'words'}</span>
                  <Show when={audioDuration() > 0} fallback={
                    <span class="text-[10px] text-fg-faint font-mono">&middot; ~{Math.max(1, Math.round(text().trim().split(/\s+/).length / 150))}m</span>
                  }>
                    <span class="text-[10px] text-accent font-mono">&middot; {formatTime(audioDuration())}</span>
                  </Show>
                  {(() => {
                    const cost = text().length * 1.6 / 1_000_000
                    return <span class="text-[10px] text-fg-faint/50 font-mono">&middot; ~${cost < 0.005 ? '<0.01' : cost.toFixed(2)}</span>
                  })()}
                </Show>
                <Show when={isUrl()}>
                  <span class="text-[10px] text-accent font-heading uppercase tracking-wider">URL detected</span>
                </Show>
              </div>
              <span class="text-[10px] text-fg-faint font-mono hidden sm:inline">
                <Show when={loading()} fallback={
                  <>
                    <kbd class="px-1.5 py-0.5 bg-surface border-2 border-edge font-mono text-[10px] text-fg shadow-[var(--shadow)]">{navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}</kbd>
                    <span class="mx-0.5">+</span>
                    <kbd class="px-1.5 py-0.5 bg-surface border-2 border-edge font-mono text-[10px] text-fg shadow-[var(--shadow)]">Enter</kbd>
                  </>
                }>
                  <kbd class="px-1.5 py-0.5 bg-surface border-2 border-red-300 font-mono text-[10px] text-red-500 shadow-[1px_1px_0_0_var(--border)]">{navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}↵ Cancel</kbd>
                </Show>
              </span>
            </div>
          </div>

          {/* Translation result */}
          <Show when={translatedText()}>
            <div class="bg-surface border-2 border-edge shadow-[var(--shadow)] p-4 animate-page-enter">
              <div class="flex items-center gap-2 mb-2">
                <span class="i-mdi-translate w-4 h-4 text-accent" />
                <span class="text-xs text-accent font-heading uppercase tracking-wider">
                  {LANGUAGES.find(l => l.code === targetLang())?.name}
                </span>
                <div class="flex-1" />
                <button
                  class="p-1 text-fg-faint hover:text-accent transition-colors"
                  title="Copy translation"
                  onClick={() => {
                    navigator.clipboard.writeText(translatedText()).then(() => {
                      setTranslationCopied(true)
                      setTimeout(() => setTranslationCopied(false), 2000)
                    }).catch(() => {})
                  }}
                >
                  <span class={`${translationCopied() ? 'i-mdi-check' : 'i-mdi-content-copy'} w-3.5 h-3.5`} />
                </button>
              </div>
              <p class="text-fg font-serif text-sm sm:text-base leading-relaxed whitespace-pre-wrap">{translatedText()}</p>
            </div>
          </Show>

          {/* Audio player */}
          <Show when={audioUrl()}>
            <div class="bg-surface border-2 border-edge shadow-[var(--shadow)] p-3 animate-page-enter">
              <div class="flex items-center gap-3">
                <button
                  class={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                    isPlaying()
                      ? 'bg-accent border-accent-strong text-white'
                      : 'bg-surface border-edge text-accent hover:bg-accent-soft'
                  }`}
                  onClick={togglePlay}
                >
                  <Show when={isPlaying()} fallback={
                    <span class="i-mdi-play w-5 h-5 ml-0.5" />
                  }>
                    <span class="i-mdi-pause w-5 h-5" />
                  </Show>
                </button>
                <div class="flex-1 flex flex-col gap-1">
                  <div
                    class="group/seek relative w-full h-1.5 bg-page border border-edge-soft overflow-visible cursor-pointer"
                    onClick={(e) => {
                      if (seekDragged) { seekDragged = false; return }
                      if (!audioRef?.duration) return
                      const rect = e.currentTarget.getBoundingClientRect()
                      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                      audioRef.currentTime = pct * audioRef.duration
                    }}
                    onMouseDown={(e) => {
                      if (!audioRef?.duration) return
                      const bar = e.currentTarget
                      let moved = false
                      const seek = (ev: MouseEvent) => {
                        moved = true
                        if (!audioRef?.duration) return
                        const rect = bar.getBoundingClientRect()
                        const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
                        audioRef.currentTime = pct * audioRef.duration
                      }
                      const onUp = () => {
                        if (moved) seekDragged = true
                        document.removeEventListener('mousemove', seek)
                        document.removeEventListener('mouseup', onUp)
                      }
                      document.addEventListener('mousemove', seek)
                      document.addEventListener('mouseup', onUp)
                    }}
                    onTouchStart={(e) => {
                      if (!audioRef?.duration) return
                      const bar = e.currentTarget
                      const seekTouch = (ev: TouchEvent) => {
                        if (!audioRef?.duration || !ev.touches[0]) return
                        const rect = bar.getBoundingClientRect()
                        const pct = Math.max(0, Math.min(1, (ev.touches[0].clientX - rect.left) / rect.width))
                        audioRef.currentTime = pct * audioRef.duration
                      }
                      seekTouch(e)
                      const onTouchMove = (ev: TouchEvent) => { ev.preventDefault(); seekTouch(ev) }
                      const onTouchEnd = () => { document.removeEventListener('touchmove', onTouchMove); document.removeEventListener('touchend', onTouchEnd) }
                      document.addEventListener('touchmove', onTouchMove, { passive: false })
                      document.addEventListener('touchend', onTouchEnd)
                    }}
                  >
                    <div class="h-full bg-accent transition-[width] duration-200 pointer-events-none"
                      style={{ width: `${audioProgress()}%` }}
                    />
                    <Show when={audioProgress() > 0}>
                      <div
                        class="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-accent border border-white shadow-sm sm:opacity-0 sm:group-hover/seek:opacity-100 transition-opacity pointer-events-none"
                        style={{ left: `calc(${audioProgress()}% - 5px)` }}
                      />
                    </Show>
                  </div>
                  <div class="flex justify-between items-center">
                    <span class="text-[9px] text-fg-faint font-mono">
                      {isPlaying() || audioTime() > 0 ? formatTime(audioTime()) : '0:00'}
                    </span>
                    <span class="flex items-center gap-1.5">
                      <Show when={audioPartial()}>
                        <span class="text-[8px] text-amber-500 font-heading uppercase tracking-wider">partial</span>
                      </Show>
                      <Show when={genVoice()}>
                        <span class="text-[8px] text-fg-faint/40 font-heading uppercase tracking-wider">{SPEAKERS.find(s => s.id === genVoice())?.name || genVoice()}</span>
                      </Show>
                      <Show when={genLang()}>
                        <span class="text-[8px] text-accent/50 font-heading uppercase tracking-wider flex items-center gap-0.5">
                          <span class="i-mdi-translate w-2.5 h-2.5" />
                          {LANGUAGES.find(l => l.code === genLang())?.name || genLang()}
                        </span>
                      </Show>
                      <Show when={audioSize() > 0}>
                        <span class="text-[8px] text-fg-faint/30 font-mono">{audioSize() > 1_000_000 ? `${(audioSize() / 1_000_000).toFixed(1)} MB` : `${Math.round(audioSize() / 1000)} KB`}</span>
                      </Show>
                    </span>
                    <span class="hidden sm:flex items-center gap-1">
                      <Show when={isPlaying()} fallback={
                        <kbd class="px-1 py-0.5 bg-surface border border-edge text-[8px] font-mono text-fg-faint/30 shadow-[1px_1px_0_0_var(--border)]">SPACE</kbd>
                      }>
                        <kbd class="px-1 py-0.5 bg-surface border border-edge text-[8px] font-mono text-fg-faint/50 shadow-[1px_1px_0_0_var(--border)]">ESC</kbd>
                      </Show>
                      <kbd class="px-1 py-0.5 bg-surface border border-edge text-[8px] font-mono text-fg-faint/20 shadow-[1px_1px_0_0_var(--border)]">R</kbd>
                      <kbd class="px-1 py-0.5 bg-surface border border-edge text-[8px] font-mono text-fg-faint/20 shadow-[1px_1px_0_0_var(--border)]">← →</kbd>
                    </span>
                    <span class="text-[9px] text-fg-faint font-mono tabular-nums">
                      {audioDuration() > 0
                        ? isPlaying() || audioTime() > 0
                          ? `-${formatTime(Math.max(0, audioDuration() - audioTime()))}`
                          : formatTime(audioDuration())
                        : '--:--'}
                    </span>
                  </div>
                  <audio
                    ref={audioRef}
                    src={audioUrl()}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onLoadedMetadata={() => { if (audioRef?.duration && isFinite(audioRef.duration)) setAudioDuration(audioRef.duration) }}
                    onEnded={() => { setIsPlaying(false); setAudioProgress(0); setAudioTime(0); textareaRef?.focus() }}
                    onTimeUpdate={() => {
                      if (audioRef?.duration) {
                        setAudioProgress((audioRef.currentTime / audioRef.duration) * 100)
                        setAudioTime(audioRef.currentTime)
                      }
                    }}
                    class="hidden"
                  />
                </div>
                <button
                  class={`px-1.5 py-0.5 text-[10px] font-mono transition-colors tabular-nums flex-shrink-0 ${
                    ttsRate() !== 1
                      ? 'text-accent bg-accent-soft border border-accent-muted'
                      : 'text-fg-faint hover:text-accent border border-transparent'
                  }`}
                  onClick={() => {
                    const cur = ttsRate()
                    const next = RATES[(RATES.indexOf(cur as typeof RATES[number]) + 1) % RATES.length]
                    setTtsRate(next)
                    if (audioRef) audioRef.playbackRate = next
                  }}
                  title="Playback speed (R)"
                >
                  {ttsRate() === 1 ? '1x' : `${ttsRate()}x`}
                </button>
                <button
                  class="text-fg-faint hover:text-accent transition-colors flex-shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(text()).then(() => {
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                    }).catch(() => {})
                  }}
                  title="Copy text"
                >
                  <span class={`w-4 h-4 ${copied() ? 'i-mdi-check text-emerald-600' : 'i-mdi-content-copy'}`} />
                </button>
                <button
                  class="text-fg-faint hover:text-accent transition-colors flex-shrink-0"
                  onClick={async () => {
                    if (navigator.share && navigator.canShare) {
                      try {
                        const res = await fetch(audioUrl())
                        const blob = await res.blob()
                        const file = new File([blob], `sonotxt-${speaker()}-${text().trim().slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'audio'}.wav`, { type: 'audio/wav' })
                        if (navigator.canShare({ files: [file] })) {
                          await navigator.share({ text: text().slice(0, 200), files: [file] })
                          return
                        }
                      } catch {}
                    }
                    navigator.clipboard.writeText(text()).then(() => {
                      setShared(true)
                      setTimeout(() => setShared(false), 1500)
                    }).catch(() => {})
                  }}
                  title="Share"
                >
                  <span class={`w-4 h-4 ${shared() ? 'i-mdi-check text-emerald-600' : 'i-mdi-share-variant'}`} />
                </button>
                <a
                  href={audioUrl()}
                  download={`sonotxt-${speaker()}-${text().trim().slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'audio'}.wav`}
                  class="text-fg-faint hover:text-accent transition-colors flex-shrink-0"
                  title="Download"
                >
                  <span class="i-mdi-download w-4 h-4" />
                </a>
              </div>
            </div>
          </Show>

          {/* Loading */}
          <Show when={loading()}>
            <div class="flex flex-col gap-2 py-3 animate-page-enter">
              <div class="flex items-center justify-center gap-2">
                <span class="i-mdi-loading w-4 h-4 text-accent animate-spin" />
                <span class="text-accent font-heading text-sm uppercase tracking-wider">
                  {status()}
                </span>
                <Show when={genElapsed() > 0}>
                  <span class="text-[10px] text-fg-faint/50 font-mono tabular-nums">{genElapsed()}s</span>
                </Show>
                <button
                  class="px-2 py-0.5 text-[10px] font-heading uppercase tracking-wider text-fg-faint hover:text-red-500 border border-edge-soft hover:border-red-300 transition-colors flex items-center gap-1"
                  onClick={cancelGeneration}
                  title="Cancel (Esc)"
                >
                  Cancel
                  <kbd class="hidden sm:inline px-1 py-px bg-surface border border-edge text-[8px] font-mono text-fg-faint/30 shadow-[1px_1px_0_0_var(--border)]">ESC</kbd>
                </button>
              </div>
              <Show when={text().trim().split(/\s+/).length > 10}>
                <span class="text-[10px] text-fg-faint/40 font-mono text-center">~{Math.max(1, Math.round(text().trim().split(/\s+/).length / 150))} min audio</span>
              </Show>
              <Show when={synthTotal() > 1}>
                <div class="w-full max-w-sm mx-auto">
                  <div class="w-full h-1 bg-page border border-edge-soft overflow-hidden">
                    <div
                      class="h-full bg-accent transition-[width] duration-300 ease-out"
                      style={{ width: `${(synthProgress() / synthTotal()) * 100}%` }}
                    />
                  </div>
                  <div class="flex items-center justify-center gap-2 mt-1">
                    <span class="text-[10px] text-fg-faint font-mono">{synthProgress()}/{synthTotal()}</span>
                    <span class="text-[10px] text-fg-faint/40 font-mono">{Math.round((synthProgress() / synthTotal()) * 100)}%</span>
                    <Show when={synthProgress() >= 2 && genElapsed() > 0}>
                      {(() => {
                        const remaining = Math.round((genElapsed() / synthProgress()) * (synthTotal() - synthProgress()))
                        if (remaining <= 0) return null
                        return <span class="text-[10px] text-fg-faint/30 font-mono">~{remaining < 60 ? `${remaining}s` : `${Math.floor(remaining / 60)}m${remaining % 60 > 0 ? remaining % 60 + 's' : ''}`} left</span>
                      })()}
                    </Show>
                  </div>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      {/* Bottom control strip */}
      <div class="bg-surface border-t-2 border-edge flex-shrink-0">
        {/* Speaker selector */}
        <div class="flex items-center gap-1.5 px-4 sm:px-6 lg:px-8 py-2 border-b border-edge-soft overflow-x-auto scroll-fade">
          <span class="text-[10px] text-fg-faint font-heading uppercase tracking-wider flex-shrink-0 mr-1">Voice</span>
          <For each={SPEAKERS}>
            {(s) => (
              <button
                class={`px-2.5 py-0.5 font-heading text-[10px] uppercase tracking-wider transition-all flex-shrink-0 flex items-center gap-1 ${
                  loading()
                    ? speaker() === s.id
                      ? 'bg-accent/60 text-white/60 border border-accent-strong cursor-not-allowed'
                      : 'text-fg-faint/30 border border-transparent cursor-not-allowed'
                    : speaker() === s.id
                    ? 'bg-accent text-white border border-accent-strong'
                    : 'text-fg-muted hover:text-accent border border-transparent hover:border-edge-soft'
                }`}
                onClick={() => !loading() && setSpeaker(s.id)}
              >
                <Show when={speaker() === s.id && isPlaying()}>
                  <span class="flex items-end gap-px h-2.5 w-2.5">
                    <span class="eq-bar" /><span class="eq-bar" /><span class="eq-bar" />
                  </span>
                </Show>
                <Show when={speaker() === s.id && loading() && !isPlaying()}>
                  <span class="i-mdi-loading w-2.5 h-2.5 animate-spin" />
                </Show>
                {s.name}
              </button>
            )}
          </For>
        </div>

        {/* Generate button */}
        <div class="flex items-center justify-center px-6 py-3">
          <button
            class={`px-8 py-2.5 font-heading text-xs uppercase tracking-wider transition-all border-2 ${
              genDone()
                ? 'bg-emerald-600 border-emerald-800 text-white shadow-[var(--shadow)]'
                : loading() || !text().trim()
                ? 'bg-page border-edge-soft text-fg-faint cursor-not-allowed'
                : 'bg-accent border-accent-strong text-white hover:bg-accent-hover active:scale-95 shadow-[var(--shadow)]'
            }`}
            disabled={loading() || !text().trim()}
            onClick={generate}
          >
            <Show when={genDone()} fallback={
              <Show when={loading()} fallback={
                <span class="flex items-center gap-2">
                  <Show when={isUrl()} fallback={
                    <Show when={translateEnabled()} fallback={
                      <span class="i-mdi-volume-high w-5 h-5" />
                    }>
                      <span class="i-mdi-translate w-5 h-5" />
                    </Show>
                  }>
                    <span class="i-mdi-web w-5 h-5" />
                  </Show>
                  {isUrl() ? 'FETCH & SPEAK' : translateEnabled() ? 'TRANSLATE & SPEAK' : audioUrl() ? 'REGENERATE' : 'GENERATE'}
                  {(() => {
                    const words = text().trim().split(/\s+/).filter(Boolean).length
                    return words > 1 && !isUrl() ? <span class="text-[9px] opacity-50 ml-1 hidden sm:inline">{words > 999 ? `${(words / 1000).toFixed(1)}k` : words} words</span> : null
                  })()}
                  <span class="hidden sm:inline text-[9px] opacity-60 ml-1">
                    {navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}↵
                  </span>
                </span>
              }>
                <span class="flex items-center gap-2">
                  <span class="i-mdi-loading w-5 h-5 animate-spin" />
                  {status()}
              </span>
            </Show>
            }>
              <span class="flex items-center gap-2">
                <span class="i-mdi-check w-5 h-5" />
                DONE
              </span>
            </Show>
          </button>
        </div>
      </div>
    </div>
  )
}
