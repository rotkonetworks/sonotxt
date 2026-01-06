// Noise protocol session management for encrypted inference
// uses Noise_NK pattern: client knows server's static key from attestation

use std::collections::HashMap;
use snow::{Builder, TransportState, Keypair};
use rand::{thread_rng, RngCore};

const NOISE_PATTERN: &str = "Noise_NK_25519_ChaChaPoly_SHA256";
// max noise message size is 65535, use smaller chunk to leave room for overhead
const MAX_CHUNK_SIZE: usize = 65000;

/// Noise protocol server managing multiple client sessions
pub struct NoiseServer {
    static_keypair: Keypair,
    sessions: HashMap<[u8; 16], TransportState>,
}

impl NoiseServer {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let builder = Builder::new(NOISE_PATTERN.parse()?);
        let static_keypair = builder.generate_keypair()?;

        Ok(Self {
            static_keypair,
            sessions: HashMap::new(),
        })
    }

    /// get server's static public key for attestation binding
    pub fn static_public_key(&self) -> &[u8] {
        &self.static_keypair.public
    }

    /// process client's handshake message (-> e, es)
    /// returns session_id and response message (<- e, ee)
    pub fn process_handshake(&mut self, client_msg: &[u8]) -> Result<([u8; 16], Vec<u8>), Box<dyn std::error::Error>> {
        let builder = Builder::new(NOISE_PATTERN.parse()?);
        let mut responder = builder
            .local_private_key(&self.static_keypair.private)
            .build_responder()?;

        // read client's first message (-> e, es)
        let mut payload = vec![0u8; 65535];
        let len = responder.read_message(client_msg, &mut payload)?;
        payload.truncate(len);

        // write server response (<- e, ee)
        let mut response = vec![0u8; 65535];
        let len = responder.write_message(&[], &mut response)?;
        response.truncate(len);

        // transition to transport mode
        let transport = responder.into_transport_mode()?;

        // generate session ID
        let mut session_id = [0u8; 16];
        thread_rng().fill_bytes(&mut session_id);

        self.sessions.insert(session_id, transport);

        Ok((session_id, response))
    }

    /// decrypt incoming message (handles chunked messages)
    pub fn decrypt(&mut self, session_id: &[u8; 16], data: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        let transport = self.sessions.get_mut(session_id)
            .ok_or("session not found")?;

        if data.len() < 4 {
            return Err("invalid encrypted data".into());
        }

        // read number of chunks
        let num_chunks = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
        let mut offset = 4;
        let mut result = Vec::new();

        for _ in 0..num_chunks {
            if offset + 4 > data.len() {
                return Err("truncated chunk header".into());
            }

            let chunk_len = u32::from_le_bytes([
                data[offset], data[offset + 1], data[offset + 2], data[offset + 3]
            ]) as usize;
            offset += 4;

            if offset + chunk_len > data.len() {
                return Err("truncated chunk data".into());
            }

            let chunk = &data[offset..offset + chunk_len];
            offset += chunk_len;

            let mut plaintext = vec![0u8; chunk.len()];
            let len = transport.read_message(chunk, &mut plaintext)?;
            plaintext.truncate(len);

            result.extend(plaintext);
        }

        Ok(result)
    }

    /// encrypt outgoing message (handles chunking for large messages)
    pub fn encrypt(&mut self, session_id: &[u8; 16], plaintext: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        let transport = self.sessions.get_mut(session_id)
            .ok_or("session not found")?;

        // chunk large messages to fit Noise's 65535 byte limit
        let mut result = Vec::new();
        let chunks: Vec<&[u8]> = plaintext.chunks(MAX_CHUNK_SIZE).collect();
        let num_chunks = chunks.len() as u32;

        // write number of chunks first
        result.extend_from_slice(&num_chunks.to_le_bytes());

        for chunk in chunks {
            let mut ciphertext = vec![0u8; chunk.len() + 16]; // +16 for auth tag
            let len = transport.write_message(chunk, &mut ciphertext)?;
            ciphertext.truncate(len);

            // write chunk length then chunk data
            result.extend_from_slice(&(ciphertext.len() as u32).to_le_bytes());
            result.extend(ciphertext);
        }

        Ok(result)
    }

    /// remove session
    pub fn remove_session(&mut self, session_id: &[u8; 16]) {
        self.sessions.remove(session_id);
    }
}
