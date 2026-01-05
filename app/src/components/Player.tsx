import { createSignal, createEffect, onCleanup, onMount, Show, batch } from 'solid-js'
import { showToast } from './Toast'

export interface PlayerProps {
  src: string | undefined
  title?: string
  onEnded?: () => void
  onDownload?: () => void
  onShare?: () => void
  showActions?: boolean
}

export function Player(props: PlayerProps) {
  const [currentTime, setCurrentTime] = createSignal(0)
  const [duration, setDuration] = createSignal(0)
  const [isPlaying, setIsPlaying] = createSignal(false)
  const [isDragging, setIsDragging] = createSignal(false)
  const [, setVolume] = createSignal(1)
  const [buffered, setBuffered] = createSignal(0)

  let audioRef: HTMLAudioElement | undefined
  let progressRef: HTMLDivElement | undefined
  let rafId: number | null = null

  // Smooth progress animation
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

  // Cleanup on unmount
  onCleanup(() => {
    stopAnimation()
    if (audioRef) {
      audioRef.pause()
      audioRef.src = ''
    }
  })

  // Reset when src changes
  createEffect(() => {
    const src = props.src
    if (src && audioRef) {
      batch(() => {
        setCurrentTime(0)
        setDuration(0)
        setIsPlaying(false)
        setBuffered(0)
      })
      stopAnimation()
    }
  })

  const progressPct = () => duration() ? (currentTime() / duration()) * 100 : 0
  const bufferedPct = () => duration() ? (buffered() / duration()) * 100 : 0

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

  const seekTo = (pct: number) => {
    if (!audioRef) return
    const time = pct * duration()
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

  const stop = () => {
    if (!audioRef) return
    audioRef.pause()
    audioRef.currentTime = 0
    batch(() => {
      setIsPlaying(false)
      setCurrentTime(0)
    })
    stopAnimation()
  }

  const handleSeekEvent = (e: MouseEvent | TouchEvent) => {
    if (!progressRef || !props.src) return
    const rect = progressRef.getBoundingClientRect()
    const clientX = 'touches' in e
      ? (e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX)
      : e.clientX
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    seekTo(pct)
  }

  const handleMouseDown = (e: MouseEvent) => {
    if (!props.src) return
    setIsDragging(true)
    handleSeekEvent(e)

    const onMove = (e: MouseEvent) => isDragging() && handleSeekEvent(e)
    const onUp = () => {
      setIsDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const handleTouch = (e: TouchEvent) => {
    if (!props.src) return
    e.preventDefault()
    handleSeekEvent(e)
  }

  // Keyboard controls
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
          seek(-5)
          break
        case 'ArrowRight':
          e.preventDefault()
          seek(5)
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
      }
    }

    document.addEventListener('keydown', handleKey)
    onCleanup(() => document.removeEventListener('keydown', handleKey))
  })

  const updateBuffered = () => {
    if (!audioRef || !audioRef.buffered.length) return
    const end = audioRef.buffered.end(audioRef.buffered.length - 1)
    setBuffered(end)
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
        await navigator.share({ title: 'SonoTxt Audio', url: props.src })
      } catch {}
    } else {
      await navigator.clipboard.writeText(props.src)
      showToast('Link copied!', 'success')
    }
  }

  return (
    <div class="player">
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={props.src}
        preload="auto"
        onLoadedMetadata={() => setDuration(audioRef?.duration || 0)}
        onPlay={() => { setIsPlaying(true); startAnimation() }}
        onPause={() => { setIsPlaying(false); stopAnimation() }}
        onEnded={() => {
          batch(() => { setIsPlaying(false); setCurrentTime(0) })
          stopAnimation()
          props.onEnded?.()
        }}
        onSeeked={() => setCurrentTime(audioRef?.currentTime || 0)}
        onProgress={updateBuffered}
      />

      {/* Title */}
      <Show when={props.title}>
        <div class="text-[10px] sm:text-xs text-lcd-green mb-2 truncate text-center" title={props.title}>
          {props.title}
        </div>
      </Show>

      {/* Progress bar */}
      <div class="flex items-center gap-2 sm:gap-3 mb-2">
        <span class="text-[10px] sm:text-xs w-8 sm:w-10 text-lcd-pink font-mono">
          {formatTime(currentTime())}
        </span>

        <div
          ref={progressRef}
          class={`flex-1 h-5 relative select-none ${props.src ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
          style={{
            background: 'linear-gradient(180deg, #010409 0%, #0d1117 100%)',
            border: '2px solid',
            'border-color': '#010409 #30363d #30363d #010409',
            'box-shadow': 'inset 0 2px 4px rgba(0,0,0,0.5)',
          }}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouch}
          onTouchMove={handleTouch}
        >
          {/* Buffered indicator */}
          <div
            style={{
              position: 'absolute',
              width: `${bufferedPct()}%`,
              height: '100%',
              background: 'rgba(255,255,255,0.1)',
            }}
          />

          {/* Progress fill */}
          <div
            style={{
              width: `${progressPct()}%`,
              height: '100%',
              background: 'linear-gradient(180deg, #f472b6 0%, #ec4899 30%, #be185d 70%, #9f1239 100%)',
              'box-shadow': '0 0 8px rgba(236, 72, 153, 0.6), inset 0 1px 0 rgba(255,255,255,0.2)',
              transition: isDragging() ? 'none' : 'width 0.05s linear',
            }}
          />

          {/* Thumb */}
          <Show when={props.src}>
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: `calc(${progressPct()}% - 6px)`,
                transform: 'translateY(-50%)',
                width: '12px',
                height: '18px',
                background: 'linear-gradient(180deg, #f472b6 0%, #be185d 100%)',
                border: '1px solid',
                'border-color': '#f9a8d4 #9f1239 #9f1239 #f9a8d4',
                'box-shadow': '0 2px 4px rgba(0,0,0,0.3)',
                cursor: isDragging() ? 'grabbing' : 'grab',
                transition: isDragging() ? 'none' : 'left 0.05s linear',
              }}
            />
          </Show>
        </div>

        <span class="text-[10px] sm:text-xs w-8 sm:w-10 text-right text-lcd-pink font-mono">
          {formatTime(duration())}
        </span>
      </div>

      {/* Transport controls */}
      <div class="flex justify-center gap-1">
        <button
          class="btn-win p-1 sm:p-2"
          onClick={() => seek(-10)}
          title="Back 10s (←)"
          disabled={!props.src}
        >
          <span class="i-mdi-rewind-10 w-3 h-3 sm:w-4 sm:h-4" />
        </button>

        <button
          class="btn-win p-1 sm:p-2"
          onClick={stop}
          title="Stop"
          disabled={!props.src}
        >
          <span class="i-mdi-stop w-3 h-3 sm:w-4 sm:h-4" />
        </button>

        <button
          class="btn-win primary p-1 sm:p-2"
          onClick={togglePlay}
          title={isPlaying() ? 'Pause (Space)' : 'Play (Space)'}
          disabled={!props.src}
        >
          <span class={isPlaying() ? 'i-mdi-pause w-4 h-4 sm:w-5 sm:h-5' : 'i-mdi-play w-4 h-4 sm:w-5 sm:h-5'} />
        </button>

        <button
          class="btn-win p-1 sm:p-2"
          onClick={() => seek(10)}
          title="Fwd 10s (→)"
          disabled={!props.src}
        >
          <span class="i-mdi-fast-forward-10 w-3 h-3 sm:w-4 sm:h-4" />
        </button>

        <Show when={props.showActions !== false}>
          <div class="w-px h-4 bg-border-light mx-1" />

          <button
            class="btn-win p-1 sm:p-2"
            onClick={handleDownload}
            title="Download"
            disabled={!props.src}
          >
            <span class="i-mdi-download w-3 h-3 sm:w-4 sm:h-4" />
          </button>

          <button
            class="btn-win p-1 sm:p-2"
            onClick={handleShare}
            title="Share"
            disabled={!props.src}
          >
            <span class="i-mdi-share-variant w-3 h-3 sm:w-4 sm:h-4" />
          </button>
        </Show>
      </div>
    </div>
  )
}

export default Player
