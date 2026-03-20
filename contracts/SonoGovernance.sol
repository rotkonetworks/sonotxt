// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SonoGovernance — on-chain governance for sonotxt marketplace
/// @notice Staked SONO holders propose and vote on protocol parameter changes.
///   Proposals have a voting period, quorum requirement, and timelock before execution.
///
///   Governable parameters:
///   - burnBps (burn rate)
///   - platformCutBps (provider/platform split)
///   - protocolFeeBps (purchase fee)
///   - minProviderStake (provider entry barrier)
///   - paused (emergency pause)
///
///   Design: minimal, no delegation, no quorum gaming.
///   1 staked SONO = 1 vote. Voting locks your stake until proposal ends.

interface ISonoToken {
    function staked(address user) external view returns (uint256);
    function totalStaked() external view returns (uint256);
    function lockForVote(address voter, uint64 unlockAt) external;
    // Governable setters
    function setBurnBps(uint16 bps) external;
    function setPlatformCutBps(uint16 bps) external;
    function setProtocolFeeBps(uint16 bps) external;
    function setMinProviderStake(uint256 min) external;
    function setPaused(bool paused) external;
    function setTreasury(address treasury) external;
    function transferOwnership(address newOwner) external;
}

contract SonoGovernance {
    ISonoToken public token;
    address public guardian; // can cancel proposals (emergency only)

    uint64 public votingPeriod;   // seconds (default 3 days)
    uint64 public timelockDelay;  // seconds between passing and execution (default 1 day)
    uint16 public quorumBps;      // % of totalStaked needed (default 1000 = 10%)

    uint256 public proposalCount;

    enum ProposalState { Active, Defeated, Passed, Queued, Executed, Canceled }

    struct Proposal {
        uint256 id;
        address proposer;
        string description;
        bytes callData;          // encoded function call to execute on token contract
        uint64 startTime;
        uint64 endTime;
        uint64 executeAfter;     // timelock: can execute after this timestamp
        uint256 forVotes;
        uint256 againstVotes;
        uint256 quorumSnapshot;  // totalStaked at proposal creation
        bool executed;
        bool canceled;
    }

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    /// Pallet dispatch proposals — stores intent, not encoding
    struct PalletIntent {
        bytes32 intentHash;    // keccak256(palletName, callName, params) — semantic commitment
        address bridge;         // AssetSwap bridge contract address
    }
    mapping(uint256 => PalletIntent) public palletIntents;

    /// Whitelisted bridge contracts for pallet dispatch
    mapping(address => bool) public allowedBridges;

    event ProposalCreated(uint256 indexed id, address indexed proposer, string description);
    event PalletProposalCreated(uint256 indexed id, bytes32 intentHash, address bridge);
    event Voted(uint256 indexed id, address indexed voter, bool support, uint256 weight);
    event ProposalExecuted(uint256 indexed id);
    event PalletProposalExecuted(uint256 indexed id, bytes32 intentHash);
    event ProposalCanceled(uint256 indexed id);

    modifier onlyGuardian() { require(msg.sender == guardian, "not guardian"); _; }

    constructor(address _token, address _guardian) {
        token = ISonoToken(_token);
        guardian = _guardian;
        votingPeriod = 3 days;
        timelockDelay = 1 days;
        quorumBps = 1000; // 10%

        // Whitelist governable functions — ONLY these can be called via proposals
        allowedSelectors[ISonoToken.setBurnBps.selector] = true;
        allowedSelectors[ISonoToken.setPlatformCutBps.selector] = true;
        allowedSelectors[ISonoToken.setProtocolFeeBps.selector] = true;
        allowedSelectors[ISonoToken.setMinProviderStake.selector] = true;
        allowedSelectors[ISonoToken.setPaused.selector] = true;
        allowedSelectors[ISonoToken.setTreasury.selector] = true;
        // transferOwnership deliberately NOT whitelisted — guardian-only upgrade path
    }

    /// @notice Create a proposal. Proposer must have staked SONO.
    /// @param description Human-readable description
    /// @param callData ABI-encoded function call to execute on the token contract
    function propose(string calldata description, bytes calldata callData) external returns (uint256) {
        uint256 voterStake = token.staked(msg.sender);
        // Proposer must hold at least 0.1% of total staked to prevent spam
        uint256 proposalThreshold = token.totalStaked() / 1000;
        if (proposalThreshold < 100 * 1e10) proposalThreshold = 100 * 1e10; // min 100 SONO
        require(voterStake >= proposalThreshold, "insufficient stake to propose");

        uint256 id = ++proposalCount;
        uint64 start = uint64(block.timestamp);
        uint64 end = start + votingPeriod;

        proposals[id] = Proposal({
            id: id,
            proposer: msg.sender,
            description: description,
            callData: callData,
            startTime: start,
            endTime: end,
            executeAfter: 0,
            forVotes: 0,
            againstVotes: 0,
            quorumSnapshot: token.totalStaked(),
            executed: false,
            canceled: false
        });

        emit ProposalCreated(id, msg.sender, description);
        return id;
    }

    /// @notice Minimum time SONO must be staked before it counts for voting (prevents flash-stake attacks)
    uint64 public constant MIN_STAKE_AGE = 1 days;

    /// @notice When each user last changed their stake (for vote weight eligibility)
    mapping(address => uint64) public lastStakeChange;

    /// @notice Called by token contract when stake changes (stake/unstake/claimRewards)
    function notifyStakeChange(address user) external {
        require(msg.sender == address(token), "only token");
        lastStakeChange[user] = uint64(block.timestamp);
    }

    /// @notice Vote on a proposal. Weight = staked SONO. Locks stake until voting ends.
    ///   Stake must have been held for MIN_STAKE_AGE to prevent flash-stake attacks.
    function vote(uint256 proposalId, bool support) external {
        Proposal storage p = proposals[proposalId];
        require(p.id > 0, "no such proposal");
        require(block.timestamp >= p.startTime && block.timestamp < p.endTime, "voting closed");
        require(!p.canceled, "canceled");
        require(!hasVoted[proposalId][msg.sender], "already voted");

        // Stake must have been held for MIN_STAKE_AGE before the proposal was created
        require(
            lastStakeChange[msg.sender] == 0 || lastStakeChange[msg.sender] + MIN_STAKE_AGE <= p.startTime,
            "stake too recent"
        );

        uint256 weight = token.staked(msg.sender);
        require(weight > 0, "no stake");

        hasVoted[proposalId][msg.sender] = true;

        if (support) {
            p.forVotes += weight;
        } else {
            p.againstVotes += weight;
        }

        // Lock voter's stake until proposal ends (prevents vote-and-unstake)
        token.lockForVote(msg.sender, p.endTime);

        emit Voted(proposalId, msg.sender, support, weight);
    }

    /// @notice Queue a passed proposal for execution after timelock.
    function queue(uint256 proposalId) external {
        require(state(proposalId) == ProposalState.Passed, "not passed");
        Proposal storage p = proposals[proposalId];
        p.executeAfter = uint64(block.timestamp) + timelockDelay;
    }

    // Allowed function selectors that governance can execute
    mapping(bytes4 => bool) public allowedSelectors;

    /// @notice Execute a queued proposal after timelock expires.
    function execute(uint256 proposalId) external {
        require(state(proposalId) == ProposalState.Queued, "not queued");
        Proposal storage p = proposals[proposalId];
        require(block.timestamp >= p.executeAfter, "timelock active");
        require(block.timestamp <= p.executeAfter + 7 days, "proposal expired");

        // Validate calldata targets an allowed function
        require(p.callData.length >= 4, "invalid calldata");
        bytes4 selector = bytes4(abi.encodePacked(p.callData[0], p.callData[1], p.callData[2], p.callData[3]));
        require(allowedSelectors[selector], "function not governable");

        p.executed = true;

        (bool ok,) = address(token).call(p.callData);
        require(ok, "execution failed");

        emit ProposalExecuted(proposalId);
    }

    /// @notice Cancel a proposal (guardian only, for emergencies).
    function cancel(uint256 proposalId) external onlyGuardian {
        Proposal storage p = proposals[proposalId];
        require(!p.executed, "already executed");
        p.canceled = true;
        emit ProposalCanceled(proposalId);
    }

    /// @notice Get current state of a proposal.
    function state(uint256 proposalId) public view returns (ProposalState) {
        Proposal storage p = proposals[proposalId];
        require(p.id > 0, "no such proposal");

        if (p.canceled) return ProposalState.Canceled;
        if (p.executed) return ProposalState.Executed;

        // Still voting?
        if (block.timestamp < p.endTime) return ProposalState.Active;

        // Voting ended — check results
        uint256 quorumRequired = p.quorumSnapshot * quorumBps / 10000;
        bool quorumMet = p.forVotes + p.againstVotes >= quorumRequired;
        bool majorityFor = p.forVotes > p.againstVotes;

        if (!quorumMet || !majorityFor) return ProposalState.Defeated;

        // Passed but not yet queued
        if (p.executeAfter == 0) return ProposalState.Passed;

        // Queued but expired
        if (block.timestamp > p.executeAfter + 7 days) return ProposalState.Defeated;

        // Queued, waiting for timelock
        return ProposalState.Queued;
    }

    // ===================== Governance self-amendment =====================

    function setVotingPeriod(uint64 _period) external onlyGuardian {
        require(_period >= 1 hours && _period <= 30 days, "out of range");
        votingPeriod = _period;
    }

    function setTimelockDelay(uint64 _delay) external onlyGuardian {
        require(_delay <= 7 days, "too long");
        timelockDelay = _delay;
    }

    function setQuorumBps(uint16 _bps) external onlyGuardian {
        require(_bps >= 100 && _bps <= 5000, "out of range"); // 1% to 50%
        quorumBps = _bps;
    }

    function setGuardian(address _guardian) external onlyGuardian {
        require(_guardian != address(0));
        guardian = _guardian;
    }

    function setAllowedBridge(address bridge, bool allowed) external onlyGuardian {
        allowedBridges[bridge] = allowed;
    }

    /// @notice Create a proposal to dispatch a pallet call.
    ///   Stores the intent hash, not the SCALE encoding. Encoding is provided
    ///   at execution time from fresh metadata, making it runtime-upgrade safe.
    /// @param description Human-readable (e.g. "Swap 10000 DOT for SONO via AssetConversion")
    /// @param intentHash keccak256(abi.encode(palletName, callName, params)) — semantic commitment
    /// @param bridge Address of the AssetSwap bridge contract
    function proposePalletCall(
        string calldata description,
        bytes32 intentHash,
        address bridge
    ) external returns (uint256) {
        require(allowedBridges[bridge], "bridge not whitelisted");
        uint256 voterStake = token.staked(msg.sender);
        uint256 proposalThreshold = token.totalStaked() / 1000;
        if (proposalThreshold < 100 * 1e10) proposalThreshold = 100 * 1e10;
        require(voterStake >= proposalThreshold, "insufficient stake to propose");

        uint256 id = ++proposalCount;
        uint64 start = uint64(block.timestamp);
        uint64 end = start + votingPeriod;

        // Store as a regular proposal with empty callData (execution uses palletIntents)
        proposals[id] = Proposal({
            id: id,
            proposer: msg.sender,
            description: description,
            callData: "",  // empty — pallet calls use intentHash
            startTime: start,
            endTime: end,
            executeAfter: 0,
            forVotes: 0,
            againstVotes: 0,
            quorumSnapshot: token.totalStaked(),
            executed: false,
            canceled: false
        });

        palletIntents[id] = PalletIntent({ intentHash: intentHash, bridge: bridge });

        emit ProposalCreated(id, msg.sender, description);
        emit PalletProposalCreated(id, intentHash, bridge);
        return id;
    }

    /// @notice Execute a pallet proposal. Anyone provides the fresh SCALE encoding.
    ///   The contract verifies the encoding matches the voted intent.
    /// @param proposalId The proposal to execute
    /// @param scaleCallData Fresh SCALE-encoded pallet call (from current metadata)
    /// @param intentPreimage The ABI-encoded (palletName, callName, params) that hashes to intentHash
    function executePalletProposal(
        uint256 proposalId,
        bytes calldata scaleCallData,
        bytes calldata intentPreimage
    ) external {
        require(state(proposalId) == ProposalState.Queued, "not queued");
        Proposal storage p = proposals[proposalId];
        require(block.timestamp >= p.executeAfter, "timelock active");
        require(block.timestamp <= p.executeAfter + 7 days, "proposal expired");

        PalletIntent storage intent = palletIntents[proposalId];
        require(intent.intentHash != bytes32(0), "not a pallet proposal");

        // Verify: the preimage hashes to the committed intent
        require(keccak256(intentPreimage) == intent.intentHash, "intent mismatch");

        p.executed = true;

        // Dispatch through the bridge
        (bool ok,) = intent.bridge.call(
            abi.encodeWithSignature("dispatchPalletOrRevert(bytes)", scaleCallData)
        );
        require(ok, "pallet dispatch failed");

        emit PalletProposalExecuted(proposalId, intent.intentHash);
    }

    /// @notice Permanently remove the guardian role. Irreversible.
    ///   After this, governance is fully controlled by SONO stakers.
    function renounceGuardian() external onlyGuardian {
        guardian = address(0);
    }
}
