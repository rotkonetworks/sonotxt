mod attestation;
mod noise;
mod quic;
mod websocket;
mod inference;

use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use crate::inference::InferenceEngine;
use crate::noise::NoiseServer;
use crate::quic::QuicServer;
use crate::websocket::WebSocketServer;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // init logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("kokoro_tee=info".parse()?)
        )
        .init();

    info!("kokoro-tee starting...");

    // load TTS model
    let model_path = std::env::var("KOKORO_MODEL")
        .unwrap_or_else(|_| "models/kokoro-v1.0.int8.onnx".to_string());
    let voices_path = std::env::var("KOKORO_VOICES")
        .unwrap_or_else(|_| "models/voices.bin".to_string());

    info!("loading kokoro model from {} and {}", model_path, voices_path);
    let engine = InferenceEngine::new(&model_path, &voices_path).await?;
    let engine = Arc::new(engine);
    info!("model loaded");

    // init Noise protocol server
    let noise_server = NoiseServer::new()?;
    let noise_server = Arc::new(RwLock::new(noise_server));

    // start QUIC server
    let quic_addr: SocketAddr = std::env::var("QUIC_ADDR")
        .or_else(|_| std::env::var("LISTEN_ADDR"))
        .unwrap_or_else(|_| "0.0.0.0:4433".to_string())
        .parse()?;

    // start WebSocket server for browser clients
    let ws_addr: SocketAddr = std::env::var("WS_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:4434".to_string())
        .parse()?;

    info!("starting QUIC server on {}", quic_addr);
    info!("starting WebSocket server on {}", ws_addr);

    let quic_server = QuicServer::new(quic_addr, engine.clone(), noise_server.clone()).await?;
    let ws_server = WebSocketServer::new(ws_addr, engine, noise_server);

    // run both servers concurrently
    tokio::select! {
        result = quic_server.run() => {
            if let Err(e) = result {
                tracing::error!("QUIC server error: {:?}", e);
            }
        }
        result = ws_server.run() => {
            if let Err(e) = result {
                tracing::error!("WebSocket server error: {:?}", e);
            }
        }
    }

    Ok(())
}
