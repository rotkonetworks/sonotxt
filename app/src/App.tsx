import { createSignal, createEffect, For, Show, onMount, onCleanup, lazy, Suspense } from 'solid-js'
import { ToastContainer, showToast } from './components/Toast'
import { useStore } from './lib/store'
import type { HistoryItem } from './lib/store'
import * as api from './lib/api'
import { locale, setLocale, getSuggestedLocale, dismissLocaleSuggestion, t, LOCALES } from './lib/i18n'
import type { Locale } from './lib/i18n'
import type { User, Contact } from './lib/api'
const VoiceTerminal = lazy(() => import('./components/VoiceTerminal'))
const TextTerminal = lazy(() => import('./components/TextTerminal'))
const AuthModal = lazy(() => import('./components/AuthModal'))
const WalletModal = lazy(() => import('./components/WalletModal'))
const ProfilePage = lazy(() => import('./components/ProfilePage'))
const CallPage = lazy(() => import('./components/CallPage'))

const LANG_NAMES: Record<string, string> = {
  en: 'English', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', es: 'Spanish',
  fr: 'French', de: 'German', pt: 'Portuguese', ru: 'Russian', it: 'Italian',
}

const VOICE_NAMES: Record<string, string> = {
  ryan: 'Ryan', serena: 'Serena', aiden: 'Aiden', vivian: 'Vivian',
  eric: 'Eric', dylan: 'Dylan', sohee: 'Sohee', ono_anna: 'Anna', uncle_fu: 'Uncle Fu',
}

const RATES = [0.75, 1, 1.25, 1.5, 2] as const

export default function App() {
  const { state: store, actions } = useStore()

  const persistModes = ['chat', 'translate', 'text'] as const
  const savedMode = sessionStorage.getItem('sonotxt_mode')
  const [mode, setMode] = createSignal<'chat' | 'translate' | 'text' | 'player' | 'call'>(
    savedMode && (persistModes as readonly string[]).includes(savedMode) ? savedMode as any : 'text'
  )
  const [callCode, setCallCode] = createSignal<string | undefined>()
  const [callFromLang, setCallFromLang] = createSignal<string | undefined>()
  const [callToLang, setCallToLang] = createSignal<string | undefined>()
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [showAuth, setShowAuth] = createSignal(false)
  const [authMode, setAuthMode] = createSignal<'email-login' | 'login'>('email-login')
  const [showWallet, setShowWallet] = createSignal(false)
  const [showProfile, setShowProfile] = createSignal(false)
  const [showLoginMenu, setShowLoginMenu] = createSignal(false)
  const [playingId, setPlayingId] = createSignal('')
  const [editText, setEditText] = createSignal('')
  const [editVoice, setEditVoice] = createSignal('')
  const [editLang, setEditLang] = createSignal('')
  const [activeItem, setActiveItem] = createSignal<HistoryItem | null>(null)
  const [historyExpanded, setHistoryExpanded] = createSignal(sessionStorage.getItem('sonotxt_history_expanded') !== '0')
  const [addContactOpen, setAddContactOpen] = createSignal(false)
  const [addContactInput, setAddContactInput] = createSignal('')
  const [addContactLoading, setAddContactLoading] = createSignal(false)
  const [audioProgress, setAudioProgress] = createSignal(0)
  const [audioTime, setAudioTime] = createSignal(0)
  const [audioDuration, setAudioDuration] = createSignal(0)
  const [copied, setCopied] = createSignal('')
  const [audioPaused, setAudioPaused] = createSignal(true)
  const [nudgeDismissed, setNudgeDismissed] = createSignal(false)
  const [prevMode, setPrevMode] = createSignal<'chat' | 'translate' | 'text' | 'call'>('text')
  const [textExpanded, setTextExpanded] = createSignal(false)
  const [playbackRate, setPlaybackRate] = createSignal((() => {
    const stored = parseFloat(sessionStorage.getItem('sonotxt_player_rate') || '1')
    return (RATES as readonly number[]).includes(stored) ? stored : 1
  })())
  const [historyFilter, setHistoryFilter] = createSignal('')
  const [historyType, setHistoryType] = createSignal<'all' | 'speech' | 'translate' | 'text'>('all')
  const [voiceRecording, setVoiceRecording] = createSignal(false)
  const [confirmClear, setConfirmClear] = createSignal(false)
  const [confirmDelete, setConfirmDelete] = createSignal(false)
  const [showShortcuts, setShowShortcuts] = createSignal(false)
  const [repeat, setRepeat] = createSignal(sessionStorage.getItem('sonotxt_repeat') === '1')
  const [ttsVoice, setTtsVoice] = createSignal(sessionStorage.getItem('sonotxt_voice') || 'ryan')

  let currentAudio: HTMLAudioElement | null = null
  let confirmClearTimer: ReturnType<typeof setTimeout> | undefined
  let confirmDeleteTimer: ReturnType<typeof setTimeout> | undefined
  let sidebarSearchRef: HTMLInputElement | undefined

  // Auto-focus sidebar search on open (desktop only)
  createEffect(() => {
    if (sidebarOpen() && historyExpanded() && store.history.length > 5 && window.matchMedia('(min-width: 640px)').matches) {
      requestAnimationFrame(() => sidebarSearchRef?.focus())
    }
  })

  // Close login menu on outside click
  onMount(() => {
    const handler = (e: MouseEvent) => {
      if (showLoginMenu()) {
        const target = e.target as HTMLElement
        if (!target.closest('[data-login-menu]')) setShowLoginMenu(false)
      }
    }
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showShortcuts()) { setShowShortcuts(false); return }
        else if (showProfile()) setShowProfile(false)
        else if (showAuth()) setShowAuth(false)
        else if (showWallet()) setShowWallet(false)
        else if (showLoginMenu()) setShowLoginMenu(false)
        else if (mode() === 'player' && !(e.target as HTMLElement).matches('input,textarea,select,[contenteditable]')) { setConfirmDelete(false); if (confirmDeleteTimer) { clearTimeout(confirmDeleteTimer); confirmDeleteTimer = undefined }; setMode(prevMode()); return }
        else if (playingId() && currentAudio && mode() !== 'player' && !(e.target as HTMLElement).matches('input,textarea,select,[contenteditable]')) {
          currentAudio.pause(); currentAudio = null; setPlayingId(''); setAudioProgress(0); setAudioTime(0); setAudioDuration(0); setAudioPaused(true)
        }
        else if (sidebarOpen() && historyFilter()) { setHistoryFilter(''); return }
        else if (sidebarOpen()) setSidebarOpen(false)
      }
      // Space to play/pause when in player mode or mini-player is visible
      if (e.code === 'Space' && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
        if (mode() === 'player' && activeItem()?.url) {
          e.preventDefault()
          playHistoryItem(activeItem()!)
        } else if (playingId() && currentAudio) {
          e.preventDefault()
          if (currentAudio.paused) currentAudio.play().catch(() => {})
          else currentAudio.pause()
        }
      }
      // Number keys to switch modes (1=Voice, 2=Translate, 3=TTS, 4=Call)
      if (e.key >= '1' && e.key <= '4' && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
        const modes = ['chat', 'translate', 'text', 'call'] as const
        const idx = parseInt(e.key) - 1
        if (idx === 3) { setCallCode(undefined); setCallFromLang(undefined); setCallToLang(undefined) }
        setMode(modes[idx])
      }
      // R key to cycle playback speed in player mode only (other modes have their own R handler)
      if (e.key === 'r' && !e.repeat && mode() === 'player' && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
        const cur = playbackRate()
        const next = RATES[(RATES.indexOf(cur as typeof RATES[number]) + 1) % RATES.length]
        setPlaybackRate(next)
        if (currentAudio) currentAudio.playbackRate = next
        showToast(`Speed: ${next}x`, 'success')
      }
      // D key to download audio in player mode
      if (e.key === 'd' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && mode() === 'player' && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
        const item = activeItem()
        if (item?.url) {
          const a = document.createElement('a')
          a.href = item.url
          a.download = `sonotxt-${item.voice || 'audio'}-${new Date(item.date).toISOString().slice(0, 16).replace(/[T:]/g, '-')}.wav`
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
        }
      }
      // ? key to toggle shortcuts overlay
      if (e.key === '?' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
        setShowShortcuts(s => !s)
      }
      // H key to toggle sidebar
      if (e.key === 'h' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && mode() !== 'call' && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
        setSidebarOpen(s => !s)
      }
      // N key to quick-play most recent history item (skip in player — has its own nav)
      if (e.key === 'n' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && mode() !== 'call' && mode() !== 'player' && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
        const latest = store.history[0]
        if (latest?.url) playHistoryItem(latest)
      }
      // L key to toggle repeat in player mode
      if (e.key === 'l' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && mode() === 'player' && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
        const next = !repeat()
        setRepeat(next)
        showToast(next ? 'Repeat on' : 'Repeat off', 'success')
      }
      // J/K to seek ±15s (works in player mode and with mini-player)
      if ((e.key === 'j' || e.key === 'k') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && currentAudio?.duration && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
        currentAudio.currentTime = e.key === 'j'
          ? Math.max(0, currentAudio.currentTime - 15)
          : Math.min(currentAudio.duration, currentAudio.currentTime + 15)
      }
      // C key to copy text in player mode
      if (e.key === 'c' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && mode() === 'player' && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
        const item = activeItem()
        if (item) { copyText(item.text, `player-${item.id}`); showToast('Copied!', 'success') }
      }
      // E key to edit/regenerate in player mode
      if (e.key === 'e' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && mode() === 'player' && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
        const item = activeItem()
        if (item) openInEditor(item)
      }
      // S key to share in player mode (text-only to stay within user gesture)
      if (e.key === 's' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && mode() === 'player' && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
        const item = activeItem()
        if (item && navigator.share) {
          navigator.share({ text: item.text, title: 'sonotxt' }).catch(() => {})
        }
      }
      // Backspace/Delete to delete in player mode (same confirm flow as trash button)
      if ((e.key === 'Backspace' || e.key === 'Delete') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && mode() === 'player' && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
        e.preventDefault()
        if (confirmDelete()) {
          const item = activeItem()
          if (item) {
            currentAudio?.pause(); currentAudio = null; setPlayingId(''); setAudioProgress(0); setAudioTime(0); setAudioDuration(0); setAudioPaused(true)
            actions.removeFromHistory(item.id)
            setMode(prevMode())
            setActiveItem(null)
            setConfirmDelete(false)
            if (confirmDeleteTimer) { clearTimeout(confirmDeleteTimer); confirmDeleteTimer = undefined }
          }
        } else {
          setConfirmDelete(true)
          if (confirmDeleteTimer) clearTimeout(confirmDeleteTimer)
          confirmDeleteTimer = setTimeout(() => { setConfirmDelete(false); confirmDeleteTimer = undefined }, 3000)
        }
      }
      // Arrow keys to navigate history in player mode
      if (mode() === 'player' && (e.code === 'ArrowLeft' || e.code === 'ArrowRight') && !(e.target as HTMLElement).matches('input,textarea,select,button,[contenteditable]')) {
        const active = activeItem()
        if (!active) return
        const idx = store.history.findIndex(h => h.id === active.id)
        if (idx < 0) return
        const next = e.code === 'ArrowLeft' ? idx + 1 : idx - 1
        if (next >= 0 && next < store.history.length) {
          e.preventDefault()
          openPlayer(store.history[next])
        }
      }
    }
    document.addEventListener('click', handler)
    document.addEventListener('keydown', escHandler)
    onCleanup(() => {
      document.removeEventListener('click', handler)
      document.removeEventListener('keydown', escHandler)
      currentAudio?.pause()
      currentAudio = null
      if (confirmClearTimer) { clearTimeout(confirmClearTimer); confirmClearTimer = undefined }
      if (confirmDeleteTimer) { clearTimeout(confirmDeleteTimer); confirmDeleteTimer = undefined }
    })
  })

  onMount(async () => {
    // Handle /call/:code URL
    const callMatch = window.location.pathname.match(/^\/call\/([a-z0-9]{4,8})$/)
    if (callMatch) {
      setCallCode(callMatch[1])
      const cp = new URLSearchParams(window.location.search)
      const from = (cp.get('from') || '').replace(/[^a-z]/g, '').slice(0, 5)
      const to = (cp.get('to') || '').replace(/[^a-z]/g, '').slice(0, 5)
      if (from) setCallFromLang(from)
      if (to) setCallToLang(to)
      setMode('call')
      return
    }

    // Handle magic link callback
    const params = new URLSearchParams(window.location.search)
    const magicToken = (params.get('token') ?? '').replace(/[^a-zA-Z0-9._-]/g, '')
    if (magicToken && window.location.pathname === '/auth/verify') {
      try {
        const data = await api.verifyMagicLink(magicToken)
        if (data.token) {
          onLogin(
            { id: data.user_id, nickname: data.nickname, email: data.email, balance: data.balance },
            data.token
          )
          showToast('Logged in via email link!', 'success')
        }
      } catch {
        showToast('Login link expired or invalid', 'error')
      }
      // Clean URL
      window.history.replaceState({}, '', '/')
      return
    }

    const savedToken = localStorage.getItem('sonotxt_token')
    if (savedToken) checkSession(savedToken)
    api.getFreeBalance(savedToken).then(data => {
      actions.setFreeRemaining(data.remaining)
    }).catch(() => {})
    actions.restoreAudioUrls()
  })

  async function checkSession(tok: string) {
    try {
      const data = await api.checkSession(tok)
      actions.login(
        { id: data.user_id, nickname: data.nickname, email: data.email, wallet_address: data.wallet_address, balance: data.balance, avatar: data.avatar },
        tok
      )
    } catch {
      actions.logout()
    }
  }

  function onLogin(u: User, tok: string) {
    actions.login(u, tok)
    setShowAuth(false)
    setShowWallet(false)
    actions.loadContacts()
    const rawName = u.nickname || u.email || (u.wallet_address ? u.wallet_address.slice(0, 8) + '...' : 'anon')
    showToast(`Welcome, ${rawName.slice(0, 64)}!`, 'success')
  }

  // Load contacts when user is already logged in
  createEffect(() => {
    if (store.user) actions.loadContacts()
  })

  // Persist active mode across refreshes (skip 'player' and 'call' — need runtime context)
  createEffect(() => {
    const m = mode()
    if (m !== 'player' && m !== 'call') sessionStorage.setItem('sonotxt_mode', m)
  })
  createEffect(() => sessionStorage.setItem('sonotxt_player_rate', String(playbackRate())))
  createEffect(() => sessionStorage.setItem('sonotxt_history_expanded', historyExpanded() ? '1' : '0'))
  createEffect(() => sessionStorage.setItem('sonotxt_repeat', repeat() ? '1' : '0'))

  // Tab title shows playback progress in player/mini-player
  const APP_TITLE = 'sonotxt - text to speech'
  createEffect(() => {
    if (playingId() && !audioPaused() && audioDuration() > 0) {
      document.title = `▶ ${playbackRate() !== 1 ? playbackRate() + 'x ' : ''}${formatTime(audioTime())} sonotxt`
    } else if (mode() === 'player') {
      const item = activeItem()
      document.title = item ? `${(item.voice && VOICE_NAMES[item.voice]) || item.voice || 'Player'} · sonotxt` : APP_TITLE
    } else {
      // Only reset if we're not in a component that manages its own title (text/voice/call)
      if (mode() !== 'text' && mode() !== 'chat' && mode() !== 'translate' && mode() !== 'call') {
        document.title = APP_TITLE
      }
    }
  })

  function contactName(c: Contact) {
    return c.nickname || (c.wallet_address ? c.wallet_address.slice(0, 8) + '...' : c.email || 'Unknown')
  }

  function contactInitial(c: Contact) {
    const name = c.nickname || c.email || ''
    return name ? name[0].toUpperCase() : '#'
  }

  // Stable color from string hash
  function initialsColor(s: string) {
    const colors = ['bg-rose-600', 'bg-orange-600', 'bg-amber-600', 'bg-emerald-600', 'bg-teal-600', 'bg-cyan-600', 'bg-blue-600', 'bg-violet-600', 'bg-purple-600', 'bg-pink-600']
    let h = 0
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
    return colors[Math.abs(h) % colors.length]
  }

  function callContact(_c: Contact) {
    setCallCode(undefined)
    setCallFromLang(undefined)
    setCallToLang(undefined)
    setMode('call')
    setSidebarOpen(false)
  }

  async function handleAddContact() {
    const input = addContactInput().trim()
    if (!input) return
    setAddContactLoading(true)
    try {
      const opts: { nickname?: string; address?: string; email?: string } = {}
      if (input.includes('@')) opts.email = input
      else if (input.startsWith('0x') || input.length > 40) opts.address = input
      else opts.nickname = input
      await actions.sendInvite(opts)
      setAddContactInput('')
      setAddContactOpen(false)
      showToast('Invite sent!', 'success')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to send invite', 'error')
    }
    setAddContactLoading(false)
  }

  function openInEditor(item: HistoryItem) {
    currentAudio?.pause()
    currentAudio = null
    setPlayingId('')
    setAudioProgress(0)
    setAudioTime(0)
    setAudioDuration(0)
    setAudioPaused(true)
    setEditText(item.text)
    setEditVoice(item.voice || 'ryan')
    setEditLang(item.targetLang || '')
    setMode('text')
    setSidebarOpen(false)
  }

  function openPlayer(item: HistoryItem) {
    currentAudio?.pause()
    currentAudio = null
    setPlayingId('')
    setAudioPaused(true)
    setConfirmDelete(false)
    if (confirmDeleteTimer) { clearTimeout(confirmDeleteTimer); confirmDeleteTimer = undefined }
    const cur = mode()
    if (cur !== 'player') setPrevMode(cur as any)
    setActiveItem(item)
    setTextExpanded(false)
    setMode('player')
    setSidebarOpen(false)
    // Auto-play after a tick so the view renders first
    if (item.url) setTimeout(() => { if (mode() === 'player' && activeItem()?.id === item.id) playHistoryItem(item) }, 50)
  }

  function playHistoryItem(item: HistoryItem) {
    if (playingId() === item.id) {
      currentAudio?.pause()
      currentAudio = null
      setPlayingId('')
      setAudioPaused(true)
      return
    }
    currentAudio?.pause()
    if (!item.url) return
    const a = new Audio(item.url)
    a.playbackRate = playbackRate()
    currentAudio = a
    setAudioProgress(0)
    setAudioTime(0)
    setAudioDuration(0)
    setPlayingId(item.id)
    setAudioPaused(false)
    a.ontimeupdate = () => {
      if (a.duration) {
        setAudioProgress((a.currentTime / a.duration) * 100)
        setAudioTime(a.currentTime)
      }
    }
    a.onplay = () => setAudioPaused(false)
    a.onpause = () => setAudioPaused(true)
    a.onloadedmetadata = () => { if (a.duration && isFinite(a.duration)) setAudioDuration(a.duration) }
    a.onended = () => {
      // Repeat current track if enabled
      if (repeat() && mode() === 'player') {
        a.currentTime = 0
        a.play().catch(() => { setPlayingId(''); setAudioProgress(0); setAudioTime(0); setAudioDuration(0); setAudioPaused(true); currentAudio = null })
        return
      }
      setPlayingId(''); setAudioProgress(0); setAudioTime(0); setAudioDuration(0); setAudioPaused(true); currentAudio = null
      // Auto-advance in player mode
      if (mode() === 'player') {
        const active = activeItem()
        if (!active) return
        const idx = store.history.findIndex(h => h.id === active.id)
        if (idx > 0) openPlayer(store.history[idx - 1])
      }
    }
    a.onerror = () => { setPlayingId(''); setAudioProgress(0); setAudioTime(0); setAudioDuration(0); setAudioPaused(true); currentAudio = null }
    a.play().catch(() => { setPlayingId(''); setAudioProgress(0); setAudioTime(0); setAudioDuration(0); setAudioPaused(true); currentAudio = null })
  }

  function formatTime(s: number): string {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id)
      setTimeout(() => setCopied((c) => c === id ? '' : c), 1500)
    }).catch(() => {})
  }

  function typeIcon(type: string) {
    switch (type) {
      case 'speech': return 'i-mdi-microphone'
      case 'translate': return 'i-mdi-translate'
      default: return 'i-mdi-text'
    }
  }

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'now'
    if (mins < 60) return `${mins}m`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    return `${days}d`
  }

  function dateGroup(dateStr: string): string {
    const now = new Date()
    const d = new Date(dateStr)
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const ts = d.getTime()
    if (ts >= startOfToday) return 'Today'
    if (ts >= startOfToday - 86400000) return 'Yesterday'
    if (ts >= startOfToday - 604800000) return 'This week'
    return 'Earlier'
  }

  return (
    <div class="h-screen flex flex-col sm:flex-row">
      {/* Thin sidebar — desktop only */}
      <div class="hidden sm:flex flex-none w-12 flex-col bg-surface border-r-2 border-edge items-center py-2 gap-0.5">
        <button class="group/nav relative p-2 text-fg-faint hover:text-accent" onClick={() => setSidebarOpen(!sidebarOpen())}>
          <span class={sidebarOpen() ? 'i-mdi-menu-open w-5 h-5' : 'i-mdi-account-group w-5 h-5'} />
          <Show when={store.pendingInvites.length > 0} fallback={
            <Show when={store.history.length > 0 && !sidebarOpen()}>
              <span class="absolute top-0.5 right-0 min-w-3.5 h-3.5 flex items-center justify-center bg-fg-faint/20 text-fg-faint text-[7px] font-mono rounded-full px-0.5">
                {store.history.length > 99 ? '99+' : store.history.length}
              </span>
            </Show>
          }>
            <span class="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          </Show>
          <span class="absolute left-full ml-1.5 px-2 py-1 bg-surface border border-edge shadow-sm text-[10px] font-heading uppercase tracking-wider whitespace-nowrap opacity-0 group-hover/nav:opacity-100 pointer-events-none transition-opacity z-50">
            Contacts
          </span>
        </button>
        <div class="w-6 border-t border-edge-soft my-1.5" />
        {([
          { id: 'text' as const, icon: 'i-mdi-file-document-outline', label: 'TTS', key: '1' },
          { id: 'chat' as const, icon: 'i-mdi-microphone', label: 'Voice', key: '2' },
          { id: 'translate' as const, icon: 'i-mdi-translate', label: 'Translate', key: '3' },
          { id: 'call' as const, icon: 'i-mdi-phone', label: 'Call', key: '4' },
        ]).map(item => (
          <button
            class={`group/nav relative w-full flex items-center justify-center py-2 transition-colors ${
              mode() === item.id ? 'text-accent bg-accent-soft' : 'text-fg-faint hover:text-accent hover:bg-page'
            }`}
            onClick={() => {
              if (item.id === 'call') { setCallCode(undefined); setCallFromLang(undefined); setCallToLang(undefined) }
              setMode(item.id)
            }}
          >
            <Show when={mode() === item.id}>
              <span class="absolute left-0 top-1 bottom-1 w-0.5 bg-accent rounded-r" />
            </Show>
            <span class={`${item.icon} w-5 h-5`} />
            <span class="absolute left-full ml-1.5 px-2 py-1 bg-surface border border-edge shadow-sm text-[10px] font-heading uppercase tracking-wider whitespace-nowrap opacity-0 group-hover/nav:opacity-100 pointer-events-none transition-opacity z-50 flex items-center gap-1.5">
              {item.label}
              <kbd class="px-1 py-px bg-page border border-edge-soft text-[8px] font-mono text-fg-faint/50">{item.key}</kbd>
            </span>
          </button>
        ))}
        <Show when={activeItem() && mode() !== 'player'}>
          <button
            class={`group/nav relative w-full flex items-center justify-center py-2 transition-colors ${
              playingId() ? 'text-accent' : 'text-fg-faint hover:text-accent hover:bg-page'
            }`}
            onClick={() => { setPrevMode(mode() as any); setMode('player') }}
          >
            <Show when={playingId()} fallback={
              <span class="i-mdi-play-circle w-5 h-5" />
            }>
              <span class="flex items-end gap-px h-5 w-5 justify-center">
                <span class="eq-bar" /><span class="eq-bar" /><span class="eq-bar" />
              </span>
            </Show>
            <span class="absolute left-full ml-1.5 px-2 py-1 bg-surface border border-edge shadow-sm text-[10px] font-heading uppercase tracking-wider whitespace-nowrap opacity-0 group-hover/nav:opacity-100 pointer-events-none transition-opacity z-50">
              Now playing
            </span>
          </button>
        </Show>
        <div class="flex-1" />
        <button
          class="group/nav relative p-2 text-fg-faint hover:text-accent"
          onClick={() => {
            const codes = LOCALES.map(l => l.code)
            const idx = codes.indexOf(locale())
            setLocale(codes[(idx + 1) % codes.length] as Locale)
          }}
        >
          <span class="i-mdi-translate w-5 h-5" />
          <span class="absolute left-full ml-1.5 px-2 py-1 bg-surface border border-edge shadow-sm text-[10px] font-heading uppercase tracking-wider whitespace-nowrap opacity-0 group-hover/nav:opacity-100 pointer-events-none transition-opacity z-50">
            {LOCALES.find(l => l.code === locale())?.native || 'English'}
          </span>
        </button>
        <Show when={store.user} fallback={
          <button
            class="group/nav relative p-2 text-fg-faint hover:text-accent"
            onClick={() => { setAuthMode('email-login'); setShowAuth(true) }}
          >
            <span class="i-mdi-login w-5 h-5" />
            <span class="absolute left-full ml-1.5 px-2 py-1 bg-surface border border-edge shadow-sm text-[10px] font-heading uppercase tracking-wider whitespace-nowrap opacity-0 group-hover/nav:opacity-100 pointer-events-none transition-opacity z-50">
              {t('nav.signin')}
            </span>
          </button>
        }>
          <button
            class="relative group/nav"
            onClick={() => setShowProfile(true)}
          >
            {(() => {
              const showImg = () => !!store.user?.avatar
              return (
                <>
                  <Show when={showImg()}>
                    <img
                      src={store.user!.avatar}
                      alt=""
                      class="w-8 h-8 rounded-full object-cover border-2 border-edge"
                      onError={(e) => { actions.updateAvatar(null) }}
                    />
                  </Show>
                  <Show when={!showImg()}>
                    <div class={`w-8 h-8 rounded-full ${initialsColor(store.user?.nickname || store.user?.email || 'U')} text-white flex items-center justify-center text-[11px] font-bold`}>
                      {(store.user?.nickname || store.user?.email || 'U')[0].toUpperCase()}
                    </div>
                  </Show>
                </>
              )
            })()}
            <span class="absolute left-full ml-1.5 px-2 py-1 bg-surface border border-edge shadow-sm text-[10px] font-heading uppercase tracking-wider whitespace-nowrap opacity-0 group-hover/nav:opacity-100 pointer-events-none transition-opacity z-50">
              Profile
            </span>
          </button>
        </Show>
      </div>

      {/* Bottom nav — mobile only, hidden when sidebar open */}
      <div class={`sm:hidden fixed bottom-0 left-0 right-0 z-20 bg-surface border-t-2 border-edge flex items-center justify-around px-1 py-1 safe-area-pb transition-transform duration-200 ${sidebarOpen() ? 'translate-y-full' : ''}`}>
        <Show when={playingId() && !audioPaused()}>
          <div class="absolute top-0 left-0 right-0 h-0.5 bg-page">
            <div class="h-full bg-accent transition-[width] duration-200" style={{ width: `${audioProgress()}%` }} />
          </div>
        </Show>
        <button
          class={`relative flex flex-col items-center gap-0.5 py-1.5 px-3 transition-all active:scale-90 ${
            mode() === 'text' ? 'text-accent' : 'text-fg-faint active:text-accent'
          }`}
          onClick={() => setMode('text')}
        >
          <span class="i-mdi-file-document-outline w-5 h-5" />
          <span class="text-[9px] font-heading uppercase tracking-wider">TTS</span>
          <Show when={mode() === 'text'}><span class="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-accent rounded-b" /></Show>
        </button>
        <button
          class={`relative flex flex-col items-center gap-0.5 py-1.5 px-3 transition-all active:scale-90 ${
            mode() === 'chat' ? 'text-accent' : 'text-fg-faint active:text-accent'
          }`}
          onClick={() => setMode('chat')}
        >
          <span class="i-mdi-microphone w-5 h-5" />
          <span class="text-[9px] font-heading uppercase tracking-wider">Voice</span>
          <Show when={mode() === 'chat'}><span class="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-accent rounded-b" /></Show>
          <Show when={voiceRecording() && mode() !== 'chat'}>
            <span class="absolute top-0.5 right-2 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          </Show>
        </button>
        <button
          class={`relative flex flex-col items-center gap-0.5 py-1.5 px-3 transition-all active:scale-90 ${
            mode() === 'translate' ? 'text-accent' : 'text-fg-faint active:text-accent'
          }`}
          onClick={() => setMode('translate')}
        >
          <span class="i-mdi-translate w-5 h-5" />
          <span class="text-[9px] font-heading uppercase tracking-wider">Trans</span>
          <Show when={mode() === 'translate'}><span class="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-accent rounded-b" /></Show>
          <Show when={voiceRecording() && mode() !== 'translate'}>
            <span class="absolute top-0.5 right-2 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          </Show>
        </button>
        <button
          class={`relative flex flex-col items-center gap-0.5 py-1.5 px-3 transition-all active:scale-90 ${
            mode() === 'call' ? 'text-accent' : 'text-fg-faint active:text-accent'
          }`}
          onClick={() => { setCallCode(undefined); setCallFromLang(undefined); setCallToLang(undefined); setMode('call') }}
        >
          <span class="i-mdi-phone w-5 h-5" />
          <span class="text-[9px] font-heading uppercase tracking-wider">Call</span>
          <Show when={mode() === 'call'}><span class="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-accent rounded-b" /></Show>
        </button>
        <button
          class={`relative flex flex-col items-center gap-0.5 py-1.5 px-3 transition-all active:scale-90 ${
            sidebarOpen() ? 'text-accent' : 'text-fg-faint active:text-accent'
          }`}
          onClick={() => setSidebarOpen(!sidebarOpen())}
        >
          <span class={`w-5 h-5 ${sidebarOpen() ? 'i-mdi-menu-open' : 'i-mdi-menu'}`} />
          <span class="text-[9px] font-heading uppercase tracking-wider">More</span>
          <Show when={store.pendingInvites.length > 0} fallback={
            <Show when={store.history.length > 0}>
              <span class="absolute -top-0.5 right-1 min-w-3.5 h-3.5 flex items-center justify-center bg-fg-faint/20 text-fg-faint text-[7px] font-mono rounded-full px-0.5">
                {store.history.length > 99 ? '99+' : store.history.length}
              </span>
            </Show>
          }>
            <span class="absolute top-0.5 right-2 w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
          </Show>
        </button>
      </div>

      {/* Sidebar overlay — slides over content */}
      <div
        class="fixed inset-y-0 right-0 left-0 z-30 bg-black/30 transition-opacity duration-200"
        style={{ opacity: sidebarOpen() ? '1' : '0', 'pointer-events': sidebarOpen() ? 'auto' : 'none' }}
        onClick={() => setSidebarOpen(false)}
      />
      <aside
        class="fixed top-0 bottom-0 left-0 z-40 w-64 max-w-[85vw] bg-surface border-r-2 border-edge flex flex-col transition-transform duration-200 ease-out safe-area-pb"
        style={{ transform: sidebarOpen() ? 'translateX(0)' : 'translateX(-100%)' }}
      >
        <div class="w-64 flex flex-col h-full">
          {/* Header */}
          <div class="flex items-center justify-between px-4 py-3 border-b-2 border-edge flex-shrink-0">
            <button class="flex items-center gap-2 hover:opacity-80 transition-opacity" onClick={() => { setMode('text'); setSidebarOpen(false) }}>
              <div class="i-mdi-waveform text-accent-strong w-4 h-4" />
              <span class="text-accent-strong font-bold text-sm">sonotxt</span>
            </button>
            <button class="text-fg-faint hover:text-accent p-1" onClick={() => setSidebarOpen(false)}>
              <span class="i-mdi-close w-4 h-4" />
            </button>
          </div>

          {/* Contacts / Social */}
          <div class="flex-1 overflow-y-auto px-2 py-2">
            {/* Pending invites */}
            <Show when={store.pendingInvites.length > 0}>
              <div class="mb-3">
                <div class="flex items-center gap-1.5 px-1 mb-2">
                  <span class="i-mdi-bell-ring w-3 h-3 text-amber-500" />
                  <span class="text-[10px] text-amber-500 font-heading uppercase tracking-wider">
                    Invites ({store.pendingInvites.length})
                  </span>
                </div>
                <For each={store.pendingInvites}>{(inv) => (
                  <div class="flex items-center gap-2.5 py-2 px-2 text-xs rounded bg-amber-500/5 hover:bg-amber-500/10 mb-1 transition-colors">
                    <div class="w-7 h-7 rounded-full bg-amber-500/20 text-amber-600 flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                      {contactInitial(inv)}
                    </div>
                    <div class="flex-1 min-w-0">
                      <span class="text-fg truncate block">{contactName(inv)}</span>
                      <Show when={inv.message}>
                        <span class="text-[10px] text-fg-faint truncate block">{inv.message}</span>
                      </Show>
                    </div>
                    <button
                      class="text-emerald-600 hover:text-emerald-700 p-1 bg-emerald-500/10 rounded"
                      onClick={() => actions.acceptInvite(inv.contact_id)}
                      title="Accept"
                    >
                      <span class="i-mdi-check w-4 h-4" />
                    </button>
                    <button
                      class="text-fg-faint hover:text-red-500 p-1"
                      onClick={() => actions.rejectInvite(inv.contact_id)}
                      title="Decline"
                    >
                      <span class="i-mdi-close w-4 h-4" />
                    </button>
                  </div>
                )}</For>
              </div>
            </Show>

            {/* Contacts header + add */}
            <div class="flex items-center justify-between px-1 mb-1">
              <span class="text-[10px] text-fg-faint font-heading uppercase tracking-wider">Contacts</span>
              <Show when={store.user}>
                <button
                  class="text-fg-faint hover:text-accent p-0.5"
                  onClick={() => setAddContactOpen(!addContactOpen())}
                  title="Add contact"
                >
                  <span class={`${addContactOpen() ? 'i-mdi-close' : 'i-mdi-account-plus'} w-3.5 h-3.5`} />
                </button>
              </Show>
            </div>

            {/* Add contact form */}
            <Show when={addContactOpen()}>
              <div class="px-1 mb-2">
                <div class="flex gap-1">
                  <input
                    ref={(el) => requestAnimationFrame(() => el.focus())}
                    type="text"
                    placeholder="Nickname, email, or address"
                    class="flex-1 px-2 py-1 text-[11px] bg-page border border-edge-soft text-fg outline-none placeholder:text-fg-faint"
                    value={addContactInput()}
                    onInput={(e) => setAddContactInput(e.currentTarget.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddContact()}
                  />
                  <button
                    class="px-2 py-1 text-[10px] bg-accent text-white font-heading uppercase tracking-wider border border-accent-strong disabled:opacity-50"
                    onClick={handleAddContact}
                    disabled={addContactLoading() || !addContactInput().trim()}
                  >
                    {addContactLoading() ? '...' : 'Add'}
                  </button>
                </div>
              </div>
            </Show>

            <Show when={store.user} fallback={
              <div class="flex flex-col items-center py-8 px-4 text-center">
                <div class="w-14 h-14 rounded-full bg-accent-soft border-2 border-accent-muted flex items-center justify-center mb-3">
                  <span class="i-mdi-account-group w-7 h-7 text-accent" />
                </div>
                <span class="text-xs text-fg font-heading uppercase tracking-wider mb-1">Connect with friends</span>
                <span class="text-[10px] text-fg-faint mb-4">Log in to add contacts and start calls</span>
                <div class="w-full flex flex-col gap-1.5">
                  <button
                    class="w-full px-4 py-2.5 bg-accent text-white font-heading text-[10px] uppercase tracking-wider border-2 border-accent-strong shadow-[2px_2px_0_0_var(--border)] hover:bg-accent-hover transition-all flex items-center justify-center gap-2"
                    onClick={() => { setSidebarOpen(false); setAuthMode('email-login'); setShowAuth(true) }}
                  >
                    <span class="i-mdi-email-outline w-3.5 h-3.5" />
                    Email login
                  </button>
                  <button
                    class="w-full px-4 py-2 bg-surface text-fg-muted font-heading text-[10px] uppercase tracking-wider border-2 border-edge hover:text-accent transition-all flex items-center justify-center gap-2"
                    onClick={() => { setSidebarOpen(false); setAuthMode('login'); setShowAuth(true) }}
                  >
                    <span class="i-mdi-key w-3.5 h-3.5" />
                    Nickname + password
                  </button>
                  <button
                    class="w-full px-4 py-2 bg-surface text-fg-muted font-heading text-[10px] uppercase tracking-wider border-2 border-edge hover:text-accent transition-all flex items-center justify-center gap-2"
                    onClick={() => { setSidebarOpen(false); setShowWallet(true) }}
                  >
                    <span class="i-mdi-wallet w-3.5 h-3.5" />
                    Connect wallet
                  </button>
                </div>
              </div>
            }>
              {/* Favorites */}
              <Show when={store.contacts.filter(c => store.favorites.includes(c.contact_id)).length > 0}>
                <div class="mb-1">
                  <For each={store.contacts.filter(c => store.favorites.includes(c.contact_id))}>{(contact) => (
                    <div
                      class="group flex items-center gap-2.5 py-2 px-2 text-xs rounded hover:bg-page cursor-pointer transition-colors"
                      onClick={() => callContact(contact)}
                    >
                      <div class={`w-7 h-7 rounded-full ${initialsColor(contactName(contact))} text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0 relative`}>
                        {contactInitial(contact)}
                        <span class="absolute -top-0.5 -right-0.5 i-mdi-star w-2.5 h-2.5 text-amber-400" />
                      </div>
                      <span class="flex-1 truncate text-fg font-medium">{contactName(contact)}</span>
                      <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          class="text-accent hover:text-accent-strong p-0.5"
                          onClick={(e) => { e.stopPropagation(); callContact(contact) }}
                          title="Call"
                        >
                          <span class="i-mdi-phone w-3.5 h-3.5" />
                        </button>
                        <button
                          class="text-amber-400 hover:text-amber-500 p-0.5"
                          onClick={(e) => { e.stopPropagation(); actions.toggleFavorite(contact.contact_id) }}
                          title="Unfavorite"
                        >
                          <span class="i-mdi-star w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}</For>
                </div>
                <div class="border-t border-edge-soft mx-3 my-1.5" />
              </Show>

              {/* All contacts (non-favorited) */}
              <Show when={store.contacts.filter(c => !store.favorites.includes(c.contact_id)).length > 0} fallback={
                <Show when={store.contacts.length === 0}>
                  <div
                    class="flex flex-col items-center py-8 px-4 text-center cursor-pointer group"
                    onClick={() => setAddContactOpen(true)}
                  >
                    <div class="w-12 h-12 rounded-full bg-page border-2 border-edge-soft group-hover:border-accent-muted flex items-center justify-center mb-3 transition-colors">
                      <span class="i-mdi-account-plus w-6 h-6 text-fg-faint group-hover:text-accent transition-colors" />
                    </div>
                    <span class="text-xs text-fg-muted mb-1">No contacts yet</span>
                    <span class="text-[10px] text-fg-faint">Click to add your first contact</span>
                  </div>
                </Show>
              }>
                <For each={store.contacts.filter(c => !store.favorites.includes(c.contact_id))}>{(contact) => (
                  <div
                    class="group flex items-center gap-2.5 py-2 px-2 text-xs rounded hover:bg-page cursor-pointer transition-colors"
                    onClick={() => callContact(contact)}
                  >
                    <div class={`w-7 h-7 rounded-full ${initialsColor(contactName(contact))} text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0`}>
                      {contactInitial(contact)}
                    </div>
                    <span class="flex-1 truncate text-fg">{contactName(contact)}</span>
                    <div class="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        class="text-fg-faint hover:text-accent p-0.5"
                        onClick={(e) => { e.stopPropagation(); callContact(contact) }}
                        title="Call"
                      >
                        <span class="i-mdi-phone w-3.5 h-3.5" />
                      </button>
                      <button
                        class="text-fg-faint hover:text-amber-400 p-0.5"
                        onClick={(e) => { e.stopPropagation(); actions.toggleFavorite(contact.contact_id) }}
                        title="Favorite"
                      >
                        <span class="i-mdi-star-outline w-3.5 h-3.5" />
                      </button>
                      <button
                        class="text-fg-faint hover:text-red-500 p-0.5"
                        onClick={(e) => { e.stopPropagation(); actions.removeContact(contact.contact_id) }}
                        title="Remove"
                      >
                        <span class="i-mdi-close w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}</For>
              </Show>
            </Show>

            {/* History — collapsible */}
            <div class="mt-4 border-t border-edge-soft pt-2">
              <button
                class="flex items-center justify-between w-full px-1 mb-1"
                onClick={() => setHistoryExpanded(!historyExpanded())}
              >
                <span class="text-[10px] text-fg-faint font-heading uppercase tracking-wider">
                  History{' '}
                  {(() => {
                    const total = store.history.length
                    const t = historyType()
                    const f = historyFilter().toLowerCase().trim()
                    if (t === 'all' && !f) return `(${total})`
                    let items = t === 'all' ? store.history : store.history.filter(h => h.type === t)
                    if (f) items = items.filter(h => h.text.toLowerCase().includes(f) || (h.translation?.toLowerCase().includes(f)) || (h.voice && VOICE_NAMES[h.voice]?.toLowerCase().includes(f)))
                    return <><span class="text-accent">{items.length}</span><span class="text-fg-faint/40">/{total}</span></>
                  })()}
                </span>
                <span class={`${historyExpanded() ? 'i-mdi-chevron-up' : 'i-mdi-chevron-down'} w-3.5 h-3.5 text-fg-faint`} />
              </button>
              <Show when={historyExpanded()}>
                <Show when={store.history.length > 3}>
                  <div class="flex items-center gap-1 px-1 mb-1">
                    {([
                      { id: 'all' as const, label: 'All' },
                      { id: 'speech' as const, label: 'Voice' },
                      { id: 'translate' as const, label: 'Trans' },
                      { id: 'text' as const, label: 'TTS' },
                    ]).map(t => {
                      const count = t.id === 'all' ? store.history.length : store.history.filter(h => h.type === t.id).length
                      return (
                        <button
                          class={`px-1.5 py-0.5 text-[9px] font-heading uppercase tracking-wider transition-colors ${
                            historyType() === t.id
                              ? 'text-accent bg-accent-soft border border-accent-muted'
                              : 'text-fg-faint hover:text-accent border border-transparent'
                          }`}
                          onClick={() => setHistoryType(t.id)}
                        >
                          {t.label}
                          <Show when={count > 0 && t.id !== 'all'}>
                            <span class="text-[7px] ml-0.5 opacity-50">{count}</span>
                          </Show>
                        </button>
                      )
                    })}
                  </div>
                </Show>
                <div class="flex items-center gap-1 px-1 mb-1">
                  <Show when={store.history.length > 5}>
                    <div class="flex-1 flex items-center gap-1 bg-page border border-edge-soft px-1.5 py-0.5">
                      <span class="i-mdi-magnify w-3 h-3 text-fg-faint flex-shrink-0" />
                      <input
                        ref={sidebarSearchRef}
                        type="text"
                        placeholder="Filter..."
                        class="flex-1 bg-transparent text-[10px] text-fg outline-none placeholder:text-fg-faint font-mono min-w-0"
                        value={historyFilter()}
                        onInput={(e) => setHistoryFilter(e.currentTarget.value)}
                      />
                      <Show when={historyFilter()}>
                        <button class="text-fg-faint hover:text-accent p-0.5" onClick={() => setHistoryFilter('')}>
                          <span class="i-mdi-close w-2.5 h-2.5" />
                        </button>
                      </Show>
                    </div>
                  </Show>
                  <div class="flex-shrink-0">
                    <Show when={store.history.length > 0}>
                      <Show when={confirmClear()} fallback={
                        <button
                          class="text-[10px] text-fg-faint hover:text-red-500 font-heading uppercase tracking-wider"
                          onClick={() => { setConfirmClear(true); if (confirmClearTimer) clearTimeout(confirmClearTimer); confirmClearTimer = setTimeout(() => { setConfirmClear(false); confirmClearTimer = undefined }, 3000) }}
                        >
                          Clear
                        </button>
                      }>
                        <button
                          class="text-[10px] text-red-500 animate-pulse font-heading uppercase tracking-wider"
                          onClick={() => { actions.clearHistory(); setConfirmClear(false); if (confirmClearTimer) { clearTimeout(confirmClearTimer); confirmClearTimer = undefined } }}
                        >
                          Clear?
                        </button>
                      </Show>
                    </Show>
                  </div>
                </div>
                <Show when={store.history.length > 0} fallback={
                  <div class="flex flex-col items-center py-6 text-center">
                    <span class="i-mdi-history w-5 h-5 text-fg-faint/30 mb-1.5" />
                    <span class="text-[10px] text-fg-faint">Your generations will appear here</span>
                  </div>
                }>
                  {(() => {
                    const filteredHistory = () => {
                      const f = historyFilter().toLowerCase().trim()
                      const t = historyType()
                      let items = t === 'all' ? store.history : store.history.filter(h => h.type === t)
                      if (f) {
                        items = items.filter(h => h.text.toLowerCase().includes(f) || (h.translation?.toLowerCase().includes(f)) || (h.voice && VOICE_NAMES[h.voice]?.toLowerCase().includes(f)))
                      }
                      return items.slice(0, 30)
                    }
                    return <>
                      <Show when={(historyFilter() || historyType() !== 'all') && filteredHistory().length === 0}>
                        <div class="flex flex-col items-center py-4 text-center">
                          <span class="i-mdi-magnify w-4 h-4 text-fg-faint/30 mb-1" />
                          <span class="text-[10px] text-fg-faint">No matches</span>
                        </div>
                      </Show>
                      <For each={filteredHistory()}>{(item, idx) => {
                    const active = () => activeItem()?.id === item.id && mode() === 'player'
                    const playing = () => playingId() === item.id
                    const group = dateGroup(item.date)
                    const prevGroup = idx() > 0 ? dateGroup(filteredHistory()[idx() - 1].date) : null
                    const showHeader = group !== prevGroup
                    return (
                      <>
                      <Show when={showHeader}>
                        <div class="text-[9px] text-fg-faint font-heading uppercase tracking-widest px-2 pt-2 pb-1">{group}</div>
                      </Show>
                      <div
                        class={`group relative flex items-start gap-2 py-2 px-2 text-xs rounded cursor-pointer transition-colors ${
                          active() ? 'bg-accent-soft' : playing() ? 'bg-accent-soft/50' : 'hover:bg-page'
                        }`}
                        onClick={() => openPlayer(item)}
                      >
                        <Show when={active() || playing()}>
                          <span class={`absolute left-0 top-1 bottom-1 w-0.5 rounded-r ${item.type === 'translate' ? 'bg-purple-500' : 'bg-accent'}`} />
                        </Show>
                        <div class="flex-shrink-0 mt-0.5">
                          <Show when={playing()} fallback={
                            <span class={`${typeIcon(item.type || 'text')} w-3.5 h-3.5 ${
                              active() ? 'text-accent' : item.type === 'speech' ? 'text-accent' : item.type === 'translate' ? 'text-purple-500' : 'text-fg-muted'
                            }`} />
                          }>
                            <span class="flex items-end gap-px h-3.5 w-3.5 text-accent">
                              <span class="eq-bar" /><span class="eq-bar" /><span class="eq-bar" />
                            </span>
                          </Show>
                        </div>
                        <div class="flex-1 min-w-0">
                          <div class="text-fg truncate leading-tight">{item.text}</div>
                          <Show when={item.translation}>
                            <div class="text-fg-faint truncate text-[10px] mt-0.5 italic">{item.translation}</div>
                          </Show>
                          <div class="flex items-center gap-1.5 mt-1 text-[10px] text-fg-faint">
                            <Show when={item.voice}>
                              <span>{VOICE_NAMES[item.voice!] || item.voice}</span>
                              <span>&middot;</span>
                            </Show>
                            <span title={new Date(item.date).toLocaleString()}>{timeAgo(item.date)}</span>
                            <Show when={item.duration > 0}>
                              <span>&middot;</span>
                              <span>{formatTime(item.duration)}</span>
                            </Show>
                            <Show when={item.targetLang}>
                              <span>&middot;</span>
                              <span class="text-purple-400">&rarr; {LANG_NAMES[item.targetLang!] || item.targetLang}</span>
                            </Show>
                            <Show when={item.text.length > 500}>
                              <span>&middot;</span>
                              <span>{item.text.length > 999 ? `${(item.text.length / 1000).toFixed(1)}k` : item.text.length} chars</span>
                            </Show>
                          </div>
                          <Show when={playing() && audioProgress() > 0}>
                            <div class="w-full h-0.5 bg-page mt-1 overflow-hidden">
                              <div class={`h-full transition-[width] duration-200 ${item.type === 'translate' ? 'bg-purple-500' : 'bg-accent'}`} style={{ width: `${audioProgress()}%` }} />
                            </div>
                          </Show>
                        </div>
                        <div class={`flex flex-col gap-0.5 flex-shrink-0 transition-opacity ${playing() ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                          <Show when={item.url}>
                            <button
                              class={`p-0.5 ${playing() ? 'text-accent' : 'text-fg-faint hover:text-accent'}`}
                              onClick={(e) => { e.stopPropagation(); playHistoryItem(item) }}
                              title={playing() ? 'Stop' : 'Play'}
                            >
                              <span class={`w-3 h-3 ${playing() ? 'i-mdi-stop' : 'i-mdi-play'}`} />
                            </button>
                          </Show>
                          <button
                            class="text-fg-faint hover:text-accent p-0.5"
                            onClick={(e) => { e.stopPropagation(); openInEditor(item) }}
                            title="Open in editor"
                          >
                            <span class="i-mdi-pencil w-3 h-3" />
                          </button>
                          <Show when={item.url}>
                            <a
                              href={item.url}
                              download={`sonotxt-${item.voice || 'audio'}-${new Date(item.date).toISOString().slice(0, 16).replace(/[T:]/g, '-')}.wav`}
                              class="text-fg-faint hover:text-accent p-0.5"
                              onClick={(e) => e.stopPropagation()}
                              title="Download"
                            >
                              <span class="i-mdi-download w-3 h-3" />
                            </a>
                          </Show>
                          <button
                            class="text-fg-faint hover:text-red-500 p-0.5"
                            onClick={(e) => { e.stopPropagation(); actions.removeFromHistory(item.id) }}
                            title="Delete"
                          >
                            <span class="i-mdi-close w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      </>
                    )
                  }}</For>
                    </>
                  })()}
                </Show>
              </Show>
            </div>
          </div>

          {/* Footer */}
          <div class="border-t-2 border-edge px-3 py-2 flex-shrink-0 flex items-center justify-between safe-area-pb">
            <span class="text-[10px] text-fg-faint font-mono flex items-center gap-1">
              <span class="i-mdi-pulse w-3 h-3" />
              {store.stats.generated} gen
              <span class="text-fg-faint/50">&middot;</span>
              {store.stats.chars > 1000 ? `${(store.stats.chars / 1000).toFixed(1)}k` : store.stats.chars} chars
              {(() => {
                const totalSec = store.history.reduce((sum, h) => sum + (h.duration || 0), 0)
                if (totalSec < 1) return null
                const m = Math.floor(totalSec / 60)
                const s = Math.floor(totalSec % 60)
                return <>
                  <span class="text-fg-faint/50">&middot;</span>
                  {m > 0 ? `${m}m${s > 0 ? s + 's' : ''}` : `${s}s`}
                </>
              })()}
            </span>
            <div class="flex items-center gap-2">
              <button
                class="text-fg-faint/30 hover:text-accent transition-colors p-0.5"
                onClick={() => { setSidebarOpen(false); setShowShortcuts(true) }}
                title="Keyboard shortcuts (?)"
              >
                <span class="i-mdi-keyboard w-3 h-3" />
              </button>
              <a href="https://rotko.net" class="text-[10px] text-fg-faint hover:text-accent font-heading uppercase tracking-wider">Rotko</a>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div class="flex-1 flex flex-col min-h-0 min-w-0 pb-safe-nav sm:pb-0">
        {/* Top bar */}
        <div class="flex items-center gap-1 px-2 py-1.5 border-b border-edge-soft bg-surface flex-shrink-0">
          <div class="flex items-center gap-1.5 px-2 transition-opacity duration-150">
            <span class={`w-3.5 h-3.5 ${
              mode() === 'player' && activeItem()?.type === 'translate' ? 'text-purple-500' :
              mode() === 'player' && activeItem()?.type === 'speech' ? 'text-accent' : 'text-fg-faint'
            } ${
              mode() === 'text' ? 'i-mdi-file-document-outline' : mode() === 'chat' ? 'i-mdi-microphone' : mode() === 'translate' ? 'i-mdi-translate' : mode() === 'call' ? 'i-mdi-phone' : 'i-mdi-play-circle'
            }`} />
            <span class="hidden sm:inline text-[10px] text-fg-faint font-heading uppercase tracking-wider">
              {mode() === 'chat' ? 'Voice' : mode() === 'translate' ? 'Translate' : mode() === 'text' ? 'Text to speech' : mode() === 'call' ? 'Call' : mode() === 'player' ? 'Player' : ''}
            </span>
            <Show when={mode() === 'player' && activeItem()?.voice}>
              <span class="text-[9px] text-fg-faint/50 font-mono">{VOICE_NAMES[activeItem()!.voice!] || activeItem()!.voice}</span>
            </Show>
            <Show when={mode() === 'text'}>
              <span class="text-[9px] text-fg-faint/50 font-mono">{VOICE_NAMES[ttsVoice()] || ttsVoice()}</span>
            </Show>
            <Show when={mode() === 'chat' || mode() === 'translate'}>
              <Show when={voiceRecording()} fallback={
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" title="Ready" />
              }>
                <span class="flex items-center gap-1" title="Recording">
                  <span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  <span class="text-[9px] text-red-500 font-heading uppercase tracking-wider animate-pulse">Rec</span>
                </span>
              </Show>
            </Show>
            <Show when={playingId() && !audioPaused()}>
              <span class="flex items-end gap-px h-3 text-accent">
                <span class="eq-bar" /><span class="eq-bar" /><span class="eq-bar" />
              </span>
            </Show>
          </div>
          <div class="flex-1" />
          {/* Login / Profile */}
          <Show when={store.user} fallback={
            <div class="relative flex items-center gap-1" data-login-menu>
              <Show when={store.freeRemaining > 0}>
                <span class={`hidden sm:inline-flex items-center gap-1.5 text-[10px] font-mono ${
                  store.freeRemaining <= 200 ? 'text-red-500' : store.freeRemaining <= 500 ? 'text-amber-500' : 'text-fg-faint'
                }`}>
                  {store.freeRemaining} free
                  <span class="w-12 h-1 bg-page border border-edge-soft overflow-hidden inline-block align-middle">
                    <span
                      class={`block h-full transition-all duration-300 ${
                        store.freeRemaining <= 200 ? 'bg-red-500' : store.freeRemaining <= 500 ? 'bg-amber-500' : 'bg-accent/50'
                      }`}
                      style={{ width: `${Math.min(100, (store.freeRemaining / 1000) * 100)}%` }}
                    />
                  </span>
                </span>
              </Show>
              <button
                class="flex items-center gap-1.5 px-3 py-1.5 text-xs text-fg-muted hover:text-accent font-heading uppercase tracking-wider transition-colors"
                onClick={() => setShowLoginMenu(!showLoginMenu())}
              >
                <span class="i-mdi-login w-4 h-4" />
                <span class="hidden sm:inline">Login</span>
              </button>
              <Show when={showLoginMenu()}>
                <div class="absolute right-0 top-full mt-1 bg-surface border-2 border-edge shadow-[var(--shadow)] z-50 w-52" style="animation: dropdown-in 0.15s ease-out">
                  <button
                    class="w-full px-4 py-2.5 text-left text-xs text-fg hover:bg-accent-soft flex items-center gap-2.5 transition-colors"
                    onClick={() => { setShowLoginMenu(false); setAuthMode('email-login'); setShowAuth(true) }}
                  >
                    <span class="i-mdi-email-outline w-4 h-4 text-accent" />
                    <div>
                      <div class="font-heading uppercase tracking-wider text-[10px]">Email Login</div>
                      <div class="text-[9px] text-fg-faint mt-0.5">Magic link, no password</div>
                    </div>
                  </button>
                  <div class="border-t border-edge-soft" />
                  <button
                    class="w-full px-4 py-2.5 text-left text-xs text-fg hover:bg-accent-soft flex items-center gap-2.5 transition-colors"
                    onClick={() => { setShowLoginMenu(false); setAuthMode('login'); setShowAuth(true) }}
                  >
                    <span class="i-mdi-key w-4 h-4 text-fg-muted" />
                    <div>
                      <div class="font-heading uppercase tracking-wider text-[10px]">Nickname + Password</div>
                      <div class="text-[9px] text-fg-faint mt-0.5">Ed25519 key derivation</div>
                    </div>
                  </button>
                  <div class="border-t border-edge-soft" />
                  <button
                    class="w-full px-4 py-2.5 text-left text-xs text-fg hover:bg-accent-soft flex items-center gap-2.5 transition-colors"
                    onClick={() => { setShowLoginMenu(false); setShowWallet(true) }}
                  >
                    <span class="i-mdi-wallet w-4 h-4 text-fg-muted" />
                    <div>
                      <div class="font-heading uppercase tracking-wider text-[10px]">Connect Wallet</div>
                      <div class="text-[9px] text-fg-faint mt-0.5">Polkadot or EVM</div>
                    </div>
                  </button>
                </div>
              </Show>
            </div>
          }>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 text-xs hover:bg-accent-soft transition-colors group"
              onClick={() => setShowProfile(true)}
            >
              <span class="i-mdi-wallet w-3.5 h-3.5 text-fg-faint group-hover:text-accent transition-colors" />
              <span class={`font-mono text-[11px] ${
                (store.user?.balance ?? 0) < 0.10 ? 'text-red-500' : (store.user?.balance ?? 0) < 1 ? 'text-amber-500' : 'text-accent'
              }`}>${(store.user?.balance ?? 0).toFixed(2)}</span>
            </button>
          </Show>
        </div>

        {/* Content */}
        <div class="flex-1 flex flex-col min-h-0">
          <Show when={mode() === 'chat'}>
            <div class="flex-1 flex flex-col min-h-0 animate-page-enter">
              <Suspense fallback={<div class="flex-1 flex items-center justify-center"><div class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 bg-accent rounded-full loading-dot" /><span class="w-1.5 h-1.5 bg-accent rounded-full loading-dot" /><span class="w-1.5 h-1.5 bg-accent rounded-full loading-dot" /></div></div>}>
                <VoiceTerminal onHistoryAdd={(item) => actions.addToHistory(item)} pipeline="chat" onRecordingChange={setVoiceRecording} />
              </Suspense>
            </div>
          </Show>
          <Show when={mode() === 'translate'}>
            <div class="flex-1 flex flex-col min-h-0 animate-page-enter">
              <Suspense fallback={<div class="flex-1 flex items-center justify-center"><div class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 bg-accent rounded-full loading-dot" /><span class="w-1.5 h-1.5 bg-accent rounded-full loading-dot" /><span class="w-1.5 h-1.5 bg-accent rounded-full loading-dot" /></div></div>}>
                <VoiceTerminal onHistoryAdd={(item) => actions.addToHistory(item)} pipeline="translate" onRecordingChange={setVoiceRecording} />
              </Suspense>
            </div>
          </Show>
          <Show when={mode() === 'text'}>
            <div class="flex-1 flex flex-col min-h-0 animate-page-enter">
              {(() => {
                const [suggested, setSuggested] = createSignal(getSuggestedLocale())
                return (
                  <Show when={suggested()}>
                    {(s) => (
                      <div class="flex items-center justify-center gap-3 px-4 py-2 bg-accent-soft/30 border-b border-accent-muted text-xs animate-page-enter">
                        <span class="i-mdi-translate w-4 h-4 text-accent" />
                        <span class="text-fg">sonotxt is available in <strong>{s().native}</strong></span>
                        <button
                          class="px-2.5 py-1 bg-accent text-white font-heading text-[10px] uppercase tracking-wider hover:bg-accent-hover transition-colors"
                          onClick={() => { setLocale(s().code); dismissLocaleSuggestion(); setSuggested(null) }}
                        >
                          Switch
                        </button>
                        <button
                          class="text-fg-faint hover:text-accent p-0.5 transition-colors"
                          onClick={() => { dismissLocaleSuggestion(); setSuggested(null) }}
                          title="Keep English"
                        >
                          <span class="i-mdi-close w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </Show>
                )
              })()}
              <Suspense fallback={<div class="flex-1 flex items-center justify-center"><div class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 bg-accent rounded-full loading-dot" /><span class="w-1.5 h-1.5 bg-accent rounded-full loading-dot" /><span class="w-1.5 h-1.5 bg-accent rounded-full loading-dot" /></div></div>}>
                <TextTerminal
                  onHistoryAdd={(item) => actions.addToHistory(item)}
                  initialText={editText()}
                  initialVoice={editVoice()}
                  initialLang={editLang()}
                  onVoiceChange={setTtsVoice}
                />
              </Suspense>
            </div>
          </Show>
          <Show when={mode() === 'call'}>
            <div class="flex-1 flex flex-col min-h-0 animate-page-enter">
              <Suspense fallback={<div class="flex-1 flex items-center justify-center"><div class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 bg-accent rounded-full loading-dot" /><span class="w-1.5 h-1.5 bg-accent rounded-full loading-dot" /><span class="w-1.5 h-1.5 bg-accent rounded-full loading-dot" /></div></div>}>
                <CallPage code={callCode()} fromLang={callFromLang()} toLang={callToLang()} onClose={() => { setMode('text'); window.history.replaceState({}, '', '/') }} />
              </Suspense>
            </div>
          </Show>
          <Show when={mode() === 'player' && activeItem()}>
            {(() => {
              const item = activeItem()!
              return (
                <div class="flex-1 flex flex-col min-h-0 animate-page-enter">
                  {/* Player content */}
                  <div class="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
                    <div class="w-full max-w-2xl mx-auto">
                      {/* Back + meta */}
                      <div class="flex items-center gap-2 mb-4">
                        <button
                          class="text-fg-faint hover:text-accent p-1 -ml-1 flex items-center gap-1"
                          onClick={() => setMode(prevMode())}
                          title="Back"
                        >
                          <span class="i-mdi-arrow-left w-5 h-5" />
                          <span class="text-[10px] font-heading uppercase tracking-wider hidden sm:inline">Back</span>
                        </button>
                        <div class="flex items-center gap-1.5 flex-1">
                          <span class={`${typeIcon(item.type || 'text')} w-3.5 h-3.5 ${
                            item.type === 'speech' ? 'text-accent' : item.type === 'translate' ? 'text-purple-500' : 'text-fg-muted'
                          }`} />
                          <span class={`text-[10px] font-heading uppercase tracking-wider ${
                            item.type === 'translate' ? 'text-purple-500' : item.type === 'speech' ? 'text-accent' : 'text-fg-faint'
                          }`}>
                            {item.type === 'translate' ? 'Translation' : item.type === 'speech' ? 'Speech' : 'Text-to-Speech'}
                          </span>
                        </div>
                        {/* Prev/Next navigation */}
                        {(() => {
                          const idx = store.history.findIndex(h => h.id === item.id)
                          return (
                            <div class="flex items-center gap-0.5">
                              <button
                                class="p-1 text-fg-faint hover:text-accent transition-colors disabled:opacity-20 disabled:cursor-default"
                                disabled={idx < 0 || idx >= store.history.length - 1}
                                onClick={() => { if (idx >= 0 && idx < store.history.length - 1) openPlayer(store.history[idx + 1]) }}
                                title="Previous (←)"
                              >
                                <span class="i-mdi-chevron-left w-4 h-4" />
                              </button>
                              <span class="text-[9px] text-fg-faint font-mono tabular-nums min-w-6 text-center">
                                {idx >= 0 ? idx + 1 : '?'}<span class="text-fg-faint/40">/{store.history.length}</span>
                              </span>
                              <button
                                class="p-1 text-fg-faint hover:text-accent transition-colors disabled:opacity-20 disabled:cursor-default"
                                disabled={idx <= 0}
                                onClick={() => { if (idx > 0) openPlayer(store.history[idx - 1]) }}
                                title="Next (→)"
                              >
                                <span class="i-mdi-chevron-right w-4 h-4" />
                              </button>
                            </div>
                          )
                        })()}
                      </div>

                      {/* Main text */}
                      <div class={`bg-surface border-2 shadow-[var(--shadow)] p-5 mb-4 select-text ${
                        item.type === 'speech' ? 'border-accent/40' : item.type === 'translate' ? 'border-purple-400/40' : 'border-edge'
                      }`}>
                        <Show when={item.translation}>
                          <div class="flex items-center gap-1.5 mb-3">
                            <span class="i-mdi-translate w-3.5 h-3.5 text-purple-500" />
                            <span class="text-[10px] text-purple-500 font-heading uppercase tracking-wider">Original</span>
                          </div>
                          <p class="text-fg-muted font-serif text-sm leading-relaxed whitespace-pre-wrap mb-4">{item.translation}</p>
                          <div class="border-t border-edge-soft pt-3 mb-1">
                            <span class="text-[10px] text-accent font-heading uppercase tracking-wider flex items-center gap-1">
                              <span class="i-mdi-arrow-right w-3 h-3" />
                              {LANG_NAMES[item.targetLang || ''] || item.targetLang}
                            </span>
                          </div>
                        </Show>
                        {(() => {
                          const isLong = item.text.length > 400
                          return (
                            <div class="relative">
                              <p
                                class={`text-fg font-serif text-base sm:text-lg leading-relaxed whitespace-pre-wrap ${
                                  isLong && !textExpanded() ? 'max-h-[9em] overflow-hidden' : ''
                                }`}
                              >
                                {item.text}
                              </p>
                              <Show when={isLong && !textExpanded()}>
                                <div class="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-surface to-transparent pointer-events-none" />
                                <button
                                  class="relative w-full pt-2 text-[10px] text-accent font-heading uppercase tracking-wider hover:text-accent-hover transition-colors"
                                  onClick={() => setTextExpanded(true)}
                                >
                                  Show more
                                </button>
                              </Show>
                              <Show when={isLong && textExpanded()}>
                                <button
                                  class="w-full pt-2 text-[10px] text-fg-faint font-heading uppercase tracking-wider hover:text-accent transition-colors"
                                  onClick={() => setTextExpanded(false)}
                                >
                                  Show less
                                </button>
                              </Show>
                            </div>
                          )
                        })()}
                      </div>

                      {/* Metadata pills */}
                      <div class="flex flex-wrap items-center gap-1.5 mb-4">
                        <Show when={item.voice}>
                          <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-page border border-edge-soft text-[10px] text-fg-faint font-heading uppercase tracking-wider">
                            <span class="i-mdi-account-voice w-3 h-3" />
                            {VOICE_NAMES[item.voice!] || item.voice}
                          </span>
                        </Show>
                        <Show when={item.targetLang}>
                          <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-500/10 border border-purple-500/20 text-[10px] text-purple-500 font-heading uppercase tracking-wider">
                            <span class="i-mdi-translate w-3 h-3" />
                            {LANG_NAMES[item.targetLang!] || item.targetLang}
                          </span>
                        </Show>
                        {(() => {
                          const words = item.text.trim().split(/\s+/).length
                          const chars = item.text.length
                          return <>
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-page border border-edge-soft text-[10px] text-fg-faint font-mono">
                              {words} {words === 1 ? 'word' : 'words'}
                            </span>
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-page border border-edge-soft text-[10px] text-fg-faint font-mono">
                              {chars > 999 ? `${(chars / 1000).toFixed(1)}k` : chars} chars
                            </span>
                          </>
                        })()}
                        <Show when={playingId() === item.id && audioDuration() > 0} fallback={
                          <Show when={item.duration > 0}>
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-page border border-edge-soft text-[10px] text-fg-faint font-mono">
                              <span class="i-mdi-timer-outline w-3 h-3" />
                              {formatTime(item.duration)}
                            </span>
                          </Show>
                        }>
                          <span class="inline-flex items-center gap-1 px-2 py-0.5 bg-accent-soft border border-accent-muted text-[10px] text-accent font-mono">
                            <span class="i-mdi-timer-outline w-3 h-3" />
                            {formatTime(audioDuration())}
                          </span>
                        </Show>
                        <span
                          class="inline-flex items-center gap-1 px-2 py-0.5 bg-page border border-edge-soft text-[10px] text-fg-faint font-mono cursor-default"
                          title={new Date(item.date).toLocaleString()}
                        >
                          <span class="i-mdi-clock-outline w-3 h-3" />
                          {timeAgo(item.date)}
                        </span>
                      </div>

                      {/* Audio player */}
                      <Show when={item.url} fallback={
                        <div class="flex items-center gap-2 px-3 py-2.5 mb-4 border border-edge-soft text-fg-faint">
                          <span class="i-mdi-volume-off w-4 h-4" />
                          <span class="text-[10px] font-heading uppercase tracking-wider flex-1">Audio unavailable</span>
                          <button
                            class="px-3 py-1 text-[10px] font-heading uppercase tracking-wider text-accent hover:text-accent-hover border border-accent-muted hover:bg-accent-soft transition-colors"
                            onClick={() => openInEditor(item)}
                          >
                            Regenerate
                          </button>
                        </div>
                      }>
                        <div class="bg-surface border-2 border-edge shadow-[var(--shadow)] p-3 mb-4">
                          <div class="flex items-center gap-3">
                            <button
                              class={`w-10 h-10 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                                playingId() === item.id && !audioPaused()
                                  ? 'bg-accent border-accent-strong text-white'
                                  : 'bg-surface border-edge text-accent hover:bg-accent-soft'
                              }`}
                              onClick={() => playHistoryItem(item)}
                            >
                              <Show when={playingId() === item.id && !audioPaused()} fallback={
                                <span class="i-mdi-play w-5 h-5 ml-0.5" />
                              }>
                                <span class="i-mdi-pause w-5 h-5" />
                              </Show>
                            </button>
                            <button
                              class={`p-1 flex-shrink-0 transition-colors ${playingId() === item.id ? 'text-fg-faint hover:text-accent' : 'text-fg-faint/20 cursor-default'}`}
                              onClick={() => { if (playingId() === item.id && currentAudio?.duration) currentAudio.currentTime = Math.max(0, currentAudio.currentTime - 15) }}
                              title="Back 15s (J)"
                            >
                              <span class="i-mdi-rewind-15 w-4 h-4" />
                            </button>
                            <div class="flex-1 flex flex-col gap-1">
                              <div
                                class="group/seek relative w-full h-1.5 bg-page border border-edge-soft overflow-visible cursor-pointer"
                                onMouseDown={(e) => {
                                  if (!currentAudio?.duration) return
                                  const bar = e.currentTarget
                                  const seek = (ev: MouseEvent) => {
                                    if (!currentAudio?.duration) return
                                    const rect = bar.getBoundingClientRect()
                                    const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width))
                                    currentAudio.currentTime = pct * currentAudio.duration
                                  }
                                  seek(e)
                                  const onMove = (ev: MouseEvent) => { ev.preventDefault(); seek(ev) }
                                  const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
                                  document.addEventListener('mousemove', onMove)
                                  document.addEventListener('mouseup', onUp)
                                }}
                                onTouchStart={(e) => {
                                  if (!currentAudio?.duration) return
                                  const bar = e.currentTarget
                                  const seekTouch = (ev: TouchEvent) => {
                                    if (!currentAudio?.duration || !ev.touches[0]) return
                                    const rect = bar.getBoundingClientRect()
                                    const pct = Math.max(0, Math.min(1, (ev.touches[0].clientX - rect.left) / rect.width))
                                    currentAudio.currentTime = pct * currentAudio.duration
                                  }
                                  seekTouch(e)
                                  const onTouchMove = (ev: TouchEvent) => { ev.preventDefault(); seekTouch(ev) }
                                  const onTouchEnd = () => { document.removeEventListener('touchmove', onTouchMove); document.removeEventListener('touchend', onTouchEnd) }
                                  document.addEventListener('touchmove', onTouchMove, { passive: false })
                                  document.addEventListener('touchend', onTouchEnd)
                                }}
                              >
                                <div class={`h-full transition-[width] duration-200 pointer-events-none ${item.type === 'translate' ? 'bg-purple-500' : 'bg-accent'}`}
                                  style={{ width: playingId() === item.id ? `${audioProgress()}%` : '0%' }}
                                />
                                <Show when={playingId() === item.id && audioProgress() > 0}>
                                  <div
                                    class={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border border-white shadow-sm sm:opacity-0 sm:group-hover/seek:opacity-100 transition-opacity pointer-events-none ${item.type === 'translate' ? 'bg-purple-500' : 'bg-accent'}`}
                                    style={{ left: `calc(${audioProgress()}% - 5px)` }}
                                  />
                                </Show>
                              </div>
                              <div class="flex justify-between">
                                <span class="text-[9px] text-fg-faint font-mono">
                                  {playingId() === item.id ? formatTime(audioTime()) : '0:00'}
                                </span>
                                <Show when={playingId() === item.id && audioDuration() > 0} fallback={
                                  <Show when={item.duration > 0} fallback={
                                    <Show when={item.voice}>
                                      <span class="text-[9px] text-fg-faint font-heading uppercase tracking-wider">{VOICE_NAMES[item.voice!] || item.voice}</span>
                                    </Show>
                                  }>
                                    <span class="text-[9px] text-fg-faint font-mono">{formatTime(item.duration)}</span>
                                  </Show>
                                }>
                                  <span class="text-[9px] text-fg-faint font-mono">
                                    {audioTime() > 0 ? `-${formatTime(Math.max(0, audioDuration() - audioTime()))}` : formatTime(audioDuration())}
                                  </span>
                                </Show>
                              </div>
                            </div>
                            <button
                              class={`p-1 flex-shrink-0 transition-colors ${playingId() === item.id ? 'text-fg-faint hover:text-accent' : 'text-fg-faint/20 cursor-default'}`}
                              onClick={() => { if (playingId() === item.id && currentAudio?.duration) currentAudio.currentTime = Math.min(currentAudio.duration, currentAudio.currentTime + 15) }}
                              title="Skip 15s (K)"
                            >
                              <span class="i-mdi-fast-forward-15 w-4 h-4" />
                            </button>
                            <a
                              href={item.url}
                              download={`sonotxt-${item.voice || 'audio'}-${new Date(item.date).toISOString().slice(0, 16).replace(/[T:]/g, '-')}.wav`}
                              class="text-fg-faint hover:text-accent transition-colors flex-shrink-0"
                              title="Download (D)"
                            >
                              <span class="i-mdi-download w-4 h-4" />
                            </a>
                          </div>
                        </div>
                      </Show>

                      {/* Inline action row */}
                      <div class="flex items-center gap-1">
                        <button
                          class="p-2 text-fg-faint hover:text-accent transition-colors"
                          onClick={() => openInEditor(item)}
                          title="Edit & regenerate (E)"
                        >
                          <span class="i-mdi-pencil w-4 h-4" />
                        </button>
                        <button
                          class="p-2 text-fg-faint hover:text-accent transition-colors"
                          onClick={() => copyText(item.text, `player-${item.id}`)}
                          title="Copy text (C)"
                        >
                          <span class={`w-4 h-4 ${copied() === `player-${item.id}` ? 'i-mdi-check text-emerald-600' : 'i-mdi-content-copy'}`} />
                        </button>
                        <Show when={item.translation}>
                          <button
                            class="p-2 text-fg-faint hover:text-purple-500 transition-colors"
                            onClick={() => copyText(item.translation!, `player-orig-${item.id}`)}
                            title="Copy original"
                          >
                            <span class={`w-4 h-4 ${copied() === `player-orig-${item.id}` ? 'i-mdi-check text-emerald-600' : 'i-mdi-translate'}`} />
                          </button>
                        </Show>
                        <Show when={typeof navigator !== 'undefined' && navigator.share}>
                          <button
                            class="p-2 text-fg-faint hover:text-accent transition-colors"
                            onClick={async () => {
                              if (item.url && navigator.canShare) {
                                try {
                                  const res = await fetch(item.url)
                                  if (!res.ok) throw new Error('fetch failed')
                                  const blob = await res.blob()
                                  const slug = item.text.trim().slice(0, 40).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'audio'
                                  const file = new File([blob], `sonotxt-${item.voice || 'audio'}-${slug}.wav`, { type: 'audio/wav' })
                                  if (navigator.canShare({ files: [file] })) {
                                    await navigator.share({ text: item.text.slice(0, 200), files: [file] })
                                    return
                                  }
                                } catch {}
                              }
                              navigator.share?.({ text: item.text, title: 'sonotxt' }).catch(() => {})
                            }}
                            title="Share (S)"
                          >
                            <span class="i-mdi-share w-4 h-4" />
                          </button>
                        </Show>
                        <span class="w-px h-4 bg-edge-soft mx-0.5" />
                        <button
                          class={`px-2 py-1 text-[10px] font-mono transition-colors tabular-nums ${
                            playbackRate() !== 1
                              ? 'text-accent bg-accent-soft border border-accent-muted'
                              : 'text-fg-faint hover:text-accent border border-transparent'
                          }`}
                          onClick={() => {
                            const cur = playbackRate()
                            const next = RATES[(RATES.indexOf(cur as typeof RATES[number]) + 1) % RATES.length]
                            setPlaybackRate(next)
                            if (currentAudio) currentAudio.playbackRate = next
                          }}
                          title={`Speed: ${playbackRate()}x`}
                        >
                          {playbackRate() === 1 ? '1x' : `${playbackRate()}x`}
                        </button>
                        <button
                          class={`p-2 transition-colors ${
                            repeat()
                              ? 'text-accent'
                              : 'text-fg-faint hover:text-accent'
                          }`}
                          onClick={() => setRepeat(r => !r)}
                          title={`Repeat: ${repeat() ? 'on' : 'off'} (L)`}
                        >
                          <span class={`w-4 h-4 ${repeat() ? 'i-mdi-repeat-once' : 'i-mdi-repeat'}`} />
                        </button>
                        <div class="flex-1" />
                        <span class="hidden sm:flex flex-wrap items-center gap-1.5 text-[9px] text-fg-faint/40 select-none">
                          <span class="flex items-center gap-0.5"><kbd class="px-1 py-0.5 bg-page border border-edge-soft font-mono">Space</kbd> play</span>
                          <span class="flex items-center gap-0.5"><kbd class="px-1 py-0.5 bg-page border border-edge-soft font-mono">R</kbd> speed</span>
                          <span class="flex items-center gap-0.5"><kbd class="px-1 py-0.5 bg-page border border-edge-soft font-mono">E</kbd> edit</span>
                          <span class="flex items-center gap-0.5"><kbd class="px-1 py-0.5 bg-page border border-edge-soft font-mono">D</kbd> save</span>
                          <span class="flex items-center gap-0.5"><kbd class="px-1 py-0.5 bg-page border border-edge-soft font-mono">L</kbd> loop</span>
                          <span class="flex items-center gap-0.5"><kbd class="px-1 py-0.5 bg-page border border-edge-soft font-mono">←→</kbd> nav</span>
                          <span class="flex items-center gap-0.5"><kbd class="px-1 py-0.5 bg-page border border-edge-soft font-mono">Esc</kbd> back</span>
                        </span>
                        <Show when={confirmDelete()} fallback={
                          <button
                            class="p-2 text-fg-faint hover:text-red-500 transition-colors"
                            onClick={() => { setConfirmDelete(true); if (confirmDeleteTimer) clearTimeout(confirmDeleteTimer); confirmDeleteTimer = setTimeout(() => { setConfirmDelete(false); confirmDeleteTimer = undefined }, 3000) }}
                            title="Delete"
                          >
                            <span class="i-mdi-delete w-4 h-4" />
                          </button>
                        }>
                          <button
                            class="px-2 py-1 text-[10px] text-red-500 font-heading uppercase tracking-wider animate-pulse"
                            onClick={() => {
                              currentAudio?.pause(); currentAudio = null; setPlayingId(''); setAudioProgress(0); setAudioTime(0); setAudioDuration(0); setAudioPaused(true)
                              actions.removeFromHistory(item.id)
                              setMode(prevMode())
                              setActiveItem(null)
                              setConfirmDelete(false)
                              if (confirmDeleteTimer) { clearTimeout(confirmDeleteTimer); confirmDeleteTimer = undefined }
                            }}
                            title="Confirm delete"
                          >
                            Delete?
                          </button>
                        </Show>
                      </div>

                      {/* Up next — shows when playing and there's a next track */}
                      <Show when={playingId() === item.id && !audioPaused()}>
                        {(() => {
                          const idx = store.history.findIndex(h => h.id === item.id)
                          const next = idx > 0 ? store.history[idx - 1] : null
                          if (!next) return null
                          return (
                            <button
                              class="flex items-center gap-2 px-3 py-2 mt-2 bg-page border border-edge-soft text-left hover:border-accent transition-colors group/next w-full"
                              onClick={() => openPlayer(next)}
                            >
                              <span class="text-[9px] text-fg-faint/50 font-heading uppercase tracking-wider flex-shrink-0">Up next</span>
                              <span class={`${typeIcon(next.type || 'text')} w-3 h-3 flex-shrink-0 ${
                                next.type === 'translate' ? 'text-purple-400' : 'text-fg-faint/40'
                              }`} />
                              <span class="text-[11px] text-fg-muted truncate flex-1 group-hover/next:text-accent transition-colors">{next.text}</span>
                              <Show when={next.voice}>
                                <span class="text-[9px] text-fg-faint/30 font-heading uppercase tracking-wider flex-shrink-0 hidden sm:inline">{VOICE_NAMES[next.voice!] || next.voice}</span>
                              </Show>
                              <Show when={next.duration > 0}>
                                <span class="text-[9px] text-fg-faint/30 font-mono flex-shrink-0">{formatTime(next.duration)}</span>
                              </Show>
                              <span class="i-mdi-skip-next w-3.5 h-3.5 text-fg-faint/30 group-hover/next:text-accent flex-shrink-0 transition-colors" />
                            </button>
                          )
                        })()}
                      </Show>
                    </div>
                  </div>
                </div>
              )
            })()}
          </Show>
        </div>
      </div>

      {/* Mini-player — visible when audio plays outside player view */}
      <Show when={playingId() && mode() !== 'player'}>
        {(() => {
          const item = store.history.find(h => h.id === playingId())
          if (!item) return null
          return (
            <div
              class="fixed left-0 sm:left-12 right-0 z-20 bg-surface border-t-2 border-edge flex items-center gap-3 px-4 py-2 bottom-[calc(52px+env(safe-area-inset-bottom,0px))] sm:bottom-0"
              style="animation: toast-in 0.2s ease-out"
            >
              <button
                class="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center flex-shrink-0 hover:bg-accent-hover transition-colors"
                onClick={() => {
                  if (currentAudio && !currentAudio.paused) currentAudio.pause()
                  else if (currentAudio && currentAudio.paused) currentAudio.play().catch(() => {})
                  else playHistoryItem(item)
                }}
              >
                <span class={`w-4 h-4 ${audioPaused() ? 'i-mdi-play' : 'i-mdi-pause'}`} />
              </button>
              <div class="flex-1 min-w-0 cursor-pointer group/mini" onClick={() => openPlayer(item)}>
                <div class="flex items-center gap-1.5 text-xs text-fg truncate leading-tight">
                  <Show when={!audioPaused()} fallback={
                    <span class={`${typeIcon(item.type || 'text')} w-3 h-3 flex-shrink-0 ${
                      item.type === 'translate' ? 'text-purple-500' : 'text-fg-faint'
                    }`} />
                  }>
                    <span class="flex items-end gap-px h-3 w-3 flex-shrink-0 text-accent">
                      <span class="eq-bar" /><span class="eq-bar" /><span class="eq-bar" />
                    </span>
                  </Show>
                  <span class="truncate">{item.text}</span>
                  <span class="i-mdi-chevron-up w-3 h-3 text-fg-faint/30 group-hover/mini:text-accent flex-shrink-0 transition-colors" />
                </div>
                <div class="flex items-center gap-1.5 text-[10px] text-fg-faint ml-[18px]">
                  <Show when={item.voice}>
                    <span>{VOICE_NAMES[item.voice!] || item.voice}</span>
                    <span>&middot;</span>
                  </Show>
                  <span>{formatTime(audioTime())}</span>
                  <Show when={audioDuration() > 0}>
                    <span class="text-fg-faint/50">/</span>
                    <Show when={audioTime() > 0 && !audioPaused()} fallback={
                      <span>{formatTime(audioDuration())}</span>
                    }>
                      <span>-{formatTime(Math.max(0, audioDuration() - audioTime()))}</span>
                    </Show>
                  </Show>
                  {(() => {
                    const idx = store.history.findIndex(h => h.id === item.id)
                    if (idx < 0) return null
                    return <>
                      <span class="text-fg-faint/30">&middot;</span>
                      <span class="text-fg-faint/40 font-mono tabular-nums">{idx + 1}<span class="text-fg-faint/20">/{store.history.length}</span></span>
                    </>
                  })()}
                </div>
              </div>
              <button
                class="text-fg-faint/40 hover:text-accent p-1 flex-shrink-0 transition-colors hidden sm:block"
                onClick={() => { if (currentAudio?.duration) currentAudio.currentTime = Math.max(0, currentAudio.currentTime - 15) }}
                title="Back 15s (J)"
              >
                <span class="i-mdi-rewind-15 w-3.5 h-3.5" />
              </button>
              <div
                class="absolute bottom-full left-0 right-0 h-1 bg-page cursor-pointer group/mini-seek hover:h-1.5 transition-[height]"
                onClick={(e) => {
                  if (!currentAudio?.duration) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
                  currentAudio.currentTime = pct * currentAudio.duration
                }}
                onTouchStart={(e) => {
                  if (!currentAudio?.duration) return
                  const bar = e.currentTarget
                  const seekTouch = (ev: TouchEvent) => {
                    if (!currentAudio?.duration || !ev.touches[0]) return
                    const rect = bar.getBoundingClientRect()
                    const pct = Math.max(0, Math.min(1, (ev.touches[0].clientX - rect.left) / rect.width))
                    currentAudio.currentTime = pct * currentAudio.duration
                  }
                  seekTouch(e)
                  const onTouchMove = (ev: TouchEvent) => { ev.preventDefault(); seekTouch(ev) }
                  const onTouchEnd = () => { document.removeEventListener('touchmove', onTouchMove); document.removeEventListener('touchend', onTouchEnd) }
                  document.addEventListener('touchmove', onTouchMove, { passive: false })
                  document.addEventListener('touchend', onTouchEnd)
                }}
              >
                <div class={`h-full transition-[width] duration-200 ${item.type === 'translate' ? 'bg-purple-500' : 'bg-accent'}`} style={{ width: `${audioProgress()}%` }} />
              </div>
              <button
                class="text-fg-faint/40 hover:text-accent p-1 flex-shrink-0 transition-colors hidden sm:block"
                onClick={() => { if (currentAudio?.duration) currentAudio.currentTime = Math.min(currentAudio.duration, currentAudio.currentTime + 15) }}
                title="Skip 15s (K)"
              >
                <span class="i-mdi-fast-forward-15 w-3.5 h-3.5" />
              </button>
              <button
                class={`text-[9px] font-mono font-medium flex-shrink-0 transition-colors ${
                  playbackRate() !== 1
                    ? 'text-accent'
                    : 'text-fg-faint/50 hover:text-fg-faint'
                }`}
                onClick={() => {
                  const cur = playbackRate()
                  const next = RATES[(RATES.indexOf(cur as typeof RATES[number]) + 1) % RATES.length]
                  setPlaybackRate(next)
                  if (currentAudio) currentAudio.playbackRate = next
                }}
                title={`Speed: ${playbackRate()}x`}
              >
                {playbackRate()}x
              </button>
              <Show when={repeat()}>
                <span class="i-mdi-repeat-once w-3.5 h-3.5 text-accent flex-shrink-0 hidden sm:block" title="Repeat on" />
              </Show>
              <button
                class="text-fg-faint hover:text-accent p-1 flex-shrink-0 transition-colors"
                onClick={() => { currentAudio?.pause(); currentAudio = null; setPlayingId(''); setAudioProgress(0); setAudioTime(0); setAudioDuration(0); setAudioPaused(true) }}
                title="Stop"
              >
                <span class="i-mdi-stop w-4 h-4" />
              </button>
            </div>
          )
        })()}
      </Show>

      {/* Modals */}
      <Show when={showAuth()}>
        <Suspense fallback={<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div class="flex items-center gap-1.5"><span class="w-2 h-2 bg-white rounded-full loading-dot" /><span class="w-2 h-2 bg-white rounded-full loading-dot" /><span class="w-2 h-2 bg-white rounded-full loading-dot" /></div></div>}>
          <AuthModal onClose={() => setShowAuth(false)} onLogin={onLogin} initialMode={authMode()} />
        </Suspense>
      </Show>
      <Show when={showWallet()}>
        <Suspense fallback={<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div class="flex items-center gap-1.5"><span class="w-2 h-2 bg-white rounded-full loading-dot" /><span class="w-2 h-2 bg-white rounded-full loading-dot" /><span class="w-2 h-2 bg-white rounded-full loading-dot" /></div></div>}>
          <WalletModal onClose={() => setShowWallet(false)} onLogin={onLogin} />
        </Suspense>
      </Show>
      <Show when={showProfile()}>
        <Suspense fallback={<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div class="flex items-center gap-1.5"><span class="w-2 h-2 bg-white rounded-full loading-dot" /><span class="w-2 h-2 bg-white rounded-full loading-dot" /><span class="w-2 h-2 bg-white rounded-full loading-dot" /></div></div>}>
          <ProfilePage onClose={() => setShowProfile(false)} />
        </Suspense>
      </Show>

      {/* Keyboard shortcuts overlay */}
      <Show when={showShortcuts()}>
        <div class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setShowShortcuts(false)}>
          <div class="bg-surface border-2 border-edge shadow-[var(--shadow)] max-w-sm w-full animate-modal-in" onClick={(e) => e.stopPropagation()}>
            <div class="flex items-center justify-between px-4 py-3 border-b-2 border-edge">
              <span class="font-heading text-xs uppercase tracking-wider text-fg">Keyboard shortcuts</span>
              <button class="text-fg-faint hover:text-accent p-0.5" onClick={() => setShowShortcuts(false)}>
                <span class="i-mdi-close w-4 h-4" />
              </button>
            </div>
            <div class="px-4 py-3 flex flex-col gap-3 text-xs max-h-[60vh] overflow-y-auto">
              <div>
                <div class="text-[10px] text-fg-faint font-heading uppercase tracking-wider mb-1.5">Global</div>
                <div class="flex flex-col gap-1">
                  {([
                    ['1 2 3 4', 'Switch mode'],
                    ['H', 'Toggle sidebar'],
                    ['N', 'Play latest'],
                    ['J / K', 'Seek −15s / +15s'],
                    ['?', 'This help'],
                    ['Esc', 'Close / stop / go back'],
                  ] as const).map(([key, desc]) => (
                    <div class="flex items-center justify-between">
                      <span class="text-fg-muted">{desc}</span>
                      <kbd class="px-1.5 py-0.5 bg-page border border-edge-soft font-mono text-[10px] text-fg-faint">{key}</kbd>
                    </div>
                  ))}
                </div>
              </div>
              <div class="border-t border-edge-soft" />
              <div>
                <div class="text-[10px] text-fg-faint font-heading uppercase tracking-wider mb-1.5">Voice / Translate</div>
                <div class="flex flex-col gap-1">
                  {([
                    ['Space', 'Hold to record'],
                    ['/', 'Toggle text input'],
                    ['R', 'Cycle replay speed'],
                  ] as const).map(([key, desc]) => (
                    <div class="flex items-center justify-between">
                      <span class="text-fg-muted">{desc}</span>
                      <kbd class="px-1.5 py-0.5 bg-page border border-edge-soft font-mono text-[10px] text-fg-faint">{key}</kbd>
                    </div>
                  ))}
                </div>
              </div>
              <div class="border-t border-edge-soft" />
              <div>
                <div class="text-[10px] text-fg-faint font-heading uppercase tracking-wider mb-1.5">TTS</div>
                <div class="flex flex-col gap-1">
                  {([
                    [`${navigator.platform?.includes('Mac') ? '⌘' : 'Ctrl'}+Enter`, 'Generate / cancel'],
                    ['Space', 'Play / pause'],
                    ['R', 'Cycle speed'],
                    ['← →', 'Seek ±5s'],
                  ] as const).map(([key, desc]) => (
                    <div class="flex items-center justify-between">
                      <span class="text-fg-muted">{desc}</span>
                      <kbd class="px-1.5 py-0.5 bg-page border border-edge-soft font-mono text-[10px] text-fg-faint">{key}</kbd>
                    </div>
                  ))}
                </div>
              </div>
              <div class="border-t border-edge-soft" />
              <div>
                <div class="text-[10px] text-fg-faint font-heading uppercase tracking-wider mb-1.5">Player</div>
                <div class="flex flex-col gap-1">
                  {([
                    ['Space', 'Play / pause'],
                    ['R', 'Cycle speed'],
                    ['L', 'Toggle repeat'],
                    ['C', 'Copy text'],
                    ['D', 'Download audio'],
                    ['E', 'Edit & regenerate'],
                    ['S', 'Share'],
                    ['← →', 'Previous / next'],
                    ['Del', 'Delete item'],
                  ] as const).map(([key, desc]) => (
                    <div class="flex items-center justify-between">
                      <span class="text-fg-muted">{desc}</span>
                      <kbd class="px-1.5 py-0.5 bg-page border border-edge-soft font-mono text-[10px] text-fg-faint">{key}</kbd>
                    </div>
                  ))}
                </div>
              </div>
              <div class="border-t border-edge-soft" />
              <div>
                <div class="text-[10px] text-fg-faint font-heading uppercase tracking-wider mb-1.5">Call</div>
                <div class="flex flex-col gap-1">
                  {([
                    ['Space', 'Hold to record'],
                    ['M', 'Toggle mute'],
                    ['R', 'Cycle replay speed'],
                    ['Esc Esc', 'Hang up'],
                  ] as const).map(([key, desc]) => (
                    <div class="flex items-center justify-between">
                      <span class="text-fg-muted">{desc}</span>
                      <kbd class="px-1.5 py-0.5 bg-page border border-edge-soft font-mono text-[10px] text-fg-faint">{key}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* Signup nudge — shown after 200 tokens used, not logged in */}
      <Show when={!store.user && !nudgeDismissed() && store.freeRemaining <= 800 && store.freeRemaining > 0}>
        <div
          class="fixed bottom-[calc(52px+env(safe-area-inset-bottom,0px)+8px)] sm:bottom-4 left-3 right-3 sm:left-auto sm:right-4 z-30 sm:w-auto sm:max-w-sm bg-surface border-2 border-accent shadow-[var(--shadow)] px-4 py-3 flex items-center gap-3"
          style="animation: toast-in 0.3s ease-out"
        >
          <span class="i-mdi-gift w-5 h-5 text-accent flex-shrink-0" />
          <div class="flex-1 min-w-0">
            <p class="text-xs text-fg font-heading uppercase tracking-wider">
              {store.freeRemaining} free tokens left
            </p>
            <div class="w-full h-1 bg-accent-soft mt-1.5 overflow-hidden">
              <div class="h-full bg-accent transition-all duration-500" style={{ width: `${Math.max(5, (store.freeRemaining / 1000) * 100)}%` }} />
            </div>
          </div>
          <button
            class="px-3 py-1.5 bg-accent text-white font-heading text-[10px] uppercase tracking-wider border-2 border-accent-strong hover:bg-accent-hover transition-all flex-shrink-0"
            onClick={() => { setAuthMode('email-login'); setShowAuth(true) }}
          >
            Sign up
          </button>
          <button
            class="text-fg-faint hover:text-fg p-0.5 flex-shrink-0 transition-colors"
            onClick={() => setNudgeDismissed(true)}
          >
            <span class="i-mdi-close w-3.5 h-3.5" />
          </button>
        </div>
      </Show>

      {/* Out of tokens — must sign up */}
      <Show when={!store.user && store.freeRemaining <= 0}>
        <div class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div class="bg-surface border-2 border-edge shadow-[var(--shadow)] max-w-sm w-full text-center animate-modal-in">
            <div class="px-6 pt-6 pb-4">
              <div class="w-14 h-14 rounded-full bg-accent-soft border-2 border-accent-muted flex items-center justify-center mx-auto mb-4">
                <span class="i-mdi-ticket-confirmation w-7 h-7 text-accent" />
              </div>
              <h3 class="font-heading text-sm uppercase tracking-wider text-fg mb-1">Free tokens used up</h3>
              <p class="text-xs text-fg-faint">Create an account to continue using sonotxt</p>
            </div>
            <div class="flex border-t-2 border-edge">
              <button
                class="flex-1 px-4 py-3 bg-accent text-white font-heading text-[10px] uppercase tracking-wider hover:bg-accent-hover transition-colors flex items-center justify-center gap-1.5"
                onClick={() => { setAuthMode('email-login'); setShowAuth(true) }}
              >
                <span class="i-mdi-email-outline w-3.5 h-3.5" />
                Sign up free
              </button>
              <div class="w-[2px] bg-edge" />
              <button
                class="flex-1 px-4 py-3 bg-surface text-fg-muted font-heading text-[10px] uppercase tracking-wider hover:text-accent transition-colors flex items-center justify-center gap-1.5"
                onClick={() => setShowWallet(true)}
              >
                <span class="i-mdi-wallet w-3.5 h-3.5" />
                Wallet
              </button>
            </div>
          </div>
        </div>
      </Show>

      <ToastContainer />
    </div>
  )
}
