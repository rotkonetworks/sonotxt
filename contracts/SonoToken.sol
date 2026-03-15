// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TXT — sonotxt utility token (upgradeable via ERC1967 proxy)
/// @notice ERC20 + payment channels + burn-on-spend economics.
///
///   Two-token model:
///   - SONO: governance token, native Asset Hub asset (pallet-assets),
///     accessible in Solidity via ERC20 precompile. Fixed 10M supply.
///   - TXT: utility token (this contract), burned on inference spend.
///
///   Economic flow:
///   1. Users buy TXT with DOT, USDC, USDT, or SONO
///   2. Users open payment channel, locking TXT
///   3. Provider delivers inference off-chain, signs receipts
///   4. Settlement: 90% of spent TXT burned, 10% to staker reward pool
///   5. Providers set their own prices in TXT per service
///
///   SONO staking:
///   - Stakers earn pro-rata share of 10% treasury from all inference spend
///   - Providers stake SONO to register on marketplace
///   - As TXT burns reduce supply, SONO→TXT exchange rate improves naturally

/// Known precompile addresses (pallet-assets ERC20):
///   USDC  (asset 1337):       0x0000053900000000000000000000000001200000
///   USDT  (asset 1984):       0x000007c000000000000000000000000001200000
///   SONO  (asset 50000445): 0x02faf23d00000000000000000000000001200000

/// @dev Minimal ERC20 interface for calling pallet-assets precompiles
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8);
}

contract SonoToken {
    string public constant name = "sonotxt";
    string public constant symbol = "TXT";
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
        uint256 txtPerToken;
    }

    mapping(address => PayToken) public payTokens;
    address[] public payTokenList;
    uint256 public txtPerDot;

    struct Channel {
        uint256 deposit;
        uint256 spent;
        uint64  nonce;
        uint64  expiresAt;
    }

    mapping(bytes32 => Channel) public channels;

    // ===================== V2 Storage (appended for upgrade) =====================

    /// @notice Treasury receives 20% of spent TXT on settlement
    address public treasury;

    /// @notice Burn percentage in basis points (default 8000 = 80%)
    uint16 public burnBps;

    /// @notice Cumulative TXT burned from inference spend
    uint256 public totalBurned;

    /// @notice SONO pallet-assets ERC20 precompile address
    address public sonoToken;

    /// @notice SONO staked per address (users + providers)
    mapping(address => uint256) public sonoStaked;

    /// @notice Total SONO staked across all users
    uint256 public totalSonoStaked;

    /// @notice Accumulated TXT in treasury available for staker claims
    uint256 public treasuryPool;

    /// @notice Cumulative reward per SONO staked (scaled by 1e18 for precision)
    uint256 public rewardPerTokenStored;

    /// @notice Per-user snapshot of rewardPerToken at last claim/stake/unstake
    mapping(address => uint256) public userRewardPerToken;

    /// @notice Per-user unclaimed TXT rewards
    mapping(address => uint256) public rewards;

    /// @notice Registered inference providers
    struct Provider {
        bool registered;
        uint256 staked;        // SONO staked to register
        uint256 totalServed;   // cumulative TXT worth of inference served
    }
    mapping(address => Provider) public providers;

    /// @notice Minimum SONO stake to register as a provider
    uint256 public minProviderStake;

    /// @notice On-chain price commitments: hash → committed
    mapping(bytes32 => bool) public priceCommitments;

    /// @notice Governance contract that can lock stakers during active proposals
    address public governance;

    /// @notice Per-user unstake lock: blocked until this timestamp
    mapping(address => uint64) public unstakeLockUntil;

    /// @notice V2 initialized flag
    bool private _v2Initialized;

    // ===================== Events =====================

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event ChannelOpened(address indexed user, address indexed service, uint256 deposit);
    event ChannelToppedUp(address indexed user, address indexed service, uint256 added, uint256 total);
    event ChannelClosing(bytes32 indexed channelId, address indexed initiator, uint256 spent, uint64 expiresAt);
    event ChannelSettled(bytes32 indexed channelId, address indexed user, address indexed service, uint256 spent, uint256 refunded);
    event ChannelDisputed(bytes32 indexed channelId, uint256 newSpent, uint64 newNonce);
    event DotPriceUpdated(uint256 txtPerDot);
    event TokenRateUpdated(address indexed token, uint256 txtPerToken);
    event BoughtWithDot(address indexed buyer, uint256 dotAmount, uint256 txtAmount);
    event BoughtWithToken(address indexed buyer, address indexed token, uint256 tokenAmount, uint256 txtAmount);
    event SoldForDot(address indexed seller, uint256 txtAmount, uint256 dotAmount);

    // V2 events
    event TxtBurned(uint256 burned, uint256 toTreasury, uint256 newTotalBurned);
    event SonoStaked(address indexed user, uint256 amount, uint256 total);
    event SonoUnstaked(address indexed user, uint256 amount, uint256 total);
    event ProviderRegistered(address indexed provider, uint256 staked);
    event ProviderUnregistered(address indexed provider, uint256 unstaked);
    event PriceCommitted(address indexed provider, bytes32 indexed priceHash);
    event PriceRevoked(address indexed provider, bytes32 indexed priceHash);
    event RewardClaimed(address indexed user, uint256 amount);
    event TreasuryDistributed(uint256 amount, uint256 rewardPerToken);

    // ===================== Modifiers =====================

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "paused");
        _;
    }

    modifier nonReentrant() {
        require(!_reentrancyLock, "reentrant");
        _reentrancyLock = true;
        _;
        _reentrancyLock = false;
    }

    constructor() { _initialized = true; }

    /// @notice V1 Initialize (called once via proxy delegatecall)
    function initialize(uint256 initialSupply) external {
        require(!_initialized, "already initialized");
        _initialized = true;
        owner = msg.sender;
        disputePeriod = 1 hours;
        _mint(msg.sender, initialSupply);
    }

    /// @notice V2 Initialize — called once after upgrading from V1
    /// @param _treasury Address that receives 20% of burned TXT
    /// @param _sonoToken SONO ERC20 precompile address on Asset Hub
    function initializeV2(address _treasury, address _sonoToken) external onlyOwner {
        require(!_v2Initialized, "v2 already initialized");
        _v2Initialized = true;
        treasury = _treasury;
        sonoToken = _sonoToken;
        burnBps = 9000; // 90% burn, 10% treasury
        minProviderStake = 1000 * 1e10; // 1000 SONO (10 decimals)
    }

    // ===================== Buy TXT =====================

    /// @notice Buy TXT with DOT (native token)
    function buyWithDot() external payable whenNotPaused nonReentrant {
        require(txtPerDot > 0, "dot price not set");
        require(msg.value > 0, "zero payment");
        uint256 txtAmount = msg.value * txtPerDot / 1e18;
        require(txtAmount > 0, "amount too small");
        require(balanceOf[owner] >= txtAmount, "insufficient reserve");
        balanceOf[owner] -= txtAmount;
        balanceOf[msg.sender] += txtAmount;
        emit Transfer(owner, msg.sender, txtAmount);
        emit BoughtWithDot(msg.sender, msg.value, txtAmount);
    }

    /// @notice Buy TXT with any accepted ERC20 token (USDC, USDT, SONO)
    function buyWithToken(address token, uint256 amount) external whenNotPaused nonReentrant {
        PayToken storage pt = payTokens[token];
        require(pt.accepted, "token not accepted");
        require(pt.txtPerToken > 0, "rate not set");
        require(amount > 0, "zero amount");

        uint256 txtAmount = amount * pt.txtPerToken / (10 ** pt.tokenDecimals);
        require(txtAmount > 0, "amount too small");
        require(balanceOf[owner] >= txtAmount, "insufficient reserve");

        bool ok = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(ok, "token transfer failed");

        balanceOf[owner] -= txtAmount;
        balanceOf[msg.sender] += txtAmount;
        emit Transfer(owner, msg.sender, txtAmount);
        emit BoughtWithToken(msg.sender, token, amount, txtAmount);
    }

    /// @notice Sell TXT back for DOT
    function sellForDot(uint256 txtAmount) external whenNotPaused nonReentrant {
        require(txtPerDot > 0, "dot price not set");
        require(txtAmount > 0, "zero amount");
        require(balanceOf[msg.sender] >= txtAmount, "insufficient balance");
        uint256 dotAmount = txtAmount * 1e18 / txtPerDot;
        require(dotAmount > 0, "amount too small");
        require(address(this).balance >= dotAmount, "insufficient liquidity");
        balanceOf[msg.sender] -= txtAmount;
        balanceOf[owner] += txtAmount;
        emit Transfer(msg.sender, owner, txtAmount);
        (bool ok,) = msg.sender.call{value: dotAmount}("");
        require(ok, "transfer failed");
        emit SoldForDot(msg.sender, txtAmount, dotAmount);
    }

    // ===================== SONO Staking =====================

    /// @notice Stake SONO to earn share of 10% treasury from inference spend.
    ///   Rewards come from real revenue — the treasury portion of settled channels.
    ///   Additionally, as TXT gets burned (90%), remaining supply shrinks,
    ///   so SONO→TXT exchange rate naturally improves.
    function stakeSONO(uint256 amount) external whenNotPaused nonReentrant {
        require(sonoToken != address(0), "sono not configured");
        require(amount > 0, "zero amount");

        _updateReward(msg.sender);

        bool ok = IERC20(sonoToken).transferFrom(msg.sender, address(this), amount);
        require(ok, "sono transfer failed");

        sonoStaked[msg.sender] += amount;
        totalSonoStaked += amount;
        emit SonoStaked(msg.sender, amount, sonoStaked[msg.sender]);
    }

    /// @notice Unstake SONO. Locked during active governance proposals you voted on.
    function unstakeSONO(uint256 amount) external nonReentrant {
        require(amount > 0, "zero amount");
        require(sonoStaked[msg.sender] >= amount, "insufficient stake");
        require(block.timestamp >= unstakeLockUntil[msg.sender], "locked by governance vote");

        // If provider, ensure they keep minimum stake
        if (providers[msg.sender].registered) {
            require(
                sonoStaked[msg.sender] - amount >= minProviderStake,
                "would drop below provider minimum"
            );
        }

        _updateReward(msg.sender);

        sonoStaked[msg.sender] -= amount;
        totalSonoStaked -= amount;

        bool ok = IERC20(sonoToken).transfer(msg.sender, amount);
        require(ok, "sono transfer failed");

        emit SonoUnstaked(msg.sender, amount, sonoStaked[msg.sender]);
    }

    /// @notice Claim accumulated TXT rewards from treasury
    function claimRewards() external nonReentrant {
        _updateReward(msg.sender);
        uint256 reward = rewards[msg.sender];
        require(reward > 0, "nothing to claim");

        rewards[msg.sender] = 0;
        treasuryPool -= reward;
        balanceOf[msg.sender] += reward;
        emit Transfer(treasury, msg.sender, reward);
        emit RewardClaimed(msg.sender, reward);
    }

    /// @notice View pending rewards for a user
    function pendingRewards(address user) external view returns (uint256) {
        uint256 rpt = rewardPerTokenStored;
        uint256 pending = rewards[user];
        if (sonoStaked[user] > 0) {
            pending += sonoStaked[user] * (rpt - userRewardPerToken[user]) / 1e18;
        }
        return pending;
    }

    // ===================== Provider Registry =====================

    /// @notice Register as an inference provider. Must stake minimum SONO.
    function registerProvider() external whenNotPaused {
        require(!providers[msg.sender].registered, "already registered");
        require(sonoStaked[msg.sender] >= minProviderStake, "insufficient sono stake");

        providers[msg.sender] = Provider({
            registered: true,
            staked: sonoStaked[msg.sender],
            totalServed: 0
        });

        emit ProviderRegistered(msg.sender, sonoStaked[msg.sender]);
    }

    /// @notice Unregister as provider
    function unregisterProvider() external {
        require(providers[msg.sender].registered, "not registered");
        uint256 staked = providers[msg.sender].staked;
        delete providers[msg.sender];
        emit ProviderUnregistered(msg.sender, staked);
    }

    // ===================== Price Commitments =====================

    /// @notice Commit a model pricing hash on-chain.
    ///   hash = keccak256(abi.encodePacked(provider, modelId, pricePerKUnit, nonce))
    ///   API validates inference price against on-chain commitment before executing.
    function commitPrice(bytes32 priceHash) external {
        require(providers[msg.sender].registered, "not a provider");
        priceCommitments[priceHash] = true;
        emit PriceCommitted(msg.sender, priceHash);
    }

    /// @notice Revoke a price commitment
    function revokePrice(bytes32 priceHash) external {
        require(providers[msg.sender].registered, "not a provider");
        require(priceCommitments[priceHash], "not committed");
        priceCommitments[priceHash] = false;
        emit PriceRevoked(msg.sender, priceHash);
    }

    /// @notice Verify a price commitment exists on-chain
    function verifyPrice(bytes32 priceHash) external view returns (bool) {
        return priceCommitments[priceHash];
    }

    // ===================== Token management =====================

    function setTokenRate(address token, uint256 rate, uint8 tokenDec) external onlyOwner {
        if (!payTokens[token].accepted) {
            payTokens[token].accepted = true;
            payTokenList.push(token);
        }
        payTokens[token].txtPerToken = rate;
        payTokens[token].tokenDecimals = tokenDec;
        emit TokenRateUpdated(token, rate);
    }

    function removeToken(address token) external onlyOwner {
        payTokens[token].accepted = false;
        payTokens[token].txtPerToken = 0;
    }

    function setDotPrice(uint256 _txtPerDot) external onlyOwner {
        txtPerDot = _txtPerDot;
        emit DotPriceUpdated(_txtPerDot);
    }

    function withdrawDot(uint256 amount) external onlyOwner nonReentrant {
        require(address(this).balance >= amount, "insufficient balance");
        (bool ok,) = owner.call{value: amount}("");
        require(ok, "transfer failed");
    }

    function withdrawToken(address token, uint256 amount) external onlyOwner {
        bool ok = IERC20(token).transfer(owner, amount);
        require(ok, "transfer failed");
    }

    function depositDot() external payable onlyOwner {}
    function setPaused(bool _paused) external onlyOwner { paused = _paused; }

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
        emit ChannelToppedUp(msg.sender, service, amount, ch.deposit);
    }

    function cooperativeClose(
        address user, uint256 spent, uint64 nonce, bytes calldata sig
    ) external {
        bytes32 id = channelId(user, msg.sender);
        Channel storage ch = channels[id];
        require(ch.deposit > 0, "no channel");
        require(spent <= ch.deposit, "overspend");

        bytes32 stateHash = keccak256(abi.encodePacked(id, spent, nonce));
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

    function initiateClose(
        address counterparty, uint256 spent, uint64 nonce, bytes calldata sig
    ) external {
        (address user, address service) = msg.sender < counterparty
            ? (msg.sender, counterparty) : (counterparty, msg.sender);
        bytes32 id = channelId(user, service);
        Channel storage ch = channels[id];
        require(ch.deposit > 0, "no channel");
        require(spent <= ch.deposit, "overspend");
        require(nonce > ch.nonce, "stale nonce");

        bytes32 stateHash = keccak256(abi.encodePacked(id, spent, nonce));
        require(_recover(stateHash, sig) == counterparty, "bad signature");

        ch.spent = spent;
        ch.nonce = nonce;
        ch.expiresAt = uint64(block.timestamp) + uint64(disputePeriod);
        emit ChannelClosing(id, msg.sender, spent, ch.expiresAt);
    }

    function dispute(
        address user, address service,
        uint256 spent, uint64 nonce,
        bytes calldata userSig, bytes calldata serviceSig
    ) external {
        bytes32 id = channelId(user, service);
        Channel storage ch = channels[id];
        require(ch.expiresAt > 0, "not closing");
        require(block.timestamp < ch.expiresAt, "dispute expired");
        require(nonce > ch.nonce, "not newer");
        require(spent <= ch.deposit, "overspend");

        bytes32 stateHash = keccak256(abi.encodePacked(id, spent, nonce));
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

    function quoteBuyDot(uint256 dotAmount) external view returns (uint256) {
        if (txtPerDot == 0) return 0;
        return dotAmount * txtPerDot / 1e18;
    }

    function quoteBuyToken(address token, uint256 amount) external view returns (uint256) {
        PayToken storage pt = payTokens[token];
        if (!pt.accepted || pt.txtPerToken == 0) return 0;
        return amount * pt.txtPerToken / (10 ** pt.tokenDecimals);
    }

    function quoteSellDot(uint256 txtAmount) external view returns (uint256) {
        if (txtPerDot == 0) return 0;
        return txtAmount * 1e18 / txtPerDot;
    }

    function availableReserve() external view returns (uint256) {
        return balanceOf[owner];
    }

    function acceptedTokenCount() external view returns (uint256) {
        return payTokenList.length;
    }

    /// @notice Effective TXT supply (totalSupply - totalBurned)
    function circulatingSupply() external view returns (uint256) {
        return totalSupply - totalBurned;
    }

    // ===================== Admin =====================

    function setDisputePeriod(uint256 period) external onlyOwner {
        disputePeriod = period;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        owner = newOwner;
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "zero address");
        treasury = _treasury;
    }

    function setBurnBps(uint16 _burnBps) external onlyOwner {
        require(_burnBps <= 10000, "exceeds 100%");
        burnBps = _burnBps;
    }

    function setMinProviderStake(uint256 _minStake) external onlyOwner {
        minProviderStake = _minStake;
    }

    function setGovernance(address _governance) external onlyOwner {
        governance = _governance;
    }

    /// @notice Called by governance contract to lock a voter's stake until proposal ends.
    ///   Extends lock if new proposal ends later than current lock.
    function lockForVote(address voter, uint64 unlockAt) external {
        require(msg.sender == governance, "not governance");
        if (unlockAt > unstakeLockUntil[voter]) {
            unstakeLockUntil[voter] = unlockAt;
        }
    }

    // ===================== Internal =====================

    /// @notice Settlement: burn portion of spent TXT, send remainder to treasury, refund user.
    ///   Service (provider) does NOT receive TXT on-chain — providers are paid
    ///   off-chain from platform revenue in stables.
    function _settle(bytes32 id, address user, address service, uint256 spent) internal {
        Channel storage ch = channels[id];
        uint256 refund = ch.deposit - spent;

        if (spent > 0) {
            // Track provider's total served
            if (providers[service].registered) {
                providers[service].totalServed += spent;
            }

            uint256 burnAmount = spent * burnBps / 10000;
            uint256 treasuryAmount = spent - burnAmount;

            // Burn: reduce totalSupply, don't credit anyone
            if (burnAmount > 0) {
                _burn(burnAmount);
            }

            // Treasury: feed staker reward pool
            if (treasuryAmount > 0) {
                if (totalSonoStaked > 0) {
                    // Distribute to stakers via reward-per-token accumulator
                    rewardPerTokenStored += treasuryAmount * 1e18 / totalSonoStaked;
                    treasuryPool += treasuryAmount;
                    // TXT stays in contract, claimable by stakers
                    emit TreasuryDistributed(treasuryAmount, rewardPerTokenStored);
                } else if (treasury != address(0)) {
                    // No stakers — send to treasury address
                    balanceOf[treasury] += treasuryAmount;
                    emit Transfer(address(0), treasury, treasuryAmount);
                } else {
                    // No stakers, no treasury — burn everything
                    _burn(treasuryAmount);
                }
            }
        }

        if (refund > 0) {
            balanceOf[user] += refund;
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
        // Note: tokens are already not in any balance (came from channel deposit).
        // We just reduce totalSupply to reflect the permanent removal.
        totalSupply -= amount;
        emit Transfer(address(0), address(0), amount);
        emit TxtBurned(amount, 0, totalBurned);
    }

    /// @notice Update reward accounting for a user before stake change
    function _updateReward(address user) internal {
        if (sonoStaked[user] > 0) {
            rewards[user] += sonoStaked[user] * (rewardPerTokenStored - userRewardPerToken[user]) / 1e18;
        }
        userRewardPerToken[user] = rewardPerTokenStored;
    }

    /// @dev ecrecover with EIP-191 prefix + signature malleability protection
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

    receive() external payable {}
}
