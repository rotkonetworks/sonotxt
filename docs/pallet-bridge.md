# Solidity-to-Substrate Pallet Bridge (AssetSwap)

A permissionless composability bridge that enables any Solidity contract on Polkadot Asset Hub (pallet-revive) to call any Substrate pallet dispatchable. The bridge accepts SCALE-encoded call data from the frontend — which has access to the runtime metadata via PAPI — and forwards it to the runtime's `RUNTIME_PALLETS_ADDR`. Because no SCALE encoding is stored on-chain, the bridge is inherently runtime-upgrade safe: pallet indices can change between upgrades without redeploying the contract.

This is the first demonstrated Solidity-to-Substrate pallet composability on pallet-revive.

## Contract Addresses

| Network           | Address                                      | Status    |
|-------------------|----------------------------------------------|-----------|
| Paseo Asset Hub   | `0xbb5a441bfce51c5b1fd5cd603b87c9787a8ba7b7` | Deployed  |
| Polkadot Asset Hub| TBD                                          | Planned   |

## How It Works

```
                         Frontend (PAPI + viem)
                                 |
                    1. Encode pallet call as SCALE bytes
                       using runtime metadata (PAPI)
                                 |
                    2. Call AssetSwap.dispatchPallet(scaleBytes)
                       via Revive.call extrinsic
                                 |
                                 v
                    +---------------------------+
                    |  AssetSwap Contract        |
                    |  (Solidity / pallet-revive)|
                    +---------------------------+
                                 |
                    3. call(RUNTIME_PALLETS_ADDR, scaleBytes)
                       low-level EVM call
                                 |
                                 v
                    +---------------------------+
                    |  RUNTIME_PALLETS_ADDR      |
                    |  0x3951...b258             |
                    |  (pallet-revive gateway)   |
                    +---------------------------+
                                 |
                    4. Runtime decodes SCALE bytes
                       and dispatches the pallet call
                       with the contract's origin
                                 |
                                 v
                    +---------------------------+
                    |  Target Pallet             |
                    |  (e.g., AssetConversion,   |
                    |   Assets, System, etc.)    |
                    +---------------------------+
```

## Usage from Solidity

Call any pallet through the bridge by passing SCALE-encoded call data:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./AssetSwap.sol";

contract MyDeFi {
    AssetSwap public bridge;

    constructor(address _bridge) {
        bridge = AssetSwap(_bridge);
    }

    /// @notice Execute a swap via AssetConversion pallet.
    ///   The SCALE-encoded call data is provided by the frontend.
    function swapViaPool(bytes calldata scaleEncodedSwap) external {
        bridge.dispatchPalletOrRevert(scaleEncodedSwap);
    }

    /// @notice Execute any pallet call (non-reverting variant)
    function tryPalletCall(bytes calldata scaleData) external returns (bool) {
        return bridge.dispatchPallet(scaleData);
    }
}
```

Or call `RUNTIME_PALLETS_ADDR` directly without the bridge contract:

```solidity
address constant RUNTIME_PALLETS = 0x3951D3C715247994d47D9382969cd0082967b258;

function directPalletCall(bytes calldata scaleData) external {
    (bool success, ) = RUNTIME_PALLETS.call(scaleData);
    require(success, "pallet dispatch failed");
}
```

## Usage from Frontend (PAPI + viem)

The frontend encodes the pallet call using PAPI (which has the full runtime metadata), then submits it through viem or directly via a `Revive.call` extrinsic.

```typescript
import { createClient, Binary } from 'polkadot-api'
import { getWsProvider } from 'polkadot-api/ws'
import { connectInjectedExtension } from 'polkadot-api/pjs-signer'
import { paseo_ah } from '@polkadot-api/descriptors'
import { encodeFunctionData } from 'viem'

const SUBSTRATE_RPC = 'wss://asset-hub-paseo.dotters.network/'
const BRIDGE_ADDRESS = '0xbb5a441bfce51c5b1fd5cd603b87c9787a8ba7b7'

// Step 1: Encode the pallet call as SCALE bytes using PAPI
const client = createClient(getWsProvider(SUBSTRATE_RPC))
const api = client.getTypedApi(paseo_ah)

// Example: AssetConversion.swap_exact_tokens_for_tokens
const swapCall = api.tx.AssetConversion.swap_exact_tokens_for_tokens({
  path: [
    { parents: 1, interior: { Here: undefined } },                     // DOT
    { parents: 0, interior: { X2: [{ PalletInstance: 50 }, { GeneralIndex: 1984n }] } }, // USDT
  ],
  amount_in: 1_000_000_000_000_000_000n, // 1 DOT
  amount_out_min: 0n,
  send_to: '5GrwvaEF...', // recipient
  keep_alive: true,
})

// Get the SCALE-encoded call data (just the call, not the full extrinsic)
const scaleBytes = swapCall.getEncodedData()

// Step 2: Call the bridge contract via Revive.call
const ext = await connectInjectedExtension('polkadot-js')
const accounts = ext.getAccounts()
const signer = accounts[0]

// Encode the Solidity function call
const evmCallData = encodeFunctionData({
  abi: [{
    type: 'function',
    name: 'dispatchPalletOrRevert',
    inputs: [{ name: 'scaleCallData', type: 'bytes' }],
    outputs: [],
    stateMutability: 'nonpayable',
  }],
  functionName: 'dispatchPalletOrRevert',
  args: [scaleBytes.asHex()],
})

// Submit via Revive.call extrinsic
const tx = api.tx.Revive.call({
  dest: Binary.fromHex(BRIDGE_ADDRESS),
  value: 0n,
  weight_limit: { ref_time: 500_000_000_000n, proof_size: 500_000n },
  storage_deposit_limit: 1_000_000_000_000n,
  data: Binary.fromHex(evmCallData),
})

await tx.signAndSubmit(signer.polkadotSigner)
client.destroy()
```

## Usage from Rust Contracts

Rust contracts compiled for pallet-revive (via `revive_build`) can call the bridge using the `call` host function, which performs a cross-contract EVM call:

```rust
// The RUNTIME_PALLETS_ADDR can be called directly from Rust contracts
// using the pallet-revive `call` host function.
//
// The scale_call_data must be SCALE-encoded pallet call bytes,
// which can be constructed at compile time or passed in from the caller.

#[ink::contract]
mod my_contract {
    const RUNTIME_PALLETS: [u8; 20] = hex!("3951D3C715247994d47D9382969cd0082967b258");

    #[ink(message)]
    pub fn dispatch_pallet(&self, scale_call_data: Vec<u8>) -> bool {
        // Low-level call to RUNTIME_PALLETS_ADDR
        let result = self.env().call_runtime(&scale_call_data);
        result.is_ok()
    }
}
```

Note: The exact API depends on the Rust contract framework used (ink!, Solang, or raw pallet-revive host functions). The key point is that `RUNTIME_PALLETS_ADDR` is callable from any contract, regardless of language.

## How RUNTIME_PALLETS_ADDR Is Computed

The address `0x3951D3C715247994d47D9382969cd0082967b258` is derived deterministically from the pallet-revive configuration:

```
PalletId = *b"py/paddr"    (8 bytes)

Account derivation (Substrate AccountId32):
  blake2b_256(b"modl" ++ b"py/paddr" ++ [0u8; 24])

EVM address (H160) = first 20 bytes of the AccountId32:
  blake2b_256(b"modl" ++ b"py/paddr" ++ [0u8; 24])[:20]
  = 0x3951D3C715247994d47D9382969cd0082967b258
```

This address is deterministic and identical across all pallet-revive deployments that use the standard `PalletId(*b"py/paddr")` configuration.

To verify in Python:

```python
from hashlib import blake2b

preimage = b"modl" + b"py/paddr" + bytes(24)
digest = blake2b(preimage, digest_size=32).digest()
evm_address = "0x" + digest[:20].hex()
# => 0x3951d3c715247994d47d9382969cd0082967b258
```

## Security Considerations

1. **Origin is the contract, not the user.** Pallet calls dispatched through the bridge execute with the contract's Substrate origin (the contract's mapped AccountId), not the end user's origin. Pallets that check `ensure_signed(origin)` will see the contract address, not the user who initiated the transaction.

2. **Permissionless dispatch.** The bridge imposes no access control on which pallet calls can be dispatched. Any caller can invoke any pallet extrinsic. This is by design — the bridge is a public good primitive. Access control should be implemented in the calling contract if needed.

3. **No SCALE stored on-chain.** The SCALE-encoded call data is passed through as calldata and never stored in contract storage. This means runtime upgrades that change pallet indices do not break the bridge — the frontend simply re-encodes with the new metadata.

4. **Call data validation.** The bridge does not validate the SCALE payload beyond checking it is non-empty. If the SCALE bytes are malformed, the runtime will reject the dispatch and the call will fail (returning `success = false` or reverting, depending on which function was called).

5. **Value transfer.** The bridge does not forward `msg.value`. If a pallet call requires a deposit or value transfer, the contract must hold sufficient balance. The contract's mapped account must be funded separately.

6. **Governance integration.** For governance-controlled pallet calls, the `SonoGovernance` contract demonstrates an intent-hash pattern: the proposal commits to a semantic intent (pallet name, call name, parameters) rather than a specific SCALE encoding. At execution time, anyone provides the fresh SCALE encoding from current metadata, and the contract verifies it matches the voted intent. See `SonoGovernance.proposePalletCall()` and `executePalletProposal()`.

## Full Solidity Source: AssetSwap.sol

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AssetSwap — Composability bridge from pallet-revive to AssetConversion
/// @notice Calls the RUNTIME_PALLETS_ADDR to dispatch AssetConversion extrinsics
///   from within a smart contract. This enables atomic compose of EVM contracts
///   with native Substrate pallets on Asset Hub.
///
///   The SCALE-encoded call data is passed from the frontend (which has the metadata)
///   to avoid hardcoding pallet indices that may change on runtime upgrades.
///
///   Usage from Solidity:
///     AssetSwap(swapContract).dispatchPallet(scaleEncodedCall);
///
///   Usage from frontend:
///     1. PAPI encodes AssetConversion.swap_exact_tokens_for_tokens as SCALE bytes
///     2. Frontend calls this contract with the encoded bytes
///     3. Contract forwards to RUNTIME_PALLETS_ADDR
///     4. Runtime executes the pallet call with the contract's origin

contract AssetSwap {
    /// @notice The RUNTIME_PALLETS_ADDR — gateway for calling Substrate pallet dispatchables.
    ///   Computed from PalletId(*b"py/paddr").into_account_truncating()
    ///   This address is deterministic and the same across all pallet-revive runtimes.
    /// blake2b_256(b"modl" + b"py/paddr" + [0u8; 24])[:20]
    address public constant RUNTIME_PALLETS = 0x3951D3C715247994d47D9382969cd0082967b258;

    event PalletDispatched(address indexed caller, bool success, uint256 dataLength);

    /// @notice Dispatch a SCALE-encoded pallet call through the runtime gateway.
    /// @param scaleCallData The SCALE-encoded extrinsic call (e.g., AssetConversion.swap)
    /// @return success Whether the pallet call succeeded
    function dispatchPallet(bytes calldata scaleCallData) external returns (bool success) {
        require(scaleCallData.length > 0, "empty call");

        (success, ) = RUNTIME_PALLETS.call(scaleCallData);

        emit PalletDispatched(msg.sender, success, scaleCallData.length);
    }

    /// @notice Convenience: dispatch and revert on failure
    function dispatchPalletOrRevert(bytes calldata scaleCallData) external {
        (bool success, ) = RUNTIME_PALLETS.call(scaleCallData);
        require(success, "pallet dispatch failed");
        emit PalletDispatched(msg.sender, true, scaleCallData.length);
    }
}
```
