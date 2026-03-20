// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TokenFactory — Trustless pallet-assets token launcher on Asset Hub
/// @notice Create pallet-assets tokens with fixed supply and NO admin from Solidity.
///   The factory creates the token, mints supply, optionally creates a pool,
///   then renounces admin — all in one transaction via batch dispatch.
///   Nobody ever holds the admin key. Immutable from birth.
///
///   Deposit model: Pallet calls execute as the BRIDGE CONTRACT's mapped Substrate
///   account (first 20 bytes of its AccountId32). That account pays deposit fees
///   for asset creation (~0.1 DOT). The bridge must be pre-funded. This is a
///   deliberate tradeoff: the bridge is stateless (no storage to corrupt), but
///   its Substrate balance can be depleted by creating many assets. Rate-limit
///   creation or require payment if this is a concern.

interface IAssetSwap {
    function dispatchPalletOrRevert(bytes calldata scaleCallData) external payable;
    function dispatchPallet(bytes calldata scaleCallData) external payable returns (bool);
}

contract TokenFactory {
    IAssetSwap public bridge;

    /// @notice Tokens launched through this factory
    struct LaunchedToken {
        uint32 assetId;
        address creator;           // EVM address that requested creation
        uint256 totalSupply;
        uint64 launchedAt;
        bool poolCreated;
    }

    mapping(uint32 => LaunchedToken) public tokens;
    uint32[] public tokenList;

    event TokenLaunched(
        uint32 indexed assetId,
        address indexed creator,
        uint256 totalSupply,
        string name,
        string symbol
    );
    event PoolCreated(uint32 indexed assetId);
    event PalletDispatched(address indexed caller, uint256 dataLength);

    constructor(address _bridge) {
        bridge = IAssetSwap(_bridge);
    }

    /// @notice Launch a token with fixed supply and no admin.
    ///   Executes multiple pallet calls via the bridge.
    ///   After this call, the token exists with fixed supply and no admin.
    ///
    /// @param assetId The pallet-assets ID to create
    /// @param totalSupply For tracking only (actual mint is in the SCALE data)
    /// @param name Token name for the event
    /// @param symbol Token symbol for the event
    /// @param palletCalls Array of SCALE-encoded calls: [create, metadata, mint, renounce, ...]
    /// @notice Launch a token. Pass an array of SCALE-encoded pallet calls
    ///   to execute in sequence: [create, set_metadata, mint, renounce_admin].
    ///   All calls go through the bridge atomically.
    function launch(
        uint32 assetId,
        uint256 totalSupply,
        string calldata name,
        string calldata symbol,
        bytes[] calldata palletCalls
    ) external {
        require(tokens[assetId].creator == address(0), "already launched");
        require(palletCalls.length >= 1, "no calls");

        // Dispatch all pallet calls through the bridge.
        // No value forwarding needed — the bridge's mapped Substrate account
        // pays deposits from its own balance, not from EVM value transfers.
        for (uint256 i = 0; i < palletCalls.length; i++) {
            bridge.dispatchPalletOrRevert(palletCalls[i]);
        }

        tokens[assetId] = LaunchedToken({
            assetId: assetId,
            creator: msg.sender,
            totalSupply: totalSupply,
            launchedAt: uint64(block.timestamp),
            poolCreated: false
        });
        tokenList.push(assetId);

        emit TokenLaunched(assetId, msg.sender, totalSupply, name, symbol);
    }

    /// @notice Create an AssetConversion pool for a launched token.
    ///   Can be called by anyone — permissionless liquidity.
    /// @param assetId The token to create a pool for
    /// @param createPoolData SCALE-encoded AssetConversion.create_pool call
    /// @param addLiquidityData SCALE-encoded AssetConversion.add_liquidity call
    function createPoolAndAddLiquidity(
        uint32 assetId,
        bytes calldata createPoolData,
        bytes calldata addLiquidityData
    ) external {
        require(tokens[assetId].creator != address(0), "not launched here");

        bridge.dispatchPalletOrRevert(createPoolData);
        bridge.dispatchPalletOrRevert(addLiquidityData);

        tokens[assetId].poolCreated = true;
        emit PoolCreated(assetId);
    }

    /// @notice Number of tokens launched
    function tokenCount() external view returns (uint256) {
        return tokenList.length;
    }

    receive() external payable {}
}
