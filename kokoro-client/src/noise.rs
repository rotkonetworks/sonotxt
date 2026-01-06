// Noise protocol client session
// uses Noise_NK pattern: client knows server's static key from attestation

use snow::{Builder, HandshakeState, TransportState};

const NOISE_PATTERN: &str = "Noise_NK_25519_ChaChaPoly_SHA256";
// max noise message size is 65535, use smaller chunk to leave room for overhead
const MAX_CHUNK_SIZE: usize = 65000;

/// Noise protocol client session
pub struct NoiseClient {
    handshake: Option<HandshakeState>,
    transport: Option<TransportState>,
    session_id: Option<[u8; 16]>,
}

impl NoiseClient {
    pub fn new() -> Self {
        Self {
            handshake: None,
            transport: None,
            session_id: None,
        }
    }

    /// initiate handshake with server's static public key (from attestation)
    /// returns the handshake message to send to server
    pub fn initiate_handshake(&mut self, server_static_key: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        let builder = Builder::new(NOISE_PATTERN.parse()?);
        let mut initiator = builder
            .remote_public_key(server_static_key)
            .build_initiator()?;

        // write first message (-> e, es)
        let mut message = vec![0u8; 65535];
        let len = initiator.write_message(&[], &mut message)?;
        message.truncate(len);

        // store handshake state for completing later
        self.handshake = Some(initiator);

        Ok(message)
    }

    /// complete handshake with server's response
    pub fn complete_handshake(
        &mut self,
        server_response: &[u8],
        session_id: [u8; 16],
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut initiator = self.handshake.take()
            .ok_or("no handshake in progress")?;

        // read server's response (<- e, ee)
        let mut payload = vec![0u8; 65535];
        let len = initiator.read_message(server_response, &mut payload)?;
        payload.truncate(len);

        // transition to transport mode
        self.transport = Some(initiator.into_transport_mode()?);
        self.session_id = Some(session_id);

        Ok(())
    }

    /// encrypt message to server (handles chunking for large messages)
    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        let transport = self.transport.as_mut()
            .ok_or("session not established")?;

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

    /// decrypt message from server (handles chunked messages)
    pub fn decrypt(&mut self, data: &[u8]) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        let transport = self.transport.as_mut()
            .ok_or("session not established")?;

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
}
