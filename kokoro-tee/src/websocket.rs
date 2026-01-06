// WebSocket server for browser clients
// Mirrors the QUIC protocol but over WS for browser compatibility

use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use axum::{
    Router,
    routing::get,
    extract::{State, ws::{Message, WebSocket, WebSocketUpgrade}},
    response::IntoResponse,
};
use futures::{SinkExt, StreamExt};
use tower_http::cors::{CorsLayer, Any};
use kokoro_common::{Message as ProtoMessage, StreamRequest};

use crate::attestation::generate_attestation;
use crate::inference::InferenceEngine;
use crate::noise::NoiseServer;

#[derive(Clone)]
pub struct WsState {
    engine: Arc<InferenceEngine>,
    noise: Arc<RwLock<NoiseServer>>,
}

pub struct WebSocketServer {
    addr: SocketAddr,
    state: WsState,
}

impl WebSocketServer {
    pub fn new(
        addr: SocketAddr,
        engine: Arc<InferenceEngine>,
        noise: Arc<RwLock<NoiseServer>>,
    ) -> Self {
        Self {
            addr,
            state: WsState { engine, noise },
        }
    }

    pub async fn run(self) -> Result<(), Box<dyn std::error::Error>> {
        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any);

        let app = Router::new()
            .route("/ws", get(ws_handler))
            .layer(cors)
            .with_state(self.state);

        let listener = tokio::net::TcpListener::bind(self.addr).await?;
        tracing::info!("WebSocket server listening on {}", self.addr);

        axum::serve(listener, app).await?;
        Ok(())
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<WsState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_websocket(socket, state))
}

async fn handle_websocket(socket: WebSocket, state: WsState) {
    let (mut sender, mut receiver) = socket.split();

    // Session state
    let session_id: Arc<RwLock<Option<[u8; 16]>>> = Arc::new(RwLock::new(None));

    tracing::info!("new WebSocket connection");

    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(Message::Binary(data)) => {
                match handle_message(&data, &state, &session_id, &mut sender).await {
                    Ok(_) => {}
                    Err(e) => {
                        tracing::error!("message handling error: {:?}", e);
                        break;
                    }
                }
            }
            Ok(Message::Close(_)) => {
                tracing::info!("WebSocket closed");
                break;
            }
            Err(e) => {
                tracing::error!("WebSocket error: {:?}", e);
                break;
            }
            _ => {} // ignore text, ping, pong
        }
    }

    // cleanup session
    let sid = { *session_id.read().await };
    if let Some(sid) = sid {
        state.noise.write().await.remove_session(&sid);
    }
}

async fn handle_message(
    data: &[u8],
    state: &WsState,
    session_id: &Arc<RwLock<Option<[u8; 16]>>>,
    sender: &mut futures::stream::SplitSink<WebSocket, Message>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    type BoxError = Box<dyn std::error::Error + Send + Sync>;
    // same framing as QUIC: 4-byte length prefix + body
    if data.len() < 4 {
        return Err("message too short".into());
    }

    let msg_len = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
    if data.len() < 4 + msg_len {
        return Err("incomplete message".into());
    }

    let body = &data[4..4 + msg_len];
    let msg: ProtoMessage = serde_json::from_slice(body)?;

    match msg {
        ProtoMessage::AttestationRequest => {
            tracing::info!("WS: attestation requested");

            let static_key = state.noise.read().await.static_public_key().to_vec();
            let attestation = generate_attestation(&static_key)
                .map_err(|e| BoxError::from(e.to_string()))?;

            let response = ProtoMessage::Attestation(attestation);
            sender.send(Message::Binary(response.encode().into())).await?;
        }

        ProtoMessage::NoiseHandshake(client_msg) => {
            tracing::info!("WS: Noise handshake received");

            let (sid, response_msg) = state.noise.write().await.process_handshake(&client_msg)
                .map_err(|e| BoxError::from(e.to_string()))?;
            *session_id.write().await = Some(sid);

            tracing::info!("WS: Noise session established: {:02x?}", sid);

            let response = ProtoMessage::NoiseHandshakeResponse {
                handshake: response_msg,
                session_id: sid.to_vec(),
            };
            sender.send(Message::Binary(response.encode().into())).await?;
        }

        ProtoMessage::EncryptedStreamRequest(ciphertext) => {
            let sid = { session_id.read().await.ok_or("no session")? };

            let plaintext = state.noise.write().await.decrypt(&sid, &ciphertext)
                .map_err(|e| BoxError::from(e.to_string()))?;
            let request: StreamRequest = serde_json::from_slice(&plaintext)?;

            tracing::info!(
                "WS: stream request: voice={}, text_len={}",
                request.voice,
                request.text.len()
            );

            // create channel for streaming chunks
            let (chunk_tx, mut chunk_rx) = tokio::sync::mpsc::channel(16);

            // spawn inference task
            let engine = state.engine.clone();
            let req = request.clone();
            tokio::spawn(async move {
                engine.process_stream(&req, chunk_tx).await;
            });

            // stream encrypted chunks back to client
            while let Some(chunk) = chunk_rx.recv().await {
                let chunk_bytes = serde_json::to_vec(&chunk)?;
                let encrypted = state.noise.write().await.encrypt(&sid, &chunk_bytes)
                    .map_err(|e| BoxError::from(e.to_string()))?;
                let encoded = ProtoMessage::EncryptedStreamChunk(encrypted).encode();
                sender.send(Message::Binary(encoded.into())).await?;

                tracing::debug!("WS: sent chunk {} ({} bytes)", chunk.sequence, chunk.audio.len());

                if chunk.is_final {
                    break;
                }
            }
        }

        ProtoMessage::EncryptedRequest(ciphertext) => {
            let sid = { session_id.read().await.ok_or("no session")? };

            let plaintext = state.noise.write().await.decrypt(&sid, &ciphertext)
                .map_err(|e| BoxError::from(e.to_string()))?;
            let request: kokoro_common::InferenceRequest = serde_json::from_slice(&plaintext)?;

            tracing::info!(
                "WS: inference request: voice={}, text_len={}",
                request.voice,
                request.text.len()
            );

            let response = state.engine.process(&request).await;

            let response_bytes = serde_json::to_vec(&response)?;
            let encrypted = state.noise.write().await.encrypt(&sid, &response_bytes)
                .map_err(|e| BoxError::from(e.to_string()))?;

            let encoded = ProtoMessage::EncryptedResponse(encrypted).encode();
            sender.send(Message::Binary(encoded.into())).await?;
        }

        _ => {
            tracing::warn!("WS: unexpected message type");
        }
    }

    Ok(())
}
