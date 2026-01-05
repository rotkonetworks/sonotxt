# E2E Audio Encryption Design

Future architecture for private, user-owned audio files using ghettobox VSS.

## Overview

- **Public files**: Plaintext Opus/OGG on IPFS, playable by anyone (embed.js)
- **Private files**: Encrypted chunks on IPFS, decryptable only by owner

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  CREATION (Server-side)                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. TTS API → WAV audio                                         │
│  2. ffmpeg → Opus/OGG (96kbps mono)                             │
│  3. Generate random 32-byte encryption key                       │
│  4. Fixed-size chunking (256KB)                                 │
│  5. ChaCha20-Poly1305 encrypt each chunk                        │
│  6. Upload chunks to IPFS → CIDs                                │
│  7. VSS split key (2-of-3 threshold)                            │
│     - Share 1: Store on ghettobox node 1                        │
│     - Share 2: Store on ghettobox node 2                        │
│     - Share 3: Store on ghettobox node 3                        │
│  8. Create manifest with CIDs + share locations                 │
│  9. Return manifest CID to client                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  PLAYBACK (Client-side)                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Fetch manifest from IPFS                                    │
│  2. User provides password → Argon2id stretch                   │
│  3. Fetch 2 of 3 VSS shares from ghettobox nodes               │
│  4. Reconstruct encryption key via Lagrange interpolation       │
│  5. Prefetch first N chunks from IPFS                          │
│  6. Decrypt chunks (WASM: ChaCha20-Poly1305)                   │
│  7. Feed to MediaSource Extensions → <audio> playback          │
│  8. Continue prefetching as playback progresses                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Deterministic Chunking

Fixed 256KB chunks enable:
- Predictable seeking (byte offset = chunk index * 256KB)
- Parallel fetch/decrypt
- Content-addressable storage (same input → same CIDs)

### Nonce Derivation

Each chunk needs unique nonce for ChaCha20. Derived deterministically:

```rust
fn chunk_nonce(key: &[u8; 32], chunk_index: u32) -> [u8; 12] {
    let mut nonce = [0u8; 12];
    nonce[..4].copy_from_slice(&chunk_index.to_le_bytes());
    let tag = hmac_sha256(key, &[b"sonotxt:nonce:v1", &chunk_index.to_le_bytes()]);
    nonce[4..].copy_from_slice(&tag[..8]);
    nonce
}
```

## Manifest Format

```json
{
  "v": 2,
  "format": "opus",
  "container": "ogg",
  "bitrate_kbps": 96,
  "sample_rate": 48000,
  "duration_ms": 45000,
  "chunk_bytes": 262144,
  "chunks": [
    "QmChunk0CID...",
    "QmChunk1CID...",
    "QmChunk2CID..."
  ],
  "shares": {
    "threshold": 2,
    "nodes": [
      "https://node1.ghettobox.net/share/abc123",
      "https://node2.ghettobox.net/share/abc123",
      "https://node3.ghettobox.net/share/abc123"
    ]
  }
}
```

## Chunk Format

```
[encrypted_opus_data][16-byte poly1305 auth tag]
```

No header needed - chunk index is implicit from manifest position.

## VSS Integration

Uses ghettobox Shamir's Secret Sharing over GF(256):

```rust
use ghettobox::{vss, crypto};

// Split encryption key
let key: [u8; 32] = crypto::random_bytes();
let shares = vss::split_secret(&key)?;  // 3 shares, 2-of-3 threshold

// Distribute to nodes
for (i, share) in shares.iter().enumerate() {
    ghettobox_client.store_share(&node_urls[i], &share).await?;
}

// Reconstruct (any 2 shares)
let key = vss::combine_shares(&[shares[0], shares[2]])?;
```

## Client-side WASM

Required crates compiled to WASM:
- `chacha20poly1305` - chunk decryption
- `ghettobox::vss` - share reconstruction
- `argon2` - password stretching (if password-protected shares)

## Format Conversion

Client-side ffmpeg.wasm for download in other formats:

```javascript
// Web Worker
import { FFmpeg } from '@ffmpeg/ffmpeg'

await ffmpeg.exec(['-i', 'input.ogg', '-b:a', '192k', 'output.mp3'])
```

## Public vs Private

| Aspect | Public | Private |
|--------|--------|---------|
| Storage | IPFS (plaintext) | IPFS (encrypted) |
| Key management | None | VSS 2-of-3 |
| Playback | Direct fetch | Fetch + decrypt |
| embed.js | Works | N/A (owner only) |
| Sharing | Share CID | Share CID + grant access |

## Dependencies

### Server (Rust)
- `ffmpeg` binary (WAV → Opus transcoding)
- `chacha20poly1305` crate
- `ghettobox` crate (VSS + crypto)
- IPFS node or pinning service

### Client (Browser)
- WASM crypto module (~50KB)
- Optional: ffmpeg.wasm for format conversion (~30MB, cached)

## Migration Path

1. **MVP (current)**: MinIO storage, MP3/Opus, no encryption
2. **Phase 1**: Switch to Opus/OGG, keep MinIO
3. **Phase 2**: Add IPFS as storage option
4. **Phase 3**: Implement E2E encryption with ghettobox VSS
5. **Phase 4**: Deprecate MinIO, full decentralization

## Open Questions

- [ ] Ghettobox network viability for audio workloads
- [ ] IPFS pinning costs vs self-hosted nodes
- [ ] Password-protected shares vs passwordless (TPM-sealed)
- [ ] Recovery UX (BIP39 words backup)
- [ ] Access sharing mechanism for private files
