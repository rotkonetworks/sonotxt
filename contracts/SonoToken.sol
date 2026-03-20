// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SONO — sonotxt marketplace token (upgradeable via ERC1967 proxy)
/// @notice Single-token design: SONO is the utility token, governance token, and
///   value-accrual mechanism. No intermediate credit token.
///
///   Economic flow:
///   1. Users buy SONO with DOT or stablecoins (USDC, USDT)
///   2. Users open payment channel to a provider, locking SONO
///   3. Provider delivers inference off-chain, signs receipts
///   4. Settlement splits spent SONO:
///      - Provider receives (100% - platformCut) — their earnings
///      - Platform cut (default 20%):
///        - 90% burned (permanent supply reduction)
///        - 10% to staker reward pool
///
///   Example: $10 inference (1000 SONO at $0.01), 20% platform cut:
///     Provider:  800 SONO ($8.00) — sell for DOT/USDT or restake
///     Burned:    180 SONO ($1.80) — permanent deflation
///     Stakers:    20 SONO ($0.20) — staking yield
///
///   Staking:
///   - Stake SONO to earn share of settlement fees
///   - Providers must stake minimum SONO to register
///   - More usage → more burns → less supply → SONO appreciates
///   - Single token: stake what you earn, earn what you stake
///
///   Price displayed in USD, settled in SONO. Users see "$0.16 for 10k chars"
///   and the wallet handles the conversion. Like ETH gas.

/// Known precompile addresses (pallet-assets ERC20):
///   USDC  (asset 1337):     0x0000053900000000000000000000000001200000
///   USDT  (asset 1984):     0x000007c000000000000000000000000001200000

/// @dev Minimal ERC20 interface for calling pallet-assets precompiles
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

contract SonoToken {
    string public constant name = "sonotxt";
    string public constant symbol = "SONO";
    uint8 public constant decimals = 10;

    // ===================== V1 Storage (DO NOT REORDER) =====================
    address public owner;
    uint256 public totalSupply;
    uint256 public disputePeriod;
    bool public paused;
    bool private _initialized;
    bool private _reentrancyLock;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    struct PayToken {
        bool accepted;
        uint8 tokenDecimals;
        uint256 sonoPerToken; // how many SONO per 1 full token unit
    }

    mapping(address => PayToken) public payTokens;
    address[] public payTokenList;
    uint256 public sonoPerDot; // how many SONO (10 dec) per 1 DOT (18 dec)

    struct Channel {
        uint256 deposit;
        uint256 spent;
        uint64  nonce;
        uint64  expiresAt;
    }

    mapping(bytes32 => Channel) public channels;

    // ===================== V2 Storage =====================

    address public treasury;
    uint16 public burnBps;          // burn % of platform cut (default 9000 = 90%)
    uint256 public totalBurned;

    // Staking uses internal balances (same token)
    mapping(address => uint256) public staked;
    uint256 public totalStaked;
    uint256 public treasuryPool;    // accumulated SONO for staker claims
    uint256 public rewardPerTokenStored;
    mapping(address => uint256) public userRewardPerToken;
    mapping(address => uint256) public rewards;

    /// Registered inference providers
    struct Provider {
        bool registered;
        uint256 stakedAtRegistration;
        uint256 totalServed;
    }
    mapping(address => Provider) public providers;
    uint256 public minProviderStake;

    /// On-chain price commitments
    mapping(bytes32 => bool) public priceCommitments;

    address public governance;
    mapping(address => uint64) public unstakeLockUntil;
    bool private _v2Initialized;

    /// @notice Dedicated oracle address — can only call setDotPrice.
    ///   Separate from owner so governance can own the contract
    ///   while the oracle updates prices in real-time.
    address public oracle;

    // ===================== V3 Storage =====================

    /// Protocol fee on purchases in bps (default 100 = 1%)
    uint16 public protocolFeeBps;

    /// Accumulated protocol fees per payment token
    mapping(address => uint256) public protocolFees;

    /// SONO price in USDT micro-units (6 dec). 10000 = $0.01
    uint256 public sonoPriceUsdt;

    /// Platform cut from settlements in bps (default 2000 = 20%)
    uint16 public platformCutBps;

    /// Cumulative SONO paid to providers
    uint256 public totalProviderEarnings;

    /// @notice Model offerings: provider → modelId → price per 1000 units (in SONO, 10 dec)
    ///   modelId is bytes32: keccak256 of model name (e.g. keccak256("qwen3-tts"))
    ///   price 0 = model not offered by this provider
    mapping(address => mapping(bytes32 => uint256)) public modelPrice;

    /// @notice Model list per provider (for enumeration)
    mapping(address => bytes32[]) public providerModels;

    /// @notice Global model registry: modelId → human-readable name
    mapping(bytes32 => string) public modelNames;

    bool private _v3Initialized;

    // ===================== Events =====================

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event ChannelOpened(address indexed user, address indexed service, uint256 deposit);
    event ChannelToppedUp(address indexed user, address indexed service, uint256 added, uint256 total);
    event ChannelClosing(bytes32 indexed channelId, address indexed initiator, uint256 spent, uint64 expiresAt);
    event ChannelSettled(bytes32 indexed channelId, address indexed user, address indexed service, uint256 spent, uint256 refunded);
    event ChannelDisputed(bytes32 indexed channelId, uint256 newSpent, uint64 newNonce);
    event TokenRateUpdated(address indexed token, uint256 sonoPerToken);
    event BoughtWithToken(address indexed buyer, address indexed token, uint256 tokenAmount, uint256 sonoAmount);
    event SonoBurned(uint256 burned, uint256 newTotalBurned);
    event ProtocolFeeCollected(address indexed token, uint256 amount);
    event ProviderPaid(address indexed provider, uint256 amount);
    event Staked(address indexed user, uint256 amount, uint256 total);
    event Unstaked(address indexed user, uint256 amount, uint256 total);
    event ProviderRegistered(address indexed provider, uint256 staked);
    event ProviderUnregistered(address indexed provider, uint256 unstaked);
    event PriceCommitted(address indexed provider, bytes32 indexed priceHash);
    event PriceRevoked(address indexed provider, bytes32 indexed priceHash);
    event RewardClaimed(address indexed user, uint256 amount);
    event TreasuryDistributed(uint256 amount, uint256 rewardPerToken);
    event ModelRegistered(bytes32 indexed modelId, string name);
    event ModelPriceSet(address indexed provider, bytes32 indexed modelId, uint256 pricePerKUnit);

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

    function initialize(uint256 initialSupply) external {
        require(!_initialized, "already initialized");
        _initialized = true;
        owner = msg.sender;
        disputePeriod = 1 hours;
        _mint(msg.sender, initialSupply);
    }

    function initializeV2(address _treasury) external onlyOwner {
        require(!_v2Initialized, "v2 already initialized");
        _v2Initialized = true;
        treasury = _treasury;
        burnBps = 9000;
        minProviderStake = 1000 * 1e10; // 1000 SONO
    }

    function initializeV3(
        uint256 _sonoPriceUsdt,
        uint16 _protocolFeeBps,
        uint16 _platformCutBps,
        address _usdc,
        address _usdt
    ) external onlyOwner {
        require(!_v3Initialized, "v3 already initialized");
        require(_sonoPriceUsdt > 0, "zero price");
        require(_protocolFeeBps <= 500, "max 5%");
        require(_platformCutBps <= 5000, "max 50%");
        _v3Initialized = true;

        sonoPriceUsdt = _sonoPriceUsdt;
        protocolFeeBps = _protocolFeeBps;
        platformCutBps = _platformCutBps;

        // Set stablecoin rates: sonoPerStable = 1e16 / sonoPriceUsdt
        uint256 sonoPerStable = 1e16 / _sonoPriceUsdt;
        _setTokenRate(_usdc, sonoPerStable, 6);
        _setTokenRate(_usdt, sonoPerStable, 6);
    }

    // ===================== Buy SONO =====================
    // DOT→SONO: use AssetConversion pool directly (on-chain AMM, no oracle)
    // USDT/USDC→SONO: fixed rate below (deterministic, no oracle)

    /// @notice Buy SONO with any accepted ERC20 token (USDC, USDT)
    function buyWithToken(address token, uint256 amount) external whenNotPaused nonReentrant {
        PayToken storage pt = payTokens[token];
        require(pt.accepted, "token not accepted");
        require(pt.sonoPerToken > 0, "rate not set");
        require(amount > 0, "zero amount");

        uint256 fee = protocolFeeBps > 0 ? amount * protocolFeeBps / 10000 : 0;
        uint256 netAmount = amount - fee;
        uint256 sonoAmount = netAmount * pt.sonoPerToken / (10 ** pt.tokenDecimals);
        require(sonoAmount > 0, "amount too small");
        require(balanceOf[owner] >= sonoAmount, "insufficient reserve");

        bool ok = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(ok, "token transfer failed");

        if (fee > 0) {
            protocolFees[token] += fee;
            emit ProtocolFeeCollected(token, fee);
        }

        balanceOf[owner] -= sonoAmount;
        balanceOf[msg.sender] += sonoAmount;
        emit Transfer(owner, msg.sender, sonoAmount);
        emit BoughtWithToken(msg.sender, token, netAmount, sonoAmount);
    }

    // sellForDot removed — use AssetConversion pool (SONO→DOT swap) instead.
    // No admin-controlled price, no reserve risk. The AMM IS the market.

    // ===================== Staking =====================

    /// @notice Stake SONO to earn share of settlement fees.
    ///   Same token — no external transfer, just internal accounting.
    function stake(uint256 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "zero amount");
        require(balanceOf[msg.sender] >= amount, "insufficient balance");

        _updateReward(msg.sender);

        balanceOf[msg.sender] -= amount;
        staked[msg.sender] += amount;
        totalStaked += amount;
        emit Transfer(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount, staked[msg.sender]);
        _notifyGovernance(msg.sender);
    }

    /// @notice Unstake SONO.
    function unstake(uint256 amount) external nonReentrant {
        require(amount > 0, "zero amount");
        require(staked[msg.sender] >= amount, "insufficient stake");
        require(block.timestamp >= unstakeLockUntil[msg.sender], "locked by governance vote");

        if (providers[msg.sender].registered) {
            require(staked[msg.sender] - amount >= minProviderStake, "would drop below provider minimum");
        }

        _updateReward(msg.sender);

        staked[msg.sender] -= amount;
        totalStaked -= amount;
        balanceOf[msg.sender] += amount;
        emit Transfer(address(this), msg.sender, amount);
        emit Unstaked(msg.sender, amount, staked[msg.sender]);
        _notifyGovernance(msg.sender);
    }

    /// @notice Claim accumulated SONO rewards from staking
    function claimRewards() external nonReentrant {
        _updateReward(msg.sender);
        uint256 reward = rewards[msg.sender];
        require(reward > 0, "nothing to claim");
        rewards[msg.sender] = 0;
        treasuryPool -= reward;
        balanceOf[msg.sender] += reward;
        emit Transfer(address(this), msg.sender, reward);
        emit RewardClaimed(msg.sender, reward);
    }

    function pendingRewards(address user) external view returns (uint256) {
        uint256 pending = rewards[user];
        if (staked[user] > 0) {
            pending += staked[user] * (rewardPerTokenStored - userRewardPerToken[user]) / 1e18;
        }
        return pending;
    }

    // ===================== Provider Registry =====================

    function registerProvider() external whenNotPaused {
        require(!providers[msg.sender].registered, "already registered");
        require(staked[msg.sender] >= minProviderStake, "insufficient stake");
        providers[msg.sender] = Provider({
            registered: true,
            stakedAtRegistration: staked[msg.sender],
            totalServed: 0
        });
        emit ProviderRegistered(msg.sender, staked[msg.sender]);
    }

    function unregisterProvider() external {
        require(providers[msg.sender].registered, "not registered");
        uint256 s = providers[msg.sender].stakedAtRegistration;
        delete providers[msg.sender];
        emit ProviderUnregistered(msg.sender, s);
    }

    function commitPrice(bytes32 priceHash) external {
        require(providers[msg.sender].registered, "not a provider");
        priceCommitments[priceHash] = true;
        emit PriceCommitted(msg.sender, priceHash);
    }

    function revokePrice(bytes32 priceHash) external {
        require(providers[msg.sender].registered, "not a provider");
        require(priceCommitments[priceHash], "not committed");
        priceCommitments[priceHash] = false;
        emit PriceRevoked(msg.sender, priceHash);
    }

    function verifyPrice(bytes32 priceHash) external view returns (bool) {
        return priceCommitments[priceHash];
    }

    // ===================== Model Registry =====================

    /// @notice Register a model name globally. Anyone can call (first-come naming).
    function registerModel(bytes32 modelId, string calldata modelName) external {
        require(bytes(modelNames[modelId]).length == 0, "model already named");
        require(bytes(modelName).length > 0, "empty name");
        modelNames[modelId] = modelName;
        emit ModelRegistered(modelId, modelName);
    }

    /// @notice Owner can override a model name (fix squatting/abuse)
    function setModelName(bytes32 modelId, string calldata modelName) external onlyOwner {
        modelNames[modelId] = modelName;
        emit ModelRegistered(modelId, modelName);
    }

    /// @notice Provider sets their price for a model. 0 = stop offering.
    ///   pricePerKUnit is SONO per 1000 inference units (chars for TTS, tokens for LLM).
    function setModelPrice(bytes32 modelId, uint256 pricePerKUnit) external {
        require(providers[msg.sender].registered, "not a provider");
        require(modelId != bytes32(0), "invalid model");
        if (modelPrice[msg.sender][modelId] == 0 && pricePerKUnit > 0) {
            // New model offering
            providerModels[msg.sender].push(modelId);
        }
        modelPrice[msg.sender][modelId] = pricePerKUnit;
        emit ModelPriceSet(msg.sender, modelId, pricePerKUnit);
    }

    /// @notice Get number of models offered by a provider
    function providerModelCount(address provider) external view returns (uint256) {
        return providerModels[provider].length;
    }

    /// @notice Get a provider's model at index
    function providerModelAt(address provider, uint256 index) external view returns (bytes32 modelId, uint256 price) {
        require(index < providerModels[provider].length, "out of bounds");
        modelId = providerModels[provider][index];
        price = modelPrice[provider][modelId];
    }

    // ===================== Admin =====================

    // setDotPrice removed — no oracle needed. Price discovery via AssetConversion pool.
    // setOracle removed — no oracle role needed.

    function setTokenRate(address token, uint256 rate, uint8 tokenDec) external onlyOwner {
        _setTokenRate(token, rate, tokenDec);
    }

    function setSonoPriceUsdt(uint256 _price, address _usdc, address _usdt) external onlyOwner {
        require(_price > 0, "zero price");
        sonoPriceUsdt = _price;
        uint256 sonoPerStable = 1e16 / _price;
        payTokens[_usdc].sonoPerToken = sonoPerStable;
        payTokens[_usdt].sonoPerToken = sonoPerStable;
    }

    function removeToken(address token) external onlyOwner {
        payTokens[token].accepted = false;
        payTokens[token].sonoPerToken = 0;
    }

    function setDisputePeriod(uint256 period) external onlyOwner { disputePeriod = period; }
    function transferOwnership(address newOwner) external onlyOwner { require(newOwner != address(0)); owner = newOwner; }
    function setTreasury(address _treasury) external onlyOwner { require(_treasury != address(0)); treasury = _treasury; }
    function setBurnBps(uint16 _bps) external onlyOwner { require(_bps <= 10000); burnBps = _bps; }
    function setMinProviderStake(uint256 _min) external onlyOwner { minProviderStake = _min; }
    function setGovernance(address _gov) external onlyOwner { governance = _gov; }
    function setProtocolFeeBps(uint16 _bps) external onlyOwner { require(_bps <= 500); protocolFeeBps = _bps; }
    function setPlatformCutBps(uint16 _bps) external onlyOwner { require(_bps <= 5000); platformCutBps = _bps; }
    function setPaused(bool _paused) external onlyOwner { paused = _paused; }

    // withdrawDot removed — contract no longer holds DOT reserves

    /// @notice Withdraw ERC20 tokens — only protocol fees, not user deposits.
    function withdrawToken(address token, uint256 amount) external onlyOwner {
        // Prevent draining user deposits — only allow withdrawing collected protocol fees
        require(amount <= protocolFees[token], "exceeds protocol fees");
        protocolFees[token] -= amount;
        bool ok = IERC20(token).transfer(owner, amount);
        require(ok, "transfer failed");
    }

    // withdrawProtocolFees merged into withdrawToken above

    // depositDot removed — contract no longer needs DOT reserves

    function lockForVote(address voter, uint64 unlockAt) external {
        require(msg.sender == governance, "not governance");
        if (unlockAt > unstakeLockUntil[voter]) unstakeLockUntil[voter] = unlockAt;
    }

    // ===================== ERC20 =====================

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance exceeded");
        allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    // ===================== Payment Channels =====================

    function openChannel(address service, uint256 amount) external whenNotPaused {
        require(service != address(0) && service != msg.sender, "bad service");
        require(amount > 0, "zero deposit");
        bytes32 id = channelId(msg.sender, service);
        require(channels[id].deposit == 0, "channel exists");
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        channels[id] = Channel(amount, 0, 0, 0);
        emit Transfer(msg.sender, address(this), amount);
        emit ChannelOpened(msg.sender, service, amount);
    }

    function topUp(address service, uint256 amount) external whenNotPaused {
        bytes32 id = channelId(msg.sender, service);
        Channel storage ch = channels[id];
        require(ch.deposit > 0, "no channel");
        require(ch.expiresAt == 0, "channel closing");
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        ch.deposit += amount;
        emit Transfer(msg.sender, address(this), amount);
        emit ChannelToppedUp(msg.sender, service, amount, ch.deposit);
    }

    function cooperativeClose(address user, uint256 spent, uint64 nonce, bytes calldata sig) external {
        bytes32 id = channelId(user, msg.sender);
        Channel storage ch = channels[id];
        require(ch.deposit > 0, "no channel");
        require(spent <= ch.deposit, "overspend");
        bytes32 stateHash = keccak256(abi.encode(
            address(this), block.chainid, "cooperativeClose", id, spent, nonce
        ));
        require(_recover(stateHash, sig) == user, "bad signature");
        _settle(id, user, msg.sender, spent);
    }

    function userClose(address service) external {
        bytes32 id = channelId(msg.sender, service);
        Channel storage ch = channels[id];
        require(ch.deposit > 0, "no channel");
        require(ch.expiresAt == 0, "already closing");
        ch.expiresAt = uint64(block.timestamp) + uint64(disputePeriod);
        emit ChannelClosing(id, msg.sender, ch.spent, ch.expiresAt);
    }

    /// @notice Either party can initiate close with the counterparty's signature.
    ///   The caller specifies the channel roles explicitly.
    function initiateClose(address user, address service, uint256 spent, uint64 nonce, bytes calldata sig) external {
        require(msg.sender == user || msg.sender == service, "not a party");
        address counterparty = msg.sender == user ? service : user;
        bytes32 id = channelId(user, service);
        Channel storage ch = channels[id];
        require(ch.deposit > 0, "no channel");
        require(spent <= ch.deposit, "overspend");
        require(nonce > ch.nonce, "stale nonce");
        bytes32 stateHash = keccak256(abi.encode(
            address(this), block.chainid, "initiateClose", id, spent, nonce
        ));
        require(_recover(stateHash, sig) == counterparty, "bad signature");
        ch.spent = spent;
        ch.nonce = nonce;
        ch.expiresAt = uint64(block.timestamp) + uint64(disputePeriod);
        emit ChannelClosing(id, msg.sender, spent, ch.expiresAt);
    }

    function dispute(
        address user, address service, uint256 spent, uint64 nonce,
        bytes calldata userSig, bytes calldata serviceSig
    ) external {
        bytes32 id = channelId(user, service);
        Channel storage ch = channels[id];
        require(ch.expiresAt > 0, "not closing");
        require(block.timestamp < ch.expiresAt, "dispute expired");
        require(nonce > ch.nonce, "not newer");
        require(spent <= ch.deposit, "overspend");
        bytes32 stateHash = keccak256(abi.encode(
            address(this), block.chainid, "dispute", id, spent, nonce
        ));
        require(_recover(stateHash, userSig) == user, "bad user sig");
        require(_recover(stateHash, serviceSig) == service, "bad service sig");
        ch.spent = spent;
        ch.nonce = nonce;
        ch.expiresAt = uint64(block.timestamp) + uint64(disputePeriod);
        emit ChannelDisputed(id, spent, nonce);
    }

    function finalize(address user, address service) external {
        bytes32 id = channelId(user, service);
        Channel storage ch = channels[id];
        require(ch.expiresAt > 0, "not closing");
        require(block.timestamp >= ch.expiresAt, "dispute active");
        _settle(id, user, service, ch.spent);
    }

    // ===================== Views =====================

    function channelId(address user, address service) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(user, service));
    }

    function getChannel(address user, address service) external view returns (
        uint256 deposit, uint256 spent, uint64 nonce, uint64 expiresAt
    ) {
        Channel storage ch = channels[channelId(user, service)];
        return (ch.deposit, ch.spent, ch.nonce, ch.expiresAt);
    }

    // quoteBuyDot removed — quote via AssetConversion.quote_price_exact_tokens_for_tokens()

    function quoteBuyToken(address token, uint256 amount) external view returns (uint256) {
        PayToken storage pt = payTokens[token];
        if (!pt.accepted || pt.sonoPerToken == 0) return 0;
        uint256 net = protocolFeeBps > 0 ? amount - amount * protocolFeeBps / 10000 : amount;
        return net * pt.sonoPerToken / (10 ** pt.tokenDecimals);
    }

    // quoteSellDot removed — quote via AssetConversion

    function availableReserve() external view returns (uint256) { return balanceOf[owner]; }
    function acceptedTokenCount() external view returns (uint256) { return payTokenList.length; }
    function circulatingSupply() external view returns (uint256) { return totalSupply - totalBurned; }

    /// @notice Total SONO locked in staking + treasury pool (for accounting verification)
    function totalLockedInStaking() external view returns (uint256) { return totalStaked + treasuryPool; }

    // ===================== Internal =====================

    /// @notice Settlement: pay provider, burn + distribute from platform cut.
    function _settle(bytes32 id, address user, address service, uint256 spent) internal {
        Channel storage ch = channels[id];
        uint256 refund = ch.deposit - spent;

        if (spent > 0) {
            uint256 providerPayout;
            uint256 platformAmount;

            if (providers[service].registered && platformCutBps > 0) {
                platformAmount = spent * platformCutBps / 10000;
                providerPayout = spent - platformAmount;
                balanceOf[service] += providerPayout;
                providers[service].totalServed += spent;
                totalProviderEarnings += providerPayout;
                emit Transfer(address(this), service, providerPayout);
                emit ProviderPaid(service, providerPayout);
            } else {
                platformAmount = spent;
                if (providers[service].registered) providers[service].totalServed += spent;
            }

            if (platformAmount > 0) {
                uint256 burnAmount = platformAmount * burnBps / 10000;
                uint256 treasuryAmount = platformAmount - burnAmount;

                if (burnAmount > 0) _burn(burnAmount);

                if (treasuryAmount > 0) {
                    if (totalStaked > 0) {
                        rewardPerTokenStored += treasuryAmount * 1e18 / totalStaked;
                        treasuryPool += treasuryAmount;
                        emit TreasuryDistributed(treasuryAmount, rewardPerTokenStored);
                    } else if (treasury != address(0)) {
                        balanceOf[treasury] += treasuryAmount;
                        emit Transfer(address(this), treasury, treasuryAmount);
                    } else {
                        _burn(treasuryAmount);
                    }
                }
            }
        }

        if (refund > 0) {
            balanceOf[user] += refund;
            emit Transfer(address(this), user, refund);
        }
        emit ChannelSettled(id, user, service, spent, refund);
        delete channels[id];
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0), "zero address");
        require(balanceOf[from] >= amount, "insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _burn(uint256 amount) internal {
        totalBurned += amount;
        totalSupply -= amount;
        emit Transfer(address(this), address(0), amount); // ERC20-standard burn
        emit SonoBurned(amount, totalBurned);
    }

    /// @dev Notify governance contract of stake changes (for vote weight eligibility)
    function _notifyGovernance(address user) internal {
        if (governance != address(0)) {
            // Best-effort: don't revert if governance notification fails
            (bool ok,) = governance.call(
                abi.encodeWithSignature("notifyStakeChange(address)", user)
            );
            // Silence unused variable warning
            ok;
        }
    }

    function _updateReward(address user) internal {
        if (staked[user] > 0 && rewardPerTokenStored > userRewardPerToken[user]) {
            rewards[user] += staked[user] * (rewardPerTokenStored - userRewardPerToken[user]) / 1e18;
        }
        userRewardPerToken[user] = rewardPerTokenStored;
    }

    function _setTokenRate(address token, uint256 rate, uint8 tokenDec) internal {
        if (!payTokens[token].accepted) {
            payTokens[token].accepted = true;
            payTokenList.push(token);
        }
        payTokens[token].sonoPerToken = rate;
        payTokens[token].tokenDecimals = tokenDec;
        emit TokenRateUpdated(token, rate);
    }

    function _recover(bytes32 hash, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65, "bad sig length");
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
        require(signer != address(0), "invalid signature");
        return signer;
    }

    // receive() removed — contract does not accept native DOT
}
