// end-to-end test: connect to kokoro-tee, run encrypted inference

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
                .add_directive("test_e2e=info".parse()?)
        )
        .init();

    let addr: SocketAddr = std::env::var("SERVER_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:4433".to_string())
        .parse()?;

    tracing::info!("connecting to kokoro-tee at {}", addr);

    // connect and establish encrypted session
    let mut client = KokoroClient::connect(addr).await?;
    tracing::info!("connected with encrypted session");

    // test synthesis
    let text = "Hello! This is a test of the encrypted text to speech system.";
    let voice = "af_bella";
    let speed = 1.0;

    tracing::info!("synthesizing: \"{}\" with voice {}", text, voice);
    let start = std::time::Instant::now();

    let audio = client.synthesize(text, voice, speed, AudioFormat::Pcm24k).await?;

    let elapsed = start.elapsed();
    tracing::info!(
        "received {} bytes of audio in {:?}",
        audio.len(),
        elapsed
    );

    // save to file
    let output_path = "test_e2e_output.raw";
    std::fs::write(output_path, &audio)?;
    tracing::info!("saved audio to {}", output_path);

    // calculate realtime factor
    // PCM at 24kHz, 16-bit = 48000 bytes per second
    let audio_duration_s = audio.len() as f64 / 48000.0;
    let rtf = elapsed.as_secs_f64() / audio_duration_s;
    tracing::info!(
        "audio duration: {:.2}s, processing time: {:.2}s, RTF: {:.2}x realtime",
        audio_duration_s,
        elapsed.as_secs_f64(),
        1.0 / rtf
    );

    Ok(())
}
