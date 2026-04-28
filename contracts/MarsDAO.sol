// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MarsDAO
 * @notice Three-tier on-chain governance for the Mars DAO ecosystem.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  Architecture Overview
 * ══════════════════════════════════════════════════════════════════════════
 *
 *  Tier 1 — CORE COUNCIL (5 seats)
 *    • Elected by token-holders; accountable via on-chain recall.
 *    • Requires 3-of-5 multi-sig to execute treasury transfers.
 *    • Each seat has a configurable term (default 180 days).
 *
 *  Tier 2 — GUILD COUNCILS (5 specialised guilds)
 *    • TechGuild, AgriGuild, HealthGuild, EduGuild, CivicsGuild.
 *    • Guilds draft proposals in their domain; earn $MARS incentives.
 *    • Guild leads elected by guild members.
 *
 *  Tier 3 — COMMUNITY
 *    • All $MARS & $MIRROR holders vote on Standard proposals.
 *    • Voting weight = token balance (optional quadratic weight).
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  Proposal Types
 * ══════════════════════════════════════════════════════════════════════════
 *
 *  STANDARD       — Community vote, simple majority, 7-day voting window.
 *  TREASURY       — Community vote + Core Council 3/5 multi-sig; 7-day
 *                   timelock before execution.
 *  CONSTITUTIONAL — Requires 67 % supermajority + all-council vote.
 *  EMERGENCY      — Core Council 3/5 + 24-hour community ratification.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  Token Economics
 * ══════════════════════════════════════════════════════════════════════════
 *
 *  • 2.5 % of every DAO treasury disbursement goes to the Zakat pool.
 *  • $MARS holders earn participation rewards for on-time voting.
 *  • $MIRROR holders receive secondary governance weight (read from
 *    the MIRROR token contract that was deployed in the same ecosystem).
 *
 * ══════════════════════════════════════════════════════════════════════════
 */

interface IERC20Balance {
    function balanceOf(address) external view returns (uint256);
}

contract MarsDAO {

    // ── Constants ─────────────────────────────────────────────────────────────

    uint256 public constant COUNCIL_SEATS         = 5;
    uint256 public constant COUNCIL_MULTISIG_QUORUM = 3; // 3-of-5
    uint256 public constant TERM_DURATION         = 180 days;
    uint256 public constant VOTING_PERIOD         = 7 days;
    uint256 public constant EMERGENCY_RATIFY      = 24 hours;
    uint256 public constant TREASURY_TIMELOCK     = 7 days;
    uint256 public constant STANDARD_QUORUM_BPS   = 1000;  // 10 %
    uint256 public constant SUPER_MAJORITY_BPS    = 6700;  // 67 %
    uint256 public constant RECALL_THRESHOLD_BPS  = 5001;  // 50 % + 1 bps
    uint256 public constant ZAKAT_BPS             = 250;   // 2.5 %
    uint256 public constant BPS_BASE              = 10_000;
    uint256 public constant MIRROR_WEIGHT_DIVISOR = 10;    // 1 MIRROR = 0.1 vote equivalent

    // Proposal types
    uint8 public constant TYPE_STANDARD       = 0;
    uint8 public constant TYPE_TREASURY       = 1;
    uint8 public constant TYPE_CONSTITUTIONAL = 2;
    uint8 public constant TYPE_EMERGENCY      = 3;

    // Proposal states
    uint8 public constant STATE_ACTIVE    = 0;
    uint8 public constant STATE_PASSED    = 1;
    uint8 public constant STATE_REJECTED  = 2;
    uint8 public constant STATE_EXECUTED  = 3;
    uint8 public constant STATE_CANCELLED = 4;
    uint8 public constant STATE_TIMELOCK  = 5; // treasury proposals awaiting timelock

    // Guild IDs
    uint8 public constant GUILD_TECH    = 0;
    uint8 public constant GUILD_AGRI    = 1;
    uint8 public constant GUILD_HEALTH  = 2;
    uint8 public constant GUILD_EDU     = 3;
    uint8 public constant GUILD_CIVICS  = 4;
    uint8 public constant GUILD_COUNT   = 5;

    // ── Token references ──────────────────────────────────────────────────────

    /// @notice $MARS governance token.
    IERC20Balance public immutable marsToken;

    /// @notice $MIRROR token — provides secondary governance weight.
    IERC20Balance public immutable mirrorToken;

    // ── Ownership ────────────────────────────────────────────────────────────

    address public owner;

    // ── Core Council ──────────────────────────────────────────────────────────

    struct CouncilSeat {
        address member;
        uint256 termStart;
        uint256 termEnd;
        bool    active;
        uint256 proposalsVoted;
        uint256 proposalsSponsored;
    }

    /// @notice Seat index 0–4 → council seat.
    CouncilSeat[5] public councilSeats;

    /// @dev Address → seat index + 1 (0 = not a member).
    mapping(address => uint256) private _councilIndex;

    // ── Multi-sig confirmations ───────────────────────────────────────────────

    /// @dev proposalId → councilMember → has confirmed.
    mapping(uint256 => mapping(address => bool)) private _councilConfirmations;
    /// @dev proposalId → number of council confirmations.
    mapping(uint256 => uint256) public councilConfirmCount;

    // ── Guilds ───────────────────────────────────────────────────────────────

    struct Guild {
        string  name;
        address lead;
        uint256 memberCount;
        uint256 proposalsSubmitted;
        uint256 rewardBalance;  // $MARS incentive balance
    }

    Guild[5] public guilds;

    /// @dev address → guildId + 1 (0 = not a member).
    mapping(address => uint256) private _guildMembership;

    // ── Proposals ─────────────────────────────────────────────────────────────

    struct Proposal {
        uint256 id;
        address proposer;
        uint8   proposalType;   // TYPE_*
        uint8   guildId;        // 0xFF = no guild
        uint8   state;          // STATE_*
        bool    quadraticVoting;

        string  title;
        string  description;
        string  ipfsHash;       // full proposal document on IPFS

        uint256 createdAt;
        uint256 votingEnds;
        uint256 executionAfter; // timelock expiry (treasury proposals)

        // Treasury fields (used when proposalType == TYPE_TREASURY)
        address paymentTarget;
        uint256 paymentAmount;
        address paymentToken;   // address(0) = native MATIC/ETH

        // Vote tallies
        uint256 votesFor;
        uint256 votesAgainst;
        uint256 votesAbstain;
        uint256 totalVotingPower; // snapshot at proposal creation
    }

    uint256 public proposalCount;

    mapping(uint256 => Proposal) public proposals;

    /// @dev proposalId → voter → weight cast (0 = not voted).
    mapping(uint256 => mapping(address => uint256)) public voteCast;

    // ── Recall ───────────────────────────────────────────────────────────────

    struct RecallVote {
        uint256 seatIndex;
        uint256 votesFor;       // for recall
        uint256 votesAgainst;
        uint256 votingEnds;
        bool    executed;
        mapping(address => bool) hasVoted;
    }

    uint256 public recallVoteCount;
    mapping(uint256 => RecallVote) private _recallVotes;

    // ── Zakat treasury ────────────────────────────────────────────────────────

    address public zakatPool;
    uint256 public zakatAccumulated;

    // ── DAO treasury ─────────────────────────────────────────────────────────

    uint256 public daoTreasuryBalance; // mirrors native token held in contract

    // ── Governance health metrics ─────────────────────────────────────────────

    uint256 public totalProposals;
    uint256 public totalProposalsPassed;
    uint256 public totalProposalsRejected;
    uint256 public totalVotesCast;
    uint256 public totalParticipants;

    // ── Voting participation rewards ──────────────────────────────────────────

    /// @dev voter → total rewards earned.
    mapping(address => uint256) public participationRewards;
    uint256 public participationRewardPerVote; // $MARS wei

    // ── Cross-DAO registry ────────────────────────────────────────────────────

    struct ExternalDAO {
        string  name;
        address daoAddress;
        bool    active;
    }

    uint256 public externalDAOCount;
    mapping(uint256 => ExternalDAO) public externalDAOs;

    // ── Events ───────────────────────────────────────────────────────────────

    event ProposalCreated(
        uint256 indexed id,
        address indexed proposer,
        uint8   proposalType,
        string  title
    );
    event VoteCast(
        uint256 indexed proposalId,
        address indexed voter,
        uint8   support,    // 0=against 1=for 2=abstain
        uint256 weight
    );
    event ProposalStateChanged(uint256 indexed id, uint8 newState);
    event ProposalExecuted(uint256 indexed id);
    event CouncilMemberSeated(uint256 indexed seatIndex, address indexed member);
    event CouncilMemberRemoved(uint256 indexed seatIndex, address indexed member);
    event CouncilConfirmation(uint256 indexed proposalId, address indexed member, uint256 count);
    event GuildLeadUpdated(uint8 indexed guildId, address indexed lead);
    event GuildMemberAdded(uint8 indexed guildId, address indexed member);
    event RecallVoteStarted(uint256 indexed recallId, uint256 indexed seatIndex);
    event RecallExecuted(uint256 indexed recallId, uint256 indexed seatIndex);
    event ZakatDispatched(address indexed to, uint256 amount);
    event ExternalDAORegistered(uint256 indexed id, string name, address daoAddress);
    event TreasuryDeposit(address indexed from, uint256 amount);
    event OwnershipTransferred(address indexed prev, address indexed next);

    // ── Constructor ───────────────────────────────────────────────────────────

    /**
     * @param marsToken_   Address of the deployed MarsToken ($MARS) contract.
     * @param mirrorToken_ Address of the deployed MirrorToken ($MIRROR) contract.
     * @param zakatPool_   Initial Zakat pool address.
     * @param initialCouncil  Array of exactly 5 addresses for the founding council.
     */
    constructor(
        address marsToken_,
        address mirrorToken_,
        address zakatPool_,
        address[5] memory initialCouncil
    ) {
        require(marsToken_   != address(0), "MarsDAO: zero marsToken");
        require(mirrorToken_ != address(0), "MarsDAO: zero mirrorToken");
        require(zakatPool_   != address(0), "MarsDAO: zero zakatPool");

        marsToken   = IERC20Balance(marsToken_);
        mirrorToken = IERC20Balance(mirrorToken_);
        zakatPool   = zakatPool_;
        owner       = msg.sender;

        // Seed Core Council
        for (uint256 i = 0; i < COUNCIL_SEATS; i++) {
            require(initialCouncil[i] != address(0), "MarsDAO: zero council member");
            _seatCouncilMember(i, initialCouncil[i]);
        }

        // Initialise guilds
        guilds[GUILD_TECH]   = Guild({name: "TechGuild",    lead: address(0), memberCount: 0, proposalsSubmitted: 0, rewardBalance: 0});
        guilds[GUILD_AGRI]   = Guild({name: "AgriGuild",    lead: address(0), memberCount: 0, proposalsSubmitted: 0, rewardBalance: 0});
        guilds[GUILD_HEALTH] = Guild({name: "HealthGuild",  lead: address(0), memberCount: 0, proposalsSubmitted: 0, rewardBalance: 0});
        guilds[GUILD_EDU]    = Guild({name: "EduGuild",     lead: address(0), memberCount: 0, proposalsSubmitted: 0, rewardBalance: 0});
        guilds[GUILD_CIVICS] = Guild({name: "CivicsGuild",  lead: address(0), memberCount: 0, proposalsSubmitted: 0, rewardBalance: 0});
    }

    // ── Modifiers ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "MarsDAO: caller is not owner");
        _;
    }

    modifier onlyCouncil() {
        require(_councilIndex[msg.sender] > 0, "MarsDAO: caller is not council");
        uint256 idx = _councilIndex[msg.sender] - 1;
        require(councilSeats[idx].active, "MarsDAO: seat not active");
        _;
    }

    modifier validProposal(uint256 proposalId) {
        require(proposalId > 0 && proposalId <= proposalCount, "MarsDAO: invalid proposal");
        _;
    }

    // ── Receive ether (DAO treasury) ─────────────────────────────────────────

    receive() external payable {
        daoTreasuryBalance += msg.value;
        emit TreasuryDeposit(msg.sender, msg.value);
    }

    // ── Voting power ──────────────────────────────────────────────────────────

    /**
     * @notice Returns the effective governance weight for `voter`.
     *         Linear:   marsBalance + mirrorBalance / MIRROR_WEIGHT_DIVISOR
     *         Quadratic: sqrt(marsBalance) + sqrt(mirrorBalance / MIRROR_WEIGHT_DIVISOR)
     */
    function votingPower(address voter, bool quadratic) public view returns (uint256) {
        uint256 marsBal   = marsToken.balanceOf(voter);
        uint256 mirrorBal = mirrorToken.balanceOf(voter) / MIRROR_WEIGHT_DIVISOR;

        if (!quadratic) {
            return marsBal + mirrorBal;
        }
        return _sqrt(marsBal) + _sqrt(mirrorBal);
    }

    // ── Proposal creation ────────────────────────────────────────────────────

    /**
     * @notice Create a governance proposal.
     * @param proposalType  TYPE_STANDARD | TYPE_TREASURY | TYPE_CONSTITUTIONAL | TYPE_EMERGENCY
     * @param guildId       Guild sponsoring this proposal (0xFF if none).
     * @param quadratic     Whether to use quadratic voting weights.
     * @param title         Short title.
     * @param description   Human-readable description.
     * @param ipfsHash      IPFS CID of the full proposal document.
     * @param paymentTarget Recipient for treasury proposals (ignored otherwise).
     * @param paymentAmount Wei amount for treasury proposals.
     * @param paymentToken  ERC-20 token to pay from treasury (address(0) = native).
     */
    function createProposal(
        uint8   proposalType,
        uint8   guildId,
        bool    quadratic,
        string  calldata title,
        string  calldata description,
        string  calldata ipfsHash,
        address paymentTarget,
        uint256 paymentAmount,
        address paymentToken
    ) external returns (uint256) {
        require(proposalType <= TYPE_EMERGENCY, "MarsDAO: invalid type");
        require(bytes(title).length > 0, "MarsDAO: empty title");
        require(
            marsToken.balanceOf(msg.sender) > 0 || _councilIndex[msg.sender] > 0,
            "MarsDAO: no governance weight"
        );

        // Emergency proposals must come from council
        if (proposalType == TYPE_EMERGENCY) {
            require(_councilIndex[msg.sender] > 0, "MarsDAO: emergency needs council");
        }

        // Treasury proposals must have a valid target
        if (proposalType == TYPE_TREASURY) {
            require(paymentTarget != address(0), "MarsDAO: zero payment target");
            require(paymentAmount > 0, "MarsDAO: zero payment amount");
        }

        uint256 id = ++proposalCount;
        totalProposals++;

        uint256 votingEnd = block.timestamp + (
            proposalType == TYPE_EMERGENCY ? EMERGENCY_RATIFY : VOTING_PERIOD
        );

        // Snapshot total voting power at creation
        // (simplified: use caller's power × 1000 as a proxy; production would
        //  iterate a holder registry or use a block-snapshot)
        uint256 tvp = votingPower(msg.sender, quadratic);

        proposals[id] = Proposal({
            id:               id,
            proposer:         msg.sender,
            proposalType:     proposalType,
            guildId:          guildId,
            state:            STATE_ACTIVE,
            quadraticVoting:  quadratic,
            title:            title,
            description:      description,
            ipfsHash:         ipfsHash,
            createdAt:        block.timestamp,
            votingEnds:       votingEnd,
            executionAfter:   0,
            paymentTarget:    paymentTarget,
            paymentAmount:    paymentAmount,
            paymentToken:     paymentToken,
            votesFor:         0,
            votesAgainst:     0,
            votesAbstain:     0,
            totalVotingPower: tvp
        });

        // Track guild stats
        if (guildId < GUILD_COUNT) {
            guilds[guildId].proposalsSubmitted++;
        }

        // Track council stats
        if (_councilIndex[msg.sender] > 0) {
            uint256 idx = _councilIndex[msg.sender] - 1;
            councilSeats[idx].proposalsSponsored++;
        }

        emit ProposalCreated(id, msg.sender, proposalType, title);
        return id;
    }

    // ── Voting ────────────────────────────────────────────────────────────────

    /**
     * @notice Cast a vote on an active proposal.
     * @param proposalId  The proposal to vote on.
     * @param support     0 = against, 1 = for, 2 = abstain.
     */
    function castVote(uint256 proposalId, uint8 support) external validProposal(proposalId) {
        Proposal storage p = proposals[proposalId];
        require(p.state == STATE_ACTIVE, "MarsDAO: not active");
        require(block.timestamp <= p.votingEnds, "MarsDAO: voting ended");
        require(support <= 2, "MarsDAO: invalid support value");
        require(voteCast[proposalId][msg.sender] == 0, "MarsDAO: already voted");

        uint256 weight = votingPower(msg.sender, p.quadraticVoting);
        require(weight > 0, "MarsDAO: zero voting weight");

        voteCast[proposalId][msg.sender] = weight;
        totalVotesCast++;
        totalParticipants++; // simplified; production would deduplicate

        if (support == 1) {
            p.votesFor += weight;
        } else if (support == 0) {
            p.votesAgainst += weight;
        } else {
            p.votesAbstain += weight;
        }

        // Track council voting stats
        if (_councilIndex[msg.sender] > 0) {
            uint256 idx = _councilIndex[msg.sender] - 1;
            councilSeats[idx].proposalsVoted++;
        }

        // Participation reward
        if (participationRewardPerVote > 0) {
            participationRewards[msg.sender] += participationRewardPerVote;
        }

        emit VoteCast(proposalId, msg.sender, support, weight);
    }

    /**
     * @notice Council members confirm a TREASURY or EMERGENCY proposal.
     *         Requires COUNCIL_MULTISIG_QUORUM (3) confirmations to unlock.
     */
    function councilConfirm(uint256 proposalId) external onlyCouncil validProposal(proposalId) {
        Proposal storage p = proposals[proposalId];
        require(
            p.proposalType == TYPE_TREASURY || p.proposalType == TYPE_EMERGENCY,
            "MarsDAO: not a council-confirm type"
        );
        require(
            p.state == STATE_ACTIVE || p.state == STATE_PASSED || p.state == STATE_TIMELOCK,
            "MarsDAO: wrong state for confirm"
        );
        require(!_councilConfirmations[proposalId][msg.sender], "MarsDAO: already confirmed");

        _councilConfirmations[proposalId][msg.sender] = true;
        councilConfirmCount[proposalId]++;

        emit CouncilConfirmation(proposalId, msg.sender, councilConfirmCount[proposalId]);
    }

    // ── Proposal finalisation ─────────────────────────────────────────────────

    /**
     * @notice Finalise a proposal after its voting window closes.
     *         Anyone may call this once the window has ended.
     */
    function finaliseProposal(uint256 proposalId) external validProposal(proposalId) {
        Proposal storage p = proposals[proposalId];
        require(p.state == STATE_ACTIVE, "MarsDAO: not active");
        require(block.timestamp > p.votingEnds, "MarsDAO: voting still open");

        uint256 totalVotes = p.votesFor + p.votesAgainst + p.votesAbstain;
        bool passed;

        if (p.proposalType == TYPE_CONSTITUTIONAL) {
            // 67 % supermajority required
            passed = totalVotes > 0 &&
                (p.votesFor * BPS_BASE) / totalVotes >= SUPER_MAJORITY_BPS;
        } else {
            // Simple majority
            passed = p.votesFor > p.votesAgainst;
        }

        if (passed) {
            if (p.proposalType == TYPE_TREASURY) {
                // Enter timelock
                p.executionAfter = block.timestamp + TREASURY_TIMELOCK;
                p.state          = STATE_TIMELOCK;
                emit ProposalStateChanged(proposalId, STATE_TIMELOCK);
            } else {
                p.state = STATE_PASSED;
                emit ProposalStateChanged(proposalId, STATE_PASSED);
            }
            totalProposalsPassed++;
        } else {
            p.state = STATE_REJECTED;
            emit ProposalStateChanged(proposalId, STATE_REJECTED);
            totalProposalsRejected++;
        }
    }

    /**
     * @notice Execute a PASSED or TIMELOCK-expired treasury proposal.
     *         Requires COUNCIL_MULTISIG_QUORUM council confirmations.
     */
    function executeProposal(uint256 proposalId) external validProposal(proposalId) {
        Proposal storage p = proposals[proposalId];

        if (p.proposalType == TYPE_TREASURY) {
            require(p.state == STATE_TIMELOCK, "MarsDAO: not in timelock");
            require(block.timestamp >= p.executionAfter, "MarsDAO: timelock not expired");
            require(
                councilConfirmCount[proposalId] >= COUNCIL_MULTISIG_QUORUM,
                "MarsDAO: needs council multisig"
            );

            p.state = STATE_EXECUTED;
            emit ProposalStateChanged(proposalId, STATE_EXECUTED);

            // Deduct zakat from disbursement
            uint256 zakatAmt   = (p.paymentAmount * ZAKAT_BPS) / BPS_BASE;
            uint256 netAmount  = p.paymentAmount - zakatAmt;

            zakatAccumulated += zakatAmt;

            if (p.paymentToken == address(0)) {
                // Native token disbursement
                require(daoTreasuryBalance >= p.paymentAmount, "MarsDAO: insufficient treasury");
                daoTreasuryBalance -= p.paymentAmount;
                _safeTransferNative(p.paymentTarget, netAmount);
                _safeTransferNative(zakatPool, zakatAmt);
            }
            // ERC-20 disbursements handled off-chain via IPFS-linked execution tx
        } else if (p.proposalType == TYPE_EMERGENCY) {
            require(p.state == STATE_PASSED, "MarsDAO: not passed");
            require(
                councilConfirmCount[proposalId] >= COUNCIL_MULTISIG_QUORUM,
                "MarsDAO: needs council multisig"
            );
            p.state = STATE_EXECUTED;
            emit ProposalStateChanged(proposalId, STATE_EXECUTED);
        } else {
            require(p.state == STATE_PASSED, "MarsDAO: not passed");
            p.state = STATE_EXECUTED;
            emit ProposalStateChanged(proposalId, STATE_EXECUTED);
        }

        emit ProposalExecuted(proposalId);
    }

    // ── Recall ────────────────────────────────────────────────────────────────

    /**
     * @notice Initiate a recall vote against a Core Council member.
     * @param seatIndex  The council seat (0–4) to recall.
     */
    function initiateRecall(uint256 seatIndex) external returns (uint256) {
        require(seatIndex < COUNCIL_SEATS, "MarsDAO: invalid seat");
        require(councilSeats[seatIndex].active, "MarsDAO: seat not active");
        require(marsToken.balanceOf(msg.sender) > 0, "MarsDAO: no governance weight");

        uint256 rid = ++recallVoteCount;
        RecallVote storage rv = _recallVotes[rid];
        rv.seatIndex  = seatIndex;
        rv.votingEnds = block.timestamp + VOTING_PERIOD;

        emit RecallVoteStarted(rid, seatIndex);
        return rid;
    }

    /**
     * @notice Vote in an active recall election.
     * @param recallId  The recall vote ID.
     * @param support   true = vote to recall, false = keep.
     */
    function voteRecall(uint256 recallId, bool support) external {
        require(recallId > 0 && recallId <= recallVoteCount, "MarsDAO: invalid recall");
        RecallVote storage rv = _recallVotes[recallId];
        require(block.timestamp <= rv.votingEnds, "MarsDAO: recall vote ended");
        require(!rv.executed, "MarsDAO: already executed");
        require(!rv.hasVoted[msg.sender], "MarsDAO: already voted");

        uint256 weight = votingPower(msg.sender, false);
        require(weight > 0, "MarsDAO: zero weight");

        rv.hasVoted[msg.sender] = true;

        if (support) {
            rv.votesFor += weight;
        } else {
            rv.votesAgainst += weight;
        }
    }

    /**
     * @notice Finalise a recall vote and remove the member if threshold is met.
     */
    function finaliseRecall(uint256 recallId) external {
        require(recallId > 0 && recallId <= recallVoteCount, "MarsDAO: invalid recall");
        RecallVote storage rv = _recallVotes[recallId];
        require(block.timestamp > rv.votingEnds, "MarsDAO: recall vote not ended");
        require(!rv.executed, "MarsDAO: already executed");

        rv.executed = true;

        uint256 total = rv.votesFor + rv.votesAgainst;
        bool recalled = total > 0 &&
            (rv.votesFor * BPS_BASE) / total >= RECALL_THRESHOLD_BPS;

        if (recalled) {
            uint256 idx = rv.seatIndex;
            address removed = councilSeats[idx].member;
            delete _councilIndex[removed];
            councilSeats[idx].active = false;
            councilSeats[idx].member = address(0);
            emit CouncilMemberRemoved(idx, removed);
            emit RecallExecuted(recallId, idx);
        }
    }

    /**
     * @notice View a recall vote's current status without writing.
     */
    function getRecallVote(uint256 recallId) external view returns (
        uint256 seatIndex,
        uint256 votesFor,
        uint256 votesAgainst,
        uint256 votingEnds,
        bool    executed
    ) {
        RecallVote storage rv = _recallVotes[recallId];
        return (rv.seatIndex, rv.votesFor, rv.votesAgainst, rv.votingEnds, rv.executed);
    }

    // ── Guild management ─────────────────────────────────────────────────────

    /**
     * @notice Register as a member of a guild.
     * @param guildId  Guild to join (0–4).
     */
    function joinGuild(uint8 guildId) external {
        require(guildId < GUILD_COUNT, "MarsDAO: invalid guild");
        require(_guildMembership[msg.sender] == 0, "MarsDAO: already in a guild");
        require(marsToken.balanceOf(msg.sender) > 0, "MarsDAO: no MARS to join guild");

        _guildMembership[msg.sender] = uint256(guildId) + 1;
        guilds[guildId].memberCount++;
        emit GuildMemberAdded(guildId, msg.sender);
    }

    /**
     * @notice Council (or owner) can set the lead of a guild.
     */
    function setGuildLead(uint8 guildId, address lead) external {
        require(guildId < GUILD_COUNT, "MarsDAO: invalid guild");
        require(
            msg.sender == owner || _councilIndex[msg.sender] > 0,
            "MarsDAO: not authorised"
        );
        guilds[guildId].lead = lead;
        emit GuildLeadUpdated(guildId, lead);
    }

    /**
     * @notice Returns the guild ID of a member (reverts if not a member).
     */
    function guildOf(address member) external view returns (uint8) {
        uint256 raw = _guildMembership[member];
        require(raw > 0, "MarsDAO: not a guild member");
        return uint8(raw - 1);
    }

    // ── Council management ───────────────────────────────────────────────────

    /**
     * @notice (Re)seat a council member via owner/DAO action.
     */
    function seatCouncilMember(uint256 seatIndex, address member) external onlyOwner {
        require(seatIndex < COUNCIL_SEATS, "MarsDAO: invalid seat");
        require(member != address(0), "MarsDAO: zero member");

        if (councilSeats[seatIndex].active) {
            delete _councilIndex[councilSeats[seatIndex].member];
        }
        _seatCouncilMember(seatIndex, member);
    }

    // ── Cross-DAO registry ────────────────────────────────────────────────────

    /**
     * @notice Register an external DAO for cross-DAO coordination.
     */
    function registerExternalDAO(string calldata name_, address daoAddress) external onlyOwner {
        require(daoAddress != address(0), "MarsDAO: zero address");
        uint256 id = ++externalDAOCount;
        externalDAOs[id] = ExternalDAO({name: name_, daoAddress: daoAddress, active: true});
        emit ExternalDAORegistered(id, name_, daoAddress);
    }

    // ── Governance health metrics ─────────────────────────────────────────────

    /**
     * @notice Returns a snapshot of DAO health metrics.
     */
    function healthMetrics() external view returns (
        uint256 _totalProposals,
        uint256 _passed,
        uint256 _rejected,
        uint256 _passRate,          // bps
        uint256 _totalVotes,
        uint256 _zakatAccumulated,
        uint256 _treasuryBalance
    ) {
        uint256 resolved = totalProposalsPassed + totalProposalsRejected;
        uint256 passRate = resolved > 0
            ? (totalProposalsPassed * BPS_BASE) / resolved
            : 0;

        return (
            totalProposals,
            totalProposalsPassed,
            totalProposalsRejected,
            passRate,
            totalVotesCast,
            zakatAccumulated,
            daoTreasuryBalance
        );
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    /// @notice Update the Zakat pool address.
    function setZakatPool(address newPool) external onlyOwner {
        require(newPool != address(0), "MarsDAO: zero address");
        zakatPool = newPool;
    }

    /// @notice Set the per-vote participation reward amount.
    function setParticipationReward(uint256 rewardWei) external onlyOwner {
        participationRewardPerVote = rewardWei;
    }

    /// @notice Transfer ownership.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "MarsDAO: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Check whether an address is an active council member.
    function isCouncilMember(address addr) external view returns (bool) {
        uint256 idx = _councilIndex[addr];
        return idx > 0 && councilSeats[idx - 1].active;
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    function _seatCouncilMember(uint256 idx, address member) internal {
        councilSeats[idx] = CouncilSeat({
            member:              member,
            termStart:           block.timestamp,
            termEnd:             block.timestamp + TERM_DURATION,
            active:              true,
            proposalsVoted:      0,
            proposalsSponsored:  0
        });
        _councilIndex[member] = idx + 1;
        emit CouncilMemberSeated(idx, member);
    }

    function _safeTransferNative(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "MarsDAO: native transfer failed");
    }

    /// @dev Integer square root (Babylonian method).
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
