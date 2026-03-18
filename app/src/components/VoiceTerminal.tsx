import { createSignal, createEffect, For, Show, onMount, onCleanup } from 'solid-js'
import type { HistoryItem } from '../lib/store'

const API = import.meta.env.VITE_API_URL || 'https://api.sonotxt.com'

interface Props {
  onHistoryAdd?: (item: Omit<HistoryItem, 'id' | 'date'>) => void
  pipeline?: 'chat' | 'translate'
  onRecordingChange?: (recording: boolean) => void
}

interface Message {
  role: 'user' | 'assistant' | 'system'
  text: string
  translation?: string
  audioUrl?: string
  ts: number
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
  { code: 'it', name: 'Italian' },
]

export default function VoiceTerminal(props: Props) {
  const [messages, setMessages] = createSignal<Message[]>([])
  const [recording, setRecording] = createSignal(false)
  const [processing, setProcessing] = createSignal(false)
  const [phase, setPhase] = createSignal<'idle' | 'rec' | 'asr' | 'llm' | 'tts' | 'play'>('idle')
  const [speaker, setSpeaker] = createSignal(sessionStorage.getItem('sonotxt_voice') || 'ryan')
  const [pipelineMode, setPipelineMode] = createSignal<'chat' | 'translate'>(props.pipeline || 'chat')

  createEffect(() => {
    if (props.pipeline) setPipelineMode(props.pipeline)
  })
  createEffect(() => sessionStorage.setItem('sonotxt_voice', speaker()))

  // Tab title shows phase during processing
  const DEFAULT_TITLE = 'sonotxt - text to speech'
  const phaseLabel = (p: string) => {
    switch (p) {
      case 'rec': return 'Recording'
      case 'asr': return 'Transcribing'
      case 'llm': return pipelineMode() === 'translate' ? 'Translating' : 'Thinking'
      case 'tts': return 'Generating'
      case 'play': return 'Speaking'
      default: return ''
    }
  }
  createEffect(() => {
    const p = phase()
    if (p !== 'idle') {
      const label = phaseLabel(p)
      document.title = label ? `(${label}) sonotxt` : '(...) sonotxt'
    } else {
      document.title = DEFAULT_TITLE
    }
  })
  onCleanup(() => { document.title = DEFAULT_TITLE })
  createEffect(() => {
    if (processing()) {
      setProcElapsed(0)
      procTimer = setInterval(() => setProcElapsed(e => e + 1), 1000)
    } else {
      if (procTimer) { clearInterval(procTimer); procTimer = undefined }
    }
  })
  const [targetLang, setTargetLang] = createSignal(sessionStorage.getItem('sonotxt_lang') || 'en')
  createEffect(() => sessionStorage.setItem('sonotxt_lang', targetLang()))
  const [editingIdx, setEditingIdx] = createSignal<number | null>(null)
  const [editText, setEditText] = createSignal('')
  const [typedText, setTypedText] = createSignal('')
  const [showTextInput, setShowTextInput] = createSignal(false)
  const [playingUrl, setPlayingUrl] = createSignal('')
  const [copiedIdx, setCopiedIdx] = createSignal<number | null>(null)
  const [recElapsed, setRecElapsed] = createSignal(0)
  const [confirmClear, setConfirmClear] = createSignal(false)
  const [expandedMsgs, setExpandedMsgs] = createSignal<Set<number>>(new Set())
  const [transcriptCopied, setTranscriptCopied] = createSignal(false)
  const [isTextSend, setIsTextSend] = createSignal(false)
  const [procElapsed, setProcElapsed] = createSignal(0)
  const [showScrollBtn, setShowScrollBtn] = createSignal(false)
  const RATES = [0.75, 1, 1.25, 1.5, 2] as const
  const [replayRate, setReplayRate] = createSignal((() => {
    const stored = parseFloat(sessionStorage.getItem('sonotxt_rate') || '1')
    return RATES.includes(stored as typeof RATES[number]) ? stored : 1
  })())
  createEffect(() => sessionStorage.setItem('sonotxt_rate', String(replayRate())))

  let mediaRecorder: MediaRecorder | null = null
  let audioChunks: Blob[] = []
  let logRef: HTMLDivElement | undefined
  let textInputRef: HTMLInputElement | undefined
  let chatHistory: { role: string; content: string }[] = []
  let detectedLanguage = ''
  let currentAudio: HTMLAudioElement | null = null
  let recordStartTime = 0
  let recTimer: ReturnType<typeof setInterval> | undefined
  let procTimer: ReturnType<typeof setInterval> | undefined
  let clearTimer: ReturnType<typeof setTimeout> | undefined
  let abortController: AbortController | null = null

  onMount(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) startRecording()
      }
      if (e.key === 'Escape' && processing() && abortController) {
        abortController.abort()
        abortController = null
        // Stop any in-progress playback from speakAndCapture
        if (currentAudio) { currentAudio.pause(); currentAudio = null }
      } else if (e.key === 'Escape' && playingUrl() && currentAudio) {
        currentAudio.pause()
        currentAudio = null
        setPlayingUrl('')
      }
      if (e.key === '/' && !recording() && !(e.target as HTMLElement).matches('input,textarea,select,[contenteditable]')) {
        e.preventDefault()
        setShowTextInput(v => {
          if (!v) requestAnimationFrame(() => textInputRef?.focus())
          return !v
        })
      }
      if (e.key === 'r' && !e.repeat && playingUrl() && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
        const cur = replayRate()
        const next = RATES[(RATES.indexOf(cur as typeof RATES[number]) + 1) % RATES.length]
        setReplayRate(next)
        if (currentAudio) currentAudio.playbackRate = next
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
        e.preventDefault()
        e.stopPropagation()
        stopRecording()
      }
    }
    document.addEventListener('keydown', down, { capture: true })
    document.addEventListener('keyup', up, { capture: true })
    onCleanup(() => {
      document.removeEventListener('keydown', down, { capture: true })
      document.removeEventListener('keyup', up, { capture: true })
      currentAudio?.pause()
      abortController?.abort(); abortController = null
      if (recTimer) clearInterval(recTimer)
      if (procTimer) clearInterval(procTimer)
      if (clearTimer) clearTimeout(clearTimer)
      mediaRecorder?.stream.getTracks().forEach(t => t.stop())
      mediaRecorder = null
      props.onRecordingChange?.(false)
      messages().forEach(m => { if (m.audioUrl) URL.revokeObjectURL(m.audioUrl) })
    })
  })

  function scroll() {
    requestAnimationFrame(() => { if (logRef) logRef.scrollTo({ top: logRef.scrollHeight, behavior: 'smooth' }) })
  }

  function isNearBottom(): boolean {
    if (!logRef) return true
    return logRef.scrollHeight - logRef.scrollTop - logRef.clientHeight < 80
  }

  async function startRecording() {
    if (recording() || editingIdx() !== null) return
    // Reset any pending confirm-clear state
    if (confirmClear()) { setConfirmClear(false); if (clearTimer) { clearTimeout(clearTimer); clearTimer = undefined } }
    // Stop any replay to prevent mic from picking up playback audio
    if (playingUrl() && currentAudio) {
      currentAudio.pause()
      currentAudio = null
      setPlayingUrl('')
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioChunks = []
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data) }
      mediaRecorder.start(100) // collect chunks every 100ms
      recordStartTime = Date.now()
      setRecElapsed(0)
      recTimer = setInterval(() => {
        const elapsed = Date.now() - recordStartTime
        setRecElapsed(Math.floor(elapsed / 1000))
        if (elapsed > 300_000) { stopRecording(); addMsg('system', 'Recording stopped — 5 min limit') }
      }, 1000)
      setRecording(true); setPhase('rec'); props.onRecordingChange?.(true)
      navigator.vibrate?.(30)
    } catch (err) { addMsg('system', `Mic: ${(err instanceof Error ? err.message : 'access denied').slice(0, 200)}`) }
  }

  function stopRecording() {
    if (!recording() || !mediaRecorder) return
    if (recTimer) { clearInterval(recTimer); recTimer = undefined }
    const elapsed = Date.now() - recordStartTime
    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' })
      mediaRecorder?.stream.getTracks().forEach(t => t.stop())
      mediaRecorder = null; setRecording(false); props.onRecordingChange?.(false)
      navigator.vibrate?.(15)
      if (elapsed < 300) {
        addMsg('system', 'Too short — hold longer to record')
        return
      }
      await sendAudio(blob)
    }
    mediaRecorder.stop()
  }

  function addMsg(role: Message['role'], text: string, extra?: Partial<Message>) {
    setMessages(prev => {
      const next = [...prev, { role, text, ts: Date.now(), ...extra }]
      if (next.length > 200) {
        const evicted = next.splice(0, next.length - 200)
        evicted.forEach(m => { if (m.audioUrl) URL.revokeObjectURL(m.audioUrl) })
      }
      return next
    })
    scroll()
  }

  function updateMsg(idx: number, updates: Partial<Message>) {
    setMessages(prev => prev.map((m, i) => i === idx ? { ...m, ...updates } : m))
  }

  // Play/stop audio for a message
  function togglePlay(url: string) {
    if (playingUrl() === url) {
      currentAudio?.pause()
      currentAudio = null
      setPlayingUrl('')
      return
    }
    currentAudio?.pause()
    const a = new Audio(url)
    a.playbackRate = replayRate()
    currentAudio = a
    setPlayingUrl(url)
    a.onended = () => { setPlayingUrl(''); currentAudio = null }
    a.onerror = () => { setPlayingUrl(''); currentAudio = null }
    a.play().catch(() => { setPlayingUrl(''); currentAudio = null })
  }

  async function sendAudio(blob: Blob) {
    setIsTextSend(false)
    setProcessing(true)
    abortController = new AbortController()
    const signal = abortController.signal
    const t0 = performance.now()
    try {
      setPhase('asr')
      const { blobToWavBase64 } = await import('../lib/audioEncode')
      const audio_base64 = await blobToWavBase64(blob)
      const ar = await fetch(`${API}/api/voice/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_base64 }),
        signal,
      })
      if (!ar.ok) throw new Error(`ASR ${ar.status}`)
      const asr = await ar.json()
      const asrMs = Math.round(performance.now() - t0)

      const transcript = asr.transcript ?? asr.text ?? ''
      if (!transcript) {
        addMsg('system', 'No speech detected')
        abortController = null
        setProcessing(false); setPhase('idle')
        return
      }
      // Store user's recording audio (after transcript check to avoid blob leak)
      const recUrl = URL.createObjectURL(blob)
      addMsg('user', transcript, { audioUrl: recUrl })
      chatHistory.push({ role: 'user', content: transcript })
      if (chatHistory.length > 100) chatHistory = chatHistory.slice(-100)

      if (pipelineMode() === 'translate') {
        await handleTranslate(transcript, asrMs, t0, signal)
      } else {
        await handleChat(asrMs, t0, signal)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        addMsg('system', 'Cancelled')
      } else {
        addMsg('system', (err instanceof Error ? err.message : 'Something went wrong').slice(0, 200))
      }
    }
    abortController = null
    setProcessing(false); setPhase('idle')
  }

  async function sendText(text: string) {
    const trimmed = text.trim()
    if (!trimmed || processing() || editingIdx() !== null) return
    setTypedText('')
    setIsTextSend(true)
    setProcessing(true)
    abortController = new AbortController()
    const signal = abortController.signal
    setPhase('llm')
    const t0 = performance.now()
    try {
      addMsg('user', trimmed)
      chatHistory.push({ role: 'user', content: trimmed })
      if (chatHistory.length > 100) chatHistory = chatHistory.slice(-100)

      if (pipelineMode() === 'translate') {
        await handleTranslate(trimmed, 0, t0, signal)
      } else {
        await handleChat(0, t0, signal)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        addMsg('system', 'Cancelled')
      } else {
        addMsg('system', (err instanceof Error ? err.message : 'Something went wrong').slice(0, 200))
      }
    }
    abortController = null
    setProcessing(false); setPhase('idle')
    if (showTextInput()) requestAnimationFrame(() => textInputRef?.focus())
  }

  async function handleChat(asrMs: number, t0: number, signal?: AbortSignal) {
    setPhase('llm')
    const t1 = performance.now()
    const sys = detectedLanguage ? [{ role: 'system', content: `Always respond in ${detectedLanguage}.` }] : []
    // Cap history to last 40 messages to prevent unbounded growth
    const recent = chatHistory.slice(-40)
    const validMessages = [...sys, ...recent].filter(m => m.role && m.content)
    const lr = await fetch(`${API}/api/voice/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: validMessages }),
      signal,
    })
    if (!lr.ok) throw new Error(`LLM ${lr.status}`)
    const llm = await lr.json()
    const llmMs = Math.round(performance.now() - t1)
    const fullResponse = llm.response || llm.full_response || ''
    if (fullResponse) {
      chatHistory.push({ role: 'assistant', content: fullResponse })
      if (chatHistory.length > 100) chatHistory = chatHistory.slice(-100)
    }

    const { audioUrl, ttsMs, partial } = await speakAndCapture(llm.sentences || [], detectedLanguage || 'auto', signal)
    addMsg('assistant', fullResponse, { audioUrl })
    const totalMs = Math.round(performance.now() - t0)
    addMsg('system', partial
      ? `Cancelled — kept partial audio`
      : totalMs < 1000 ? `${totalMs}ms` : `${(totalMs / 1000).toFixed(1)}s`
    )

    if (audioUrl) {
      props.onHistoryAdd?.({
        type: 'speech',
        text: fullResponse,
        url: audioUrl,
        duration: Math.round((performance.now() - t0) / 1000),
        voice: speaker(),
      })
    }
  }

  async function handleTranslate(userText: string, asrMs: number, t0: number, signal?: AbortSignal) {
    const target = LANGUAGES.find(l => l.code === targetLang())
    if (!target) throw new Error('Invalid target language')
    const targetName = target.name

    setPhase('llm')
    const t1 = performance.now()
    const lr = await fetch(`${API}/api/voice/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: `You are a translator. Translate the user's message to ${targetName}. Only output the translation, nothing else.` },
          { role: 'user', content: userText },
        ]
      }),
      signal,
    })
    if (!lr.ok) throw new Error(`LLM ${lr.status}`)
    const llm = await lr.json()
    const llmMs = Math.round(performance.now() - t1)
    const fullResponse = llm.response || llm.full_response || ''

    const { audioUrl, ttsMs, partial } = await speakAndCapture(llm.sentences || [], targetLang(), signal)
    addMsg('assistant', fullResponse, { audioUrl, translation: userText })
    const totalMs = Math.round(performance.now() - t0)
    addMsg('system', partial
      ? `Cancelled — kept partial audio`
      : totalMs < 1000 ? `${totalMs}ms` : `${(totalMs / 1000).toFixed(1)}s`
    )

    if (audioUrl) {
      props.onHistoryAdd?.({
        type: 'translate',
        text: fullResponse,
        translation: userText,
        targetLang: targetLang(),
        url: audioUrl,
        duration: Math.round((performance.now() - t0) / 1000),
        voice: speaker(),
      })
    }
  }

  // Speak sentences with pipelined TTS — prefetch next while playing current.
  // No gap between sentences because audio N+1 is ready before audio N finishes.
  async function speakAndCapture(sentences: string[], language: string, signal?: AbortSignal): Promise<{ audioUrl: string; ttsMs: number[]; partial: boolean }> {
    const ttsMs: number[] = []
    const audioBuffers: ArrayBuffer[] = []
    let cancelled = false

    // Prefetch TTS for a sentence → returns ArrayBuffer
    async function fetchTts(text: string): Promise<ArrayBuffer | null> {
      const ts = performance.now()
      try {
        const tr = await fetch(`${API}/api/voice/synthesize`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, speaker: speaker(), language }),
          signal,
        })
        if (!tr.ok) { ttsMs.push(Math.round(performance.now() - ts)); return null }
        const ttsData = await tr.json()
        let binary: string
        try { binary = atob(ttsData.audio_base64) } catch { ttsMs.push(Math.round(performance.now() - ts)); return null }
        const buf = new ArrayBuffer(binary.length)
        const view = new Uint8Array(buf)
        for (let j = 0; j < binary.length; j++) view[j] = binary.charCodeAt(j)
        ttsMs.push(Math.round(performance.now() - ts))
        return buf
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') { cancelled = true }
        return null
      }
    }

    // Start fetching first sentence immediately
    let nextFetch: Promise<ArrayBuffer | null> | null = sentences.length > 0 ? fetchTts(sentences[0]) : null

    for (let i = 0; i < sentences.length; i++) {
      if (signal?.aborted || cancelled) { cancelled = true; break }

      // Wait for current sentence's audio (already fetching)
      setPhase('tts')
      const buf = await nextFetch
      nextFetch = null

      // Start prefetching NEXT sentence while we play this one
      if (i + 1 < sentences.length && !signal?.aborted) {
        nextFetch = fetchTts(sentences[i + 1])
      }

      if (!buf) continue
      audioBuffers.push(buf)

      if (signal?.aborted) { cancelled = true; break }
      setPhase('play')
      await playAudioBuffer(buf)
    }

    // Combine into one blob for replay
    let audioUrl = ''
    if (audioBuffers.length > 0) {
      const totalLen = audioBuffers.reduce((s, b) => s + b.byteLength, 0)
      const combined = new Uint8Array(totalLen)
      let offset = 0
      for (const b of audioBuffers) { combined.set(new Uint8Array(b), offset); offset += b.byteLength }
      audioUrl = URL.createObjectURL(new Blob([combined], { type: 'audio/wav' }))
    }

    return { audioUrl, ttsMs, partial: cancelled }
  }

  function playAudioBuffer(buf: ArrayBuffer): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
      const a = new Audio(url)
      const cleanup = () => {
        URL.revokeObjectURL(url)
        if (currentAudio === a) currentAudio = null
        resolve()
      }
      currentAudio = a
      a.onended = cleanup
      a.onerror = cleanup
      a.onpause = cleanup
      a.play().catch(cleanup)
    })
  }

  // Edit a user message and regenerate from that point
  function startEdit(idx: number) {
    const msg = messages()[idx]
    if (msg.role !== 'user') return
    setEditingIdx(idx)
    setEditText(msg.text)
  }

  async function submitEdit() {
    if (processing()) return
    const idx = editingIdx()
    if (idx === null) return
    const newText = editText().trim()
    if (!newText) { setEditingIdx(null); return }

    // Update the message
    updateMsg(idx, { text: newText })
    // Trim chatHistory: find the Nth user message in chatHistory matching this edit
    const userMsgCount = messages().slice(0, idx + 1).filter(m => m.role === 'user').length
    let usersSeen = 0
    let trimIdx = 0
    for (let i = 0; i < chatHistory.length; i++) {
      if (chatHistory[i].role === 'user') {
        usersSeen++
        if (usersSeen === userMsgCount) { trimIdx = i; break }
      }
    }
    chatHistory = chatHistory.slice(0, trimIdx)
    chatHistory.push({ role: 'user', content: newText })
    // Stop any playing audio before revoking URLs
    currentAudio?.pause()
    currentAudio = null
    setPlayingUrl('')
    // Remove all messages after this user message, revoking their blob URLs
    const removed = messages().slice(idx + 1)
    for (const m of removed) { if (m.audioUrl) URL.revokeObjectURL(m.audioUrl) }
    setMessages(prev => prev.slice(0, idx + 1))
    setEditingIdx(null)

    // Regenerate
    setIsTextSend(true)
    setProcessing(true)
    abortController = new AbortController()
    const signal = abortController.signal
    setPhase('llm')
    const t0 = performance.now()
    try {
      if (pipelineMode() === 'translate') {
        await handleTranslate(newText, 0, t0, signal)
      } else {
        await handleChat(0, t0, signal)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        addMsg('system', 'Cancelled')
      } else {
        addMsg('system', (err instanceof Error ? err.message : 'Something went wrong').slice(0, 200))
      }
    }
    abortController = null
    setProcessing(false); setPhase('idle')
  }

  function cancelEdit() { setEditingIdx(null) }

  async function shareMessage(msg: Message) {
    const shareText = msg.translation
      ? `${msg.text}\n\n(${msg.translation})`
      : msg.text

    if (msg.audioUrl && navigator.share && navigator.canShare) {
      try {
        const res = await fetch(msg.audioUrl)
        const blob = await res.blob()
        const slug = msg.text.trim().slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'audio'
        const file = new File([blob], `sonotxt-${msg.role === 'assistant' ? speaker() : 'recording'}-${slug}.wav`, { type: 'audio/wav' })
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ text: shareText, files: [file] })
          return
        }
      } catch {}
    }

    // Fallback: copy text
    try {
      await navigator.clipboard.writeText(shareText)
    } catch {}
  }

  function clear() {
    currentAudio?.pause()
    currentAudio = null
    setPlayingUrl('')
    messages().forEach(m => { if (m.audioUrl) URL.revokeObjectURL(m.audioUrl) })
    chatHistory = []; detectedLanguage = ''; setMessages([]); setEditingIdx(null)
    setTypedText('')
  }

  const phaseText = () => {
    switch (phase()) {
      case 'rec': return 'Listening'
      case 'asr': return 'Transcribing'
      case 'llm': return pipelineMode() === 'translate' ? 'Translating' : 'Thinking'
      case 'tts': return 'Generating voice'
      case 'play': return 'Speaking'
      default: return ''
    }
  }

  const ringActive = () => recording() || processing()

  return (
    <div class="flex-1 flex flex-col min-h-0">
      {/* Conversation area */}
      <div ref={logRef} class="flex-1 overflow-y-auto flex flex-col relative" onScroll={() => setShowScrollBtn(!isNearBottom())}>
        <Show when={messages().length === 0}>
          <div class="flex-1 flex flex-col items-center justify-center px-6 animate-fade-in">
            <div class="relative w-20 h-20 lg:w-24 lg:h-24 flex items-center justify-center mb-6">
              <div class="absolute inset-0 rounded-full bg-accent-soft border-2 border-accent-muted" />
              <div class="absolute inset-0 rounded-full border-2 border-accent-muted animate-ping opacity-10" />
              <Show when={pipelineMode() === 'translate'} fallback={
                <span class="relative i-mdi-microphone w-10 h-10 lg:w-12 lg:h-12 text-accent" />
              }>
                <span class="relative i-mdi-translate w-10 h-10 lg:w-12 lg:h-12 text-accent" />
              </Show>
            </div>
            <div class="font-heading text-base lg:text-lg text-fg uppercase tracking-wider mb-2">
              {pipelineMode() === 'translate' ? 'Translate' : 'Talk to me'}
            </div>
            <div class="text-[10px] text-fg-faint/50 font-heading uppercase tracking-wider mb-3">
              voice: {SPEAKERS.find(s => s.id === speaker())?.name || speaker()}
            </div>
            <div class="text-sm lg:text-base text-fg-muted text-center max-w-sm">
              <Show when={pipelineMode() === 'translate'} fallback={
                <>
                  <span class="hidden sm:inline">Hold <kbd class="px-2 py-1 bg-surface border-2 border-edge font-mono text-sm text-fg shadow-[var(--shadow)]">SPACE</kbd> or tap</span>
                  <span class="sm:hidden">Press & hold</span> the mic below, or <span class="i-mdi-keyboard inline-block w-4 h-4 align-text-bottom" /> type
                </>
              }>
                Speak or <span class="i-mdi-keyboard inline-block w-4 h-4 align-text-bottom" /> type in any language →{' '}
                <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-accent-soft border border-accent-muted text-accent font-heading text-xs uppercase tracking-wider">
                  {LANGUAGES.find(l => l.code === targetLang())?.name}
                </span>
              </Show>
            </div>
          </div>
        </Show>

        {/* Messages */}
        <div class="max-w-2xl mx-auto px-4 sm:px-6 py-4 w-full">
          <For each={messages()}>
            {(msg, idx) => (
              <Show when={msg.role !== 'system'} fallback={
                <div class="py-0.5 text-center" style="animation: msg-in 0.2s ease-out">
                  <span class="text-fg-faint font-mono text-[9px] sys-msg-fade">{msg.text}</span>
                </div>
              }>
                <div
                  class={`flex gap-3 py-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group`}
                  style="animation: msg-in 0.2s ease-out"
                >
                  <Show when={msg.role === 'assistant'}>
                    <div class="w-8 h-8 lg:w-9 lg:h-9 rounded-full bg-accent-strong text-white flex items-center justify-center flex-shrink-0">
                      <Show when={playingUrl() === msg.audioUrl && msg.audioUrl} fallback={
                        <Show when={pipelineMode() === 'translate'} fallback={
                          <span class="i-mdi-robot w-4 h-4 lg:w-5 lg:h-5" />
                        }>
                          <span class="i-mdi-translate w-4 h-4 lg:w-5 lg:h-5" />
                        </Show>
                      }>
                        <span class="flex items-end gap-px h-3.5">
                          <span class="eq-bar" /><span class="eq-bar" /><span class="eq-bar" />
                        </span>
                      </Show>
                    </div>
                  </Show>

                  <div class="flex flex-col max-w-[80%]">
                    {/* Message bubble */}
                    <div
                      class={`px-4 py-3 ${
                        msg.role === 'user'
                          ? 'bg-accent text-white border-2 border-edge shadow-[var(--shadow)]'
                          : 'bg-surface border-2 border-edge shadow-[var(--shadow)]'
                      }${msg.role === 'assistant' && msg.audioUrl ? ' cursor-pointer' : ''}`}
                      onClick={() => {
                        if (msg.role === 'assistant' && msg.audioUrl && editingIdx() === null && !processing() && !window.getSelection()?.toString()) {
                          togglePlay(msg.audioUrl)
                        }
                      }}
                    >
                      {/* Edit mode */}
                      <Show when={editingIdx() === idx()} fallback={
                        (() => {
                          const isLong = msg.text.length > 300
                          const expanded = () => expandedMsgs().has(msg.ts)
                          return (
                            <div class="relative">
                              <span class={`font-serif text-sm sm:text-base lg:text-lg leading-relaxed ${
                                msg.role === 'user' ? '' : 'text-fg'
                              } ${isLong && !expanded() ? 'line-clamp-4' : ''}`}>
                                {msg.text}
                              </span>
                              <Show when={isLong && !expanded()}>
                                <div class={`absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t pointer-events-none ${
                                  msg.role === 'user' ? 'from-accent to-transparent' : 'from-surface to-transparent'
                                }`} />
                                <button
                                  class={`relative w-full pt-1 text-[9px] font-heading uppercase tracking-wider transition-colors ${
                                    msg.role === 'user' ? 'text-white/70 hover:text-white' : 'text-accent hover:text-accent-hover'
                                  }`}
                                  onClick={(e) => { e.stopPropagation(); setExpandedMsgs(prev => { const next = new Set(prev); next.add(msg.ts); return next }) }}
                                >
                                  Show more
                                </button>
                              </Show>
                              <Show when={isLong && expanded()}>
                                <button
                                  class={`w-full pt-1 text-[9px] font-heading uppercase tracking-wider transition-colors ${
                                    msg.role === 'user' ? 'text-white/50 hover:text-white/70' : 'text-fg-faint hover:text-accent'
                                  }`}
                                  onClick={(e) => { e.stopPropagation(); setExpandedMsgs(prev => { const next = new Set(prev); next.delete(msg.ts); return next }) }}
                                >
                                  Show less
                                </button>
                              </Show>
                            </div>
                          )
                        })()
                      }>
                        <textarea
                          class="w-full bg-white/20 text-white font-serif text-sm sm:text-base rounded p-2 outline-none resize-none min-h-16"
                          value={editText()}
                          onInput={(e) => setEditText(e.currentTarget.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit() }
                            if (e.key === 'Escape') cancelEdit()
                          }}
                          ref={(el) => requestAnimationFrame(() => el.focus())}
                        />
                        <div class="flex gap-2 mt-2">
                          <button
                            class="px-3 py-1 text-xs bg-white/20 hover:bg-white/30 text-white font-heading uppercase tracking-wider"
                            onClick={submitEdit}
                          >
                            Regenerate
                          </button>
                          <button
                            class="px-3 py-1 text-xs text-white/70 hover:text-white font-heading uppercase tracking-wider"
                            onClick={cancelEdit}
                          >
                            Cancel
                          </button>
                        </div>
                      </Show>

                      {/* Translation subtitle */}
                      <Show when={msg.translation && editingIdx() !== idx()}>
                        <div class={`mt-2 pt-2 border-t text-xs italic ${
                          msg.role === 'user' ? 'border-white/20 text-white/70' : 'border-edge-soft text-fg-faint'
                        }`}>
                          <Show when={msg.role === 'assistant' && pipelineMode() === 'translate'}>
                            <span class="not-italic text-[9px] font-heading uppercase tracking-wider text-fg-faint/50 mr-1">original:</span>
                          </Show>
                          {msg.translation}
                        </div>
                      </Show>
                    </div>

                    {/* Action buttons — show on hover */}
                    <Show when={editingIdx() === null}>
                      <div class={`flex gap-1 mt-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity ${
                        msg.role === 'user' ? 'justify-end' : 'justify-start'
                      }`}>
                        {/* Play/replay */}
                        <Show when={msg.audioUrl}>
                          <button
                            class={`p-1 text-xs transition-colors ${
                              playingUrl() === msg.audioUrl ? 'text-accent' : 'text-fg-faint hover:text-accent'
                            }`}
                            onClick={() => togglePlay(msg.audioUrl!)}
                            title={playingUrl() === msg.audioUrl ? 'Stop' : 'Replay'}
                          >
                            <span class={playingUrl() === msg.audioUrl ? 'i-mdi-stop w-3.5 h-3.5' : 'i-mdi-play w-3.5 h-3.5'} />
                          </button>
                        </Show>
                        <Show when={msg.role === 'user' && !msg.audioUrl}>
                          <span class="p-1 text-fg-faint/40" title="Typed message">
                            <span class="i-mdi-keyboard w-3 h-3" />
                          </span>
                        </Show>

                        {/* Edit (user messages only) */}
                        <Show when={msg.role === 'user'}>
                          <button
                            class="p-1 text-fg-faint hover:text-accent text-xs transition-colors"
                            onClick={() => startEdit(idx())}
                            title="Edit & regenerate"
                          >
                            <span class="i-mdi-pencil w-3.5 h-3.5" />
                          </button>
                        </Show>

                        {/* Copy */}
                        <button
                          class="p-1 text-fg-faint hover:text-accent text-xs transition-colors"
                          onClick={() => {
                            navigator.clipboard.writeText(msg.text).then(() => {
                              setCopiedIdx(idx())
                              setTimeout(() => setCopiedIdx((c) => c === idx() ? null : c), 1500)
                            }).catch(() => {})
                          }}
                          title="Copy text"
                        >
                          <span class={`w-3.5 h-3.5 ${copiedIdx() === idx() ? 'i-mdi-check text-emerald-600' : 'i-mdi-content-copy'}`} />
                        </button>

                        {/* Share */}
                        <button
                          class="p-1 text-fg-faint hover:text-accent text-xs transition-colors"
                          onClick={() => shareMessage(msg)}
                          title="Share"
                        >
                          <span class="i-mdi-share-variant w-3.5 h-3.5" />
                        </button>

                        <Show when={playingUrl() === msg.audioUrl && msg.audioUrl && replayRate() !== 1}>
                          <span class="text-[8px] font-mono text-accent ml-auto tabular-nums">{replayRate()}x</span>
                        </Show>
                        <span class={`text-[9px] font-mono ${playingUrl() === msg.audioUrl && msg.audioUrl && replayRate() !== 1 ? '' : 'ml-auto'} ${msg.role === 'user' ? 'text-fg-faint/40' : 'text-fg-faint/50'}`}>
                          {new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>

                        {/* Download audio */}
                        <Show when={msg.audioUrl}>
                          <a
                            href={msg.audioUrl}
                            download={`sonotxt-${msg.role === 'assistant' ? speaker() : 'recording'}-${msg.text.trim().slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'audio'}.wav`}
                            class="p-1 text-fg-faint hover:text-accent text-xs transition-colors"
                            title="Download audio"
                          >
                            <span class="i-mdi-download w-3.5 h-3.5" />
                          </a>
                        </Show>
                      </div>
                    </Show>
                  </div>

                  <Show when={msg.role === 'user'}>
                    <div class="w-8 h-8 lg:w-9 lg:h-9 rounded-full bg-accent text-white flex items-center justify-center flex-shrink-0">
                      <span class="i-mdi-account w-4 h-4 lg:w-5 lg:h-5" />
                    </div>
                  </Show>
                </div>
              </Show>
            )}
          </For>

          {/* Live phase indicator */}
          <Show when={processing()}>
            <div class="flex gap-3 py-3 justify-start" style="animation: msg-in 0.2s ease-out">
              <div class="w-8 h-8 lg:w-9 lg:h-9 rounded-full bg-accent-strong text-white flex items-center justify-center flex-shrink-0">
                <span class="i-mdi-loading w-4 h-4 lg:w-5 lg:h-5 animate-spin" />
              </div>
              <div class="bg-surface border-2 border-edge px-4 py-2.5 shadow-[var(--shadow)]">
                <div class="flex items-center gap-3">
                  {(() => {
                    const spk = SPEAKERS.find(s => s.id === speaker())?.name || speaker()
                    const llmLabel = pipelineMode() === 'translate' ? 'Translate' : 'LLM'
                    const steps = isTextSend()
                      ? [{ id: 'llm', label: llmLabel }, { id: 'tts', label: spk }, { id: 'play', label: 'Play' }]
                      : [{ id: 'asr', label: 'ASR' }, { id: 'llm', label: llmLabel }, { id: 'tts', label: spk }, { id: 'play', label: 'Play' }]
                    const phaseOrder = isTextSend() ? ['llm', 'tts', 'play'] : ['asr', 'llm', 'tts', 'play']
                    const curIdx = () => phaseOrder.indexOf(phase())
                    return <For each={steps}>{(step, i) => (
                      <div class="flex items-center gap-1.5">
                        <Show when={i() > 0}>
                          <div class={`w-3 h-px ${i() < curIdx() ? 'bg-accent' : 'bg-edge-soft'}`} />
                        </Show>
                        <span class={`text-[9px] font-heading uppercase tracking-wider transition-colors ${
                          i() === curIdx() ? 'text-accent animate-pulse' : i() < curIdx() ? 'text-accent/50' : 'text-fg-faint/30'
                        }`}>
                          {step.label}
                        </span>
                      </div>
                    )}</For>
                  })()}
                  <Show when={procElapsed() > 0}>
                    <span class="text-[9px] text-fg-faint/50 font-mono tabular-nums ml-1">{procElapsed()}s</span>
                  </Show>
                </div>
              </div>
            </div>
          </Show>
        </div>
        <Show when={showScrollBtn() && messages().length > 0}>
          <button
            class="absolute bottom-3 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-surface border-2 border-edge shadow-[var(--shadow)] flex items-center justify-center text-fg-faint hover:text-accent transition-colors animate-fade-in z-10"
            onClick={() => { scroll(); setShowScrollBtn(false) }}
            title="Scroll to bottom"
          >
            <span class="i-mdi-chevron-down w-5 h-5" />
          </button>
        </Show>
      </div>

      {/* Bottom control strip */}
      <div class="bg-surface border-t-2 border-edge">
        {/* Controls row — voice + language + clear */}
        <div class="flex items-center gap-1.5 px-4 sm:px-6 lg:px-8 py-2 border-b border-edge-soft overflow-x-auto scroll-fade">
          <span class="text-[10px] text-fg-faint font-heading uppercase tracking-wider flex-shrink-0 mr-1">Voice</span>
          <For each={SPEAKERS}>
            {(s) => (
              <button
                class={`px-2.5 py-0.5 font-heading text-[10px] uppercase tracking-wider transition-all flex-shrink-0 flex items-center gap-1 ${
                  speaker() === s.id
                    ? 'bg-accent text-white border border-accent-strong'
                    : 'text-fg-muted hover:text-accent border border-transparent hover:border-edge-soft'
                }`}
                onClick={() => setSpeaker(s.id)}
              >
                <Show when={speaker() === s.id && playingUrl()}>
                  <span class="flex items-end gap-px h-2.5 w-2.5">
                    <span class="eq-bar" /><span class="eq-bar" /><span class="eq-bar" />
                  </span>
                </Show>
                <Show when={speaker() === s.id && recording()}>
                  <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                </Show>
                {s.name}
              </button>
            )}
          </For>
          <div class="flex-1" />
          <button
            class={`px-1.5 py-0.5 text-[10px] font-mono transition-colors tabular-nums flex-shrink-0 ${
              replayRate() !== 1
                ? 'text-accent bg-accent-soft border border-accent-muted'
                : 'text-fg-faint hover:text-accent border border-transparent'
            }`}
            onClick={() => {
              const cur = replayRate()
              const next = RATES[(RATES.indexOf(cur as typeof RATES[number]) + 1) % RATES.length]
              setReplayRate(next)
              if (currentAudio) currentAudio.playbackRate = next
            }}
            title="Replay speed (R)"
          >
            {replayRate() === 1 ? '1x' : `${replayRate()}x`}
          </button>
          <Show when={messages().some(m => m.role !== 'system')}>
            <button
              class={`transition-colors flex-shrink-0 p-0.5 ${transcriptCopied() ? 'text-emerald-600' : 'text-fg-faint hover:text-accent'}`}
              onClick={() => {
                const transcript = messages()
                  .filter(m => m.role !== 'system')
                  .map(m => {
                    const prefix = m.role === 'user' ? 'You' : 'Assistant'
                    let line = `${prefix}: ${m.text}`
                    if (m.translation) line += `\n  (${m.translation})`
                    return line
                  })
                  .join('\n\n')
                navigator.clipboard.writeText(transcript).then(() => {
                  setTranscriptCopied(true)
                  setTimeout(() => setTranscriptCopied(false), 2000)
                }).catch(() => {})
              }}
              title="Copy transcript"
            >
              <span class={`w-3.5 h-3.5 ${transcriptCopied() ? 'i-mdi-check' : 'i-mdi-content-copy'}`} />
            </button>
            <button
              class="transition-colors flex-shrink-0 p-0.5 text-fg-faint hover:text-accent"
              onClick={() => {
                const mode = pipelineMode() === 'translate' ? 'translate' : 'chat'
                const langNote = mode === 'translate' ? ` → ${LANGUAGES.find(l => l.code === targetLang())?.name || targetLang()}` : ''
                const header = `sonotxt ${mode} transcript${langNote}\n${'─'.repeat(40)}\n\n`
                const body = messages()
                  .filter(m => m.role !== 'system')
                  .map(m => {
                    const prefix = m.role === 'user' ? 'You' : 'Assistant'
                    let line = `${prefix}: ${m.text}`
                    if (m.translation) line += `\n  (${m.translation})`
                    return line
                  })
                  .join('\n\n')
                const blob = new Blob([header + body], { type: 'text/plain' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `sonotxt-${mode}-${new Date().toISOString().slice(0, 10)}.txt`
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                URL.revokeObjectURL(url)
              }}
              title="Download transcript"
            >
              <span class="i-mdi-download w-3.5 h-3.5" />
            </button>
            <Show when={typeof navigator !== 'undefined' && navigator.share}>
              <button
                class="transition-colors flex-shrink-0 p-0.5 text-fg-faint hover:text-accent"
                onClick={() => {
                  const mode = pipelineMode() === 'translate' ? 'translate' : 'chat'
                  const langNote = mode === 'translate' ? ` → ${LANGUAGES.find(l => l.code === targetLang())?.name || targetLang()}` : ''
                  const transcript = messages()
                    .filter(m => m.role !== 'system')
                    .map(m => {
                      const prefix = m.role === 'user' ? 'You' : 'Assistant'
                      let line = `${prefix}: ${m.text}`
                      if (m.translation) line += `\n  (${m.translation})`
                      return line
                    })
                    .join('\n\n')
                  navigator.share({ text: transcript, title: `sonotxt ${mode} transcript${langNote}` }).catch(() => {})
                }}
                title="Share transcript"
              >
                <span class="i-mdi-share w-3.5 h-3.5" />
              </button>
            </Show>
          </Show>
          <Show when={messages().length > 0}>
            <button
              class={`transition-colors flex-shrink-0 p-0.5 ${
                confirmClear() ? 'text-red-500 hover:text-red-600' : 'text-fg-faint hover:text-accent'
              }`}
              onClick={() => {
                if (confirmClear()) { clear(); setConfirmClear(false); if (clearTimer) { clearTimeout(clearTimer); clearTimer = undefined } }
                else { setConfirmClear(true); if (clearTimer) clearTimeout(clearTimer); clearTimer = setTimeout(() => { setConfirmClear(false); clearTimer = undefined }, 3000) }
              }}
              title={confirmClear() ? 'Tap again to clear' : 'Clear conversation'}
            >
              <Show when={confirmClear()} fallback={
                <span class="i-mdi-delete-outline w-3.5 h-3.5" />
              }>
                <span class="text-[9px] font-heading uppercase tracking-wider animate-pulse">Clear?</span>
              </Show>
            </button>
          </Show>
        </div>

        {/* Target language — only in translate mode */}
        <Show when={pipelineMode() === 'translate'}>
          <div class="flex items-center gap-2 px-4 sm:px-6 lg:px-8 py-1.5 border-b border-edge-soft">
            <span class="i-mdi-translate w-3.5 h-3.5 text-accent flex-shrink-0" />
            <span class="text-[10px] text-fg-faint font-heading uppercase tracking-wider flex-shrink-0">to</span>
            <select
              class="px-2 py-0.5 bg-page border border-edge-soft text-fg font-heading text-[10px] uppercase tracking-wider outline-none cursor-pointer focus:border-accent transition-colors"
              value={targetLang()}
              onChange={(e) => setTargetLang(e.currentTarget.value)}
            >
              <For each={LANGUAGES}>
                {(lang) => <option value={lang.code}>{lang.name}</option>}
              </For>
            </select>
          </div>
        </Show>

        {/* Main control row */}
        <Show when={showTextInput()}>
          <Show when={processing()}>
            <div class="flex items-center justify-center gap-2 px-4 py-1.5 border-b border-edge-soft">
              <span class="i-mdi-loading w-3 h-3 text-accent animate-spin" />
              <span class="text-accent text-[10px] font-heading uppercase tracking-wider animate-pulse">{phaseText()}</span>
            </div>
          </Show>
          <div class="flex items-center gap-2 px-4 py-2">
            <input
              type="text"
              class="flex-1 bg-page border border-edge-soft px-3 py-2 text-sm text-fg font-body outline-none focus:border-accent transition-colors"
              placeholder={processing() ? phaseText() + '...' : 'Type a message...'}
              value={typedText()}
              onInput={(e) => setTypedText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendText(typedText())
                } else if (e.key === 'Escape') {
                  if (!typedText().trim()) setShowTextInput(false)
                  else setTypedText('')
                }
              }}
              disabled={processing()}
              ref={(el) => { textInputRef = el; requestAnimationFrame(() => el.focus()) }}
            />
            <button
              class="btn-win primary px-3 py-2"
              onClick={() => sendText(typedText())}
              disabled={processing() || !typedText().trim()}
            >
              <Show when={processing()} fallback={<span class="i-mdi-send w-4 h-4" />}>
                <span class="i-mdi-loading w-4 h-4 animate-spin" />
              </Show>
            </button>
            <button
              class="btn-win px-2 py-2"
              onClick={() => setShowTextInput(false)}
              title="Switch to voice"
            >
              <span class="i-mdi-microphone w-4 h-4" />
            </button>
          </div>
        </Show>
        <Show when={!showTextInput()}>
        <div class="flex items-center justify-center gap-5 px-6 py-3">
          <div class="relative">
            <Show when={ringActive()}>
              <div class={`absolute inset-0 rounded-full ${
                recording() ? 'bg-red-200' : 'bg-accent-soft'
              } animate-ping opacity-40 -m-2`} />
            </Show>
            <button
              class={`relative w-14 h-14 lg:w-16 lg:h-16 rounded-full border-3 flex items-center justify-center transition-all ${
                recording()
                  ? 'bg-red-600 border-red-800 text-white scale-110'
                  : processing()
                  ? 'bg-page border-edge-soft text-fg-faint cursor-not-allowed'
                  : 'bg-accent border-accent-strong text-white hover:bg-accent-hover hover:scale-105 active:scale-95'
              }`}
              onMouseDown={() => !processing() && startRecording()}
              onMouseUp={stopRecording}
              onMouseLeave={() => recording() && stopRecording()}
              onTouchStart={(e) => { e.preventDefault(); !processing() && startRecording() }}
              onTouchEnd={(e) => { e.preventDefault(); stopRecording() }}
              disabled={processing()}
            >
              <Show when={recording()} fallback={
                <Show when={processing()} fallback={
                  <span class="i-mdi-microphone w-6 h-6 lg:w-7 lg:h-7" />
                }>
                  <span class="i-mdi-loading w-6 h-6 lg:w-7 lg:h-7 animate-spin" />
                </Show>
              }>
                <div class="w-5 h-5 lg:w-6 lg:h-6 bg-white rounded-sm animate-pulse" />
              </Show>
            </button>
          </div>

          <span class="text-xs text-fg-muted font-heading">
            <Show when={recording()}>
              <span class="text-red-600 animate-pulse uppercase tracking-wider">Release to send</span>
              <span class="ml-2 text-red-400 font-mono text-[10px]">{Math.floor(recElapsed() / 60)}:{(recElapsed() % 60).toString().padStart(2, '0')}</span>
            </Show>
            <Show when={processing()}>
              <span class="text-accent animate-pulse uppercase tracking-wider">{phaseText()}</span>
              <Show when={procElapsed() > 0}>
                <span class="ml-2 text-fg-faint/50 font-mono text-[10px] tabular-nums">{procElapsed()}s</span>
              </Show>
              <kbd class="hidden sm:inline ml-2 px-1 py-px bg-surface border border-edge text-[8px] font-mono text-fg-faint/30 shadow-[1px_1px_0_0_var(--border)]">ESC</kbd>
            </Show>
            <Show when={!recording() && !processing()}>
              {(() => {
                const userMsgs = messages().filter(m => m.role !== 'system')
                const count = userMsgs.length
                return (
                  <span class="text-fg-faint flex items-center gap-2">
                    <Show when={count > 0}>
                      <span class="text-[10px] text-fg-faint/50 font-mono">{count} {count === 1 ? 'msg' : 'msgs'}</span>
                      <span class="text-fg-faint/30">&middot;</span>
                    </Show>
                    <kbd class="hidden sm:inline px-1.5 py-0.5 bg-surface border-2 border-edge font-mono text-[10px] text-fg shadow-[var(--shadow)]">SPACE</kbd>
                    <span class="hidden sm:inline sm:ml-1.5 text-[10px] uppercase tracking-wider">talk</span>
                    <span class="hidden sm:inline text-fg-faint/30 mx-1">/</span>
                    <kbd class="hidden sm:inline px-1.5 py-0.5 bg-surface border-2 border-edge font-mono text-[10px] text-fg shadow-[var(--shadow)]">/</kbd>
                    <span class="hidden sm:inline sm:ml-1.5 text-[10px] uppercase tracking-wider">type</span>
                    <span class="sm:hidden text-[10px] uppercase tracking-wider">hold to talk</span>
                  </span>
                )
              })()}
            </Show>
          </span>

          <button
            class="w-8 h-8 flex items-center justify-center text-fg-faint hover:text-accent transition-colors"
            onClick={() => setShowTextInput(true)}
            title="Type instead"
          >
            <span class="i-mdi-keyboard w-5 h-5" />
          </button>
        </div>
        </Show>
      </div>
    </div>
  )
}
