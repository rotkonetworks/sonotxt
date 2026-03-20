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
    function dispatchPallet(bytes calldata scaleCallData) external payable returns (bool success) {
        require(scaleCallData.length > 0, "empty call");

        (success, ) = RUNTIME_PALLETS.call{value: msg.value}(scaleCallData);

        emit PalletDispatched(msg.sender, success, scaleCallData.length);
    }

    /// @notice Convenience: dispatch and revert on failure
    function dispatchPalletOrRevert(bytes calldata scaleCallData) external payable {
        (bool success, ) = RUNTIME_PALLETS.call{value: msg.value}(scaleCallData);
        require(success, "pallet dispatch failed");
        emit PalletDispatched(msg.sender, true, scaleCallData.length);
    }
}
