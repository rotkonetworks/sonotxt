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

  // Derived: featured voices
  const featuredVoices = createMemo(() => {
    const all = Object.values(props.voices).flat()
    return all.filter(v => props.featured.includes(v.id))
  })

  // Derived: selected voice name
  const selectedName = createMemo(() => {
    const all = Object.values(props.voices).flat()
    return all.find(v => v.id === props.selected)?.name ?? props.selected
  })

  // Cleanup audio on unmount
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

  const handleSelect = (voiceId: string) => {
    props.onSelect(voiceId)
  }

  return (
    <div class="voice-selector">
      {/* Hidden preview audio */}
      <audio
        ref={audioRef}
        onEnded={() => setPreviewing(null)}
        onError={() => setPreviewing(null)}
      />

      {/* Header */}
      <div class="flex justify-between items-center mb-2">
        <div class="text-[10px] sm:text-xs text-text-dim uppercase tracking-wider">
          Voice: <span class="text-lcd-green">{selectedName()}</span>
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
              onSelect={() => handleSelect(v.id)}
              onPreview={() => preview(v.id)}
              onStopPreview={stopPreview}
            />
          )}
        </For>
      </div>

      {/* Expanded: all voices by category */}
      <Show when={expanded()}>
        <div class="mt-3 pt-3 border-t border-border-dark space-y-3">
          <For each={Object.entries(props.voices)}>
            {([category, voices]) => (
              <div>
                <div class="text-[9px] sm:text-[10px] text-text-dim mb-1 uppercase">
                  {category}
                </div>
                <div class="flex flex-wrap gap-1">
                  <For each={voices}>
                    {v => (
                      <VoiceButton
                        voice={v}
                        selected={props.selected === v.id}
                        previewing={previewing() === v.id}
                        onSelect={() => handleSelect(v.id)}
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

// Extracted button component for better performance
interface VoiceButtonProps {
  voice: Voice
  selected: boolean
  previewing: boolean
  onSelect: () => void
  onPreview: () => void
  onStopPreview: () => void
}

function VoiceButton(props: VoiceButtonProps) {
  return (
    <div class="flex items-center gap-0.5">
      <button
        class={`btn-win text-[10px] sm:text-xs ${props.selected ? 'primary' : ''}`}
        onClick={props.onSelect}
      >
        {props.voice.name}
      </button>
      <button
        class={`btn-win p-1 ${props.previewing ? 'primary' : ''}`}
        onClick={() => props.previewing ? props.onStopPreview() : props.onPreview()}
        onMouseEnter={props.onPreview}
        onMouseLeave={props.onStopPreview}
        title={`Preview ${props.voice.name}`}
      >
        <span
          class={`w-3 h-3 ${props.previewing ? 'i-mdi-volume-high animate-pulse' : 'i-mdi-play'}`}
        />
      </button>
    </div>
  )
}

export default VoiceSelector
