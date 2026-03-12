import { createSignal, createEffect, For, Show, onMount, onCleanup } from 'solid-js'
import type { HistoryItem } from '../lib/store'

const API = import.meta.env.VITE_API_URL || 'https://api.sonotxt.com'

interface Props {
  onHistoryAdd?: (item: Omit<HistoryItem, 'id' | 'date'>) => void
  pipeline?: 'chat' | 'translate'
}

interface Message {
  role: 'user' | 'assistant' | 'system'
  text: string
  translation?: string
  audioUrl?: string
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

export default function VoiceTerminal(props: Props) {
  const [messages, setMessages] = createSignal<Message[]>([])
  const [recording, setRecording] = createSignal(false)
  const [processing, setProcessing] = createSignal(false)
  const [phase, setPhase] = createSignal<'idle' | 'rec' | 'asr' | 'llm' | 'tts' | 'play'>('idle')
  const [speaker, setSpeaker] = createSignal('ryan')
  const [pipelineMode, setPipelineMode] = createSignal<'chat' | 'translate'>(props.pipeline || 'chat')

  createEffect(() => {
    if (props.pipeline) setPipelineMode(props.pipeline)
  })
  const [targetLang, setTargetLang] = createSignal('en')
  const [editingIdx, setEditingIdx] = createSignal<number | null>(null)
  const [editText, setEditText] = createSignal('')
  const [playingUrl, setPlayingUrl] = createSignal('')

  let mediaRecorder: MediaRecorder | null = null
  let audioChunks: Blob[] = []
  let logRef: HTMLDivElement | undefined
  let chatHistory: { role: string; content: string }[] = []
  let detectedLanguage = ''
  let currentAudio: HTMLAudioElement | null = null

  onMount(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).matches('input,textarea,select,button')) {
        e.preventDefault()
        e.stopPropagation()
        if (!e.repeat) startRecording()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).matches('input,textarea,select,button')) {
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
    })
  })

  function scroll() {
    requestAnimationFrame(() => { if (logRef) logRef.scrollTop = logRef.scrollHeight })
  }

  async function startRecording() {
    if (recording() || processing() || editingIdx() !== null) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioChunks = []
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data) }
      mediaRecorder.start()
      setRecording(true); setPhase('rec')
    } catch (err) { addMsg('system', `Mic: ${err}`) }
  }

  function stopRecording() {
    if (!recording() || !mediaRecorder) return
    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' })
      mediaRecorder?.stream.getTracks().forEach(t => t.stop())
      mediaRecorder = null; setRecording(false)
      await sendAudio(blob)
    }
    mediaRecorder.stop()
  }

  function addMsg(role: Message['role'], text: string, extra?: Partial<Message>) {
    setMessages(prev => [...prev, { role, text, ...extra }]); scroll()
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
    currentAudio = a
    setPlayingUrl(url)
    a.onended = () => { setPlayingUrl(''); currentAudio = null }
    a.onerror = () => { setPlayingUrl(''); currentAudio = null }
    a.play().catch(() => { setPlayingUrl(''); currentAudio = null })
  }

  async function sendAudio(blob: Blob) {
    setProcessing(true)
    const t0 = performance.now()
    try {
      setPhase('asr')
      const buf = await blob.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      const audio_base64 = btoa(binary)
      const ar = await fetch(`${API}/api/voice/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_base64 }),
      })
      if (!ar.ok) throw new Error(`ASR ${ar.status}`)
      const asr = await ar.json()
      const asrMs = Math.round(performance.now() - t0)

      // Store user's recording audio
      const recUrl = URL.createObjectURL(blob)
      const transcript = asr.transcript || asr.text
      addMsg('user', transcript, { audioUrl: recUrl })
      chatHistory.push({ role: 'user', content: transcript })

      if (pipelineMode() === 'translate') {
        await handleTranslate(transcript, asrMs, t0)
      } else {
        await handleChat(asrMs, t0)
      }
    } catch (err) { addMsg('system', `${err}`) }
    setProcessing(false); setPhase('idle')
  }

  async function handleChat(asrMs: number, t0: number) {
    setPhase('llm')
    const t1 = performance.now()
    const sys = detectedLanguage ? [{ role: 'system', content: `Always respond in ${detectedLanguage}.` }] : []
    const lr = await fetch(`${API}/api/voice/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [...sys, ...chatHistory] }),
    })
    if (!lr.ok) throw new Error(`LLM ${lr.status}`)
    const llm = await lr.json()
    const llmMs = Math.round(performance.now() - t1)
    const fullResponse = llm.response || llm.full_response
    chatHistory.push({ role: 'assistant', content: fullResponse })

    const { audioUrl, ttsMs } = await speakAndCapture(llm.sentences, detectedLanguage || 'auto')
    addMsg('assistant', fullResponse, { audioUrl })
    addMsg('system', `${asrMs} + ${llmMs} + ${ttsMs.join('+')} = ${Math.round(performance.now() - t0)}ms`)

    props.onHistoryAdd?.({
      type: 'speech',
      text: fullResponse,
      url: audioUrl,
      duration: Math.round((performance.now() - t0) / 1000),
      voice: speaker(),
    })
  }

  async function handleTranslate(userText: string, asrMs: number, t0: number) {
    const target = LANGUAGES.find(l => l.code === targetLang())
    const targetName = target?.name || targetLang()

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
    })
    if (!lr.ok) throw new Error(`LLM ${lr.status}`)
    const llm = await lr.json()
    const llmMs = Math.round(performance.now() - t1)
    const fullResponse = llm.response || llm.full_response

    const { audioUrl, ttsMs } = await speakAndCapture(llm.sentences, targetLang())
    addMsg('assistant', fullResponse, { audioUrl, translation: userText })
    addMsg('system', `${asrMs} + ${llmMs} + ${ttsMs.join('+')} = ${Math.round(performance.now() - t0)}ms`)

    props.onHistoryAdd?.({
      type: 'translate',
      text: llm.full_response,
      translation: userText,
      targetLang: targetLang(),
      url: audioUrl,
      duration: Math.round((performance.now() - t0) / 1000),
      voice: speaker(),
    })
  }

  // Speak sentences and return combined audio blob URL
  async function speakAndCapture(sentences: string[], language: string): Promise<{ audioUrl: string; ttsMs: number[] }> {
    const ttsMs: number[] = []
    const audioBuffers: ArrayBuffer[] = []

    for (let i = 0; i < sentences.length; i++) {
      setPhase('tts')
      const ts = performance.now()
      const tr = await fetch(`${API}/api/voice/synthesize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sentences[i], speaker: speaker(), language }),
      })
      if (!tr.ok) { ttsMs.push(Math.round(performance.now() - ts)); continue }
      const ttsData = await tr.json()
      const binary = atob(ttsData.audio_base64)
      const buf = new ArrayBuffer(binary.length)
      const view = new Uint8Array(buf)
      for (let j = 0; j < binary.length; j++) view[j] = binary.charCodeAt(j)
      ttsMs.push(Math.round(performance.now() - ts))
      audioBuffers.push(buf)
      setPhase('play')
      await playAudioBuffer(buf)
    }

    // Combine into one blob for replay
    const totalLen = audioBuffers.reduce((s, b) => s + b.byteLength, 0)
    const combined = new Uint8Array(totalLen)
    let offset = 0
    for (const b of audioBuffers) { combined.set(new Uint8Array(b), offset); offset += b.byteLength }
    const audioUrl = URL.createObjectURL(new Blob([combined], { type: 'audio/wav' }))

    return { audioUrl, ttsMs }
  }

  function playAudioBuffer(buf: ArrayBuffer): Promise<void> {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
      const a = new Audio(url)
      a.onended = () => { URL.revokeObjectURL(url); resolve() }
      a.onerror = () => { URL.revokeObjectURL(url); resolve() }
      a.play().catch(() => resolve())
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
    const idx = editingIdx()
    if (idx === null) return
    const newText = editText().trim()
    if (!newText) { setEditingIdx(null); return }

    // Update the message
    updateMsg(idx, { text: newText })
    // Trim history to this point
    const userMsgCount = messages().slice(0, idx + 1).filter(m => m.role === 'user').length
    chatHistory = chatHistory.slice(0, (userMsgCount - 1) * 2)
    chatHistory.push({ role: 'user', content: newText })
    // Remove all messages after this user message
    setMessages(prev => prev.slice(0, idx + 1))
    setEditingIdx(null)

    // Regenerate
    setProcessing(true)
    const t0 = performance.now()
    try {
      if (pipelineMode() === 'translate') {
        await handleTranslate(newText, 0, t0)
      } else {
        await handleChat(0, t0)
      }
    } catch (err) { addMsg('system', `${err}`) }
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
        const file = new File([blob], 'sonotxt-audio.wav', { type: 'audio/wav' })
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

  function clear() { chatHistory = []; detectedLanguage = ''; setMessages([]); setEditingIdx(null) }

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
      <div ref={logRef} class="flex-1 overflow-y-auto flex flex-col">
        <Show when={messages().length === 0}>
          <div class="flex-1 flex flex-col items-center justify-center px-6">
            <div class="w-20 h-20 lg:w-24 lg:h-24 rounded-full bg-accent-soft border-2 border-accent-muted flex items-center justify-center mb-6">
              <Show when={pipelineMode() === 'translate'} fallback={
                <svg viewBox="0 0 24 24" class="w-10 h-10 lg:w-12 lg:h-12 text-accent" fill="currentColor">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              }>
                <span class="i-mdi-translate w-10 h-10 lg:w-12 lg:h-12 text-accent" />
              </Show>
            </div>
            <div class="font-heading text-base lg:text-lg text-fg uppercase tracking-wider mb-2">
              {pipelineMode() === 'translate' ? 'Translate' : 'Talk to me'}
            </div>
            <div class="text-sm lg:text-base text-fg-muted text-center max-w-sm">
              <Show when={pipelineMode() === 'translate'} fallback={
                <>Hold <kbd class="px-2 py-1 bg-surface border-2 border-edge font-mono text-sm text-fg shadow-[var(--shadow)]">SPACE</kbd> or press the mic button</>
              }>
                Speak in any language → <span class="text-accent font-medium">{LANGUAGES.find(l => l.code === targetLang())?.name}</span>
              </Show>
            </div>
          </div>
        </Show>

        {/* Messages */}
        <div class="max-w-2xl mx-auto px-4 sm:px-6 py-4 w-full">
          <For each={messages()}>
            {(msg, idx) => (
              <Show when={msg.role !== 'system'} fallback={
                <div class="py-1 text-center">
                  <span class="text-fg-faint font-mono text-[10px] lg:text-xs">{msg.text}</span>
                </div>
              }>
                <div class={`flex gap-3 py-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group`}>
                  <Show when={msg.role === 'assistant'}>
                    <div class="w-8 h-8 lg:w-9 lg:h-9 rounded-full bg-accent-strong text-white flex items-center justify-center flex-shrink-0">
                      <Show when={pipelineMode() === 'translate'} fallback={
                        <span class="i-mdi-robot w-4 h-4 lg:w-5 lg:h-5" />
                      }>
                        <span class="i-mdi-translate w-4 h-4 lg:w-5 lg:h-5" />
                      </Show>
                    </div>
                  </Show>

                  <div class="flex flex-col max-w-[80%]">
                    {/* Message bubble */}
                    <div class={`px-4 py-3 ${
                      msg.role === 'user'
                        ? 'bg-accent text-white border-2 border-edge shadow-[var(--shadow)]'
                        : 'bg-surface border-2 border-edge shadow-[var(--shadow)]'
                    }`}>
                      {/* Edit mode */}
                      <Show when={editingIdx() === idx()} fallback={
                        <span class={`font-serif text-sm sm:text-base lg:text-lg leading-relaxed ${
                          msg.role === 'user' ? '' : 'text-fg'
                        }`}>
                          {msg.text}
                        </span>
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
                          {msg.translation}
                        </div>
                      </Show>
                    </div>

                    {/* Action buttons — show on hover */}
                    <Show when={editingIdx() === null}>
                      <div class={`flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity ${
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
                          onClick={() => navigator.clipboard.writeText(msg.text)}
                          title="Copy text"
                        >
                          <span class="i-mdi-content-copy w-3.5 h-3.5" />
                        </button>

                        {/* Share */}
                        <button
                          class="p-1 text-fg-faint hover:text-accent text-xs transition-colors"
                          onClick={() => shareMessage(msg)}
                          title="Share"
                        >
                          <span class="i-mdi-share-variant w-3.5 h-3.5" />
                        </button>

                        {/* Download audio */}
                        <Show when={msg.audioUrl}>
                          <a
                            href={msg.audioUrl}
                            download={`sonotxt-${msg.role}.wav`}
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
            <div class="flex gap-3 py-3 justify-start">
              <div class="w-8 h-8 lg:w-9 lg:h-9 rounded-full bg-accent-strong text-white flex items-center justify-center flex-shrink-0">
                <span class="i-mdi-loading w-4 h-4 lg:w-5 lg:h-5 animate-spin" />
              </div>
              <div class="bg-surface border-2 border-edge px-4 py-3 shadow-[var(--shadow)]">
                <span class="text-accent font-heading text-sm lg:text-base uppercase tracking-wider animate-pulse">
                  {phaseText()}...
                </span>
              </div>
            </div>
          </Show>
        </div>
      </div>

      {/* Bottom control strip */}
      <div class="bg-surface border-t-2 border-edge">
        {/* Language + clear row */}
        <div class="flex items-center gap-2 px-4 sm:px-6 lg:px-8 py-2 border-b border-edge-soft overflow-x-auto">
          <Show when={pipelineMode() === 'translate'}>
            <span class="text-[10px] text-fg-faint font-heading uppercase tracking-wider flex-shrink-0">Translate to</span>
            <select
              class="px-2 py-1 bg-surface border-2 border-edge text-fg font-heading text-xs uppercase tracking-wider outline-none cursor-pointer"
              value={targetLang()}
              onChange={(e) => setTargetLang(e.currentTarget.value)}
            >
              <For each={LANGUAGES}>
                {(lang) => <option value={lang.code}>{lang.name}</option>}
              </For>
            </select>
          </Show>

          <div class="flex-1" />
          <Show when={messages().length > 0}>
            <button
              class="text-fg-faint hover:text-accent transition-colors flex-shrink-0"
              onClick={clear}
              title="Clear"
            >
              <span class="i-mdi-delete-outline w-4 h-4" />
            </button>
          </Show>
        </div>

        {/* Speaker selector row */}
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

        {/* Main control row */}
        <div class="flex items-center justify-center gap-6 px-6 py-4 lg:py-5">
          <span class="text-xs text-fg-faint font-mono w-12 text-right">
            {messages().filter(m => m.role === 'user').length || ''}
          </span>

          <div class="relative">
            <Show when={ringActive()}>
              <div class={`absolute inset-0 rounded-full ${
                recording() ? 'bg-red-200' : 'bg-accent-soft'
              } animate-ping opacity-40`} style="margin: -8px" />
            </Show>
            <button
              class={`relative w-16 h-16 lg:w-20 lg:h-20 rounded-full border-3 flex items-center justify-center transition-all ${
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
                  <svg viewBox="0 0 24 24" class="w-7 h-7 lg:w-8 lg:h-8" fill="currentColor">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                  </svg>
                }>
                  <span class="i-mdi-loading w-7 h-7 lg:w-8 lg:h-8 animate-spin" />
                </Show>
              }>
                <div class="w-6 h-6 lg:w-7 lg:h-7 bg-white rounded-sm animate-pulse" />
              </Show>
            </button>
          </div>

          <span class="text-sm lg:text-base text-fg-muted font-heading w-40">
            <Show when={recording()}>
              <span class="text-red-600 animate-pulse">Release to send</span>
            </Show>
            <Show when={processing()}>
              <span class="text-accent animate-pulse">{phaseText()}</span>
            </Show>
            <Show when={!recording() && !processing()}>
              <span class="text-fg-faint">
                <kbd class="px-1.5 py-0.5 bg-page border border-edge-soft font-mono text-xs">SPACE</kbd> to talk
              </span>
            </Show>
          </span>
        </div>
      </div>
    </div>
  )
}
