import { createSignal, createEffect, For, Show } from 'solid-js'
import type { HistoryItem } from '../lib/store'

const API = import.meta.env.VITE_API_URL || 'https://api.sonotxt.com'
const SPEECH_URL = import.meta.env.VITE_SPEECH_URL || `${API}/api/voice`
const LLM_URL = import.meta.env.VITE_LLM_URL || `${API}/api/voice`

interface Props {
  onHistoryAdd?: (item: Omit<HistoryItem, 'id' | 'date'>) => void
  initialText?: string
  initialVoice?: string
  initialLang?: string
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
  return /^https?:\/\//i.test(t) || /^www\./i.test(t) || /^\S+\.\w{2,}\/\S*$/.test(t)
}

export default function TextTerminal(props: Props) {
  const [text, setText] = createSignal(props.initialText || '')
  const [translatedText, setTranslatedText] = createSignal('')
  const [speaker, setSpeaker] = createSignal(props.initialVoice || 'ryan')
  const [loading, setLoading] = createSignal(false)
  const [status, setStatus] = createSignal('')
  const [audioUrl, setAudioUrl] = createSignal('')
  const [isPlaying, setIsPlaying] = createSignal(false)
  const [translateEnabled, setTranslateEnabled] = createSignal(!!props.initialLang)
  const [targetLang, setTargetLang] = createSignal(props.initialLang || 'en')

  // React to prop changes (when opening from history)
  createEffect(() => {
    if (props.initialText !== undefined) setText(props.initialText)
  })
  createEffect(() => {
    if (props.initialVoice) setSpeaker(props.initialVoice)
  })
  createEffect(() => {
    if (props.initialLang) {
      setTranslateEnabled(true)
      setTargetLang(props.initialLang)
    }
  })

  let textareaRef: HTMLTextAreaElement | undefined
  let audioRef: HTMLAudioElement | undefined

  async function extractUrl(url: string): Promise<string> {
    const fullUrl = url.startsWith('http') ? url : `https://${url}`
    setStatus('Fetching article...')
    const API_URL = import.meta.env.VITE_API_URL || ''
    const res = await fetch(`${API_URL}/api/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fullUrl }),
    })
    if (!res.ok) throw new Error(`Extract error ${res.status}`)
    const data = await res.json()
    return data.text || ''
  }

  async function translateText(sourceText: string): Promise<string> {
    const target = LANGUAGES.find(l => l.code === targetLang())
    const targetName = target?.name || targetLang()
    setStatus('Translating...')
    const res = await fetch(`${LLM_URL}/chat_sentences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: `You are a translator. Translate the following text to ${targetName}. Only output the translation, nothing else. Preserve paragraph breaks.` },
          { role: 'user', content: sourceText },
        ]
      }),
    })
    if (!res.ok) throw new Error(`Translation error ${res.status}`)
    const data = await res.json()
    return data.full_response
  }

  async function generate() {
    let t = text().trim()
    if (!t || loading()) return

    setLoading(true)
    setAudioUrl('')
    setTranslatedText('')

    try {
      // Auto-detect URL and extract
      if (looksLikeUrl(t)) {
        const extracted = await extractUrl(t)
        setText(extracted)
        t = extracted
        if (!t) throw new Error('No text extracted from URL')
      }

      let ttsText = t

      if (translateEnabled()) {
        ttsText = await translateText(t)
        setTranslatedText(ttsText)
      }

      const sentences = ttsText.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [ttsText]
      const audioBuffers: ArrayBuffer[] = []
      const ttsLang = translateEnabled() ? targetLang() : 'auto'

      for (let i = 0; i < sentences.length; i++) {
        setStatus(`Synthesizing ${i + 1}/${sentences.length}...`)
        const res = await fetch(`${SPEECH_URL}/synthesize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: sentences[i].trim(),
            speaker: speaker(),
            language: ttsLang,
          }),
        })
        if (!res.ok) throw new Error(`TTS error ${res.status}`)
        audioBuffers.push(await res.arrayBuffer())
      }

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
      setStatus('Ready')

      props.onHistoryAdd?.({
        type: translateEnabled() ? 'translate' : 'text',
        text: t,
        url,
        duration: 0,
        voice: speaker(),
        ...(translateEnabled() ? { translation: ttsText, targetLang: targetLang() } : {}),
      })
    } catch (err) {
      setStatus(`Error: ${err}`)
    }
    setLoading(false)
  }

  function togglePlay() {
    if (!audioRef) return
    if (isPlaying()) audioRef.pause()
    else audioRef.play()
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
                translateEnabled()
                  ? 'bg-accent text-white border-edge shadow-[2px_2px_0_0_var(--border)]'
                  : 'bg-surface text-fg-muted hover:text-accent border-edge'
              }`}
              onClick={() => setTranslateEnabled(!translateEnabled())}
            >
              <span class="i-mdi-translate w-3 h-3 mr-1" />
              Translate
            </button>

            <Show when={translateEnabled()}>
              <span class="text-fg-faint">→</span>
              <select
                class="px-2 py-1.5 bg-surface border-2 border-edge text-fg font-heading text-xs uppercase tracking-wider outline-none cursor-pointer"
                value={targetLang()}
                onChange={(e) => setTargetLang(e.currentTarget.value)}
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
          </div>

          {/* Textarea */}
          <div class="flex-1 flex flex-col bg-surface border-2 border-edge shadow-[var(--shadow)]">
            <textarea
              ref={textareaRef}
              class="flex-1 w-full p-4 bg-transparent text-fg font-serif text-base sm:text-lg lg:text-xl leading-relaxed resize-none outline-none placeholder:text-fg-faint"
              placeholder={translateEnabled()
                ? `Paste text or a URL to translate to ${LANGUAGES.find(l => l.code === targetLang())?.name}...`
                : 'Paste text or a URL to convert to speech...'
              }
              value={text()}
              onInput={(e) => setText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault()
                  generate()
                }
              }}
            />
            <div class="flex items-center justify-between px-4 py-2 border-t border-edge-soft">
              <div class="flex items-center gap-2">
                <span class={`text-xs font-mono ${
                  text().length > 5000 ? 'text-red-600' : text().length > 3000 ? 'text-amber-600' : 'text-fg-faint'
                }`}>
                  {text().length.toLocaleString()} chars
                </span>
                <Show when={isUrl()}>
                  <span class="text-[10px] text-accent font-heading uppercase tracking-wider">URL detected</span>
                </Show>
              </div>
              <span class="text-[10px] text-fg-faint font-mono">
                <kbd class="px-1.5 py-0.5 bg-page border border-edge-soft">Ctrl+Enter</kbd>
              </span>
            </div>
          </div>

          {/* Translation result */}
          <Show when={translatedText()}>
            <div class="bg-surface border-2 border-edge shadow-[var(--shadow)] p-4">
              <div class="flex items-center gap-2 mb-2">
                <span class="i-mdi-translate w-4 h-4 text-accent" />
                <span class="text-xs text-accent font-heading uppercase tracking-wider">
                  {LANGUAGES.find(l => l.code === targetLang())?.name}
                </span>
              </div>
              <p class="text-fg font-serif text-sm sm:text-base leading-relaxed whitespace-pre-wrap">{translatedText()}</p>
            </div>
          </Show>

          {/* Audio player */}
          <Show when={audioUrl()}>
            <div class="bg-surface border-2 border-edge shadow-[var(--shadow)] p-3">
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
                    <svg viewBox="0 0 24 24" class="w-4 h-4 ml-0.5" fill="currentColor">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  }>
                    <svg viewBox="0 0 24 24" class="w-4 h-4" fill="currentColor">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                  </Show>
                </button>
                <div class="flex-1">
                  <audio
                    ref={audioRef}
                    src={audioUrl()}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                    controls
                    class="w-full h-8"
                  />
                </div>
                <a
                  href={audioUrl()}
                  download="sonotxt-audio.wav"
                  class="text-fg-faint hover:text-accent transition-colors flex-shrink-0"
                  title="Download"
                >
                  <span class="i-mdi-download w-5 h-5" />
                </a>
              </div>
            </div>
          </Show>

          {/* Loading */}
          <Show when={loading()}>
            <div class="text-center py-2">
              <span class="text-accent font-heading text-sm uppercase tracking-wider animate-pulse">
                {status()}
              </span>
            </div>
          </Show>
        </div>
      </div>

      {/* Bottom control strip */}
      <div class="bg-surface border-t-2 border-edge flex-shrink-0">
        {/* Speaker selector */}
        <div class="flex items-center gap-2 px-4 sm:px-6 lg:px-8 py-2 border-b border-edge-soft overflow-x-auto">
          <span class="text-[10px] text-fg-faint font-heading uppercase tracking-wider flex-shrink-0">Voice</span>
          <For each={SPEAKERS}>
            {(s) => (
              <button
                class={`px-3 py-1 font-heading text-xs uppercase tracking-wider transition-all flex-shrink-0 ${
                  speaker() === s.id
                    ? 'bg-accent text-white border-2 border-edge shadow-[2px_2px_0_0_var(--border)]'
                    : 'text-fg-muted hover:text-accent border-2 border-transparent'
                }`}
                onClick={() => setSpeaker(s.id)}
              >
                {s.name}
              </button>
            )}
          </For>
        </div>

        {/* Generate button */}
        <div class="flex items-center justify-center px-6 py-4 lg:py-5">
          <button
            class={`px-10 py-3 font-heading text-sm uppercase tracking-wider transition-all border-2 ${
              loading() || !text().trim()
                ? 'bg-page border-edge-soft text-fg-faint cursor-not-allowed'
                : 'bg-accent border-accent-strong text-white hover:bg-accent-hover active:scale-95 shadow-[var(--shadow)]'
            }`}
            disabled={loading() || !text().trim()}
            onClick={generate}
          >
            <Show when={loading()} fallback={
              <span class="flex items-center gap-2">
                <Show when={isUrl()} fallback={
                  <Show when={translateEnabled()} fallback={
                    <svg viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                    </svg>
                  }>
                    <span class="i-mdi-translate w-5 h-5" />
                  </Show>
                }>
                  <span class="i-mdi-web w-5 h-5" />
                </Show>
                {isUrl() ? 'FETCH & SPEAK' : translateEnabled() ? 'TRANSLATE & SPEAK' : 'GENERATE'}
              </span>
            }>
              <span class="flex items-center gap-2">
                <span class="i-mdi-loading w-5 h-5 animate-spin" />
                {status()}
              </span>
            </Show>
          </button>
        </div>
      </div>
    </div>
  )
}
