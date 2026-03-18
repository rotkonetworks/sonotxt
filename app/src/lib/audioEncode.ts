/// Decode any audio Blob (webm/opus, ogg, mp3, etc.) to 16kHz mono WAV base64.
/// Uses the browser's built-in AudioContext decoder — no server-side ffmpeg needed.
export async function blobToWavBase64(blob: Blob): Promise<string> {
  const ctx = new OfflineAudioContext(1, 1, 16000)
  const arrayBuf = await blob.arrayBuffer()
  const decoded = await ctx.decodeAudioData(arrayBuf)

  // Resample to 16kHz mono
  const offlineCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000)
  const source = offlineCtx.createBufferSource()
  source.buffer = decoded
  source.connect(offlineCtx.destination)
  source.start()
  const rendered = await offlineCtx.startRendering()

  const pcm = rendered.getChannelData(0)
  const wav = encodeWav(pcm, 16000)

  let binary = ''
  const bytes = new Uint8Array(wav)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numSamples = samples.length
  const buffer = new ArrayBuffer(44 + numSamples * 2)
  const view = new DataView(buffer)

  // RIFF header
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + numSamples * 2, true)
  writeString(view, 8, 'WAVE')

  // fmt chunk
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)           // chunk size
  view.setUint16(20, 1, true)            // PCM
  view.setUint16(22, 1, true)            // mono
  view.setUint32(24, sampleRate, true)   // sample rate
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true)            // block align
  view.setUint16(34, 16, true)           // bits per sample

  // data chunk
  writeString(view, 36, 'data')
  view.setUint32(40, numSamples * 2, true)

  // PCM samples (float32 → int16)
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
  }

  return buffer
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}
