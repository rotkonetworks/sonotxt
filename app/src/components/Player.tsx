import { createSignal, createEffect, onCleanup, onMount, Show, For, batch } from 'solid-js'
import { showToast } from './Toast'

export interface PlayerProps {
  src: string | undefined
  title?: string
  onEnded?: () => void
  onDownload?: () => void
  onShare?: () => void
  onPlayStateChange?: (playing: boolean) => void
  showActions?: boolean
}

export function Player(props: PlayerProps) {
  const [currentTime, setCurrentTime] = createSignal(0)
  const [duration, setDuration] = createSignal(0)
  const [isPlaying, setIsPlaying] = createSignal(false)
  const [isDragging, setIsDragging] = createSignal(false)
  const [seekPreviewPct, setSeekPreviewPct] = createSignal<number | null>(null)
  const [hoverPct, setHoverPct] = createSignal<number | null>(null)
  const [playbackRate, setPlaybackRate] = createSignal(1)
  const [, setVolume] = createSignal(1)
  const [, setBuffered] = createSignal(0)

  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

  let audioRef: HTMLAudioElement | undefined
  let waveformRef: HTMLDivElement | undefined
  let rafId: number | null = null

  const barHeights = Array.from({ length: 40 }, (_, i) =>
    30 + Math.sin(i * 0.5) * 25 + Math.sin(i * 0.3 + 1) * 15
  )

  const startAnimation = () => {
    const update = () => {
      if (audioRef && !audioRef.paused) {
        setCurrentTime(audioRef.currentTime)
        rafId = requestAnimationFrame(update)
      }
    }
    rafId = requestAnimationFrame(update)
  }

  const stopAnimation = () => {
    if (rafId) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  onCleanup(() => {
    stopAnimation()
    if (audioRef) {
      audioRef.pause()
      audioRef.src = ''
    }
  })

  createEffect(() => {
    const src = props.src
    if (src && audioRef) {
      batch(() => {
        setCurrentTime(0)
        setDuration(0)
        setIsPlaying(false)
        setBuffered(0)
        setSeekPreviewPct(null)
        setHoverPct(null)
      })
      stopAnimation()
    }
  })

  const progressPct = () => duration() ? (currentTime() / duration()) * 100 : 0

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const seek = (delta: number) => {
    if (!audioRef) return
    audioRef.currentTime = Math.max(0, Math.min(duration(), audioRef.currentTime + delta))
    setCurrentTime(audioRef.currentTime)
  }

  const seekToPercent = (pct: number) => {
    if (!audioRef) return
    const time = (pct / 100) * duration()
    audioRef.currentTime = time
    setCurrentTime(time)
  }

  const togglePlay = () => {
    if (!audioRef || !props.src) return
    if (audioRef.paused) {
      audioRef.play().catch(() => {})
    } else {
      audioRef.pause()
    }
  }

  const cycleSpeed = () => {
    const cur = playbackRate()
    const idx = speeds.indexOf(cur)
    const next = speeds[(idx + 1) % speeds.length]
    setPlaybackRate(next)
    if (audioRef) audioRef.playbackRate = next
  }

  const getPctFromEvent = (e: MouseEvent | TouchEvent): number => {
    if (!waveformRef) return 0
    const rect = waveformRef.getBoundingClientRect()
    const clientX = 'touches' in e
      ? (e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX)
      : e.clientX
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100))
  }

  const handleMouseDown = (e: MouseEvent) => {
    if (!props.src) return
    e.preventDefault()
    const pct = getPctFromEvent(e)
    setIsDragging(true)
    setSeekPreviewPct(pct)

    const onMove = (e: MouseEvent) => {
      if (!isDragging()) return
      setSeekPreviewPct(getPctFromEvent(e))
    }
    const onUp = (e: MouseEvent) => {
      const finalPct = getPctFromEvent(e)
      seekToPercent(finalPct)
      setIsDragging(false)
      setSeekPreviewPct(null)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const handleTouchStart = (e: TouchEvent) => {
    if (!props.src) return
    e.preventDefault()
    setIsDragging(true)
    setSeekPreviewPct(getPctFromEvent(e))
  }

  const handleTouchMove = (e: TouchEvent) => {
    if (!isDragging()) return
    e.preventDefault()
    setSeekPreviewPct(getPctFromEvent(e))
  }

  const handleTouchEnd = () => {
    if (!isDragging()) return
    const pct = seekPreviewPct() ?? 0
    seekToPercent(pct)
    setIsDragging(false)
    setSeekPreviewPct(null)
  }

  const handleHover = (e: MouseEvent) => {
    if (isDragging()) return
    setHoverPct(getPctFromEvent(e))
  }

  const handleLeave = () => {
    if (!isDragging()) setHoverPct(null)
  }

  onMount(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (!props.src) return

      switch (e.key) {
        case ' ':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          e.preventDefault()
          seek(e.shiftKey ? -30 : -5)
          break
        case 'ArrowRight':
          e.preventDefault()
          seek(e.shiftKey ? 30 : 5)
          break
        case 'ArrowUp':
          e.preventDefault()
          if (audioRef) {
            const v = Math.min(1, audioRef.volume + 0.1)
            audioRef.volume = v
            setVolume(v)
          }
          break
        case 'ArrowDown':
          e.preventDefault()
          if (audioRef) {
            const v = Math.max(0, audioRef.volume - 0.1)
            audioRef.volume = v
            setVolume(v)
          }
          break
        case 's':
          e.preventDefault()
          cycleSpeed()
          break
      }
    }

    document.addEventListener('keydown', handleKey)
    onCleanup(() => document.removeEventListener('keydown', handleKey))
  })

  const updateBuffered = () => {
    if (!audioRef || !audioRef.buffered.length) return
    setBuffered(audioRef.buffered.end(audioRef.buffered.length - 1))
  }

  const handlePlay = () => {
    setIsPlaying(true)
    startAnimation()
    props.onPlayStateChange?.(true)
  }

  const handlePause = () => {
    setIsPlaying(false)
    stopAnimation()
    props.onPlayStateChange?.(false)
  }

  const handleEnded = () => {
    batch(() => { setIsPlaying(false); setCurrentTime(0) })
    stopAnimation()
    props.onPlayStateChange?.(false)
    props.onEnded?.()
  }

  const handleDownload = async () => {
    if (props.onDownload) {
      props.onDownload()
      return
    }
    if (!props.src) return
    try {
      const res = await fetch(props.src)
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

  const handleShare = async () => {
    if (props.onShare) {
      props.onShare()
      return
    }
    if (!props.src) return
    if (navigator.share) {
      try {
        await navigator.share({ title: 'sonotxt audio', url: props.src })
      } catch {}
    } else {
      await navigator.clipboard.writeText(props.src)
      showToast('Link copied!', 'success')
    }
  }

  return (
    <div class="player">
      <audio
        ref={audioRef}
        src={props.src}
        preload="auto"
        onLoadedMetadata={() => setDuration(audioRef?.duration || 0)}
        onPlay={handlePlay}
        onPause={handlePause}
        onEnded={handleEnded}
        onSeeked={() => setCurrentTime(audioRef?.currentTime || 0)}
        onProgress={updateBuffered}
      />

      <div class="flex items-center gap-2 sm:gap-3">
        {/* Play/Pause */}
        <button
          class={`w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center flex-shrink-0 transition-all ${
            props.src
              ? 'bg-accent hover:bg-accent-hover text-white cursor-pointer'
              : 'bg-accent-soft text-fg-faint cursor-not-allowed'
          }`}
          onClick={togglePlay}
          disabled={!props.src}
        >
          <span class={`${isPlaying() ? 'i-mdi-pause' : 'i-mdi-play'} w-4 h-4 sm:w-5 sm:h-5`} />
        </button>

        {/* Skip back */}
        <button
          class="lg:hidden p-1 text-fg-faint hover:text-accent transition-colors disabled:opacity-30 flex-shrink-0"
          onClick={() => seek(-10)}
          disabled={!props.src}
          title="Back 10s"
        >
          <span class="i-mdi-rewind-10 w-4 h-4 sm:w-5 sm:h-5" />
        </button>

        {/* Skip forward */}
        <button
          class="lg:hidden p-1 text-fg-faint hover:text-accent transition-colors disabled:opacity-30 flex-shrink-0"
          onClick={() => seek(30)}
          disabled={!props.src}
          title="Forward 30s"
        >
          <span class="i-mdi-fast-forward-30 w-4 h-4 sm:w-5 sm:h-5" />
        </button>

        {/* Waveform + time */}
        <div class="flex-1 flex flex-col gap-1">
          <div
            ref={waveformRef}
            class={`h-6 sm:h-8 relative select-none bg-page ${props.src ? 'cursor-pointer' : 'opacity-40'}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleHover}
            onMouseLeave={handleLeave}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* Background bars */}
            <div class="absolute inset-0 flex items-end justify-around px-1 opacity-25">
              <For each={barHeights}>{(h) => (
                <div
                  class="w-1 bg-accent-faint rounded-t"
                  style={{ height: `${h}%` }}
                />
              )}</For>
            </div>

            {/* Played portion */}
            <div
              class="absolute inset-y-0 left-0 overflow-hidden"
              style={{ width: `${seekPreviewPct() ?? progressPct()}%` }}
            >
              <div
                class="absolute inset-0 flex items-end justify-around px-1"
                style={{ width: `${100 / ((seekPreviewPct() ?? progressPct()) / 100 || 1)}%` }}
              >
                <For each={barHeights}>{(h) => (
                  <div
                    class="w-1 bg-accent rounded-t"
                    style={{ height: `${h}%` }}
                  />
                )}</For>
              </div>
            </div>

            {/* Hover indicator */}
            <Show when={hoverPct() !== null && !isDragging()}>
              <div
                class="absolute inset-y-0 w-0.5 bg-fg-faint"
                style={{ left: `${hoverPct()}%`, opacity: 0.5 }}
              />
            </Show>

            {/* Playhead */}
            <Show when={props.src}>
              <div
                class="absolute inset-y-0 w-0.5 bg-accent-strong"
                style={{
                  left: `${seekPreviewPct() ?? progressPct()}%`,
                  'box-shadow': '0 0 3px var(--accent-strong)',
                }}
              />
            </Show>

            {/* Time tooltip */}
            <Show when={(hoverPct() !== null || isDragging()) && duration() > 0}>
              <div
                class="absolute -top-7 px-2 py-0.5 bg-surface border border-edge-soft text-xs text-fg font-mono"
                style={{
                  left: `${seekPreviewPct() ?? hoverPct() ?? 0}%`,
                  transform: 'translateX(-50%)',
                }}
              >
                {formatTime(((seekPreviewPct() ?? hoverPct() ?? 0) / 100) * duration())}
              </div>
            </Show>
          </div>

          {/* Time display */}
          <div class="flex justify-between text-[10px] sm:text-xs text-fg-muted font-mono">
            <span>{formatTime(currentTime())}</span>
            <span>{formatTime(duration())}</span>
          </div>
        </div>

        {/* Speed + actions */}
        <div class="flex gap-1 flex-shrink-0 items-center">
          <button
            class={`px-1.5 py-0.5 text-[10px] sm:text-xs font-mono transition-colors ${
              playbackRate() !== 1
                ? 'text-accent border-b border-accent'
                : 'text-fg-faint hover:text-fg'
            } disabled:opacity-30`}
            onClick={cycleSpeed}
            disabled={!props.src}
            title="Playback speed (S key)"
          >
            {playbackRate()}x
          </button>
          <Show when={props.showActions !== false}>
            <button
              class="p-1 text-fg-faint hover:text-accent transition-colors disabled:opacity-30"
              onClick={handleDownload}
              disabled={!props.src}
              title="Download"
            >
              <span class="i-mdi-download w-3.5 h-3.5" />
            </button>
            <button
              class="p-1 text-fg-faint hover:text-accent transition-colors disabled:opacity-30"
              onClick={handleShare}
              disabled={!props.src}
              title="Share"
            >
              <span class="i-mdi-share-variant w-3.5 h-3.5" />
            </button>
          </Show>
        </div>
      </div>
    </div>
  )
}

export default Player
