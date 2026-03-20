# Tip: Solidity-to-Substrate Pallet Bridge for Asset Hub (pallet-revive composability)

## Summary

We built and deployed an open-source, permissionless composability bridge that enables any Solidity contract on Polkadot Asset Hub to call any Substrate pallet dispatchable. This is the first demonstrated Solidity-to-Substrate pallet composability on pallet-revive.

The bridge contract (`AssetSwap`) accepts SCALE-encoded call data and forwards it to the runtime via `RUNTIME_PALLETS_ADDR` (`0x3951D3C715247994d47D9382969cd0082967b258`). Because the SCALE encoding is constructed by the frontend using PAPI (which always has the current runtime metadata), the bridge is inherently runtime-upgrade safe — no SCALE is stored on-chain, and pallet index changes do not require contract redeployment.

## Why It Matters

Polkadot Asset Hub now runs pallet-revive, bringing EVM-compatible smart contracts to the relay chain's system parachain. However, contracts deployed on pallet-revive have historically been isolated from the native Substrate pallets (AssetConversion, Assets, Staking, Governance, etc.). This bridge eliminates that boundary.

With this bridge, EVM contracts on Asset Hub can:

- **Execute DEX swaps** through the AssetConversion pallet (native AMM pools)
- **Interact with any pallet-assets token** beyond those exposed via ERC20 precompiles
- **Compose atomic operations** that span both EVM contract logic and native pallet functionality
- **Participate in governance** — contracts can submit remarks, vote, or interact with any governance pallet
- **Access XCM and cross-chain messaging** from within Solidity contracts

This turns Asset Hub's EVM layer from an isolated execution environment into a first-class citizen that can compose with the full Substrate runtime.

## Technical Details

### RUNTIME_PALLETS_ADDR

The address `0x3951D3C715247994d47D9382969cd0082967b258` is the EVM mapping of the Substrate account derived from `PalletId(*b"py/paddr")`. It is computed as:

```
blake2b_256(b"modl" ++ b"py/paddr" ++ [0u8; 24])[:20]
```

This address is deterministic and identical across all pallet-revive deployments using the standard configuration. When an EVM contract calls this address with SCALE-encoded data, the pallet-revive runtime intercepts the call and dispatches the encoded pallet extrinsic with the calling contract's origin.

### Bridge Interface

```solidity
function dispatchPallet(bytes calldata scaleCallData) external returns (bool success);
function dispatchPalletOrRevert(bytes calldata scaleCallData) external;
```

The entire contract is 47 lines of Solidity. It imposes no access control, stores no state beyond the constant address, and charges no fees. It is a pure public good.

### Runtime-Upgrade Safety

Traditional approaches to calling pallets from contracts require hardcoding SCALE encodings, which break when pallet indices change during runtime upgrades. Our approach avoids this entirely:

1. The frontend uses PAPI, which fetches the current runtime metadata
2. PAPI encodes the pallet call with the correct, current pallet indices
3. The encoded bytes are passed as calldata to the bridge contract
4. The bridge forwards them to the runtime without interpretation

No SCALE is stored in contract storage. The bridge contract never needs to be redeployed or upgraded after a runtime change.

### Governance Integration

We also built a governance pattern (`SonoGovernance.proposePalletCall`) that demonstrates how DAOs can safely govern pallet calls through this bridge. The pattern uses intent hashes — the proposal commits to a semantic description of the pallet call (pallet name, call name, parameters) rather than a specific SCALE encoding. At execution time, anyone provides the fresh SCALE encoding from current metadata, and the contract verifies it matches the voted intent.

## Use Cases

1. **DEX integration from contracts** — Solidity DeFi contracts can execute swaps through AssetConversion's native AMM pools, accessing liquidity that exists only at the pallet level.

2. **Cross-pallet atomic operations** — A single transaction can combine EVM contract logic with pallet calls. For example: check a condition in a contract, then execute a pallet swap, then update contract state — all atomically.

3. **Governance pallet calls** — DAO contracts can propose, vote on, and execute pallet-level actions (asset creation, XCM messages, system remarks) through on-chain governance.

4. **Asset management** — Contracts can create, mint, transfer, and manage pallet-assets tokens that are not exposed via ERC20 precompiles.

5. **Cross-chain messaging** — Solidity contracts can initiate XCM transfers and messages by calling the relevant pallets through the bridge.

## Deliverables

| Deliverable | Status | Link |
|---|---|---|
| AssetSwap bridge contract | Deployed on Paseo Asset Hub | `0xbb5a441bfce51c5b1fd5cd603b87c9787a8ba7b7` |
| Full Solidity source | Open source | [AssetSwap.sol](https://github.com/niccoloraspa/sonotxt/blob/master/contracts/AssetSwap.sol) |
| Technical documentation | Complete | [docs/pallet-bridge.md](https://github.com/niccoloraspa/sonotxt/blob/master/docs/pallet-bridge.md) |
| Landing page | Complete | [swap.rotko.net/#dev](https://swap.rotko.net/#dev) |
| Governance integration | Deployed | [SonoGovernance.sol](https://github.com/niccoloraspa/sonotxt/blob/master/contracts/SonoGovernance.sol) — demonstrates intent-hash pattern for pallet proposals |
| Frontend integration (PAPI + viem) | In production | Used by the sonotxt app for AssetConversion swaps |

## Requested Amount

**1000 DOT**

This covers the research, implementation, testing, documentation, and ongoing maintenance of the bridge as a public good for the Polkadot ecosystem.

## Team

**sonotxt / rotko.net**

- Building on Polkadot Asset Hub since pallet-revive launch
- Deployed production contracts (SonoToken, SonoGovernance, AssetSwap) on Paseo Asset Hub
- Active contributors to the pallet-revive ecosystem
- GitHub: [github.com/niccoloraspa/sonotxt](https://github.com/niccoloraspa/sonotxt)

## Links

- **GitHub repository**: [github.com/niccoloraspa/sonotxt](https://github.com/niccoloraspa/sonotxt)
- **Bridge contract (Paseo)**: [`0xbb5a441bfce51c5b1fd5cd603b87c9787a8ba7b7`](https://assethub-paseo.subscan.io/account/0xbb5a441bfce51c5b1fd5cd603b87c9787a8ba7b7)
- **RUNTIME_PALLETS_ADDR**: `0x3951D3C715247994d47D9382969cd0082967b258`
- **Documentation**: [docs/pallet-bridge.md](https://github.com/niccoloraspa/sonotxt/blob/master/docs/pallet-bridge.md)
- **Landing page**: [swap.rotko.net/#dev](https://swap.rotko.net/#dev)
