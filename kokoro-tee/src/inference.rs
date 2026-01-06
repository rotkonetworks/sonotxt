// kokoro TTS inference wrapper

use kokoro_tts::{KokoroTts, Voice};
use kokoro_common::{InferenceRequest, InferenceResponse, AudioFormat, StreamRequest, StreamChunk};
use std::time::Instant;
use tokio::sync::{RwLock, mpsc};
use futures::StreamExt;

pub struct InferenceEngine {
    tts: RwLock<KokoroTts>,
}

impl InferenceEngine {
    pub async fn new(model_path: &str, voices_path: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let tts = KokoroTts::new(model_path, voices_path).await?;
        Ok(Self {
            tts: RwLock::new(tts),
        })
    }

    /// process inference request, return response
    pub async fn process(&self, request: &InferenceRequest) -> InferenceResponse {
        let start = Instant::now();

        // parse voice
        let voice = match parse_voice(&request.voice, request.speed) {
            Ok(v) => v,
            Err(e) => {
                return InferenceResponse {
                    request_id: request.request_id,
                    sequence: 0,
                    audio: vec![],
                    is_final: true,
                    error: Some(e.to_string()),
                };
            }
        };

        // run inference
        let tts = self.tts.read().await;
        let result = tts.synth(&request.text, voice).await;

        match result {
            Ok((samples, _duration)) => {
                let audio = match request.format {
                    AudioFormat::Pcm24k => encode_pcm(&samples),
                    AudioFormat::Opus => encode_opus(&samples),
                };

                tracing::info!(
                    "inference completed: {} chars -> {} bytes audio in {:?}",
                    request.text.len(),
                    audio.len(),
                    start.elapsed()
                );

                InferenceResponse {
                    request_id: request.request_id,
                    sequence: 0,
                    audio,
                    is_final: true,
                    error: None,
                }
            }
            Err(e) => {
                tracing::error!("inference failed: {:?}", e);
                InferenceResponse {
                    request_id: request.request_id,
                    sequence: 0,
                    audio: vec![],
                    is_final: true,
                    error: Some(format!("inference failed: {:?}", e)),
                }
            }
        }
    }
}

fn parse_voice(voice_id: &str, speed: f32) -> Result<Voice, &'static str> {
    let voice = match voice_id {
        "af_bella" => Voice::AfBella(speed),
        "af_nicole" => Voice::AfNicole(speed),
        "af_sarah" => Voice::AfSarah(speed),
        "af_sky" => Voice::AfSky(speed),
        "af_nova" => Voice::AfNova(speed),
        "af_river" => Voice::AfRiver(speed),
        "af_jessica" => Voice::AfJessica(speed),
        "am_adam" => Voice::AmAdam(speed),
        "am_michael" => Voice::AmMichael(speed),
        "am_eric" => Voice::AmEric(speed),
        "am_liam" => Voice::AmLiam(speed),
        "bf_emma" => Voice::BfEmma(speed),
        "bf_alice" => Voice::BfAlice(speed),
        "bf_lily" => Voice::BfLily(speed),
        "bm_george" => Voice::BmGeorge(speed),
        "bm_daniel" => Voice::BmDaniel(speed),
        "bm_lewis" => Voice::BmLewis(speed),
        _ => return Err("unknown voice"),
    };
    Ok(voice)
}

fn encode_pcm(samples: &[f32]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(samples.len() * 2);
    for &s in samples {
        let i = (s.clamp(-1.0, 1.0) * 32767.0) as i16;
        buf.extend_from_slice(&i.to_le_bytes());
    }
    buf
}

fn encode_opus(samples: &[f32]) -> Vec<u8> {
    use audiopus::{coder::Encoder, Application, Channels, SampleRate};

    // kokoro outputs 24kHz audio
    // opus supports 24kHz natively
    let sample_rate = SampleRate::Hz24000;
    let channels = Channels::Mono;

    // create encoder with VOIP application for speech
    let encoder = match Encoder::new(sample_rate, channels, Application::Voip) {
        Ok(e) => e,
        Err(e) => {
            tracing::error!("failed to create opus encoder: {:?}", e);
            return vec![];
        }
    };

    // opus frame sizes at 24kHz: 120, 240, 480, 960, 1920, 2880 samples
    // 20ms frames = 480 samples at 24kHz
    const FRAME_SIZE: usize = 480;

    // convert f32 to i16
    let pcm: Vec<i16> = samples.iter()
        .map(|&s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
        .collect();

    // encode in frames
    let mut output = Vec::new();

    // write number of frames first (for decoding)
    let num_frames = (pcm.len() + FRAME_SIZE - 1) / FRAME_SIZE;
    output.extend_from_slice(&(num_frames as u32).to_le_bytes());

    let mut frame_buf = vec![0u8; 4000]; // max opus frame size

    for chunk in pcm.chunks(FRAME_SIZE) {
        // pad last frame if needed
        let frame: Vec<i16> = if chunk.len() < FRAME_SIZE {
            let mut padded = chunk.to_vec();
            padded.resize(FRAME_SIZE, 0);
            padded
        } else {
            chunk.to_vec()
        };

        match encoder.encode(&frame, &mut frame_buf) {
            Ok(len) => {
                // write frame length then frame data
                output.extend_from_slice(&(len as u16).to_le_bytes());
                output.extend_from_slice(&frame_buf[..len]);
            }
            Err(e) => {
                tracing::error!("opus encode error: {:?}", e);
                // write zero-length frame to indicate error
                output.extend_from_slice(&0u16.to_le_bytes());
            }
        }
    }

    tracing::debug!(
        "encoded {} samples to {} bytes opus ({:.1}x compression)",
        samples.len(),
        output.len(),
        (samples.len() * 2) as f64 / output.len() as f64
    );

    output
}

/// split text into sentences for streaming
fn split_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();

    for c in text.chars() {
        current.push(c);
        // split on sentence-ending punctuation
        if matches!(c, '.' | '!' | '?' | ';' | '\n') {
            let trimmed = current.trim().to_string();
            if !trimmed.is_empty() {
                sentences.push(trimmed);
            }
            current.clear();
        }
    }

    // don't forget remaining text
    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        sentences.push(trimmed);
    }

    sentences
}

impl InferenceEngine {
    /// process streaming inference request, sends chunks via channel
    pub async fn process_stream(
        &self,
        request: &StreamRequest,
        chunk_tx: mpsc::Sender<StreamChunk>,
    ) {
        let start = Instant::now();

        // parse voice
        let voice = match parse_voice(&request.voice, request.speed) {
            Ok(v) => v,
            Err(e) => {
                let _ = chunk_tx.send(StreamChunk {
                    request_id: request.request_id,
                    sequence: 0,
                    audio: vec![],
                    is_final: true,
                    error: Some(e.to_string()),
                }).await;
                return;
            }
        };

        // split text into sentences
        let sentences = split_sentences(&request.text);
        tracing::info!("streaming {} sentences", sentences.len());

        // use kokoro-tts streaming API
        let tts = self.tts.read().await;
        let (mut sink, mut stream) = tts.stream(voice);

        // spawn task to send sentences
        let sentences_clone = sentences.clone();
        tokio::spawn(async move {
            for sentence in sentences_clone {
                if let Err(e) = sink.synth(sentence).await {
                    tracing::error!("synth error: {:?}", e);
                    break;
                }
            }
            drop(sink); // signal completion
        });

        // receive audio chunks and forward
        let mut sequence = 0u32;
        while let Some((samples, _duration)) = stream.next().await {
            let audio = match request.format {
                AudioFormat::Pcm24k => encode_pcm(&samples),
                AudioFormat::Opus => encode_opus(&samples),
            };

            let chunk = StreamChunk {
                request_id: request.request_id,
                sequence,
                audio,
                is_final: false,
                error: None,
            };

            if chunk_tx.send(chunk).await.is_err() {
                tracing::warn!("chunk receiver dropped");
                break;
            }

            sequence += 1;
        }

        // send final chunk
        let final_chunk = StreamChunk {
            request_id: request.request_id,
            sequence,
            audio: vec![],
            is_final: true,
            error: None,
        };
        let _ = chunk_tx.send(final_chunk).await;

        tracing::info!(
            "streaming completed: {} chars -> {} chunks in {:?}",
            request.text.len(),
            sequence,
            start.elapsed()
        );
    }
}
