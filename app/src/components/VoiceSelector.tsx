import { createSignal, createMemo, For, Show, onCleanup } from 'solid-js'

export interface Voice {
  id: string
  name: string
  accent: string
  gender: 'M' | 'F'
}

export interface VoiceSelectorProps {
  voices: Record<string, Voice[]>
  featured: string[]
  selected: string
  samplesBaseUrl?: string
  onSelect: (voiceId: string) => void
}

export function VoiceSelector(props: VoiceSelectorProps) {
  const [expanded, setExpanded] = createSignal(false)
  const [previewing, setPreviewing] = createSignal<string | null>(null)

  let audioRef: HTMLAudioElement | undefined

  const featuredVoices = createMemo(() => {
    const all = Object.values(props.voices).flat()
    return all.filter(v => props.featured.includes(v.id))
  })

  const selectedName = createMemo(() => {
    const all = Object.values(props.voices).flat()
    return all.find(v => v.id === props.selected)?.name ?? props.selected
  })

  onCleanup(() => {
    if (audioRef) {
      audioRef.pause()
      audioRef.src = ''
    }
  })

  const preview = (voiceId: string) => {
    if (!props.samplesBaseUrl || !audioRef) return
    audioRef.src = `${props.samplesBaseUrl}/${voiceId}.mp3`
    audioRef.play().catch(() => {})
    setPreviewing(voiceId)
  }

  const stopPreview = () => {
    if (audioRef) {
      audioRef.pause()
      audioRef.currentTime = 0
    }
    setPreviewing(null)
  }

  return (
    <div class="voice-selector">
      <audio
        ref={audioRef}
        onEnded={() => setPreviewing(null)}
        onError={() => setPreviewing(null)}
      />

      {/* Header */}
      <div class="flex justify-between items-center mb-2">
        <div class="text-[10px] sm:text-xs text-fg-muted uppercase tracking-wider font-heading">
          Voice: <span class="text-accent">{selectedName()}</span>
        </div>
        <button
          class="btn-win text-[10px]"
          onClick={() => setExpanded(!expanded())}
        >
          {expanded() ? 'LESS' : 'MORE'}
        </button>
      </div>

      {/* Featured voices */}
      <div class="flex flex-wrap gap-1">
        <For each={featuredVoices()}>
          {v => (
            <VoiceButton
              voice={v}
              selected={props.selected === v.id}
              previewing={previewing() === v.id}
              onSelect={() => props.onSelect(v.id)}
              onPreview={() => preview(v.id)}
              onStopPreview={stopPreview}
            />
          )}
        </For>
      </div>

      {/* Expanded: all voices by category */}
      <Show when={expanded()}>
        <div class="mt-3 pt-3 border-t border-edge-soft space-y-3">
          <For each={Object.entries(props.voices)}>
            {([category, voices]) => (
              <div>
                <div class="text-[9px] sm:text-[10px] text-fg-muted mb-1 uppercase font-heading">
                  {category}
                </div>
                <div class="flex flex-wrap gap-1">
                  <For each={voices}>
                    {v => (
                      <VoiceButton
                        voice={v}
                        selected={props.selected === v.id}
                        previewing={previewing() === v.id}
                        onSelect={() => props.onSelect(v.id)}
                        onPreview={() => preview(v.id)}
                        onStopPreview={stopPreview}
                      />
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

interface VoiceButtonProps {
  voice: Voice
  selected: boolean
  previewing: boolean
  onSelect: () => void
  onPreview: () => void
  onStopPreview: () => void
}

function VoiceButton(props: VoiceButtonProps) {
  let hoverTimer: ReturnType<typeof setTimeout> | undefined

  const handlePointerEnter = () => {
    hoverTimer = setTimeout(() => props.onPreview(), 150)
  }
  const handlePointerLeave = () => {
    clearTimeout(hoverTimer)
    props.onStopPreview()
  }
  onCleanup(() => clearTimeout(hoverTimer))

  return (
    <button
      class={`btn-win text-[10px] sm:text-xs inline-flex items-center gap-1 ${
        props.selected ? 'primary' : ''
      } ${props.previewing ? 'bg-accent-soft' : ''}`}
      onClick={() => { props.onSelect(); props.onPreview() }}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <Show when={props.previewing}>
        <span class="i-mdi-volume-high w-3 h-3 animate-pulse" />
      </Show>
      <span class={`w-2.5 h-2.5 ${props.voice.gender === 'F' ? 'i-mdi-gender-female text-pink-400' : 'i-mdi-gender-male text-blue-400'}`} />
      {props.voice.name}
      <span class="text-fg-faint text-[9px]">{props.voice.accent}</span>
    </button>
  )
}

export default VoiceSelector
