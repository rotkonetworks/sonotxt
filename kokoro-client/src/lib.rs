// kokoro-client: encrypted TTS inference client
//
// connects to kokoro-tee server over QUIC
// verifies TEE attestation, establishes Noise_NK session
// sends encrypted requests, receives encrypted responses

mod noise;

use std::net::SocketAddr;
use std::sync::Arc;
use quinn::{Endpoint, Connection, ClientConfig};
use rustls::pki_types::CertificateDer;
use kokoro_common::{
    Message, AttestationBundle, InferenceRequest, InferenceResponse, AudioFormat,
    StreamRequest, StreamChunk,
};

pub use crate::noise::NoiseClient;

/// errors from the client
#[derive(Debug)]
pub enum ClientError {
    Connection(String),
    Attestation(String),
    Session(String),
    Inference(String),
    Protocol(String),
}

impl std::fmt::Display for ClientError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClientError::Connection(e) => write!(f, "connection error: {}", e),
            ClientError::Attestation(e) => write!(f, "attestation error: {}", e),
            ClientError::Session(e) => write!(f, "session error: {}", e),
            ClientError::Inference(e) => write!(f, "inference error: {}", e),
            ClientError::Protocol(e) => write!(f, "protocol error: {}", e),
        }
    }
}

impl std::error::Error for ClientError {}

/// kokoro TTS client with E2E encryption via Noise protocol
pub struct KokoroClient {
    #[allow(dead_code)]
    endpoint: Endpoint,
    connection: Connection,
    noise: NoiseClient,
}

impl KokoroClient {
    /// connect to kokoro-tee server, verify attestation, establish Noise session
    pub async fn connect(addr: SocketAddr) -> Result<Self, ClientError> {
        // create QUIC endpoint
        let endpoint = create_client_endpoint()
            .map_err(|e| ClientError::Connection(e.to_string()))?;

        tracing::info!("connecting to {}", addr);

        // connect to server
        let connection = endpoint
            .connect(addr, "localhost")
            .map_err(|e| ClientError::Connection(e.to_string()))?
            .await
            .map_err(|e| ClientError::Connection(e.to_string()))?;

        tracing::info!("connected to server");

        // request attestation
        let attestation = request_attestation(&connection).await?;
        tracing::info!("received attestation: {:?}", attestation.tee_type);

        // verify attestation (in production this is critical)
        verify_attestation(&attestation)?;
        tracing::info!("attestation verified");

        // create Noise client, initiate handshake with server's attested static key
        let mut noise = NoiseClient::new();
        let handshake_msg = noise.initiate_handshake(&attestation.static_key)
            .map_err(|e| ClientError::Session(e.to_string()))?;

        // send handshake, get response
        let (server_response, session_id) = send_noise_handshake(&connection, &handshake_msg).await?;

        // complete handshake
        noise.complete_handshake(
            &server_response,
            session_id,
        ).map_err(|e| ClientError::Session(e.to_string()))?;

        tracing::info!("Noise session established: {:02x?}", session_id);

        Ok(Self {
            endpoint,
            connection,
            noise,
        })
    }

    /// synthesize speech from text
    pub async fn synthesize(
        &mut self,
        text: &str,
        voice: &str,
        speed: f32,
        format: AudioFormat,
    ) -> Result<Vec<u8>, ClientError> {
        // create request
        let mut request_id = [0u8; 16];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut request_id);

        let request = InferenceRequest {
            request_id,
            voice: voice.to_string(),
            speed,
            text: text.to_string(),
            format,
        };

        // serialize and encrypt
        let plaintext = serde_json::to_vec(&request)
            .map_err(|e| ClientError::Protocol(e.to_string()))?;

        let ciphertext = self.noise.encrypt(&plaintext)
            .map_err(|e| ClientError::Session(e.to_string()))?;

        // send encrypted request
        let (mut send, mut recv) = self.connection
            .open_bi()
            .await
            .map_err(|e| ClientError::Connection(e.to_string()))?;

        let msg = Message::EncryptedRequest(ciphertext);
        send.write_all(&msg.encode())
            .await
            .map_err(|e| ClientError::Connection(e.to_string()))?;
        send.finish()
            .map_err(|e| ClientError::Connection(e.to_string()))?;

        tracing::debug!("request sent, waiting for response...");

        // receive encrypted response - read length prefix then body
        let mut len_buf = [0u8; 4];
        recv.read_exact(&mut len_buf)
            .await
            .map_err(|e| ClientError::Connection(format!("failed to read length: {}", e)))?;

        let msg_len = u32::from_le_bytes(len_buf) as usize;
        tracing::debug!("expecting {} byte response", msg_len);

        let mut body = vec![0u8; msg_len];
        recv.read_exact(&mut body)
            .await
            .map_err(|e| ClientError::Connection(format!("failed to read body: {}", e)))?;

        // prepend length prefix back for decode
        let mut buf = len_buf.to_vec();
        buf.extend(body);
        tracing::debug!("received {} bytes total", buf.len());

        if buf.is_empty() {
            return Err(ClientError::Protocol("empty response".into()));
        }

        let (msg, _) = Message::decode(&buf)
            .map_err(|e| ClientError::Protocol(e.to_string()))?;

        match msg {
            Message::EncryptedResponse(ciphertext) => {
                // decrypt response
                let plaintext = self.noise.decrypt(&ciphertext)
                    .map_err(|e| ClientError::Session(e.to_string()))?;

                let response: InferenceResponse = serde_json::from_slice(&plaintext)
                    .map_err(|e| ClientError::Protocol(e.to_string()))?;

                if let Some(error) = response.error {
                    return Err(ClientError::Inference(error));
                }

                Ok(response.audio)
            }
            _ => Err(ClientError::Protocol("unexpected response type".into())),
        }
    }

    /// synthesize speech with streaming - returns a stream handle for receiving chunks
    pub async fn synthesize_stream(
        &mut self,
        text: &str,
        voice: &str,
        speed: f32,
        format: AudioFormat,
    ) -> Result<StreamHandle, ClientError> {
        // create request
        let mut request_id = [0u8; 16];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut request_id);

        let request = StreamRequest {
            request_id,
            voice: voice.to_string(),
            speed,
            text: text.to_string(),
            format,
        };

        // serialize and encrypt
        let plaintext = serde_json::to_vec(&request)
            .map_err(|e| ClientError::Protocol(e.to_string()))?;

        let ciphertext = self.noise.encrypt(&plaintext)
            .map_err(|e| ClientError::Session(e.to_string()))?;

        // send encrypted stream request
        let (mut send, recv) = self.connection
            .open_bi()
            .await
            .map_err(|e| ClientError::Connection(e.to_string()))?;

        let msg = Message::EncryptedStreamRequest(ciphertext);
        send.write_all(&msg.encode())
            .await
            .map_err(|e| ClientError::Connection(e.to_string()))?;
        send.finish()
            .map_err(|e| ClientError::Connection(e.to_string()))?;

        tracing::debug!("stream request sent");

        Ok(StreamHandle { recv })
    }

    /// receive next chunk from stream (call after synthesize_stream)
    pub async fn recv_chunk(&mut self, handle: &mut StreamHandle) -> Result<Option<StreamChunk>, ClientError> {
        // read length prefix
        let mut len_buf = [0u8; 4];
        match handle.recv.read_exact(&mut len_buf).await {
            Ok(_) => {}
            Err(quinn::ReadExactError::FinishedEarly(_)) => return Ok(None),
            Err(e) => return Err(ClientError::Connection(format!("read error: {}", e))),
        }

        let msg_len = u32::from_le_bytes(len_buf) as usize;

        // read message body
        let mut body = vec![0u8; msg_len];
        handle.recv.read_exact(&mut body)
            .await
            .map_err(|e| ClientError::Connection(format!("failed to read body: {}", e)))?;

        // decode message
        let mut buf = len_buf.to_vec();
        buf.extend(body);

        let (msg, _) = Message::decode(&buf)
            .map_err(|e| ClientError::Protocol(e.to_string()))?;

        match msg {
            Message::EncryptedStreamChunk(ciphertext) => {
                // decrypt chunk
                let plaintext = self.noise.decrypt(&ciphertext)
                    .map_err(|e| ClientError::Session(e.to_string()))?;

                let chunk: StreamChunk = serde_json::from_slice(&plaintext)
                    .map_err(|e| ClientError::Protocol(e.to_string()))?;

                if chunk.is_final && chunk.audio.is_empty() {
                    return Ok(None);
                }

                Ok(Some(chunk))
            }
            _ => Err(ClientError::Protocol("unexpected message type".into())),
        }
    }
}

/// handle for receiving streamed audio chunks
pub struct StreamHandle {
    recv: quinn::RecvStream,
}

/// create QUIC client endpoint
fn create_client_endpoint() -> Result<Endpoint, Box<dyn std::error::Error>> {
    // for development: skip certificate verification
    // in production: verify server cert or rely on attestation binding
    let mut crypto = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(SkipServerVerification))
        .with_no_client_auth();

    // must match server ALPN
    crypto.alpn_protocols = vec![b"kokoro-tee".to_vec()];

    let client_config = ClientConfig::new(Arc::new(
        quinn::crypto::rustls::QuicClientConfig::try_from(crypto)?
    ));

    let mut endpoint = Endpoint::client("0.0.0.0:0".parse()?)?;
    endpoint.set_default_client_config(client_config);

    Ok(endpoint)
}

/// request attestation from server
async fn request_attestation(conn: &Connection) -> Result<AttestationBundle, ClientError> {
    let (mut send, mut recv) = conn
        .open_bi()
        .await
        .map_err(|e| ClientError::Connection(e.to_string()))?;

    // send attestation request
    let msg = Message::AttestationRequest;
    send.write_all(&msg.encode())
        .await
        .map_err(|e| ClientError::Connection(e.to_string()))?;
    send.finish()
        .map_err(|e| ClientError::Connection(e.to_string()))?;

    // receive attestation
    let mut buf = vec![0u8; 65536];
    let n = recv.read(&mut buf)
        .await
        .map_err(|e| ClientError::Connection(e.to_string()))?
        .ok_or_else(|| ClientError::Protocol("stream closed".into()))?;

    let (msg, _) = Message::decode(&buf[..n])
        .map_err(|e| ClientError::Protocol(e.to_string()))?;

    match msg {
        Message::Attestation(bundle) => Ok(bundle),
        _ => Err(ClientError::Protocol("expected attestation".into())),
    }
}

/// verify attestation bundle
fn verify_attestation(bundle: &AttestationBundle) -> Result<(), ClientError> {
    use sha2::{Sha256, Digest};

    // verify binding signature
    let mut hasher = Sha256::new();
    hasher.update(&bundle.quote);
    hasher.update(&bundle.static_key);
    let expected = hasher.finalize();

    if bundle.binding_sig != expected.as_slice() {
        return Err(ClientError::Attestation("binding signature mismatch".into()));
    }

    // TODO: for real TEE types, verify:
    // - certificate chain (AMD/Intel roots)
    // - measurement against transparency log
    // - code identity matches expected

    match bundle.tee_type {
        kokoro_common::TeeType::Insecure => {
            tracing::warn!("accepting insecure attestation (development mode)");
            Ok(())
        }
        kokoro_common::TeeType::SevSnp => {
            Err(ClientError::Attestation("SEV-SNP verification not implemented".into()))
        }
        kokoro_common::TeeType::Tdx => {
            Err(ClientError::Attestation("TDX verification not implemented".into()))
        }
    }
}

/// send Noise handshake, receive response and session ID
async fn send_noise_handshake(conn: &Connection, handshake_msg: &[u8]) -> Result<(Vec<u8>, [u8; 16]), ClientError> {
    let (mut send, mut recv) = conn
        .open_bi()
        .await
        .map_err(|e| ClientError::Connection(e.to_string()))?;

    let msg = Message::NoiseHandshake(handshake_msg.to_vec());
    send.write_all(&msg.encode())
        .await
        .map_err(|e| ClientError::Connection(e.to_string()))?;
    send.finish()
        .map_err(|e| ClientError::Connection(e.to_string()))?;

    // receive handshake response
    let mut buf = vec![0u8; 65536];
    let n = recv.read(&mut buf)
        .await
        .map_err(|e| ClientError::Connection(e.to_string()))?
        .ok_or_else(|| ClientError::Protocol("stream closed".into()))?;

    let (msg, _) = Message::decode(&buf[..n])
        .map_err(|e| ClientError::Protocol(e.to_string()))?;

    match msg {
        Message::NoiseHandshakeResponse { handshake, session_id } => {
            if session_id.len() != 16 {
                return Err(ClientError::Protocol("invalid session id".into()));
            }
            let mut sid = [0u8; 16];
            sid.copy_from_slice(&session_id);
            Ok((handshake, sid))
        }
        _ => Err(ClientError::Protocol("expected handshake response".into())),
    }
}

/// skip TLS cert verification (development only)
#[derive(Debug)]
struct SkipServerVerification;

impl rustls::client::danger::ServerCertVerifier for SkipServerVerification {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &rustls::pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        vec![
            rustls::SignatureScheme::RSA_PKCS1_SHA256,
            rustls::SignatureScheme::RSA_PKCS1_SHA384,
            rustls::SignatureScheme::RSA_PKCS1_SHA512,
            rustls::SignatureScheme::ECDSA_NISTP256_SHA256,
            rustls::SignatureScheme::ECDSA_NISTP384_SHA384,
            rustls::SignatureScheme::ECDSA_NISTP521_SHA512,
            rustls::SignatureScheme::RSA_PSS_SHA256,
            rustls::SignatureScheme::RSA_PSS_SHA384,
            rustls::SignatureScheme::RSA_PSS_SHA512,
            rustls::SignatureScheme::ED25519,
        ]
    }
}
