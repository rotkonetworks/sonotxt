use serde::{Deserialize, Serialize};

/// TEE attestation quote with bound Noise static key
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttestationBundle {
    /// raw attestation quote (SEV-SNP or TDX format)
    pub quote: Vec<u8>,

    /// Noise static public key for this TEE instance (32 bytes X25519)
    pub static_key: Vec<u8>,

    /// signature binding static_key to quote
    /// signs: H(quote || static_key)
    pub binding_sig: Vec<u8>,

    /// TEE type for client verification
    pub tee_type: TeeType,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum TeeType {
    /// AMD SEV-SNP
    SevSnp,
    /// Intel TDX
    Tdx,
    /// development/testing (no real attestation)
    Insecure,
}

/// inference request (sent inside Noise encrypted channel)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceRequest {
    /// unique request id for correlation
    pub request_id: [u8; 16],

    /// voice id (e.g. "af_bella", "bm_george")
    pub voice: String,

    /// speed multiplier (0.5 - 2.0)
    pub speed: f32,

    /// text to synthesize
    pub text: String,

    /// output format
    pub format: AudioFormat,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum AudioFormat {
    /// raw PCM 16-bit signed, 24kHz mono
    Pcm24k,
    /// Opus encoded
    Opus,
}

/// inference response chunk (sent inside Noise encrypted channel)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InferenceResponse {
    /// matches request
    pub request_id: [u8; 16],

    /// sequence number for ordering (0-indexed)
    pub sequence: u32,

    /// audio data
    pub audio: Vec<u8>,

    /// is this the final chunk?
    pub is_final: bool,

    /// error if inference failed
    pub error: Option<String>,
}

/// QUIC stream message wrapper
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Message {
    /// client requesting attestation
    AttestationRequest,

    /// TEE responding with attestation
    Attestation(AttestationBundle),

    /// Noise handshake: client -> server (-> e, es)
    NoiseHandshake(Vec<u8>),

    /// Noise handshake response: server -> client (<- e, ee) + session_id
    NoiseHandshakeResponse {
        handshake: Vec<u8>,
        session_id: Vec<u8>,
    },

    /// encrypted inference request (Noise transport ciphertext)
    EncryptedRequest(Vec<u8>),

    /// encrypted inference response (Noise transport ciphertext)
    EncryptedResponse(Vec<u8>),

    /// encrypted streaming inference request (Noise transport ciphertext)
    EncryptedStreamRequest(Vec<u8>),

    /// encrypted streaming chunk (Noise transport ciphertext)
    EncryptedStreamChunk(Vec<u8>),
}

/// streaming inference request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamRequest {
    pub request_id: [u8; 16],
    pub voice: String,
    pub speed: f32,
    pub text: String,
    pub format: AudioFormat,
}

/// streaming audio chunk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamChunk {
    pub request_id: [u8; 16],
    pub sequence: u32,
    pub audio: Vec<u8>,
    pub is_final: bool,
    pub error: Option<String>,
}

impl Message {
    pub fn encode(&self) -> Vec<u8> {
        // simple length-prefixed encoding
        let data = bincode_encode(self);
        let len = (data.len() as u32).to_le_bytes();
        [len.as_slice(), &data].concat()
    }

    pub fn decode(bytes: &[u8]) -> Result<(Self, usize), &'static str> {
        if bytes.len() < 4 {
            return Err("not enough bytes for length");
        }
        let len = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
        if bytes.len() < 4 + len {
            return Err("not enough bytes for message");
        }
        let msg = bincode_decode(&bytes[4..4 + len])?;
        Ok((msg, 4 + len))
    }
}

fn bincode_encode<T: Serialize>(val: &T) -> Vec<u8> {
    // using JSON for now, switch to bincode later
    serde_json::to_vec(val).unwrap()
}

fn bincode_decode<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Result<T, &'static str> {
    serde_json::from_slice(bytes).map_err(|_| "decode failed")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_message_roundtrip() {
        let req = InferenceRequest {
            request_id: [1; 16],
            voice: "af_bella".to_string(),
            speed: 1.0,
            text: "hello world".to_string(),
            format: AudioFormat::Pcm24k,
        };

        let msg = Message::EncryptedRequest(serde_json::to_vec(&req).unwrap());
        let encoded = msg.encode();
        let (decoded, len) = Message::decode(&encoded).unwrap();

        assert_eq!(len, encoded.len());
        match decoded {
            Message::EncryptedRequest(data) => {
                let req2: InferenceRequest = serde_json::from_slice(&data).unwrap();
                assert_eq!(req2.voice, "af_bella");
            }
            _ => panic!("wrong message type"),
        }
    }
}
