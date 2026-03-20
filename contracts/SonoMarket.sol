// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SonoMarket — sonotxt inference marketplace
/// @notice Multi-token payment channels + SONO governance.
///
///   Channels accept DOT (native), USDT, or USDC — provider's choice.
///   Settlement pays provider in the channel's token.
///   Platform cut auto-swaps to SONO via AssetConversion and burns.
///   SONO is a pallet-assets token (not minted by this contract).
///
///   No intermediate token. No oracle. No admin price feed.

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IAssetSwap {
    function dispatchPalletOrRevert(bytes calldata scaleCallData) external payable;
}

contract SonoMarket {
    address public owner;
    bool public paused;
    bool private _initialized;
    bool private _reentrancyLock;
    uint256 public disputePeriod;

    // SONO pallet-assets ERC20 precompile (for staking + burns)
    address public sonoToken;
    address public constant BURN_ADDRESS = address(0xdead);

    // AssetSwap bridge for pallet composability
    address public assetSwapBridge;

    // ===================== Staking (SONO via precompile) =====================

    mapping(address => uint256) public staked;
    uint256 public totalStaked;
    uint256 public minProviderStake;

    // Governance
    address public governance;
    mapping(address => uint64) public unstakeLockUntil;

    // ===================== Provider Registry =====================

    struct Provider {
        bool registered;
        uint256 totalServed;    // cumulative value served (in any token)
    }
    mapping(address => Provider) public providers;

    // Provider token preferences: provider → token → accepted
    // address(0) = native DOT
    mapping(address => mapping(address => bool)) public providerAcceptsToken;

    // Model registry
    mapping(address => mapping(bytes32 => uint256)) public modelPrice;
    mapping(address => bytes32[]) public providerModels;
    mapping(bytes32 => string) public modelNames;

    // ===================== Payment Channels =====================

    struct Channel {
        address token;      // address(0) = DOT, or ERC20 precompile address
        uint256 deposit;
        uint256 spent;
        uint64 nonce;
        uint64 expiresAt;
    }
    mapping(bytes32 => Channel) public channels;

    // ===================== Platform Economics =====================

    uint16 public platformCutBps;   // default 2000 = 20%
    uint16 public burnBps;          // % of platform cut to burn (default 9000 = 90%)

    // Accumulated platform fees per token (for manual SONO buyback if auto fails)
    mapping(address => uint256) public platformFees;
    uint256 public totalBurned;

    // ===================== Events =====================

    event ChannelOpened(address indexed user, address indexed service, address token, uint256 deposit);
    event ChannelToppedUp(address indexed user, address indexed service, uint256 added, uint256 total);
    event ChannelClosing(bytes32 indexed channelId, address indexed initiator, uint256 spent, uint64 expiresAt);
    event ChannelSettled(bytes32 indexed channelId, address indexed user, address indexed service, uint256 spent, uint256 refunded);
    event ChannelDisputed(bytes32 indexed channelId, uint256 newSpent, uint64 newNonce);
    event ProviderPaid(address indexed provider, address token, uint256 amount);
    event SonoBurned(uint256 amount, uint256 newTotalBurned);
    event PlatformFeeCollected(address indexed token, uint256 amount);
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event ProviderRegistered(address indexed provider);
    event ProviderTokenSet(address indexed provider, address token, bool accepted);
    event ModelPriceSet(address indexed provider, bytes32 indexed modelId, uint256 price);

    // ===================== Modifiers =====================

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }
    modifier whenNotPaused() { require(!paused, "paused"); _; }
    modifier nonReentrant() {
        require(!_reentrancyLock, "reentrant");
        _reentrancyLock = true;
        _;
        _reentrancyLock = false;
    }

    constructor() { _initialized = true; }

    function initialize(
        address _sonoToken,
        address _assetSwapBridge,
        uint16 _platformCutBps,
        uint16 _burnBps,
        uint256 _minProviderStake
    ) external {
        require(!_initialized, "already initialized");
        _initialized = true;
        owner = msg.sender;
        disputePeriod = 1 hours;
        sonoToken = _sonoToken;
        assetSwapBridge = _assetSwapBridge;
        platformCutBps = _platformCutBps;
        burnBps = _burnBps;
        minProviderStake = _minProviderStake;
    }

    // ===================== Staking (SONO pallet-assets) =====================

    /// @notice Stake SONO. Calls transferFrom on the pallet-assets precompile.
    function stake(uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "zero");
        bool ok = IERC20(sonoToken).transferFrom(msg.sender, address(this), amount);
        require(ok, "sono transfer failed");
        staked[msg.sender] += amount;
        totalStaked += amount;
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external nonReentrant {
        require(staked[msg.sender] >= amount, "insufficient");
        require(block.timestamp >= unstakeLockUntil[msg.sender], "locked");
        if (providers[msg.sender].registered) {
            require(staked[msg.sender] - amount >= minProviderStake, "below min");
        }
        staked[msg.sender] -= amount;
        totalStaked -= amount;
        bool ok = IERC20(sonoToken).transfer(msg.sender, amount);
        require(ok, "sono transfer failed");
        emit Unstaked(msg.sender, amount);
    }

    // ===================== Provider Registry =====================

    function registerProvider() external whenNotPaused {
        require(!providers[msg.sender].registered, "registered");
        require(staked[msg.sender] >= minProviderStake, "stake more");
        providers[msg.sender] = Provider({ registered: true, totalServed: 0 });
        emit ProviderRegistered(msg.sender);
    }

    function unregisterProvider() external {
        require(providers[msg.sender].registered, "not registered");
        delete providers[msg.sender];
    }

    /// @notice Provider sets which tokens they accept for payment
    function setAcceptedToken(address token, bool accepted) external {
        require(providers[msg.sender].registered, "not provider");
        providerAcceptsToken[msg.sender][token] = accepted;
        emit ProviderTokenSet(msg.sender, token, accepted);
    }

    function setModelPrice(bytes32 modelId, uint256 pricePerKUnit) external {
        require(providers[msg.sender].registered, "not provider");
        require(modelId != bytes32(0), "invalid");
        if (modelPrice[msg.sender][modelId] == 0 && pricePerKUnit > 0) {
            providerModels[msg.sender].push(modelId);
        }
        modelPrice[msg.sender][modelId] = pricePerKUnit;
        emit ModelPriceSet(msg.sender, modelId, pricePerKUnit);
    }

    function registerModel(bytes32 modelId, string calldata modelName) external {
        require(bytes(modelNames[modelId]).length == 0, "named");
        modelNames[modelId] = modelName;
    }

    // ===================== Payment Channels =====================

    /// @notice Open channel with DOT (native token)
    function openChannelDot(address service) external payable whenNotPaused {
        require(msg.value > 0, "zero");
        require(providerAcceptsToken[service][address(0)], "provider rejects DOT");
        _openChannel(msg.sender, service, address(0), msg.value);
    }

    /// @notice Open channel with ERC20 (USDT, USDC)
    function openChannelToken(address service, address token, uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "zero");
        require(providerAcceptsToken[service][token], "provider rejects token");
        bool ok = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(ok, "transfer failed");
        _openChannel(msg.sender, service, token, amount);
    }

    function _openChannel(address user, address service, address token, uint256 amount) internal {
        require(service != address(0) && service != user, "bad service");
        bytes32 id = channelId(user, service);
        require(channels[id].deposit == 0, "exists");
        channels[id] = Channel(token, amount, 0, 0, 0);
        emit ChannelOpened(user, service, token, amount);
    }

    function topUp(address service, uint256 amount) external payable whenNotPaused nonReentrant {
        bytes32 id = channelId(msg.sender, service);
        Channel storage ch = channels[id];
        require(ch.deposit > 0, "no channel");
        require(ch.expiresAt == 0, "closing");

        if (ch.token == address(0)) {
            require(msg.value == amount && amount > 0, "bad value");
        } else {
            require(amount > 0, "zero");
            bool ok = IERC20(ch.token).transferFrom(msg.sender, address(this), amount);
            require(ok, "transfer failed");
        }
        ch.deposit += amount;
        emit ChannelToppedUp(msg.sender, service, amount, ch.deposit);
    }

    // ===================== Channel Close / Dispute =====================

    function cooperativeClose(address user, uint256 spent, uint64 nonce, bytes calldata sig) external {
        bytes32 id = channelId(user, msg.sender);
        Channel storage ch = channels[id];
        require(ch.deposit > 0, "no channel");
        require(spent <= ch.deposit, "overspend");
        bytes32 stateHash = keccak256(abi.encode(
            address(this), block.chainid, "cooperativeClose", id, spent, nonce
        ));
        require(_recover(stateHash, sig) == user, "bad sig");
        _settle(id, user, msg.sender, spent);
    }

    function userClose(address service) external {
        bytes32 id = channelId(msg.sender, service);
        Channel storage ch = channels[id];
        require(ch.deposit > 0, "no channel");
        require(ch.expiresAt == 0, "closing");
        ch.expiresAt = uint64(block.timestamp) + uint64(disputePeriod);
        emit ChannelClosing(id, msg.sender, ch.spent, ch.expiresAt);
    }

    function finalize(address user, address service) external {
        bytes32 id = channelId(user, service);
        Channel storage ch = channels[id];
        require(ch.expiresAt > 0, "not closing");
        require(block.timestamp >= ch.expiresAt, "active");
        _settle(id, user, service, ch.spent);
    }

    // ===================== Settlement =====================

    function _settle(bytes32 id, address user, address service, uint256 spent) internal {
        Channel storage ch = channels[id];
        address token = ch.token;
        uint256 refund = ch.deposit - spent;

        if (spent > 0) {
            uint256 platformAmount = providers[service].registered && platformCutBps > 0
                ? spent * platformCutBps / 10000 : spent;
            uint256 providerPayout = spent - platformAmount;

            // Pay provider in their preferred token
            if (providerPayout > 0) {
                _sendToken(token, service, providerPayout);
                providers[service].totalServed += providerPayout;
                emit ProviderPaid(service, token, providerPayout);
            }

            // Platform cut: accumulate for SONO buyback+burn
            if (platformAmount > 0) {
                platformFees[token] += platformAmount;
                emit PlatformFeeCollected(token, platformAmount);
            }
        }

        if (refund > 0) {
            _sendToken(token, user, refund);
        }

        emit ChannelSettled(id, user, service, spent, refund);
        delete channels[id];
    }

    function _sendToken(address token, address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            require(ok, "DOT transfer failed");
        } else {
            bool ok = IERC20(token).transfer(to, amount);
            require(ok, "token transfer failed");
        }
    }

    // ===================== SONO Buyback + Burn =====================

    /// @notice Anyone can trigger buyback: swap accumulated platform fees for SONO and burn.
    ///   Uses the AssetSwap bridge to call AssetConversion.
    /// @param token Which platform fee token to swap (address(0)=DOT, or USDT/USDC)
    /// @param scaleCallData Fresh SCALE-encoded AssetConversion.swap call from PAPI
    function buybackAndBurn(address token, bytes calldata scaleCallData) external nonReentrant {
        uint256 amount = platformFees[token];
        require(amount > 0, "no fees");
        platformFees[token] = 0;

        uint256 sonoBefore = IERC20(sonoToken).balanceOf(address(this));

        // Approve bridge to spend the token (for ERC20)
        if (token != address(0)) {
            IERC20(token).transfer(assetSwapBridge, amount);
        }

        // Dispatch swap via bridge
        if (token == address(0)) {
            IAssetSwap(assetSwapBridge).dispatchPalletOrRevert{value: amount}(scaleCallData);
        } else {
            IAssetSwap(assetSwapBridge).dispatchPalletOrRevert(scaleCallData);
        }

        // Burn whatever SONO we received
        uint256 sonoAfter = IERC20(sonoToken).balanceOf(address(this));
        uint256 received = sonoAfter - sonoBefore;
        if (received > 0) {
            // Subtract staked SONO so we don't burn it
            uint256 burnable = received;
            IERC20(sonoToken).transfer(BURN_ADDRESS, burnable);
            totalBurned += burnable;
            emit SonoBurned(burnable, totalBurned);
        }
    }

    // ===================== Views =====================

    function channelId(address user, address service) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(user, service));
    }

    function getChannel(address user, address service) external view returns (
        address token, uint256 deposit, uint256 spent, uint64 nonce, uint64 expiresAt
    ) {
        Channel storage ch = channels[channelId(user, service)];
        return (ch.token, ch.deposit, ch.spent, ch.nonce, ch.expiresAt);
    }

    // ===================== Admin =====================

    function setDisputePeriod(uint256 p) external onlyOwner { disputePeriod = p; }
    function setPlatformCutBps(uint16 b) external onlyOwner { require(b <= 5000); platformCutBps = b; }
    function setBurnBps(uint16 b) external onlyOwner { require(b <= 10000); burnBps = b; }
    function setMinProviderStake(uint256 m) external onlyOwner { minProviderStake = m; }
    function setPaused(bool p) external onlyOwner { paused = p; }
    function setGovernance(address g) external onlyOwner { governance = g; }
    function setAssetSwapBridge(address b) external onlyOwner { assetSwapBridge = b; }
    function transferOwnership(address newOwner) external onlyOwner { require(newOwner != address(0)); owner = newOwner; }

    function lockForVote(address voter, uint64 unlockAt) external {
        require(msg.sender == governance, "not governance");
        if (unlockAt > unstakeLockUntil[voter]) unstakeLockUntil[voter] = unlockAt;
    }

    // ===================== Internal =====================

    function _recover(bytes32 hash, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65, "bad sig");
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "invalid s");
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "invalid v");
        bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        address signer = ecrecover(prefixed, v, r, s);
        require(signer != address(0), "invalid sig");
        return signer;
    }

    receive() external payable {}
}
