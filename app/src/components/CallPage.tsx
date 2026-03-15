import { createSignal, createEffect, onCleanup, Show, For, onMount, lazy, Suspense } from 'solid-js'
import { useStore } from '../lib/store'
import type { AvatarParams } from './Avatar'

const Avatar = lazy(() => import('./Avatar'))

const API = import.meta.env.VITE_API_URL || 'https://api.sonotxt.com'
const ALLOWED_AVATARS = ['haru', 'hiyori', 'mao', 'mark', 'natori', 'rice', 'wanko']
const WS_API = API.startsWith('https://') ? API.replace('https://', 'wss://') : API.replace('http://', 'ws://')

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

interface ChatMessage {
  from: 'me' | 'peer' | 'system'
  text: string
  translation?: string
  audioUrl?: string
  ts: number
}

interface Props {
  code?: string
  fromLang?: string
  toLang?: string
  onClose: () => void
}

export default function CallPage(props: Props) {
  const { state: store } = useStore()

  const [stage, setStage] = createSignal<'setup' | 'waiting' | 'connected' | 'ended'>('setup')
  const [myLang, setMyLang] = createSignal(
    props.toLang && LANGUAGES.some(l => l.code === props.toLang) ? props.toLang
      : sessionStorage.getItem('sonotxt_call_lang') || 'en'
  )
  const [peerLang, setPeerLang] = createSignal('')
  const [targetLang, setTargetLang] = createSignal('')
  const [code, setCode] = createSignal(props.code || '')
  const [messages, setMessages] = createSignal<ChatMessage[]>([])
  const [chatInput, setChatInput] = createSignal('')
  const [recording, setRecording] = createSignal(false)
  const [processing, setProcessing] = createSignal(false)
  const [phase, setPhase] = createSignal('')
  const [peerNum, setPeerNum] = createSignal(0)
  const [copied, setCopied] = createSignal(false)
  const [transcriptCopied, setTranscriptCopied] = createSignal(false)
  const [muted, setMuted] = createSignal(false)
  const [avatarEnabled, setAvatarEnabled] = createSignal(true)
  const [billing, setBilling] = createSignal<'creator' | 'split'>('creator')
  const [mouthOpen, setMouthOpen] = createSignal(0)
  const [peerParams, setPeerParams] = createSignal<AvatarParams>({})
  const [peerAvatar, setPeerAvatar] = createSignal<string | null>(null)
  const [callElapsed, setCallElapsed] = createSignal(0)
  const [recElapsed, setRecElapsed] = createSignal(0)
  const [procElapsed, setProcElapsed] = createSignal(0)
  const [copiedIdx, setCopiedIdx] = createSignal<number | null>(null)
  const [showScrollBtn, setShowScrollBtn] = createSignal(false)
  const [playingMsgTs, setPlayingMsgTs] = createSignal<number | null>(null)
  const [unreadCount, setUnreadCount] = createSignal(0)
  const [peerTyping, setPeerTyping] = createSignal(false)
  const [expandedMsgs, setExpandedMsgs] = createSignal<Set<number>>(new Set())
  const RATES = [0.75, 1, 1.25, 1.5, 2] as const
  const [replayRate, setReplayRate] = createSignal((() => {
    const stored = parseFloat(sessionStorage.getItem('sonotxt_rate') || '1')
    return RATES.includes(stored as typeof RATES[number]) ? stored : 1
  })())
  const [confirmHangup, setConfirmHangup] = createSignal(false)
  const [waitElapsed, setWaitElapsed] = createSignal(0)
  let peerTypingTimer: ReturnType<typeof setTimeout> | undefined
  let hangupTimer: ReturnType<typeof setTimeout> | undefined
  let waitTimer: ReturnType<typeof setInterval> | undefined

  let procTimer: ReturnType<typeof setInterval> | undefined
  createEffect(() => {
    if (processing()) {
      setProcElapsed(0)
      procTimer = setInterval(() => setProcElapsed(e => e + 1), 1000)
    } else {
      if (procTimer) { clearInterval(procTimer); procTimer = undefined }
    }
  })
  onCleanup(() => { if (procTimer) clearInterval(procTimer) })
  createEffect(() => sessionStorage.setItem('sonotxt_call_lang', myLang()))

  const isCreator = () => peerNum() === 1
  // Creator pays, or split — determines who sends auth token with API calls
  const iPayForThis = () => billing() === 'split' || isCreator()

  let ws: WebSocket | null = null
  let pc: RTCPeerConnection | null = null
  let dataChannel: RTCDataChannel | null = null
  let mediaRecorder: MediaRecorder | null = null
  let audioChunks: Blob[] = []
  let localStream: MediaStream | null = null
  let chatRef: HTMLDivElement | undefined
  let recordStartTime = 0
  let recTimer: ReturnType<typeof setInterval> | undefined
  let callTimer: ReturnType<typeof setInterval> | undefined
  let callStartTime = 0
  let inlineAudio: HTMLAudioElement | null = null

  function formatCallTime(secs: number): string {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const DEFAULT_TITLE = 'sonotxt - text to speech'

  // Tab title reflects call state
  createEffect(() => {
    const s = stage()
    if (s === 'setup' || s === 'ended') {
      document.title = DEFAULT_TITLE
      return
    }
    if (s === 'waiting') {
      document.title = '(Waiting) sonotxt'
      return
    }
    // 'connected' — subscribe to live signals only in this branch
    const label = recording() ? 'Recording' : processing() ? phase() || 'Processing' : `Connected ${formatCallTime(callElapsed())}`
    document.title = `(${label}) sonotxt`
  })
  onCleanup(() => { document.title = DEFAULT_TITLE })

  // Start/stop call timer based on stage changes
  createEffect(() => {
    if (stage() === 'connected') {
      callStartTime = Date.now()
      setCallElapsed(0)
      callTimer = setInterval(() => setCallElapsed(Math.floor((Date.now() - callStartTime) / 1000)), 1000)
    } else if (callTimer) {
      clearInterval(callTimer)
      callTimer = undefined
    }
  })

  // Waiting elapsed timer
  createEffect(() => {
    if (stage() === 'waiting') {
      setWaitElapsed(0)
      if (waitTimer) clearInterval(waitTimer)
      waitTimer = setInterval(() => setWaitElapsed(e => e + 1), 1000)
    } else {
      if (waitTimer) { clearInterval(waitTimer); waitTimer = undefined }
    }
  })

  onCleanup(() => { if (callTimer) clearInterval(callTimer); if (peerTypingTimer) clearTimeout(peerTypingTimer); if (hangupTimer) clearTimeout(hangupTimer); if (waitTimer) clearInterval(waitTimer) })

  function scrollChat() {
    requestAnimationFrame(() => {
      if (chatRef) chatRef.scrollTop = chatRef.scrollHeight
    })
  }

  function isNearBottom(): boolean {
    if (!chatRef) return true
    return chatRef.scrollHeight - chatRef.scrollTop - chatRef.clientHeight < 80
  }

  function addMsg(from: ChatMessage['from'], text: string, extra?: Partial<ChatMessage>) {
    const wasNearBottom = isNearBottom()
    setMessages(prev => {
      const next = [...prev, { from, text, ts: Date.now(), ...extra }]
      if (next.length > 200) {
        const evicted = next.splice(0, next.length - 200)
        evicted.forEach(m => { if (m.audioUrl) URL.revokeObjectURL(m.audioUrl) })
      }
      return next
    })
    if (wasNearBottom) {
      scrollChat()
      setUnreadCount(0)
    } else if (from !== 'system') {
      setUnreadCount(c => c + 1)
    }
  }

  // Auth headers for billing — creator pays by default, split means both send tokens
  function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('sonotxt_token')
    if (token && iPayForThis()) {
      return { 'Authorization': `Bearer ${token}` }
    }
    return {}
  }

  // --- Session creation / joining ---

  async function createSession() {
    try {
      const res = await fetch(`${API}/api/p2p/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ language: myLang() }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const safeCode = (data.code || '').replace(/[^a-z0-9]/g, '')
      if (!safeCode) throw new Error('Invalid session code')
      setCode(safeCode)
      setStage('waiting')
      connectWs(safeCode)
    } catch (err) {
      addMsg('system', `Failed to create session: ${(err instanceof Error ? err.message : 'Something went wrong').slice(0, 200)}`)
    }
  }

  function joinSession() {
    const safeCode = code().replace(/[^a-z0-9]/g, '')
    if (!safeCode) return
    setCode(safeCode)
    setStage('waiting')
    connectWs(safeCode)
  }

  // --- WebSocket signaling ---

  function connectWs(sessionCode: string) {
    ws = new WebSocket(`${WS_API}/ws/p2p/${sessionCode}`)

    ws.onopen = () => {
      addMsg('system', 'Connected to signaling server')
    }

    ws.onmessage = async (ev) => {
      let msg: any
      try { msg = JSON.parse(ev.data) } catch { return }

      switch (msg.type) {
        case 'joined':
          setPeerNum(msg.peer)
          if (msg.creator_lang && msg.peer === 2 && LANGUAGES.some(l => l.code === msg.creator_lang)) {
            setPeerLang(msg.creator_lang)
          }
          addMsg('system', `You are peer ${msg.peer}${msg.peer === 1 ? ' (host)' : ''}`)
          break

        case 'peer_joined':
          addMsg('system', 'Peer joined — starting call')
          if (peerNum() === 1) {
            await startWebRTC(true)
          }
          break

        case 'offer':
          try {
            if (!pc) await startWebRTC(false)
            await pc!.setRemoteDescription(new RTCSessionDescription(msg.sdp))
            const answer = await pc!.createAnswer()
            await pc!.setLocalDescription(answer)
            ws!.send(JSON.stringify({ type: 'answer', sdp: answer }))
          } catch (e) {
            addMsg('system', `Connection error: ${(e instanceof Error ? e.message : 'Something went wrong').slice(0, 200)}`)
          }
          break

        case 'answer':
          try { await pc?.setRemoteDescription(new RTCSessionDescription(msg.sdp)) } catch {}
          break

        case 'ice':
          if (msg.candidate) {
            try { await pc?.addIceCandidate(new RTCIceCandidate(msg.candidate)) } catch {}
          }
          break

        case 'chat':
          if (typeof msg.text === 'string' && msg.text.length <= 10_000) {
            handlePeerChat(msg.text, msg.lang)
          }
          break

        case 'typing':
          setPeerTyping(true)
          if (peerTypingTimer) clearTimeout(peerTypingTimer)
          peerTypingTimer = setTimeout(() => setPeerTyping(false), 3000)
          if (isNearBottom()) requestAnimationFrame(() => scrollChat())
          break

        case 'peer_left':
          addMsg('system', 'Peer disconnected')
          setStage('ended')
          break

        case 'error':
          addMsg('system', `Error: ${typeof msg.message === 'string' ? msg.message.slice(0, 200) : 'Unknown error'}`)
          break
      }
    }

    ws.onclose = () => {
      addMsg('system', 'Disconnected from signaling')
    }
  }

  // --- WebRTC ---

  async function startWebRTC(isOfferer: boolean) {
    pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ]
    })

    if (isOfferer) {
      dataChannel = pc.createDataChannel('sonotxt', { ordered: true })
      setupDataChannel(dataChannel)
    } else {
      pc.ondatachannel = (ev) => {
        dataChannel = ev.channel
        setupDataChannel(dataChannel)
      }
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ice', candidate: ev.candidate }))
      }
    }

    pc.onconnectionstatechange = () => {
      if (pc?.connectionState === 'connected') {
        setStage('connected')
        addMsg('system', 'P2P connected — you can talk and chat')
      } else if (pc?.connectionState === 'disconnected' || pc?.connectionState === 'failed') {
        // Clean up resources — don't revoke blob URLs, ended UI still renders messages
        pc?.close(); pc = null
        ws?.close(); ws = null
        localStream?.getTracks().forEach(t => t.stop())
        localStream = null; dataChannel = null
        setConfirmHangup(false); if (hangupTimer) { clearTimeout(hangupTimer); hangupTimer = undefined }
        setStage('ended')
        addMsg('system', 'Connection lost')
      }
    }

    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      for (const track of localStream.getAudioTracks()) {
        pc.addTrack(track, localStream)
      }
    } catch {
      addMsg('system', 'Microphone access denied')
    }

    pc.ontrack = () => {}

    if (isOfferer) {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      ws!.send(JSON.stringify({ type: 'offer', sdp: offer }))
    }
  }

  function setupDataChannel(dc: RTCDataChannel) {
    dc.onopen = () => {
      addMsg('system', 'Data channel open')
      dc.send(JSON.stringify({ type: 'lang', lang: myLang() }))
      dc.send(JSON.stringify({ type: 'billing', mode: billing() }))
      // Tell peer our avatar
      dc.send(JSON.stringify({ type: 'avatar', avatar: store.user?.avatar || null }))
    }

    dc.onmessage = async (ev) => {
      if (typeof ev.data === 'string' && ev.data.length > 2_000_000) return
      let msg: any
      try { msg = JSON.parse(ev.data) } catch { return }
      if (msg.type === 'lang') {
        const lang = LANGUAGES.find(l => l.code === msg.lang)
        if (!lang) return
        setPeerLang(msg.lang)
        addMsg('system', `Peer speaks ${lang.name}`)
      } else if (msg.type === 'avatar') {
        if (msg.avatar === null || ALLOWED_AVATARS.includes(msg.avatar)) {
          setPeerAvatar(msg.avatar)
        }
      } else if (msg.type === 'face') {
        // Peer's blendshape params — validate type and cap size
        if (msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params)) {
          const safe: AvatarParams = {}
          const keys = Object.keys(msg.params).slice(0, 64)
          for (const k of keys) {
            if (typeof (msg.params as any)[k] === 'number') {
              safe[k as keyof AvatarParams] = Math.max(-1, Math.min(2, (msg.params as any)[k]))
            }
          }
          setPeerParams(safe)
        }
      } else if (msg.type === 'billing') {
        // Only accept billing override from creator (we must be peer 2)
        if (msg.mode === 'split' && peerNum() === 2) setBilling('split')
      } else if (msg.type === 'translated_audio') {
        // Play translated audio from peer — cap at 10MB base64 to prevent memory bombs
        if (!msg.audio_base64 || msg.audio_base64.length > 10_000_000) return
        let binary: string
        try { binary = atob(msg.audio_base64) } catch { return }
        const buf = new ArrayBuffer(binary.length)
        const view = new Uint8Array(buf)
        for (let i = 0; i < binary.length; i++) view[i] = binary.charCodeAt(i)
        const blob = new Blob([buf], { type: 'audio/wav' })
        const url = URL.createObjectURL(blob)
        const original = typeof msg.original === 'string' ? msg.original.slice(0, 10_000) : ''
        const translated = typeof msg.translated === 'string' ? msg.translated.slice(0, 10_000) : ''
        addMsg('peer', original, { translation: translated, audioUrl: url })
        if (!muted()) {
          const a = new Audio(url)
          // Don't revoke on first play — message holds a reference for replay
          a.play().catch(() => {})
        }
      } else if (msg.type === 'chat') {
        if (typeof msg.text === 'string' && msg.text.length <= 10_000) {
          handlePeerChat(msg.text, msg.lang)
        }
      }
    }
  }

  // --- Translation pipeline ---

  async function handlePeerChat(text: string, lang: string) {
    setPeerTyping(false)
    if (peerTypingTimer) { clearTimeout(peerTypingTimer); peerTypingTimer = undefined }
    if (lang === myLang()) {
      addMsg('peer', text)
      return
    }
    try {
      const targetName = LANGUAGES.find(l => l.code === myLang())?.name || myLang()
      const res = await fetch(`${API}/api/voice/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: `Translate to ${targetName}. Output only the translation.` },
            { role: 'user', content: text },
          ]
        }),
      })
      if (!res.ok) throw new Error('Translation failed')
      const data = await res.json()
      const translated = data.response || data.full_response || text
      addMsg('peer', translated, { translation: text })
    } catch {
      addMsg('peer', text)
    }
  }

  // --- Voice recording + translate + send ---

  async function startRecording() {
    if (recording() || processing()) return
    try {
      // Stop any lingering stream from a prior recording
      mediaRecorder?.stream.getTracks().forEach(t => t.stop())
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      audioChunks = []
      mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data) }
      mediaRecorder.start()
      recordStartTime = Date.now()
      setRecElapsed(0)
      recTimer = setInterval(() => {
        const elapsed = Date.now() - recordStartTime
        setRecElapsed(Math.floor(elapsed / 1000))
        if (elapsed > 300_000) {
          stopRecording()
          addMsg('system', 'Recording stopped — 5 min limit')
        }
      }, 1000)
      setRecording(true)
      setMouthOpen(0.6) // Simple mouth-open indicator while recording
      navigator.vibrate?.(30)
    } catch (err) {
      addMsg('system', `Mic error: ${(err instanceof Error ? err.message : 'Something went wrong').slice(0, 200)}`)
    }
  }

  function stopRecording() {
    if (!recording() || !mediaRecorder) return
    if (recTimer) { clearInterval(recTimer); recTimer = undefined }
    setMouthOpen(0)
    navigator.vibrate?.(15)
    const elapsed = Date.now() - recordStartTime
    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' })
      mediaRecorder?.stream.getTracks().forEach(t => t.stop())
      mediaRecorder = null
      setRecording(false)
      if (elapsed < 300) {
        addMsg('system', 'Too short — hold longer to record')
        return
      }
      await processAndSend(blob)
    }
    mediaRecorder.stop()
  }

  async function processAndSend(blob: Blob) {
    setProcessing(true)
    try {
      // 1. ASR
      setPhase('Transcribing')
      const buf = await blob.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      const audio_base64 = btoa(binary)

      const asrRes = await fetch(`${API}/api/voice/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ audio_base64 }),
      })
      if (!asrRes.ok) throw new Error(`ASR ${asrRes.status}`)
      const asr = await asrRes.json()
      const transcript = asr.transcript ?? asr.text ?? ''
      if (!transcript) { addMsg('system', 'No speech detected'); setProcessing(false); setPhase(''); return }

      addMsg('me', transcript)

      // 2. Translate
      const targetLang = peerLang() || 'en'
      if (targetLang === myLang()) {
        sendChatToPeer(transcript, myLang())
        setProcessing(false); setPhase('')
        return
      }

      setPhase('Translating')
      const targetName = LANGUAGES.find(l => l.code === targetLang)?.name || targetLang
      const llmRes = await fetch(`${API}/api/voice/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: `Translate to ${targetName}. Output only the translation.` },
            { role: 'user', content: transcript },
          ]
        }),
      })
      if (!llmRes.ok) throw new Error(`LLM ${llmRes.status}`)
      const llm = await llmRes.json()
      const translated = llm.response || llm.full_response || transcript

      // 3. TTS
      setPhase('Synthesizing')
      const ttsRes = await fetch(`${API}/api/voice/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ text: translated, speaker: 'ryan', language: targetLang }),
      })

      if (ttsRes.ok) {
        const ttsData = await ttsRes.json()
        // Cap outbound audio to 10MB base64 to match receive-side limit
        if (dataChannel?.readyState === 'open' && ttsData.audio_base64?.length <= 10_000_000) {
          dataChannel.send(JSON.stringify({
            type: 'translated_audio',
            audio_base64: ttsData.audio_base64,
            original: transcript.slice(0, 10_000),
            translated: translated.slice(0, 10_000),
          }))
        }
      } else {
        sendChatToPeer(transcript, myLang())
      }
    } catch (err) {
      addMsg('system', `Error: ${(err instanceof Error ? err.message : 'Something went wrong').slice(0, 200)}`)
    }
    setProcessing(false); setPhase('')
  }

  // --- Text chat ---

  function sendChat() {
    const text = chatInput().trim().slice(0, 10_000)
    if (!text) return
    setChatInput('')
    addMsg('me', text)
    sendChatToPeer(text, myLang())
  }

  function sendChatToPeer(text: string, lang: string) {
    const msg = JSON.stringify({ type: 'chat', text, lang })
    if (dataChannel?.readyState === 'open') {
      dataChannel.send(msg)
    } else if (ws?.readyState === WebSocket.OPEN) {
      ws.send(msg)
    }
  }

  // Stream face params to peer (throttled to ~15fps to save bandwidth)
  let lastParamSend = 0
  function sendFaceParams(params: AvatarParams) {
    const now = performance.now()
    if (now - lastParamSend < 66) return // ~15fps
    lastParamSend = now
    if (dataChannel?.readyState === 'open') {
      dataChannel.send(JSON.stringify({ type: 'face', params }))
    }
  }

  let lastTypingSent = 0
  function sendTyping() {
    const now = Date.now()
    if (now - lastTypingSent < 2000) return
    lastTypingSent = now
    const msg = JSON.stringify({ type: 'typing' })
    if (dataChannel?.readyState === 'open') {
      dataChannel.send(msg)
    }
  }

  // --- Link sharing ---

  function callUrl() {
    const base = `${window.location.origin}/call/${code()}`
    const t = targetLang()
    if (t && t !== myLang()) {
      return `${base}?from=${encodeURIComponent(myLang())}&to=${encodeURIComponent(t)}`
    }
    return `${base}?from=${encodeURIComponent(myLang())}`
  }

  function shareLink() {
    navigator.clipboard.writeText(callUrl()).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {})
  }

  // --- Cleanup ---

  function hangup() {
    inlineAudio?.pause(); inlineAudio = null; setPlayingMsgTs(null)
    setConfirmHangup(false); if (hangupTimer) { clearTimeout(hangupTimer); hangupTimer = undefined }
    pc?.close(); pc = null
    ws?.close(); ws = null
    localStream?.getTracks().forEach(t => t.stop())
    localStream = null; dataChannel = null
    // Don't revoke blob URLs here — messages are still rendered in the ended UI
    setStage('ended')
  }

  onCleanup(() => {
    if (recTimer) clearInterval(recTimer)
    inlineAudio?.pause(); inlineAudio = null
    pc?.close(); ws?.close()
    localStream?.getTracks().forEach(t => t.stop())
    messages().forEach(m => { if (m.audioUrl) URL.revokeObjectURL(m.audioUrl) })
  })

  onMount(() => { if (props.code) joinSession() })

  // Keyboard shortcuts
  onMount(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
        e.preventDefault()
        if (!e.repeat && stage() === 'connected') startRecording()
      }
      if (e.key === 'Escape' && stage() === 'setup' && !(e.target as HTMLElement).matches('input,textarea,select,[contenteditable]')) {
        props.onClose()
      }
      if (e.key === 'Escape' && stage() === 'ended' && !(e.target as HTMLElement).matches('input,textarea,select,[contenteditable]')) {
        props.onClose()
      }
      if (e.key === 'Escape' && stage() === 'connected') {
        if (confirmHangup()) {
          hangup()
          if (hangupTimer) { clearTimeout(hangupTimer); hangupTimer = undefined }
        } else {
          setConfirmHangup(true)
          if (hangupTimer) clearTimeout(hangupTimer)
          hangupTimer = setTimeout(() => { setConfirmHangup(false); hangupTimer = undefined }, 3000)
        }
      }
      if (e.key === 'm' && !e.repeat && stage() === 'connected' && !(e.target as HTMLElement).matches('input,textarea,select,[contenteditable]')) {
        setMuted(m => !m)
      }
      if (e.key === 'r' && !e.repeat && stage() === 'connected' && !(e.target as HTMLElement).matches('input,textarea,select,[contenteditable]')) {
        const cur = replayRate()
        const next = RATES[(RATES.indexOf(cur as typeof RATES[number]) + 1) % RATES.length]
        setReplayRate(next)
        if (inlineAudio) inlineAudio.playbackRate = next
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
        e.preventDefault()
        stopRecording()
      }
    }
    document.addEventListener('keydown', down, { capture: true })
    document.addEventListener('keyup', up, { capture: true })
    onCleanup(() => {
      document.removeEventListener('keydown', down, { capture: true })
      document.removeEventListener('keyup', up, { capture: true })
    })
  })

  return (
    <div class="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div class="flex items-center gap-2 px-4 py-2.5 border-b-2 border-edge bg-surface flex-shrink-0">
        <button class="text-fg-faint hover:text-accent p-1" onClick={props.onClose} title="Back">
          <span class="i-mdi-arrow-left w-5 h-5" />
        </button>
        <div class="flex items-center gap-2 flex-1 min-w-0">
          <span class={`w-2 h-2 rounded-full flex-shrink-0 ${
            stage() === 'connected' ? 'bg-emerald-500' : stage() === 'waiting' ? 'bg-amber-500 animate-pulse' : stage() === 'ended' ? 'bg-red-500' : 'bg-fg-faint'
          }`} />
          <span class="font-heading text-xs uppercase tracking-wider text-fg truncate">
            {stage() === 'setup' ? 'New Call' : stage() === 'waiting' ? 'Waiting' : stage() === 'connected' ? 'Connected' : 'Ended'}
          </span>
          <Show when={stage() === 'connected'}>
            <Show when={recording()}>
              <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
            </Show>
            <span class="font-mono text-[10px] text-fg-faint">{formatCallTime(callElapsed())}</span>
            <Show when={peerLang()}>
              <span class="px-1.5 py-0.5 bg-accent-soft border border-accent-muted text-[9px] text-accent font-heading uppercase tracking-wider flex-shrink-0">
                {myLang().toUpperCase()} → {peerLang().toUpperCase()}
              </span>
            </Show>
            <Show when={processing() && phase()}>
              <span class="text-[9px] text-accent font-heading uppercase tracking-wider animate-pulse flex-shrink-0">
                {phase()}
              </span>
            </Show>
            <Show when={muted()}>
              <span class="i-mdi-volume-off w-3.5 h-3.5 text-red-500 flex-shrink-0" title="Speaker muted" />
            </Show>
            {(() => {
              const count = messages().filter(m => m.from !== 'system').length
              return <Show when={count > 0}>
                <span class="text-[9px] text-fg-faint/40 font-mono tabular-nums flex-shrink-0">{count} {count === 1 ? 'msg' : 'msgs'}</span>
              </Show>
            })()}
          </Show>
          <Show when={code()}>
            <button
              class="font-mono text-[10px] text-fg-faint hover:text-accent transition-colors"
              onClick={() => { navigator.clipboard.writeText(callUrl()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {}) }}
              title="Copy call link"
            >
              #{code()} {copied() ? '(copied)' : ''}
            </button>
          </Show>
        </div>
        <Show when={stage() === 'connected'}>
          <button
            class={`p-1.5 transition-colors ${avatarEnabled() ? 'text-accent' : 'text-fg-faint hover:text-accent'}`}
            onClick={() => setAvatarEnabled(!avatarEnabled())}
            title={avatarEnabled() ? 'Hide avatar' : 'Show avatar'}
          >
            <span class="i-mdi-face-woman w-4 h-4" />
          </button>
          <button
            class={`px-3 py-1.5 text-white font-heading text-[10px] uppercase tracking-wider border-2 transition-colors flex items-center gap-1.5 ${
              confirmHangup()
                ? 'bg-red-700 border-red-900 animate-pulse'
                : 'bg-red-600 border-red-800 hover:bg-red-700'
            }`}
            onClick={hangup}
            title="End call (ESC ESC)"
          >
            <span class="i-mdi-phone-hangup w-3.5 h-3.5" />
            {confirmHangup() ? 'End?' : 'End'}
          </button>
        </Show>
        <Show when={stage() === 'ended'}>
          {(() => {
            const userMsgs = () => messages().filter(m => m.from !== 'system')
            return <div class="flex items-center gap-3">
            <span class="text-[10px] text-fg-faint font-mono">
              {formatCallTime(callElapsed())}
              <span class="text-fg-faint/40 mx-1">&middot;</span>
              {userMsgs().length} msgs
            </span>
            <Show when={userMsgs().length > 0}>
              <button
                class={`p-1 transition-colors ${transcriptCopied() ? 'text-emerald-600' : 'text-fg-faint hover:text-accent'}`}
                onClick={() => {
                  const transcript = userMsgs()
                    .map(m => {
                      const prefix = m.from === 'me' ? 'You' : 'Peer'
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
                class="p-1 text-fg-faint hover:text-accent transition-colors"
                onClick={() => {
                  const langFrom = LANGUAGES.find(l => l.code === myLang())?.name || myLang()
                  const langTo = peerLang() ? LANGUAGES.find(l => l.code === peerLang())?.name || peerLang() : '?'
                  const header = `sonotxt call transcript (${langFrom} ↔ ${langTo})\n${formatCallTime(callElapsed())} · ${userMsgs().length} messages\n${'─'.repeat(40)}\n\n`
                  const body = userMsgs()
                    .map(m => {
                      const prefix = m.from === 'me' ? 'You' : 'Peer'
                      let line = `${prefix}: ${m.text}`
                      if (m.translation) line += `\n  (${m.translation})`
                      return line
                    })
                    .join('\n\n')
                  const blob = new Blob([header + body], { type: 'text/plain' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `sonotxt-call-${new Date().toISOString().slice(0, 10)}.txt`
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
                  class="p-1 text-fg-faint hover:text-accent transition-colors"
                  onClick={() => {
                    const langFrom = LANGUAGES.find(l => l.code === myLang())?.name || myLang()
                    const langTo = peerLang() ? LANGUAGES.find(l => l.code === peerLang())?.name || peerLang() : '?'
                    const transcript = userMsgs()
                      .map(m => {
                        const prefix = m.from === 'me' ? 'You' : 'Peer'
                        let line = `${prefix}: ${m.text}`
                        if (m.translation) line += `\n  (${m.translation})`
                        return line
                      })
                      .join('\n\n')
                    navigator.share({ text: transcript, title: `sonotxt call (${langFrom} ↔ ${langTo})` }).catch(() => {})
                  }}
                  title="Share transcript"
                >
                  <span class="i-mdi-share w-3.5 h-3.5" />
                </button>
              </Show>
            </Show>
            <button
              class="px-3 py-1.5 bg-accent text-white font-heading text-[10px] uppercase tracking-wider border-2 border-accent-strong hover:bg-accent-hover transition-colors flex items-center gap-1.5"
              onClick={() => { inlineAudio?.pause(); inlineAudio = null; setPlayingMsgTs(null); messages().forEach(m => { if (m.audioUrl) URL.revokeObjectURL(m.audioUrl) }); setCode(''); setMessages([]); setStage('setup') }}
            >
              <span class="i-mdi-phone-plus w-3.5 h-3.5" />
              New call
            </button>
          </div>
          })()}
        </Show>
      </div>

      {/* Setup screen */}
      <Show when={stage() === 'setup'}>
        <div class="flex-1 flex items-center justify-center px-4 py-8">
          <div class="w-full max-w-md flex flex-col gap-5 animate-fade-in">
            {/* Hero */}
            <div class="text-center mb-2">
              <div class="w-16 h-16 rounded-full bg-accent-soft border-2 border-accent-muted flex items-center justify-center mx-auto mb-3">
                <span class="i-mdi-translate w-8 h-8 text-accent" />
              </div>
              <p class="text-sm text-fg-muted">
                {props.fromLang && props.toLang
                  ? `${LANGUAGES.find(l => l.code === props.fromLang)?.name || props.fromLang} ↔ ${LANGUAGES.find(l => l.code === props.toLang)?.name || props.toLang}`
                  : 'Talk in your language, your friend hears theirs'}
              </p>
            </div>

            {/* Settings card */}
            <div class="bg-surface border-2 border-edge shadow-[var(--shadow)] p-4 flex flex-col gap-4">
              {/* Language */}
              <div>
                <label class="text-[10px] text-fg-faint font-heading uppercase tracking-wider mb-1.5 block">
                  I speak
                </label>
                <select
                  class="w-full px-3 py-2 bg-page border-2 border-edge text-fg font-heading text-sm uppercase tracking-wider outline-none focus:border-accent transition-colors"
                  value={myLang()}
                  onChange={(e) => setMyLang(e.currentTarget.value)}
                >
                  <For each={LANGUAGES}>
                    {(l) => <option value={l.code}>{l.name}</option>}
                  </For>
                </select>
              </div>

              {/* Partner language (optional) */}
              <div>
                <label class="text-[10px] text-fg-faint font-heading uppercase tracking-wider mb-1.5 block">
                  Partner speaks
                </label>
                <select
                  class="w-full px-3 py-2 bg-page border-2 border-edge text-fg font-heading text-sm uppercase tracking-wider outline-none focus:border-accent transition-colors"
                  value={targetLang()}
                  onChange={(e) => setTargetLang(e.currentTarget.value)}
                >
                  <option value="">Any language</option>
                  <For each={LANGUAGES}>
                    {(l) => <option value={l.code}>{l.name}</option>}
                  </For>
                </select>
              </div>

              {/* Billing + Avatar row */}
              <div class="flex gap-3">
                <div class="flex-1">
                  <label class="text-[10px] text-fg-faint font-heading uppercase tracking-wider mb-1.5 block">
                    Billing
                  </label>
                  <div class="flex gap-1">
                    <button
                      class={`flex-1 px-2 py-1.5 font-heading text-[10px] uppercase tracking-wider border-2 transition-all ${
                        billing() === 'creator'
                          ? 'bg-accent text-white border-accent-strong'
                          : 'bg-page text-fg-muted border-edge hover:text-accent'
                      }`}
                      onClick={() => setBilling('creator')}
                    >
                      Host pays
                    </button>
                    <button
                      class={`flex-1 px-2 py-1.5 font-heading text-[10px] uppercase tracking-wider border-2 transition-all ${
                        billing() === 'split'
                          ? 'bg-accent text-white border-accent-strong'
                          : 'bg-page text-fg-muted border-edge hover:text-accent'
                      }`}
                      onClick={() => setBilling('split')}
                    >
                      Split
                    </button>
                  </div>
                </div>
                <div>
                  <label class="text-[10px] text-fg-faint font-heading uppercase tracking-wider mb-1.5 block">
                    Avatar
                  </label>
                  <button
                    class={`px-3 py-1.5 font-heading text-[10px] uppercase tracking-wider border-2 transition-all flex items-center gap-1.5 ${
                      avatarEnabled()
                        ? 'bg-accent text-white border-accent-strong'
                        : 'bg-page text-fg-muted border-edge hover:text-accent'
                    }`}
                    onClick={() => setAvatarEnabled(!avatarEnabled())}
                  >
                    <span class="i-mdi-face-woman w-3.5 h-3.5" />
                    {avatarEnabled() ? 'On' : 'Off'}
                  </button>
                </div>
              </div>
            </div>

            {/* Create button */}
            <button
              class="w-full px-4 py-3.5 bg-accent text-white font-heading text-sm uppercase tracking-wider border-2 border-accent-strong shadow-[2px_2px_0_0_var(--border)] hover:bg-accent-hover hover:translate-y-[-1px] active:translate-y-0 active:shadow-none transition-all flex items-center justify-center gap-2"
              onClick={createSession}
            >
              <span class="i-mdi-phone-plus w-5 h-5" />
              Create Call
            </button>

            {/* Divider */}
            <div class="flex items-center gap-3">
              <div class="flex-1 border-t border-edge-soft" />
              <span class="text-[10px] text-fg-faint font-heading uppercase tracking-wider">or join with code</span>
              <div class="flex-1 border-t border-edge-soft" />
            </div>

            {/* Join */}
            <div class="flex gap-2">
              <input
                type="text"
                placeholder="abc123"
                class="flex-1 px-3 py-2.5 bg-surface border-2 border-edge text-fg font-mono text-sm text-center outline-none placeholder:text-fg-faint tracking-widest uppercase focus:border-accent transition-colors"
                value={code()}
                onInput={(e) => setCode(e.currentTarget.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
                onKeyDown={(e) => e.key === 'Enter' && joinSession()}
                maxLength={8}
              />
              <button
                class="px-5 py-2.5 bg-surface border-2 border-edge text-fg-muted hover:text-accent hover:border-accent font-heading text-sm uppercase tracking-wider transition-all disabled:opacity-40"
                onClick={joinSession}
                disabled={!code()}
              >
                Join
              </button>
            </div>

            <Show when={!store.user}>
              <p class="text-[10px] text-fg-faint text-center">
                Log in to use your balance. Free tier limits apply without an account.
              </p>
            </Show>
          </div>
        </div>
      </Show>

      {/* Waiting screen */}
      <Show when={stage() === 'waiting'}>
        <div class="flex-1 flex items-center justify-center px-4">
          <div class="w-full max-w-sm flex flex-col items-center gap-6 text-center animate-fade-in">
            {/* Pulsing rings */}
            <div class="relative w-24 h-24 flex items-center justify-center">
              <div class="absolute inset-0 rounded-full border-2 border-accent-muted animate-ping opacity-20" />
              <div class="absolute inset-2 rounded-full border-2 border-accent-muted animate-pulse opacity-40" />
              <div class="w-16 h-16 rounded-full bg-accent-soft border-2 border-accent-muted flex items-center justify-center">
                <span class="i-mdi-phone-ring w-8 h-8 text-accent" />
              </div>
            </div>
            <div>
              <div class="font-heading text-base text-fg uppercase tracking-wider mb-1">
                Waiting for peer
              </div>
              <div class="text-xs text-fg-muted flex items-center justify-center gap-2">
                Share this link to start the call
                <Show when={waitElapsed() > 0}>
                  <span class="text-[10px] text-fg-faint/50 font-mono tabular-nums">{formatCallTime(waitElapsed())}</span>
                </Show>
              </div>
              <Show when={targetLang() && LANGUAGES.find(l => l.code === targetLang())}>
                <div class="text-[10px] text-fg-faint mt-1 font-heading uppercase tracking-wider">
                  {LANGUAGES.find(l => l.code === myLang())?.name} ↔ {LANGUAGES.find(l => l.code === targetLang())?.name}
                </div>
              </Show>
            </div>

            {/* Share card */}
            <div class="w-full bg-surface border-2 border-edge shadow-[var(--shadow)] p-3">
              <div class="flex gap-2 items-center">
                <div
                  class="flex-1 px-3 py-2 bg-page border border-edge-soft font-mono text-[11px] text-fg truncate cursor-pointer"
                  onClick={() => { navigator.clipboard.writeText(callUrl()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {}) }}
                >
                  {callUrl()}
                </div>
                <button
                  class={`px-4 py-2 font-heading text-xs uppercase tracking-wider border-2 transition-all flex-shrink-0 ${
                    copied()
                      ? 'bg-emerald-600 border-emerald-800 text-white'
                      : 'bg-accent border-accent-strong text-white hover:bg-accent-hover'
                  }`}
                  onClick={shareLink}
                >
                  {copied() ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <Show when={typeof navigator !== 'undefined' && navigator.share}>
                <button
                  class="w-full mt-2 px-3 py-2 bg-page border border-edge-soft text-fg-muted hover:text-accent font-heading text-[10px] uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5"
                  onClick={() => navigator.share?.({ url: callUrl(), title: 'sonotxt call' }).catch(() => {})}
                >
                  <span class="i-mdi-share w-3.5 h-3.5" />
                  Share via...
                </button>
              </Show>
            </div>

            <button
              class="text-xs text-fg-faint hover:text-red-500 font-heading uppercase tracking-wider transition-colors"
              onClick={() => { hangup(); setStage('setup') }}
            >
              Cancel
            </button>
          </div>
        </div>
      </Show>

      {/* Connected / call screen */}
      <Show when={stage() === 'connected' || stage() === 'ended'}>
        <div class="flex-1 flex flex-col min-h-0">
          {/* Avatar area */}
          <Show when={avatarEnabled()}>
            <div class="flex items-center justify-center gap-4 px-4 py-3 border-b border-edge-soft bg-page flex-shrink-0">
              {/* My avatar */}
              <div class="flex flex-col items-center gap-1">
                <div class="border-2 border-accent overflow-hidden">
                  <Show when={store.user?.avatar} fallback={
                    <div class="w-[150px] h-[200px] flex items-center justify-center bg-surface">
                      <span class="i-mdi-account w-12 h-12 text-fg-faint" />
                    </div>
                  }>
                    <Suspense fallback={
                      <div class="w-[150px] h-[200px] flex items-center justify-center bg-surface">
                        <div class="flex items-center gap-1"><span class="w-1.5 h-1.5 bg-accent rounded-full loading-dot" /><span class="w-1.5 h-1.5 bg-accent rounded-full loading-dot" /><span class="w-1.5 h-1.5 bg-accent rounded-full loading-dot" /></div>
                      </div>
                    }>
                      <Avatar
                        width={150}
                        height={200}
                        active={stage() === 'connected'}
                        mouthOpen={recording() ? mouthOpen() : undefined}
                        modelPath={`/live2d/${store.user!.avatar}/${store.user!.avatar}.model3.json`}
                        onParams={sendFaceParams}
                      />
                    </Suspense>
                  </Show>
                </div>
                <span class="text-[10px] font-heading uppercase tracking-wider text-accent">
                  You ({LANGUAGES.find(l => l.code === myLang())?.name})
                </span>
              </div>

              {/* Peer avatar */}
              <div class="flex flex-col items-center gap-1">
                <Show when={peerAvatar()} fallback={
                  <div class="w-[150px] h-[200px] border-2 border-edge bg-surface flex items-center justify-center">
                    <div class="text-center">
                      <span class="i-mdi-face-woman-shimmer w-12 h-12 text-fg-faint block mx-auto" />
                      <span class="text-[10px] text-fg-faint font-heading uppercase tracking-wider mt-1 block">
                        Peer
                      </span>
                    </div>
                  </div>
                }>
                  <div class="border-2 border-edge overflow-hidden">
                    <Suspense fallback={
                      <div class="w-[150px] h-[200px] flex items-center justify-center bg-surface">
                        <div class="flex items-center gap-1"><span class="w-1.5 h-1.5 bg-accent rounded-full loading-dot" /><span class="w-1.5 h-1.5 bg-accent rounded-full loading-dot" /><span class="w-1.5 h-1.5 bg-accent rounded-full loading-dot" /></div>
                      </div>
                    }>
                      <Avatar
                        width={150}
                        height={200}
                        modelPath={`/live2d/${peerAvatar()}/${peerAvatar()}.model3.json`}
                        remoteParams={peerParams()}
                      />
                    </Suspense>
                  </div>
                </Show>
                <span class="text-[10px] font-heading uppercase tracking-wider text-fg-muted">
                  {peerLang() ? LANGUAGES.find(l => l.code === peerLang())?.name || peerLang() : 'Peer'}
                </span>
              </div>
            </div>
          </Show>

          {/* Chat messages */}
          <div ref={chatRef} class="flex-1 overflow-y-auto px-4 py-4 relative" onScroll={() => {
            if (!chatRef) return
            const near = isNearBottom()
            setShowScrollBtn(!near)
            if (near) setUnreadCount(0)
          }}>
            <div class="max-w-2xl mx-auto flex flex-col gap-2">
              <Show when={messages().filter(m => m.from !== 'system').length === 0 && stage() === 'connected'}>
                <div class="flex-1 flex items-center justify-center py-12 animate-fade-in">
                  <div class="text-center">
                    <span class="i-mdi-chat-outline w-10 h-10 text-fg-faint/30 block mx-auto mb-3" />
                    <p class="text-xs text-fg-faint font-heading uppercase tracking-wider mb-1">Ready to talk</p>
                    <p class="text-[10px] text-fg-faint/60 font-heading">
                      <kbd class="hidden sm:inline px-1 py-0.5 bg-surface border border-edge text-[8px] font-mono mr-1">SPACE</kbd>
                      Hold to talk, or type below
                    </p>
                  </div>
                </div>
              </Show>
              <For each={messages()}>
                {(msg) => (
                  <div class={`flex ${msg.from === 'me' ? 'justify-end' : msg.from === 'system' ? 'justify-center' : 'justify-start'}`} style="animation: msg-in 0.15s ease-out">
                    <Show when={msg.from === 'system'}>
                      <span class="text-fg-faint font-mono text-[9px] opacity-60">{msg.text}</span>
                    </Show>
                    <Show when={msg.from !== 'system'}>
                      <div
                        class={`max-w-[80%] px-3 py-2 ${
                          msg.from === 'me'
                            ? 'bg-accent text-white border-2 border-edge shadow-[var(--shadow)]'
                            : 'bg-surface border-2 border-edge shadow-[var(--shadow)]'
                        }${msg.audioUrl ? ' cursor-pointer' : ''}`}
                        onClick={() => {
                          if (!msg.audioUrl) return
                          if (window.getSelection()?.toString()) return
                          if (playingMsgTs() === msg.ts) {
                            inlineAudio?.pause()
                            inlineAudio = null
                            setPlayingMsgTs(null)
                            return
                          }
                          inlineAudio?.pause()
                          setPlayingMsgTs(null)
                          inlineAudio = new Audio(msg.audioUrl!)
                          inlineAudio.playbackRate = replayRate()
                          inlineAudio.onended = () => { inlineAudio = null; setPlayingMsgTs(null) }
                          inlineAudio.onerror = () => { inlineAudio = null; setPlayingMsgTs(null) }
                          inlineAudio.play().then(() => setPlayingMsgTs(msg.ts)).catch(() => { inlineAudio = null })
                        }}
                      >
                        {(() => {
                          const isLong = msg.text.length > 300
                          const expanded = () => expandedMsgs().has(msg.ts)
                          return (
                            <div class={`relative font-serif text-sm leading-relaxed ${msg.from === 'me' ? '' : 'text-fg'}`}>
                              <span class={isLong && !expanded() ? 'line-clamp-4' : ''}>
                                {msg.text}
                              </span>
                              <Show when={isLong && !expanded()}>
                                <div class={`absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t pointer-events-none ${
                                  msg.from === 'me' ? 'from-accent to-transparent' : 'from-surface to-transparent'
                                }`} />
                                <button
                                  class={`relative w-full pt-1 text-[9px] font-heading uppercase tracking-wider transition-colors ${
                                    msg.from === 'me' ? 'text-white/70 hover:text-white' : 'text-accent hover:text-accent-hover'
                                  }`}
                                  onClick={(e) => { e.stopPropagation(); setExpandedMsgs(prev => { const next = new Set(prev); next.add(msg.ts); return next }) }}
                                >
                                  Show more
                                </button>
                              </Show>
                              <Show when={isLong && expanded()}>
                                <button
                                  class={`w-full pt-1 text-[9px] font-heading uppercase tracking-wider transition-colors ${
                                    msg.from === 'me' ? 'text-white/50 hover:text-white/70' : 'text-fg-faint hover:text-accent'
                                  }`}
                                  onClick={(e) => { e.stopPropagation(); setExpandedMsgs(prev => { const next = new Set(prev); next.delete(msg.ts); return next }) }}
                                >
                                  Show less
                                </button>
                              </Show>
                            </div>
                          )
                        })()}
                        <Show when={msg.translation}>
                          <div class={`mt-1 pt-1 border-t text-xs italic ${
                            msg.from === 'me' ? 'border-white/20 text-white/70' : 'border-edge-soft text-fg-faint'
                          }`}>
                            {msg.translation}
                          </div>
                        </Show>
                        <div class={`flex items-center gap-1.5 mt-1 ${msg.from === 'me' ? '' : ''}`}>
                          <Show when={msg.audioUrl}>
                            <button
                              class={`p-0.5 text-xs ${msg.from === 'me' ? 'text-white/70 hover:text-white' : 'text-fg-faint hover:text-accent'} transition-colors`}
                              onClick={(e) => {
                                e.stopPropagation()
                                if (playingMsgTs() === msg.ts) {
                                  inlineAudio?.pause()
                                  inlineAudio = null
                                  setPlayingMsgTs(null)
                                  return
                                }
                                inlineAudio?.pause()
                                setPlayingMsgTs(null)
                                inlineAudio = new Audio(msg.audioUrl!)
                                inlineAudio.playbackRate = replayRate()
                                inlineAudio.onended = () => { inlineAudio = null; setPlayingMsgTs(null) }
                                inlineAudio.onerror = () => { inlineAudio = null; setPlayingMsgTs(null) }
                                inlineAudio.play().then(() => setPlayingMsgTs(msg.ts)).catch(() => { inlineAudio = null })
                              }}
                            >
                              <span class={`w-3.5 h-3.5 ${playingMsgTs() === msg.ts ? 'i-mdi-pause' : 'i-mdi-play'}`} />
                            </button>
                            <a
                              href={msg.audioUrl}
                              download={`sonotxt-call-${msg.from === 'me' ? 'you' : 'peer'}-${msg.text.trim().slice(0, 30).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'audio'}.wav`}
                              class={`p-0.5 text-xs ${msg.from === 'me' ? 'text-white/40 hover:text-white/70' : 'text-fg-faint/40 hover:text-accent'} transition-colors`}
                              onClick={(e) => e.stopPropagation()}
                              title="Download audio"
                            >
                              <span class="i-mdi-download w-3 h-3" />
                            </a>
                          </Show>
                          <button
                            class={`p-0.5 text-xs ${msg.from === 'me' ? 'text-white/40 hover:text-white/70' : 'text-fg-faint/40 hover:text-accent'} transition-colors`}
                            onClick={(e) => {
                              e.stopPropagation()
                              const t = msg.translation ? `${msg.text}\n${msg.translation}` : msg.text
                              navigator.clipboard.writeText(t).then(() => {
                                setCopiedIdx(messages().indexOf(msg))
                                setTimeout(() => setCopiedIdx(null), 1500)
                              }).catch(() => {})
                            }}
                            title="Copy"
                          >
                            <span class={`w-3 h-3 ${copiedIdx() === messages().indexOf(msg) ? 'i-mdi-check' : 'i-mdi-content-copy'}`} />
                          </button>
                          <Show when={playingMsgTs() === msg.ts && replayRate() !== 1}>
                            <span class={`text-[8px] font-mono ml-auto tabular-nums ${msg.from === 'me' ? 'text-white/60' : 'text-accent'}`}>{replayRate()}x</span>
                          </Show>
                          <span class={`text-[9px] font-mono ${playingMsgTs() === msg.ts && replayRate() !== 1 ? '' : 'ml-auto'} ${msg.from === 'me' ? 'text-white/40' : 'text-fg-faint/50'}`}>
                            {new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
              <Show when={peerTyping() && stage() === 'connected'}>
                <div class="flex justify-start" style="animation: msg-in 0.15s ease-out">
                  <span class="px-3 py-1.5 bg-surface border border-edge-soft text-fg-faint text-[10px] font-heading uppercase tracking-wider flex items-center gap-1.5">
                    <span class="flex gap-0.5">
                      <span class="w-1 h-1 rounded-full bg-fg-faint loading-dot" />
                      <span class="w-1 h-1 rounded-full bg-fg-faint loading-dot" />
                      <span class="w-1 h-1 rounded-full bg-fg-faint loading-dot" />
                    </span>
                    typing
                  </span>
                </div>
              </Show>
            </div>
            <Show when={showScrollBtn() && messages().length > 0}>
              <button
                class="sticky bottom-3 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-surface border-2 border-edge shadow-[var(--shadow)] flex items-center justify-center text-fg-faint hover:text-accent transition-colors animate-fade-in z-10"
                onClick={() => { scrollChat(); setShowScrollBtn(false); setUnreadCount(0) }}
                title="Scroll to bottom"
              >
                <span class="i-mdi-chevron-down w-5 h-5" />
                <Show when={unreadCount() > 0}>
                  <span class="absolute -top-2 -right-2 min-w-4 h-4 px-1 rounded-full bg-accent text-white text-[9px] font-heading flex items-center justify-center">
                    {unreadCount()}
                  </span>
                </Show>
              </button>
            </Show>
          </div>

          {/* Bottom controls */}
          <div class={`bg-surface border-t-2 border-edge transition-opacity ${stage() === 'ended' ? 'opacity-40 pointer-events-none' : ''}`}>
            {/* Language + billing display */}
            <div class="flex items-center gap-2 px-4 py-2 border-b border-edge-soft text-xs">
              <span class="text-fg font-heading uppercase tracking-wider">
                {LANGUAGES.find(l => l.code === myLang())?.name}
              </span>
              <span class="i-mdi-arrow-right w-3 h-3 text-fg-faint" />
              <span class="text-accent font-heading uppercase tracking-wider">
                {LANGUAGES.find(l => l.code === peerLang())?.name || '?'}
              </span>
              <Show when={stage() === 'connected' && callElapsed() > 0}>
                <span class="text-[10px] text-fg-faint/40 font-mono tabular-nums">{formatCallTime(callElapsed())}</span>
              </Show>
              <div class="flex-1" />
              <Show when={isCreator() && billing() === 'creator'}>
                <span class="text-[10px] text-fg-faint font-mono">you pay</span>
              </Show>
              <Show when={billing() === 'split'}>
                <span class="text-[10px] text-fg-faint font-mono">split</span>
              </Show>
              <button
                class={`px-1 py-0.5 text-[10px] font-mono transition-colors tabular-nums ${
                  replayRate() !== 1
                    ? 'text-accent bg-accent-soft border border-accent-muted'
                    : 'text-fg-faint hover:text-accent border border-transparent'
                }`}
                onClick={() => {
                  const cur = replayRate()
                  const next = RATES[(RATES.indexOf(cur as typeof RATES[number]) + 1) % RATES.length]
                  setReplayRate(next)
                  if (inlineAudio) inlineAudio.playbackRate = next
                }}
                title="Replay speed (R)"
              >
                {replayRate() === 1 ? '1x' : `${replayRate()}x`}
              </button>
              <button
                class={`p-1 transition-colors ${muted() ? 'text-red-500' : 'text-fg-faint hover:text-accent'}`}
                onClick={() => setMuted(!muted())}
                title={muted() ? 'Unmute (M)' : 'Mute (M)'}
              >
                <span class={muted() ? 'i-mdi-volume-off w-4 h-4' : 'i-mdi-volume-high w-4 h-4'} />
              </button>
            </div>

            {/* Chat input */}
            <div class="flex items-center gap-2 px-4 py-2 border-b border-edge-soft">
              <div class="flex-1 relative">
                <input
                  ref={(el) => { if (stage() === 'connected' && window.matchMedia('(min-width: 640px)').matches) requestAnimationFrame(() => el.focus()) }}
                  type="text"
                  placeholder="Type a message..."
                  class="w-full px-3 py-2 pr-12 bg-page border-2 border-edge text-fg text-sm outline-none placeholder:text-fg-faint focus:border-accent transition-colors"
                  value={chatInput()}
                  onInput={(e) => { setChatInput(e.currentTarget.value); sendTyping() }}
                  onKeyDown={(e) => e.key === 'Enter' && sendChat()}
                  disabled={stage() === 'ended'}
                  maxLength={10_000}
                />
                <Show when={!chatInput().trim()}>
                  <kbd class="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 bg-surface border border-edge-soft text-[9px] text-fg-faint font-mono pointer-events-none">
                    Enter
                  </kbd>
                </Show>
              </div>
              <button
                class="px-3 py-2 bg-accent text-white font-heading text-xs uppercase tracking-wider border-2 border-accent-strong hover:bg-accent-hover disabled:opacity-50"
                onClick={sendChat}
                disabled={!chatInput().trim() || stage() === 'ended'}
              >
                Send
              </button>
            </div>

            {/* Voice control */}
            <div class="flex items-center justify-center gap-6 px-6 py-3">
              <Show when={processing()}>
                <span class="text-accent font-heading text-xs uppercase tracking-wider animate-pulse">
                  {phase() || 'Processing'}...
                  <Show when={procElapsed() > 0}>
                    <span class="text-[9px] text-fg-faint/50 font-mono tabular-nums ml-1 no-underline">{procElapsed()}s</span>
                  </Show>
                </span>
              </Show>

              <div class="relative">
                <Show when={recording()}>
                  <div class="absolute inset-0 rounded-full bg-red-200 animate-ping opacity-40 -m-2" />
                </Show>
                <button
                  class={`relative w-14 h-14 rounded-full border-3 flex items-center justify-center transition-all ${
                    recording()
                      ? 'bg-red-600 border-red-800 text-white scale-110'
                      : processing()
                      ? 'bg-page border-edge-soft text-fg-faint cursor-not-allowed'
                      : stage() === 'ended'
                      ? 'bg-page border-edge-soft text-fg-faint cursor-not-allowed'
                      : 'bg-accent border-accent-strong text-white hover:bg-accent-hover hover:scale-105 active:scale-95'
                  }`}
                  onMouseDown={() => !processing() && stage() === 'connected' && startRecording()}
                  onMouseUp={stopRecording}
                  onMouseLeave={() => recording() && stopRecording()}
                  onTouchStart={(e) => { e.preventDefault(); !processing() && stage() === 'connected' && startRecording() }}
                  onTouchEnd={(e) => { e.preventDefault(); stopRecording() }}
                  disabled={processing() || stage() === 'ended'}
                >
                  <Show when={recording()} fallback={
                    <Show when={processing()} fallback={
                      <span class="i-mdi-microphone w-6 h-6" />
                    }>
                      <span class="i-mdi-loading w-6 h-6 animate-spin" />
                    </Show>
                  }>
                    <div class="w-5 h-5 bg-white rounded-sm animate-pulse" />
                  </Show>
                </button>
              </div>

              <span class="text-xs text-fg-faint font-heading">
                <Show when={recording()}>
                  <span class="text-red-600 animate-pulse uppercase tracking-wider">Release to send</span>
                  <span class="ml-2 text-red-400 font-mono text-[10px]">{Math.floor(recElapsed() / 60)}:{(recElapsed() % 60).toString().padStart(2, '0')}</span>
                </Show>
                <Show when={!recording() && !processing() && stage() === 'connected'}>
                  <kbd class="hidden sm:inline px-1.5 py-0.5 bg-surface border-2 border-edge font-mono text-[10px] text-fg shadow-[var(--shadow)]">SPACE</kbd>
                  <span class="sm:ml-1 text-[10px] uppercase tracking-wider">hold to talk</span>
                  <span class="hidden sm:inline-flex items-center gap-2 ml-3 text-[9px] text-fg-faint/30">
                    <span class="flex items-center gap-0.5"><kbd class="px-1 py-px bg-surface border border-edge-soft font-mono">M</kbd> mute</span>
                    <span class="flex items-center gap-0.5"><kbd class="px-1 py-px bg-surface border border-edge-soft font-mono">R</kbd> speed</span>
                    <span class="flex items-center gap-0.5"><kbd class="px-1 py-px bg-surface border border-edge-soft font-mono">Esc</kbd> hang up</span>
                  </span>
                </Show>
              </span>
            </div>

            {/* Call ended overlay */}
            <Show when={stage() === 'ended'}>
              <div class="bg-page border-t border-edge-soft px-4 py-4 flex flex-col items-center gap-3 animate-fade-in">
                <div class="flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full bg-red-500" />
                  <span class="text-xs text-fg-faint font-heading uppercase tracking-wider">Call ended</span>
                  <Show when={callElapsed() > 0}>
                    <span class="text-fg-faint">&middot;</span>
                    <span class="text-[10px] text-fg-faint font-mono">{formatCallTime(callElapsed())}</span>
                  </Show>
                  <Show when={messages().filter(m => m.from !== 'system').length > 0}>
                    <span class="text-fg-faint">&middot;</span>
                    <span class="text-[10px] text-fg-faint font-mono">{messages().filter(m => m.from !== 'system').length} messages</span>
                  </Show>
                </div>
                <div class="flex gap-2">
                  <button
                    class="px-5 py-2 bg-accent text-white font-heading text-xs uppercase tracking-wider border-2 border-accent-strong shadow-[2px_2px_0_0_var(--border)] hover:bg-accent-hover transition-all flex items-center gap-1.5"
                    onClick={() => { inlineAudio?.pause(); inlineAudio = null; setPlayingMsgTs(null); messages().forEach(m => { if (m.audioUrl) URL.revokeObjectURL(m.audioUrl) }); setStage('setup'); setCode(''); setMessages([]) }}
                  >
                    <span class="i-mdi-phone-plus w-4 h-4" />
                    New call
                  </button>
                  <Show when={messages().filter(m => m.from !== 'system').length > 0}>
                    <button
                      class="px-4 py-2 bg-surface text-fg-muted font-heading text-xs uppercase tracking-wider border-2 border-edge hover:text-accent transition-all flex items-center gap-1.5"
                      onClick={() => {
                        const transcript = messages()
                          .filter(m => m.from !== 'system')
                          .map(m => {
                            const prefix = m.from === 'me' ? 'You' : 'Peer'
                            const time = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            let line = `[${time}] ${prefix}: ${m.text}`
                            if (m.translation) line += `\n        (${m.translation})`
                            return line
                          })
                          .join('\n')
                        navigator.clipboard.writeText(transcript).then(() => {
                          setTranscriptCopied(true)
                          setTimeout(() => setTranscriptCopied(false), 2000)
                        }).catch(() => {})
                      }}
                    >
                      <span class={`w-3.5 h-3.5 ${transcriptCopied() ? 'i-mdi-check text-emerald-600' : 'i-mdi-content-copy'}`} />
                      {transcriptCopied() ? 'Copied' : 'Copy transcript'}
                    </button>
                    <button
                      class="px-4 py-2 bg-surface text-fg-muted font-heading text-xs uppercase tracking-wider border-2 border-edge hover:text-accent transition-all flex items-center gap-1.5"
                      onClick={() => {
                        const langs = `${LANGUAGES.find(l => l.code === myLang())?.name || myLang()} ↔ ${LANGUAGES.find(l => l.code === peerLang())?.name || peerLang() || 'Unknown'}`
                        const header = `sonotxt call transcript\n${langs}\nDuration: ${formatCallTime(callElapsed())}\n${'─'.repeat(40)}\n\n`
                        const body = messages()
                          .filter(m => m.from !== 'system')
                          .map(m => {
                            const prefix = m.from === 'me' ? 'You' : 'Peer'
                            const time = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                            let line = `[${time}] ${prefix}: ${m.text}`
                            if (m.translation) line += `\n        (${m.translation})`
                            return line
                          })
                          .join('\n')
                        const blob = new Blob([header + body], { type: 'text/plain' })
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url
                        a.download = `sonotxt-call-${new Date().toISOString().slice(0, 10)}.txt`
                        document.body.appendChild(a)
                        a.click()
                        document.body.removeChild(a)
                        URL.revokeObjectURL(url)
                      }}
                    >
                      <span class="i-mdi-download w-3.5 h-3.5" />
                      Save .txt
                    </button>
                  </Show>
                  <button
                    class="px-5 py-2 bg-surface text-fg-muted font-heading text-xs uppercase tracking-wider border-2 border-edge hover:text-accent transition-all"
                    onClick={props.onClose}
                  >
                    Back
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  )
}
