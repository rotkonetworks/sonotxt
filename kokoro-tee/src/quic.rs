// QUIC server for encrypted inference transport

use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use quinn::{Endpoint, ServerConfig, Connection, RecvStream, SendStream};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use kokoro_common::{Message, InferenceRequest, StreamRequest};

use crate::attestation::generate_attestation;
use crate::inference::InferenceEngine;
use crate::noise::NoiseServer;

pub struct QuicServer {
    endpoint: Endpoint,
    engine: Arc<InferenceEngine>,
    noise: Arc<RwLock<NoiseServer>>,
}

impl QuicServer {
    pub async fn new(
        addr: SocketAddr,
        engine: Arc<InferenceEngine>,
        noise: Arc<RwLock<NoiseServer>>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        // generate self-signed cert for QUIC
        // in production, use proper certs or let attestation handle trust
        let (cert, key) = generate_self_signed_cert()?;

        let mut server_crypto = rustls::ServerConfig::builder()
            .with_no_client_auth()
            .with_single_cert(vec![cert], key)?;

        server_crypto.alpn_protocols = vec![b"kokoro-tee".to_vec()];

        let server_config = ServerConfig::with_crypto(Arc::new(
            quinn::crypto::rustls::QuicServerConfig::try_from(server_crypto)?
        ));

        let endpoint = Endpoint::server(server_config, addr)?;

        Ok(Self {
            endpoint,
            engine,
            noise,
        })
    }

    pub async fn run(self) -> Result<(), Box<dyn std::error::Error>> {
        tracing::info!("QUIC server listening");

        while let Some(incoming) = self.endpoint.accept().await {
            let engine = self.engine.clone();
            let noise = self.noise.clone();

            tokio::spawn(async move {
                match incoming.await {
                    Ok(conn) => {
                        if let Err(e) = handle_connection(conn, engine, noise).await {
                            tracing::error!("connection error: {:?}", e);
                        }
                    }
                    Err(e) => {
                        tracing::error!("incoming connection failed: {:?}", e);
                    }
                }
            });
        }

        Ok(())
    }
}

async fn handle_connection(
    conn: Connection,
    engine: Arc<InferenceEngine>,
    noise: Arc<RwLock<NoiseServer>>,
) -> Result<(), Box<dyn std::error::Error>> {
    tracing::info!("new connection from {}", conn.remote_address());

    // session ID is shared across all streams on this connection
    let session_id: Arc<RwLock<Option<[u8; 16]>>> = Arc::new(RwLock::new(None));

    loop {
        match conn.accept_bi().await {
            Ok((send, recv)) => {
                let engine = engine.clone();
                let noise = noise.clone();
                let sid = session_id.clone();

                tokio::spawn(async move {
                    if let Err(e) = handle_stream(send, recv, engine, noise, sid).await {
                        tracing::error!("stream error: {:?}", e);
                    }
                });
            }
            Err(quinn::ConnectionError::ApplicationClosed(_)) => {
                tracing::info!("connection closed");
                break;
            }
            Err(e) => {
                tracing::error!("accept stream error: {:?}", e);
                break;
            }
        }
    }

    // cleanup session
    if let Some(sid) = *session_id.read().await {
        noise.write().await.remove_session(&sid);
    }

    Ok(())
}

async fn handle_stream(
    mut send: SendStream,
    mut recv: RecvStream,
    engine: Arc<InferenceEngine>,
    noise: Arc<RwLock<NoiseServer>>,
    session_id: Arc<RwLock<Option<[u8; 16]>>>,
) -> Result<(), Box<dyn std::error::Error>> {
    // read the length prefix first (4 bytes), then read the message body
    let mut len_buf = [0u8; 4];
    recv.read_exact(&mut len_buf).await?;
    let msg_len = u32::from_le_bytes(len_buf) as usize;

    // read the message body
    let mut body = vec![0u8; msg_len];
    recv.read_exact(&mut body).await?;

    tracing::debug!("received {} byte message", msg_len);

    // decode (body doesn't include length prefix)
    let msg: Message = serde_json::from_slice(&body)?;

    match msg {
        Message::AttestationRequest => {
            tracing::info!("attestation requested");

            // get server's Noise static public key
            let static_key = noise.read().await.static_public_key().to_vec();

            // generate attestation bound to Noise static key
            let attestation = generate_attestation(&static_key)?;

            // send response
            let response = Message::Attestation(attestation);
            send.write_all(&response.encode()).await?;
        }

        Message::NoiseHandshake(client_msg) => {
            tracing::info!("Noise handshake received");

            // process handshake, create session
            let (sid, response_msg) = noise.write().await.process_handshake(&client_msg)?;
            *session_id.write().await = Some(sid);

            tracing::info!("Noise session established: {:02x?}", sid);

            // send handshake response + session ID
            let response = Message::NoiseHandshakeResponse {
                handshake: response_msg,
                session_id: sid.to_vec(),
            };
            send.write_all(&response.encode()).await?;
        }

        Message::EncryptedRequest(ciphertext) => {
            let sid = session_id.read().await.ok_or("no session established")?;

            // decrypt request
            let plaintext = noise.write().await.decrypt(&sid, &ciphertext)?;
            let request: InferenceRequest = serde_json::from_slice(&plaintext)?;

            tracing::info!(
                "inference request: voice={}, text_len={}",
                request.voice,
                request.text.len()
            );

            // run inference (this is where the magic happens - plaintext only exists here in TEE)
            let response = engine.process(&request).await;

            // encrypt response
            let response_bytes = serde_json::to_vec(&response)?;
            let encrypted = noise.write().await.encrypt(&sid, &response_bytes)?;

            // send encrypted response
            let encoded = Message::EncryptedResponse(encrypted).encode();
            tracing::debug!("sending {} bytes response", encoded.len());
            send.write_all(&encoded).await?;
            tracing::debug!("response sent");
        }

        Message::EncryptedStreamRequest(ciphertext) => {
            let sid = session_id.read().await.ok_or("no session established")?;

            // decrypt request
            let plaintext = noise.write().await.decrypt(&sid, &ciphertext)?;
            let request: StreamRequest = serde_json::from_slice(&plaintext)?;

            tracing::info!(
                "stream request: voice={}, text_len={}",
                request.voice,
                request.text.len()
            );

            // create channel for streaming chunks
            let (chunk_tx, mut chunk_rx) = tokio::sync::mpsc::channel(16);

            // spawn inference task
            let engine_clone = engine.clone();
            let request_clone = request.clone();
            tokio::spawn(async move {
                engine_clone.process_stream(&request_clone, chunk_tx).await;
            });

            // stream encrypted chunks back to client
            while let Some(chunk) = chunk_rx.recv().await {
                let chunk_bytes = serde_json::to_vec(&chunk)?;
                let encrypted = noise.write().await.encrypt(&sid, &chunk_bytes)?;
                let encoded = Message::EncryptedStreamChunk(encrypted).encode();
                send.write_all(&encoded).await?;
                tracing::debug!("sent chunk {} ({} bytes audio)", chunk.sequence, chunk.audio.len());

                if chunk.is_final {
                    break;
                }
            }
        }

        _ => {
            tracing::warn!("unexpected message type");
        }
    }

    send.finish()?;
    Ok(())
}

fn generate_self_signed_cert() -> Result<(CertificateDer<'static>, PrivateKeyDer<'static>), Box<dyn std::error::Error>> {
    let cert = rcgen::generate_simple_self_signed(vec!["localhost".to_string()])?;

    let key = PrivatePkcs8KeyDer::from(cert.key_pair.serialize_der()).into();
    let cert = CertificateDer::from(cert.cert);

    Ok((cert, key))
}
