# sonotxt: PolkadotDAO as Early Investor in AI Inference on Asset Hub

**Track:** Small Spender
**Requested:** 10,000 DOT (~$15,000 USD)
**Beneficiary:** [address]
**SONO Allocation to Treasury:** 2,000,000 SONO (20% of 10M supply)

---

## TL;DR

sonotxt is a live AI inference marketplace built natively on Polkadot Asset Hub. This proposal asks for 10,000 DOT to fund two engineers for open-source development of the API, smart contracts, frontend, and deployment tooling — connecting to existing GPU services. In return, the Polkadot treasury receives 20% of the SONO governance token, making PolkadotDAO an early investor in a real product with real revenue mechanics. Not a grant. An investment.

A follow-up proposal will cover dedicated GPU hardware and an Android app to make inference pricing competitive with centralized alternatives.

---

## Why This Proposal Is Different

The era of grants without products in the pipeline should have never happened. Too many treasury proposals delivered documentation, prototypes, and pitch decks that went nowhere. This proposal comes from someone who has been in the trenches.

### My Track Record — And My Scars

I'm the operator behind **rotko.net**, the RPC infrastructure provider serving the majority of public RPC requests across the Polkadot ecosystem — with our own ASN and anycasted routing. That infrastructure investment paid off. Rotko handles more public RPC traffic than any other provider aside perhaps Parity, who don't publicly disclose much about their endpoints.

I also built **whodb**, which passed its OpenGov proposal. We delivered: rewrote the entire backend software stack, created a user-first frontend with a search engine interface for finding on-chain profiles. It's complete and functional.

But I won't pretend everything went smoothly. My earlier proposal failed to achieve its goals. As an entrepreneur I absorbed roughly $30k in employment costs from that failure, and came close to burnout trying to deliver while simultaneously standing up Rotko's infrastructure from scratch — BGP sessions, colocation, monitoring, the whole stack. When you're that deep in the hole, it's hard to see light at the end of the tunnel.

I'm being transparent about this because treasury voters deserve honesty. Some proposals fail. What matters is what you build next with the lessons learned.

### What's Different About sonotxt

sonotxt isn't a whitepaper or a prototype. It's a working product deployed on Asset Hub that actually uses Polkadot as a platform — not just as a funding source.

- Smart contracts live on Paseo Asset Hub (pallet-revive/PolkaVM)
- Payment channels for real-time micropayment billing
- WebAuthn/passkey auth — no seed phrases, no extensions
- Multiple inference models (TTS, LLM, STT) already serving requests
- Burn-on-spend tokenomics enforced at the contract level

This has a real pathway to becoming something people use daily. Text-to-speech, voice AI, transcription — these are tools with genuine demand outside of crypto.

---

## Architecture

### How It Works Today

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Frontend   │────▶│   Rust API       │────▶│  GPU Workers     │
│  (SolidJS)   │     │                  │     │  (cloud GPUs)    │
│              │     │  • Auth (passkey) │     │                  │
│  • TTS UI    │     │  • Billing        │     │  • Kokoro TTS    │
│  • LLM chat  │     │  • Job queue      │     │  • Qwen LLM      │
│  • STT       │     │  • Channels       │     │  • Whisper STT   │
└──────┬───────┘     └────────┬─────────┘     └─────────────────┘
       │                      │
       │                      ▼
       │              ┌──────────────────┐
       └─────────────▶│  Asset Hub        │
                      │  (pallet-revive)  │
                      │                   │
                      │  • TXT contract   │
                      │  • Payment channels│
                      │  • SONO staking   │
                      │  • Price commits  │
                      └──────────┬────────┘
                                 │
                      ┌──────────▼────────┐
                      │  pallet-assets    │
                      │  • SONO token     │
                      │  • USDC / USDT    │
                      └───────────────────┘
```

The current architecture is centralized where it needs to be (GPU inference, API routing) and decentralized where it matters (billing, settlement, token economics). The API server manages auth, job scheduling, and inference routing. Payment channels handle real-time micropayment billing with on-chain settlement. All token logic — burns, staking rewards, provider registration — is enforced by the contract on Asset Hub.

Audio files, model weights, and inference results currently live on conventional infrastructure (local NVMe, S3-compatible storage). This is the pragmatic choice for launch — but it's not where we want to stay.

### Where It Goes: Private Inference + Distributed Storage

#### Private Inference — Why We Need Our Own Hardware

Today, when you send a prompt to an AI service, the operator sees everything in plaintext — stores it, trains on it, monetizes it. This is the fundamental problem Moxie Marlinspike's Confer is solving with confidential computing: hardware-enforced Trusted Execution Environments (TEEs) where the host provides CPU, memory, and power but cannot access the TEE's memory or execution state.

The approach: encrypt prompts from the client directly into a TEE using Noise Pipes, run inference inside the confidential VM, encrypt responses back. The host never sees plaintext. Remote attestation with reproducible builds proves what code is running. Transparency logs prevent silent deployment of different versions.

sonotxt wants to offer this. The technology exists today — services like [Phala Network](https://phala.com/gpu-tee/h100) already offer H100 GPUs with full TEE stack (Intel TDX + NVIDIA Confidential Computing, dual attestation) at ~$3/GPU/hr (~$2,200/month). Consumer GPUs like the RTX 4090 do not support confidential computing — only H100 and newer (Hopper, Blackwell) have the hardware root of trust.

For now, inference runs on rental GPU services. The plan is to prove the concept and build demand with standard inference first — the economics of $2-3k/month for a TEE-capable H100 only make sense once there's enough usage to justify it. Scaling to private inference is a natural next step, not a leap of faith.

```
Path to Private Inference

  Phase 1 (now):     Rental GPUs, standard inference, prove demand
                     ↓
  Phase 2:           Own RTX 4090s in Rotko colo, competitive pricing
                     ↓
  Phase 3:           H100 TEE instances (Phala or own hardware)
                     Private inference with full attestation chain

  ┌──────────┐    Noise Pipes (encrypted)     ┌───────────────────┐
  │  Client   │──────────────────────────────▶│  Confidential VM   │
  │           │◀──────────────────────────────│  (TEE on H100)     │
  └──────────┘    attestation + response      │                    │
                                               │  • LLM inference  │
       Only the client and the TEE             │  • TTS synthesis   │
       can see prompts/responses.              │  • STT transcribe  │
       Host operator cannot.                   │                    │
                                               │  Attestation:      │
                                               │  reproducible build│
                                               │  + transparency log│
                                               └───────────────────┘
                                                        │
                                               ┌───────▼───────────┐
                                               │  Asset Hub         │
                                               │  • Settlement      │
                                               │  • TXT burn        │
                                               │  • Price commits   │
                                               └───────────────────┘
```

Private inference is where AI on crypto rails actually makes sense — not as a gimmick, but because the payment channel model (no account, no identity, just signed state) aligns perfectly with privacy-preserving compute. Pay with TXT through a channel, get inference in a TEE, nobody knows what you asked.

There is one ecosystem gap worth noting: **no Polkadot wallet supports encryption**, despite the cryptography being solved. ECDH on sr25519 works — you do Ristretto255 scalar multiplication (`pubKey * privKey`) with ed25519-style key expansion (SHA-512 + bit clamping), producing a shared secret that both parties can derive independently. Working implementations exist in Go and Python since 2023. From there it's standard ECIES: ephemeral keypair → shared secret → KDF → symmetric encryption.

The problem isn't cryptographic — it's that nobody shipped it in a wallet. Ed25519 ecosystems have had this forever because the x25519 conversion is a one-liner. sr25519's Ristretto encoding made people assume it couldn't be done, when it just needed `ScalarMult` on the Ristretto point directly.

sonotxt sidesteps this today with WebAuthn/passkeys for auth and channel state. But native sr25519 ECDH in wallet software would unlock encrypted channels to TEEs, private messaging, and confidential data exchange across the entire Polkadot ecosystem. This is something we'd like to contribute to as part of our open-source work.

It makes sense to prove the product first and scale into privacy as demand justifies the hardware cost.

#### Distributed Storage — zoda-vss

We have an existing Rust implementation of verifiable secret sharing (`zoda-vss`) in our zeratul monorepo, built on Reed-Solomon coding over GF(2^8) with threshold reconstruction. It's a working `no_std` crate with Shamir-style polynomial evaluation — dealer creates t-of-n shares, any t shares reconstruct the original secret, each share is verifiable against a header commitment.

If sonotxt gains traction, this primitive enables distributed object storage: model weights, audio assets, and inference results sharded across a network of storage nodes with verifiable reconstruction. No single point of failure, no S3 dependency, cryptographic guarantees that what you reconstruct is what was originally stored.

This is a longer-term possibility, not a near-term deliverable. The current architecture uses conventional storage and is designed to swap in a distributed layer later — content-addressed hashing and hash-based price commitments are already structured to support this transition.

---

## What We're Building

### The Product

sonotxt is an AI inference marketplace where:

1. **Users** buy TXT tokens and spend them on inference (text-to-speech, LLM chat, speech-to-text)
2. **Providers** register models at their chosen price (in TXT) and serve inference
3. **The contract** handles billing, burns 90% of spent TXT, distributes 10% to SONO stakers

Currently, sonotxt itself is the sole provider — we run Kokoro TTS, Qwen LLM, and are adding STT. But the smart contract is written so that **anyone can become a provider**: stake SONO, register, commit their pricing on-chain, and serve inference. If marketplace interest emerges, we're ready and excited to open the frontend up for third-party providers.

### Smart Contract Architecture

The TXT contract on Asset Hub handles:

**Payment Channels** — Users lock TXT in a channel. As inference is consumed, the service signs state updates off-chain. Settlement is on-chain with signature verification, dispute periods, and cooperative close.

**Burn on Spend** — When a channel settles, 90% of spent TXT is permanently burned (reducing `totalSupply`). 10% goes to a staker reward pool. This isn't a fee that accumulates somewhere — the tokens are destroyed. Deflation is enforced at the contract level.

**Provider Registry** — Providers stake SONO to register. They commit price hashes on-chain (`commitPrice(bytes32)`) so users have cryptographic proof of the price they were charged. Providers set their own prices in TXT per service — the platform doesn't dictate pricing.

**SONO Staking** — Stakers earn pro-rata share of the 10% treasury from all inference spend. No fake yield, no token printing — rewards come from real revenue. Staked SONO also locks during governance votes (per-proposal lockup, no arbitrary timelock).

### Tokenomics

**TXT** (this contract, ERC20 on Asset Hub):
- Utility token, used to pay for inference
- 90% burned on every settlement — permanently deflationary
- 10 decimals, mintable by owner (to supply reserve for purchases)
- Buyable with DOT, USDC, USDT, or SONO

**SONO** (pallet-assets on Asset Hub):
- Governance and value capture token
- Fixed 10M supply — no mint authority, ever
- Stakers earn TXT from inference revenue
- Providers stake to list models
- Value captured through TXT scarcity: as burns reduce TXT supply, SONO→TXT exchange rate improves naturally

```
User pays TXT for inference
    ├── 90% burned (TXT supply shrinks)
    └── 10% to SONO staker reward pool
              ↓
        Stakers claim real TXT from real usage
        SONO appreciates as TXT becomes scarcer
```

### SONO Distribution

| Allocation | Amount | % |
|-----------|--------|---|
| Polkadot Treasury | 2,000,000 | 20% |
| Hydration DEX LP (SONO/DOT) | 2,500,000 | 25% |
| Team (4yr vest) | 2,500,000 | 25% |
| Provider incentives | 1,500,000 | 15% |
| Community/ecosystem | 1,500,000 | 15% |

---

## This Proposal: Part 1 — Open Source Development

### What the 10,000 DOT Funds

Two engineers working full-time on open-sourcing and hardening the sonotxt stack:

**Rust API Server** (open source)
- Payment channel state management and settlement logic
- Inference job queue, billing, provider routing
- WebAuthn/passkey authentication
- Rate limiting, free tier management
- Integration with Asset Hub contracts via alloy/ethers

**Solidity Smart Contracts** (open source)
- TXT token with burn-on-spend settlement
- Payment channels (open, topUp, cooperativeClose, dispute, finalize)
- SONO staking with revenue distribution
- Provider registry with on-chain price commitments
- Governance vote locking
- ERC1967 upgrade proxy

**SolidJS Frontend** (open source)
- Inference UI (TTS, LLM chat, STT)
- Wallet connection (passkey + browser extension)
- Payment channel management
- Provider marketplace interface

**Deploy Scripts & Tooling** (open source)
- Contract compilation (resolc/PolkaVM) and deployment
- Proxy upgrade scripts
- Interaction CLI for all contract functions
- CI/CD for testnet → mainnet promotion

This phase connects to **existing GPU services** (cloud inference endpoints) — no hardware purchase yet. The goal is to ship a fully functional, open-source, mainnet-deployed product.

### Deliverables

| # | Milestone | Timeline | Deliverable |
|---|-----------|----------|-------------|
| 1 | Open source repositories | Week 1 | All code public on GitHub with licenses |
| 2 | Mainnet contract deployment | Week 2-3 | TXT + proxy on Asset Hub mainnet, SONO asset created |
| 3 | SONO treasury transfer | Week 3 | 2M SONO to treasury-controlled address |
| 4 | Hydration LP | Week 4 | SONO/DOT pool live |
| 5 | Production API | Week 5-6 | API live on mainnet with cloud GPU inference |
| 6 | Frontend launch | Week 7-8 | app.sonotxt.com on mainnet, documentation |

Monthly reports on Polkassembly: usage metrics, TXT burned, SONO staker rewards, code contributions.

---

## Part 2 — What Comes Next

A follow-up proposal will cover making sonotxt pricing competitive and bringing it to mobile:

**Dedicated GPU Infrastructure**
- Purchase 2-4x NVIDIA RTX 4090 GPUs in Rotko's existing colocation racks
- Cuts per-inference cost by ~70% vs. cloud, making pricing competitive with centralized alternatives
- Owned hardware in Rotko colocation — stepping stone toward H100 TEE-capable instances for private inference once demand justifies ~$2-3k/month rental or hardware purchase

**Android App**
- Native Android client for sonotxt inference
- Voice assistant, TTS reader, transcription
- Brings Polkadot-powered AI to mobile — no browser extension, passkey auth native on Android

**Provider Marketplace Frontend**
- Self-service provider onboarding
- Model listing, pricing dashboard, analytics
- Opens sonotxt to third-party GPU providers

Part 2 only makes sense once Part 1 is live and generating usage data to prove demand.

---

## What PolkadotDAO Gets

This isn't a grant. It's an investment. The treasury receives:

1. **2,000,000 SONO (20% of supply)** — the treasury becomes a major stakeholder with governance weight and revenue share from day one.

2. **Ongoing TXT revenue** — staked SONO earns pro-rata share of 10% of all inference spend. As usage grows, this is a continuous return.

3. **Exchange rate appreciation** — 90% burn rate means TXT supply shrinks with every inference request. SONO→TXT rate improves. The treasury's position appreciates without anyone selling.

4. **A real product on Polkadot** — Not another bridge, not another DeFi fork. An AI inference platform that normal people can use, built natively on Asset Hub.

5. **Open source infrastructure** — All code open sourced. Other teams can fork, extend, or build on top of the payment channel and marketplace contracts.

---

## Links

- **Live testnet:** https://app.sonotxt.com
- **Contract (Paseo):** `0x1b3ece804e4414e3bce3ca9a006656b67d07fea1`
- **Rotko RPC:** https://dotters.network
- **whodb:** https://whodb.org

---

*sonotxt — AI inference, native to Polkadot. Built by someone who's been here the whole time.*
