// streaming test: connect to kokoro-tee, run encrypted streaming inference

use kokoro_client::KokoroClient;
use kokoro_common::AudioFormat;
use std::net::SocketAddr;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // init logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("kokoro_client=info".parse()?)
                .add_directive("test_stream=info".parse()?)
        )
        .init();

    let addr: SocketAddr = std::env::var("SERVER_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:4433".to_string())
        .parse()?;

    // check for opus format
    let use_opus = std::env::args().any(|a| a == "--opus");
    let format = if use_opus { AudioFormat::Opus } else { AudioFormat::Pcm24k };
    let format_name = if use_opus { "opus" } else { "pcm24k" };

    tracing::info!("connecting to kokoro-tee at {}", addr);

    // connect and establish encrypted session
    let mut client = KokoroClient::connect(addr).await?;
    tracing::info!("connected with encrypted session");

    // test streaming synthesis with multiple sentences
    let text = "Hello! This is the first sentence. Here comes the second one. And now we have a third. Finally, the last sentence arrives.";
    let voice = "af_bella";
    let speed = 1.0;

    tracing::info!("streaming synthesis ({} format): \"{}\" with voice {}", format_name, text, voice);
    let start = std::time::Instant::now();

    // start streaming
    let mut handle = client.synthesize_stream(text, voice, speed, format).await?;

    let mut total_bytes = 0usize;
    let mut chunk_count = 0u32;
    let mut all_audio = Vec::new();

    // receive chunks
    while let Some(chunk) = client.recv_chunk(&mut handle).await? {
        let chunk_time = start.elapsed();
        tracing::info!(
            "chunk {}: {} bytes at {:?}",
            chunk.sequence,
            chunk.audio.len(),
            chunk_time
        );
        total_bytes += chunk.audio.len();
        chunk_count += 1;
        all_audio.extend(&chunk.audio);
    }

    let elapsed = start.elapsed();
    tracing::info!(
        "streaming complete: {} chunks, {} bytes in {:?}",
        chunk_count,
        total_bytes,
        elapsed
    );

    // save combined audio
    let output_path = if use_opus { "test_stream_output.opus" } else { "test_stream_output.raw" };
    std::fs::write(output_path, &all_audio)?;
    tracing::info!("saved audio to {}", output_path);

    // calculate realtime factor (PCM: 2 bytes/sample @ 24kHz)
    let pcm_bytes = if use_opus {
        // estimate: opus ~12x compression
        total_bytes * 12
    } else {
        total_bytes
    };
    let audio_duration_s = pcm_bytes as f64 / 48000.0;
    let rtf = elapsed.as_secs_f64() / audio_duration_s;
    tracing::info!(
        "audio duration: {:.2}s, processing time: {:.2}s, RTF: {:.2}x realtime",
        audio_duration_s,
        elapsed.as_secs_f64(),
        1.0 / rtf
    );

    Ok(())
}
