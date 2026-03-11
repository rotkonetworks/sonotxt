import { createSignal, For, Show, onMount, lazy, Suspense } from 'solid-js'
import { ToastContainer, showToast } from './components/Toast'
import { useStore } from './lib/store'
import type { HistoryItem } from './lib/store'
import * as api from './lib/api'
import type { User } from './lib/api'

const VoiceTerminal = lazy(() => import('./components/VoiceTerminal'))
const TextTerminal = lazy(() => import('./components/TextTerminal'))
const AuthModal = lazy(() => import('./components/AuthModal'))
const WalletModal = lazy(() => import('./components/WalletModal'))
const ProfilePage = lazy(() => import('./components/ProfilePage'))

export default function App() {
  const { state: store, actions } = useStore()

  const [mode, setMode] = createSignal<'chat' | 'translate' | 'text' | 'player'>('chat')
  const [sidebarOpen, setSidebarOpen] = createSignal(false)
  const [showAuth, setShowAuth] = createSignal(false)
  const [showWallet, setShowWallet] = createSignal(false)
  const [showProfile, setShowProfile] = createSignal(false)
  const [showLoginMenu, setShowLoginMenu] = createSignal(false)
  const [playingId, setPlayingId] = createSignal('')
  const [editText, setEditText] = createSignal('')
  const [editVoice, setEditVoice] = createSignal('')
  const [editLang, setEditLang] = createSignal('')
  const [activeItem, setActiveItem] = createSignal<HistoryItem | null>(null)

  let currentAudio: HTMLAudioElement | null = null
  let playerAudioRef: HTMLAudioElement | undefined

  onMount(async () => {
    // Handle magic link callback
    const params = new URLSearchParams(window.location.search)
    const magicToken = params.get('token')
    if (magicToken && window.location.pathname.includes('/auth/verify')) {
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
        { id: data.user_id, nickname: data.nickname, email: data.email, wallet_address: data.wallet_address, balance: data.balance },
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
    const name = u.nickname || u.email || (u.wallet_address ? u.wallet_address.slice(0, 8) + '...' : 'anon')
    showToast(`Welcome, ${name}!`, 'success')
  }

  function logout() {
    actions.logout()
    showToast('Logged out', 'success')
  }

  function openInEditor(item: HistoryItem) {
    currentAudio?.pause()
    currentAudio = null
    setPlayingId('')
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
    setActiveItem(item)
    setMode('player')
    setSidebarOpen(false)
  }

  function playHistoryItem(item: HistoryItem) {
    if (playingId() === item.id) {
      currentAudio?.pause()
      currentAudio = null
      setPlayingId('')
      return
    }
    currentAudio?.pause()
    if (!item.url) return
    const a = new Audio(item.url)
    currentAudio = a
    setPlayingId(item.id)
    a.onended = () => { setPlayingId(''); currentAudio = null }
    a.onerror = () => { setPlayingId(''); currentAudio = null }
    a.play().catch(() => { setPlayingId(''); currentAudio = null })
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

  return (
    <div class="h-screen flex">
      {/* Thin sidebar — always visible on desktop */}
      <div class="hidden lg:flex flex-shrink-0 w-12 bg-surface border-r-2 border-edge flex-col items-center py-2 gap-1">
        <button class="p-2 text-fg-faint hover:text-accent" onClick={() => setSidebarOpen(!sidebarOpen())} title="History">
          <span class={sidebarOpen() ? 'i-mdi-menu-open w-5 h-5' : 'i-mdi-menu w-5 h-5'} />
        </button>
        <div class="w-6 border-t border-edge-soft my-1" />
        <button
          class={`p-2 transition-colors ${mode() === 'chat' ? 'text-accent' : 'text-fg-faint hover:text-accent'}`}
          onClick={() => setMode('chat')}
          title="Voice chat"
        >
          <span class="i-mdi-microphone w-5 h-5" />
        </button>
        <button
          class={`p-2 transition-colors ${mode() === 'translate' ? 'text-accent' : 'text-fg-faint hover:text-accent'}`}
          onClick={() => setMode('translate')}
          title="Translate"
        >
          <span class="i-mdi-translate w-5 h-5" />
        </button>
        <button
          class={`p-2 transition-colors ${mode() === 'text' ? 'text-accent' : 'text-fg-faint hover:text-accent'}`}
          onClick={() => setMode('text')}
          title="Text to speech"
        >
          <span class="i-mdi-volume-high w-5 h-5" />
        </button>
        <div class="flex-1" />
        <Show when={store.user}>
          <button class="p-2 text-fg-faint hover:text-accent" onClick={() => setShowProfile(true)} title="Profile">
            <span class="i-mdi-account w-5 h-5" />
          </button>
        </Show>
      </div>

      {/* Sidebar overlay — slides over content, never pushes it */}
      <Show when={sidebarOpen()}>
        <div class="fixed inset-0 z-30 bg-black/30" onClick={() => setSidebarOpen(false)} />
      </Show>
      <aside class={`fixed inset-y-0 left-0 lg:left-12 z-40 w-64 bg-surface border-r-2 border-edge flex flex-col transition-transform duration-200 ${
        sidebarOpen() ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div class="w-64 flex flex-col h-full">
          {/* Header */}
          <div class="flex items-center justify-between px-4 py-3 border-b-2 border-edge flex-shrink-0">
            <div class="flex items-center gap-2">
              <div class="i-mdi-waveform text-accent-strong w-4 h-4" />
              <span class="text-accent-strong font-bold text-sm">sonotxt</span>
            </div>
            <button class="text-fg-faint hover:text-accent p-1" onClick={() => setSidebarOpen(false)}>
              <span class="i-mdi-close w-4 h-4" />
            </button>
          </div>

          {/* History */}
          <div class="flex-1 overflow-y-auto px-2 py-2">
            <div class="flex items-center justify-between px-1 mb-2">
              <span class="text-[10px] text-fg-faint font-heading uppercase tracking-wider">History</span>
              <div class="flex items-center gap-2">
                <span class="text-[10px] text-fg-faint font-mono">
                  {store.history.filter(h => h.type === 'speech').length} voice · {store.history.filter(h => h.type !== 'speech').length} text
                </span>
                <Show when={store.history.length > 0}>
                  <button
                    class="text-[10px] text-fg-faint hover:text-red-500 font-heading uppercase tracking-wider"
                    onClick={() => actions.clearHistory()}
                  >
                    Clear
                  </button>
                </Show>
              </div>
            </div>
            <Show when={store.history.length > 0} fallback={
              <div class="text-xs text-fg-faint py-8 text-center">No history yet</div>
            }>
              <For each={store.history.slice(0, 30)}>{item => {
                const active = () => activeItem()?.id === item.id && mode() === 'player'
                return (
                  <div
                    class={`group flex items-start gap-2 py-2 px-2 text-xs rounded cursor-pointer transition-colors ${
                      active() ? 'bg-accent-soft' : 'hover:bg-page'
                    }`}
                    onClick={() => openPlayer(item)}
                  >
                    {/* Type icon */}
                    <div class="flex-shrink-0 mt-0.5">
                      <span class={`${typeIcon(item.type || 'text')} w-3.5 h-3.5 ${
                        active() ? 'text-accent' : item.type === 'speech' ? 'text-accent' : item.type === 'translate' ? 'text-purple-500' : 'text-fg-muted'
                      }`} />
                    </div>

                    {/* Content */}
                    <div class="flex-1 min-w-0">
                      <div class="text-fg truncate leading-tight">{item.text}</div>
                      <Show when={item.translation}>
                        <div class="text-fg-faint truncate text-[10px] mt-0.5 italic">{item.translation}</div>
                      </Show>
                      <div class="flex items-center gap-1.5 mt-1 text-[10px] text-fg-faint">
                        <Show when={item.voice}>
                          <span>{item.voice}</span>
                          <span>·</span>
                        </Show>
                        <span>{timeAgo(item.date)}</span>
                        <Show when={item.targetLang}>
                          <span>·</span>
                          <span class="text-purple-400">→ {item.targetLang}</span>
                        </Show>
                      </div>
                    </div>

                    {/* Actions — visible on hover */}
                    <div class="flex flex-col gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
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
                          download={`sonotxt-${item.id?.slice(0, 8)}.wav`}
                          class="text-fg-faint hover:text-accent p-0.5"
                          onClick={(e) => e.stopPropagation()}
                          title="Download"
                        >
                          <span class="i-mdi-download w-3 h-3" />
                        </a>
                      </Show>
                    </div>
                  </div>
                )
              }}</For>
            </Show>
          </div>

          {/* Footer */}
          <div class="border-t-2 border-edge px-3 py-2 flex-shrink-0 flex items-center justify-between">
            <span class="text-[10px] text-fg-faint font-mono">{store.stats.generated} generated</span>
            <a href="https://rotko.net" class="text-[10px] text-fg-faint hover:text-accent font-heading uppercase tracking-wider">Rotko</a>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div class="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Top bar */}
        <div class="flex items-center gap-1 px-2 py-1.5 border-b border-edge-soft bg-surface flex-shrink-0">
          {/* Hamburger — mobile only */}
          <button class="lg:hidden text-fg-faint hover:text-accent p-1.5" onClick={() => setSidebarOpen(!sidebarOpen())} title="History">
            <span class="i-mdi-menu w-5 h-5" />
          </button>
          {/* Mode icons — mobile only (desktop has thin sidebar) */}
          <div class="flex-1 flex lg:hidden items-center justify-center gap-1">
            <button
              class={`p-1.5 transition-colors ${mode() === 'chat' ? 'text-accent' : 'text-fg-faint'}`}
              onClick={() => setMode('chat')}
            >
              <span class="i-mdi-microphone w-4 h-4" />
            </button>
            <button
              class={`p-1.5 transition-colors ${mode() === 'translate' ? 'text-accent' : 'text-fg-faint'}`}
              onClick={() => setMode('translate')}
            >
              <span class="i-mdi-translate w-4 h-4" />
            </button>
            <button
              class={`p-1.5 transition-colors ${mode() === 'text' ? 'text-accent' : 'text-fg-faint'}`}
              onClick={() => setMode('text')}
            >
              <span class="i-mdi-volume-high w-4 h-4" />
            </button>
          </div>
          <div class="hidden lg:block flex-1" />
          {/* Login / Profile — always visible, top right */}
          <Show when={store.user} fallback={
            <div class="relative">
              <button
                class="flex items-center gap-1 px-3 py-1.5 text-xs text-fg-muted hover:text-accent font-heading uppercase tracking-wider"
                onClick={() => setShowLoginMenu(!showLoginMenu())}
              >
                <span class="i-mdi-login w-4 h-4" />
                <span class="hidden sm:inline">Login</span>
              </button>
              <Show when={showLoginMenu()}>
                <div class="absolute right-0 top-full mt-1 bg-surface border-2 border-edge shadow-sharp z-50 w-48">
                  <button
                    class="w-full px-3 py-2 text-left text-xs text-fg hover:bg-page flex items-center gap-2"
                    onClick={() => { setShowLoginMenu(false); setShowAuth(true) }}
                  >
                    <span class="i-mdi-key w-4 h-4 text-fg-muted" />
                    Nickname + Password
                  </button>
                  <button
                    class="w-full px-3 py-2 text-left text-xs text-fg hover:bg-page flex items-center gap-2"
                    onClick={() => { setShowLoginMenu(false); setShowWallet(true) }}
                  >
                    <span class="i-mdi-wallet w-4 h-4 text-fg-muted" />
                    Connect Wallet
                  </button>
                </div>
              </Show>
            </div>
          }>
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 text-xs hover:bg-accent-soft transition-colors"
              onClick={() => setShowProfile(true)}
            >
              <span class="text-accent font-mono">${store.user?.balance.toFixed(2)}</span>
              <div class="w-6 h-6 rounded-full bg-accent-soft border border-edge flex items-center justify-center">
                <span class="i-mdi-account w-3.5 h-3.5 text-accent" />
              </div>
            </button>
          </Show>
        </div>

        {/* Content */}
        <div class="flex-1 flex flex-col min-h-0">
          <Show when={mode() === 'chat' || mode() === 'translate'}>
            <Suspense fallback={<div class="flex-1 flex items-center justify-center"><span class="text-accent animate-pulse font-heading text-xs uppercase tracking-wider">Loading...</span></div>}>
              <VoiceTerminal onHistoryAdd={(item) => actions.addToHistory(item)} pipeline={mode() === 'translate' ? 'translate' : 'chat'} />
            </Suspense>
          </Show>
          <Show when={mode() === 'text'}>
            <Suspense fallback={<div class="flex-1 flex items-center justify-center"><span class="text-accent animate-pulse font-heading text-xs uppercase tracking-wider">Loading...</span></div>}>
              <TextTerminal
                onHistoryAdd={(item) => actions.addToHistory(item)}
                initialText={editText()}
                initialVoice={editVoice()}
                initialLang={editLang()}
              />
            </Suspense>
          </Show>
          <Show when={mode() === 'player' && activeItem()}>
            {(() => {
              const item = activeItem()!
              return (
                <div class="flex-1 flex flex-col min-h-0">
                  {/* Player header */}
                  <div class="flex items-center gap-2 px-4 sm:px-6 py-3 border-b border-edge-soft flex-shrink-0">
                    <button
                      class="text-fg-faint hover:text-accent p-1"
                      onClick={() => setMode('chat')}
                      title="Back"
                    >
                      <span class="i-mdi-arrow-left w-5 h-5" />
                    </button>
                    <span class={`${typeIcon(item.type || 'text')} w-4 h-4 ${
                      item.type === 'speech' ? 'text-accent' : item.type === 'translate' ? 'text-purple-500' : 'text-fg-muted'
                    }`} />
                    <span class="text-xs text-fg-faint font-heading uppercase tracking-wider">
                      {item.type === 'translate' ? 'Translation' : item.type === 'speech' ? 'Speech' : 'Text-to-Speech'}
                    </span>
                    <div class="flex-1" />
                    <span class="text-[10px] text-fg-faint font-mono">{timeAgo(item.date)}</span>
                  </div>

                  {/* Player content */}
                  <div class="flex-1 overflow-y-auto px-4 sm:px-6 py-6">
                    <div class="w-full max-w-2xl mx-auto flex flex-col gap-4">
                      {/* Audio player */}
                      <Show when={item.url}>
                        <div class="bg-surface border-2 border-edge shadow-[var(--shadow)] p-4">
                          <div class="flex items-center gap-3">
                            <button
                              class={`w-12 h-12 rounded-full border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                                playingId() === item.id
                                  ? 'bg-accent border-accent-strong text-white'
                                  : 'bg-surface border-edge text-accent hover:bg-accent-soft'
                              }`}
                              onClick={() => playHistoryItem(item)}
                            >
                              <Show when={playingId() === item.id} fallback={
                                <svg viewBox="0 0 24 24" class="w-5 h-5 ml-0.5" fill="currentColor">
                                  <path d="M8 5v14l11-7z"/>
                                </svg>
                              }>
                                <svg viewBox="0 0 24 24" class="w-5 h-5" fill="currentColor">
                                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                                </svg>
                              </Show>
                            </button>
                            <div class="flex-1">
                              <audio
                                ref={playerAudioRef}
                                src={item.url}
                                controls
                                class="w-full h-10"
                              />
                            </div>
                            <a
                              href={item.url}
                              download={`sonotxt-${item.id?.slice(0, 8)}.wav`}
                              class="text-fg-faint hover:text-accent transition-colors flex-shrink-0"
                              title="Download"
                            >
                              <span class="i-mdi-download w-5 h-5" />
                            </a>
                          </div>
                          <Show when={item.voice}>
                            <div class="mt-2 flex items-center gap-2">
                              <span class="text-[10px] text-fg-faint font-heading uppercase tracking-wider">Voice:</span>
                              <span class="text-xs text-fg font-heading uppercase tracking-wider">{item.voice}</span>
                            </div>
                          </Show>
                        </div>
                      </Show>

                      {/* Translation info */}
                      <Show when={item.translation}>
                        <div class="bg-surface border-2 border-edge shadow-[var(--shadow)] p-4">
                          <div class="flex items-center gap-2 mb-2">
                            <span class="i-mdi-translate w-4 h-4 text-purple-500" />
                            <span class="text-xs text-purple-500 font-heading uppercase tracking-wider">
                              Original
                            </span>
                          </div>
                          <p class="text-fg font-serif text-sm sm:text-base leading-relaxed whitespace-pre-wrap">{item.translation}</p>
                        </div>
                      </Show>

                      {/* Full text */}
                      <div class="bg-surface border-2 border-edge shadow-[var(--shadow)] p-4">
                        <Show when={item.type === 'translate'}>
                          <div class="flex items-center gap-2 mb-2">
                            <span class="text-xs text-fg-faint font-heading uppercase tracking-wider">
                              Translated ({item.targetLang})
                            </span>
                          </div>
                        </Show>
                        <p class="text-fg font-serif text-sm sm:text-base lg:text-lg leading-relaxed whitespace-pre-wrap">{item.text}</p>
                      </div>

                      {/* Actions */}
                      <div class="flex items-center gap-2 flex-wrap">
                        <button
                          class="px-4 py-2 font-heading text-xs uppercase tracking-wider border-2 border-edge bg-surface text-fg-muted hover:text-accent transition-all flex items-center gap-2"
                          onClick={() => openInEditor(item)}
                        >
                          <span class="i-mdi-pencil w-4 h-4" />
                          Edit & Regenerate
                        </button>
                        <Show when={typeof navigator !== 'undefined' && navigator.share}>
                          <button
                            class="px-4 py-2 font-heading text-xs uppercase tracking-wider border-2 border-edge bg-surface text-fg-muted hover:text-accent transition-all flex items-center gap-2"
                            onClick={async () => {
                              try {
                                await navigator.share({ text: item.text, title: 'sonotxt' })
                              } catch {}
                            }}
                          >
                            <span class="i-mdi-share w-4 h-4" />
                            Share
                          </button>
                        </Show>
                        <button
                          class="px-4 py-2 font-heading text-xs uppercase tracking-wider border-2 border-edge bg-surface text-fg-muted hover:text-accent transition-all flex items-center gap-2"
                          onClick={() => { navigator.clipboard.writeText(item.text) }}
                        >
                          <span class="i-mdi-content-copy w-4 h-4" />
                          Copy
                        </button>
                        <div class="flex-1" />
                        <button
                          class="px-4 py-2 font-heading text-xs uppercase tracking-wider border-2 border-edge bg-surface text-red-500 hover:text-red-600 transition-all flex items-center gap-2"
                          onClick={() => {
                            actions.removeFromHistory(item.id)
                            setMode('chat')
                            setActiveItem(null)
                          }}
                        >
                          <span class="i-mdi-delete w-4 h-4" />
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}
          </Show>
        </div>
      </div>

      {/* Modals */}
      <Show when={showAuth()}>
        <Suspense fallback={<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div class="text-accent animate-pulse font-heading">LOADING...</div></div>}>
          <AuthModal onClose={() => setShowAuth(false)} onLogin={onLogin} />
        </Suspense>
      </Show>
      <Show when={showWallet()}>
        <Suspense fallback={<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div class="text-accent animate-pulse font-heading">LOADING...</div></div>}>
          <WalletModal onClose={() => setShowWallet(false)} onLogin={onLogin} />
        </Suspense>
      </Show>
      <Show when={showProfile()}>
        <Suspense fallback={<div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"><div class="text-accent animate-pulse font-heading">LOADING...</div></div>}>
          <ProfilePage onClose={() => setShowProfile(false)} />
        </Suspense>
      </Show>

      {/* Signup nudge — shown after 200 tokens used, not logged in */}
      <Show when={!store.user && store.freeRemaining <= 800 && store.freeRemaining > 0}>
        <div class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-md bg-surface border-2 border-accent shadow-[var(--shadow)] px-4 py-3 flex items-center gap-3">
          <div class="flex-1">
            <p class="text-xs text-fg font-heading uppercase tracking-wider">
              {store.freeRemaining} free tokens left
            </p>
            <p class="text-[10px] text-fg-faint mt-0.5">
              Create an account to get your full free allowance
            </p>
          </div>
          <button
            class="px-4 py-2 bg-accent text-white font-heading text-xs uppercase tracking-wider border-2 border-accent-strong shadow-[2px_2px_0_0_var(--border)] hover:bg-accent-hover transition-all flex-shrink-0"
            onClick={() => setShowAuth(true)}
          >
            Sign up
          </button>
        </div>
      </Show>

      {/* Out of tokens — must sign up */}
      <Show when={!store.user && store.freeRemaining <= 0}>
        <div class="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div class="bg-surface border-2 border-edge shadow-[var(--shadow)] p-6 max-w-sm w-full text-center">
            <span class="i-mdi-alert-circle w-8 h-8 text-accent mx-auto mb-3" />
            <h3 class="font-heading text-sm uppercase tracking-wider text-fg mb-2">Free tokens used up</h3>
            <p class="text-xs text-fg-faint mb-4">Create an account to continue using sonotxt</p>
            <div class="flex gap-2">
              <button
                class="flex-1 px-4 py-2 bg-accent text-white font-heading text-xs uppercase tracking-wider border-2 border-accent-strong shadow-[2px_2px_0_0_var(--border)] hover:bg-accent-hover transition-all"
                onClick={() => setShowAuth(true)}
              >
                Sign up
              </button>
              <button
                class="flex-1 px-4 py-2 bg-surface text-fg-muted font-heading text-xs uppercase tracking-wider border-2 border-edge hover:text-accent transition-all"
                onClick={() => setShowWallet(true)}
              >
                Connect wallet
              </button>
            </div>
          </div>
        </div>
      </Show>

      <ToastContainer />
    </div>
  )
}
