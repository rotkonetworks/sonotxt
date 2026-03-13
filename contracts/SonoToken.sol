// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TXT — sonotxt utility token (upgradeable via ERC1967 proxy)
/// @notice ERC20 + payment channels for off-chain service usage.
///
///   Two-token model:
///   - SONO: governance token, native Asset Hub asset (pallet-assets),
///     accessible in Solidity via ERC20 precompile
///   - TXT: utility token (this contract), used for payment channels
///
///   Users buy TXT with: DOT, USDC, USDT, or SONO.
///   All accepted tokens use the pallet-assets ERC20 precompile except DOT (native).
///
///   Payment channel flow:
///   1. User buys TXT with any accepted token
///   2. User opens channel to a service, locking TXT
///   3. Service delivers work off-chain, signs receipts
///   4. Settlement transfers spent TXT to service, refunds remainder
///   5. User can sell TXT back for DOT

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

    address public owner;
    uint256 public totalSupply;
    uint256 public disputePeriod;
    bool public paused;
    bool private _initialized;
    bool private _reentrancyLock;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // --- Accepted payment tokens ---
    // ERC20 precompile addresses for pallet-assets tokens on Asset Hub
    // Format: [asset_id_be32][12 zero bytes][0x0120][2 zero bytes]

    struct PayToken {
        bool accepted;
        uint8 tokenDecimals;  // decimals of the payment token
        uint256 txtPerToken;  // TXT (10 dec) received per 1 whole token
    }

    /// @notice Accepted ERC20 tokens and their TXT exchange rates
    mapping(address => PayToken) public payTokens;
    address[] public payTokenList;

    /// @notice TXT per 1 DOT (1e18 wei). Set by oracle.
    uint256 public txtPerDot;

    // --- Payment channels ---
    struct Channel {
        uint256 deposit;
        uint256 spent;
        uint64  nonce;
        uint64  expiresAt;
    }

    mapping(bytes32 => Channel) public channels;

    // --- Events ---
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

    /// @notice Initialize (called once via proxy delegatecall)
    /// @param initialSupply Total TXT supply, all minted to deployer
    function initialize(uint256 initialSupply) external {
        require(!_initialized, "already initialized");
        _initialized = true;
        owner = msg.sender;
        disputePeriod = 1 hours;
        _mint(msg.sender, initialSupply);
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
    /// @param token ERC20 precompile address of the payment token
    /// @param amount Amount of payment token (in its native decimals)
    function buyWithToken(address token, uint256 amount) external whenNotPaused nonReentrant {
        PayToken storage pt = payTokens[token];
        require(pt.accepted, "token not accepted");
        require(pt.txtPerToken > 0, "rate not set");
        require(amount > 0, "zero amount");

        // Calculate TXT: amount * txtPerToken / 10^tokenDecimals
        uint256 txtAmount = amount * pt.txtPerToken / (10 ** pt.tokenDecimals);
        require(txtAmount > 0, "amount too small");
        require(balanceOf[owner] >= txtAmount, "insufficient reserve");

        // Pull payment token from buyer
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
        // effects
        balanceOf[msg.sender] -= txtAmount;
        balanceOf[owner] += txtAmount;
        emit Transfer(msg.sender, owner, txtAmount);
        // interaction
        (bool ok,) = msg.sender.call{value: dotAmount}("");
        require(ok, "transfer failed");
        emit SoldForDot(msg.sender, txtAmount, dotAmount);
    }

    // ===================== Token management =====================

    /// @notice Set exchange rate for an accepted ERC20 token
    /// @param token ERC20 address (precompile for pallet-assets)
    /// @param rate TXT (10 dec) per 1 whole token
    /// @param tokenDec Decimals of the payment token (6 for USDC/USDT, 10 for SONO pallet-asset)
    function setTokenRate(address token, uint256 rate, uint8 tokenDec) external onlyOwner {
        if (!payTokens[token].accepted) {
            payTokens[token].accepted = true;
            payTokenList.push(token);
        }
        payTokens[token].txtPerToken = rate;
        payTokens[token].tokenDecimals = tokenDec;
        emit TokenRateUpdated(token, rate);
    }

    /// @notice Remove an accepted token
    function removeToken(address token) external onlyOwner {
        payTokens[token].accepted = false;
        payTokens[token].txtPerToken = 0;
    }

    /// @notice Set DOT → TXT rate (from oracle)
    function setDotPrice(uint256 _txtPerDot) external onlyOwner {
        txtPerDot = _txtPerDot;
        emit DotPriceUpdated(_txtPerDot);
    }

    /// @notice Owner withdraws DOT liquidity
    function withdrawDot(uint256 amount) external onlyOwner nonReentrant {
        require(address(this).balance >= amount, "insufficient balance");
        (bool ok,) = owner.call{value: amount}("");
        require(ok, "transfer failed");
    }

    /// @notice Owner withdraws collected payment tokens
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

    // ===================== Admin =====================

    function setDisputePeriod(uint256 period) external onlyOwner {
        disputePeriod = period;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "zero address");
        owner = newOwner;
    }

    // ===================== Internal =====================

    function _settle(bytes32 id, address user, address service, uint256 spent) internal {
        Channel storage ch = channels[id];
        uint256 refund = ch.deposit - spent;
        if (spent > 0) balanceOf[service] += spent;
        if (refund > 0) balanceOf[user] += refund;
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
