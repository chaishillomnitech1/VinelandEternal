// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ── External interface stubs (no OpenZeppelin dependency) ─────────────────

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface IERC721 {
    function ownerOf(uint256) external view returns (address);
    function transferFrom(address, address, uint256) external;
}

/**
 * @title MirrorStaking
 * @notice Stake Consciousness Mirror NFTs (CMIRROR) to earn $MIRROR rewards.
 *
 * Economics
 * ─────────
 *   • Each staked NFT accrues `rewardRate` $MIRROR tokens per second.
 *   • Rewards are minted directly by this contract, which must hold a
 *     sufficient $MIRROR balance (funded by the owner via depositRewards()).
 *   • 2.5% of every reward claim is automatically forwarded to the
 *     ScrollSoul Zakat pool — aligned with MirrorToken's fee structure.
 *   • The Master NFT (tokenId 20) earns a 3× multiplier over regular tokens.
 *
 * Roles
 * ─────
 *   owner  — set reward rate, zakat pool, deposit / recover reward tokens.
 *
 * Flow
 * ────
 *   1. Owner deploys, then calls depositRewards() to seed the reward pool.
 *   2. NFT holder calls approve(stakingContract, tokenId) on the NFT contract.
 *   3. NFT holder calls stake(tokenId).
 *   4. At any time the staker may call claimRewards(tokenId) to harvest.
 *   5. unstake(tokenId) claims all pending rewards then returns the NFT.
 */
contract MirrorStaking {

    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    /// @notice The Master NFT (token #20) earns this multiplier on rewards.
    uint256 public constant MASTER_MULTIPLIER  = 3;
    uint256 public constant MASTER_TOKEN_ID    = 20;

    /// @notice Zakat rate on claimed rewards: 2.5% = 250 basis points.
    uint256 public constant ZAKAT_BPS  = 250;
    uint256 private constant BPS_BASE  = 10_000;

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    /// @notice $MIRROR ERC-20 token used for reward payouts.
    IERC20  public immutable mirrorToken;

    /// @notice ConsciousnessMirrorNFT ERC-721 collection.
    IERC721 public immutable nftContract;

    /// @notice $MIRROR wei earned per second per staked NFT (base rate).
    uint256 public rewardRate;

    /// @notice Address that receives the zakat cut of every reward claim.
    address public zakatPool;

    address public owner;

    /// @notice Total $MIRROR deposited by owner as the reward reserve.
    uint256 public rewardReserve;

    // -----------------------------------------------------------------------
    // Per-stake records
    // -----------------------------------------------------------------------

    struct StakeInfo {
        address staker;
        uint256 stakedAt;       // block.timestamp when staked
        uint256 rewardDebt;     // MIRROR already claimed for this stake (wei)
    }

    /// @notice tokenId → stake info; staker == address(0) means not staked.
    mapping(uint256 => StakeInfo) public stakes;

    /// @notice staker address → list of currently staked token IDs.
    mapping(address => uint256[]) private _stakerTokens;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event Staked(address indexed staker, uint256 indexed tokenId);
    event Unstaked(address indexed staker, uint256 indexed tokenId, uint256 reward);
    event RewardsClaimed(address indexed staker, uint256 indexed tokenId, uint256 netReward, uint256 zakat);
    event RewardRateUpdated(uint256 previousRate, uint256 newRate);
    event ZakatPoolUpdated(address indexed previousPool, address indexed newPool);
    event RewardsDeposited(uint256 amount);
    event RewardsRecovered(uint256 amount);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    /**
     * @param mirrorToken_  Address of the deployed MirrorToken ($MIRROR) contract.
     * @param nftContract_  Address of the deployed ConsciousnessMirrorNFT contract.
     * @param zakatPool_    Initial address of the ScrollSoul Zakat pool.
     * @param rewardRate_   $MIRROR wei earned per second per staked NFT.
     *                      Example: 1e15 = 0.001 MIRROR/s ≈ 86.4 MIRROR/day.
     */
    constructor(
        address mirrorToken_,
        address nftContract_,
        address zakatPool_,
        uint256 rewardRate_
    ) {
        require(mirrorToken_ != address(0), "MirrorStaking: zero mirrorToken");
        require(nftContract_ != address(0), "MirrorStaking: zero nftContract");
        require(zakatPool_   != address(0), "MirrorStaking: zero zakatPool");

        mirrorToken = IERC20(mirrorToken_);
        nftContract = IERC721(nftContract_);
        zakatPool   = zakatPool_;
        rewardRate  = rewardRate_;
        owner       = msg.sender;
    }

    // -----------------------------------------------------------------------
    // Modifiers
    // -----------------------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == owner, "MirrorStaking: caller is not owner");
        _;
    }

    // -----------------------------------------------------------------------
    // Staking
    // -----------------------------------------------------------------------

    /**
     * @notice Stake an NFT.  Caller must have approved this contract to
     *         transfer `tokenId` on the NFT contract first.
     * @param tokenId  Token ID to stake (1–20).
     */
    function stake(uint256 tokenId) external {
        require(
            nftContract.ownerOf(tokenId) == msg.sender,
            "MirrorStaking: not token owner"
        );
        require(stakes[tokenId].staker == address(0), "MirrorStaking: already staked");

        nftContract.transferFrom(msg.sender, address(this), tokenId);

        stakes[tokenId] = StakeInfo({
            staker:     msg.sender,
            stakedAt:   block.timestamp,
            rewardDebt: 0
        });

        _stakerTokens[msg.sender].push(tokenId);

        emit Staked(msg.sender, tokenId);
    }

    /**
     * @notice Claim pending $MIRROR rewards for a staked token without
     *         unstaking it.
     * @param tokenId  Token ID whose rewards to claim.
     */
    function claimRewards(uint256 tokenId) external {
        StakeInfo storage info = stakes[tokenId];
        require(info.staker == msg.sender, "MirrorStaking: not staker");

        uint256 pending = _pendingRewards(tokenId);
        require(pending > 0, "MirrorStaking: no rewards");

        info.rewardDebt += pending;
        _disperseReward(msg.sender, tokenId, pending);
    }

    /**
     * @notice Unstake a token, automatically claiming all pending rewards.
     * @param tokenId  Token ID to unstake.
     */
    function unstake(uint256 tokenId) external {
        StakeInfo storage info = stakes[tokenId];
        require(info.staker == msg.sender, "MirrorStaking: not staker");

        uint256 pending = _pendingRewards(tokenId);

        // Clear stake before external calls (re-entrancy guard pattern)
        delete stakes[tokenId];
        _removeFromStakerList(msg.sender, tokenId);

        // Return NFT
        nftContract.transferFrom(address(this), msg.sender, tokenId);

        // Pay out reward
        if (pending > 0) {
            _disperseReward(msg.sender, tokenId, pending);
        }

        emit Unstaked(msg.sender, tokenId, pending);
    }

    // -----------------------------------------------------------------------
    // View helpers
    // -----------------------------------------------------------------------

    /**
     * @notice Returns the pending $MIRROR reward (gross, before zakat) for
     *         a staked token.
     */
    function pendingRewards(uint256 tokenId) external view returns (uint256) {
        return _pendingRewards(tokenId);
    }

    /**
     * @notice Returns all token IDs currently staked by `staker`.
     */
    function stakedTokensOf(address staker) external view returns (uint256[] memory) {
        return _stakerTokens[staker];
    }

    // -----------------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------------

    /**
     * @notice Deposit $MIRROR into this contract as the reward reserve.
     *         Caller must approve this contract on the MirrorToken first.
     * @param amount  Amount of $MIRROR (wei) to deposit.
     */
    function depositRewards(uint256 amount) external onlyOwner {
        require(amount > 0, "MirrorStaking: zero amount");
        require(
            mirrorToken.transferFrom(msg.sender, address(this), amount),
            "MirrorStaking: transfer failed"
        );
        rewardReserve += amount;
        emit RewardsDeposited(amount);
    }

    /**
     * @notice Recover unused reward tokens back to the owner.
     *         Only recovers tokens above what is currently owed to stakers
     *         — does not affect staked NFTs or pending rewards.
     */
    function recoverRewards(uint256 amount) external onlyOwner {
        require(amount <= rewardReserve, "MirrorStaking: exceeds reserve");
        rewardReserve -= amount;
        require(mirrorToken.transfer(owner, amount), "MirrorStaking: transfer failed");
        emit RewardsRecovered(amount);
    }

    /**
     * @notice Update the per-second reward rate.
     */
    function setRewardRate(uint256 newRate) external onlyOwner {
        emit RewardRateUpdated(rewardRate, newRate);
        rewardRate = newRate;
    }

    /**
     * @notice Update the zakat pool address.
     */
    function setZakatPool(address newPool) external onlyOwner {
        require(newPool != address(0), "MirrorStaking: zero address");
        emit ZakatPoolUpdated(zakatPool, newPool);
        zakatPool = newPool;
    }

    /**
     * @notice Transfer contract ownership.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "MirrorStaking: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    function _pendingRewards(uint256 tokenId) internal view returns (uint256) {
        StakeInfo storage info = stakes[tokenId];
        if (info.staker == address(0)) return 0;

        uint256 elapsed = block.timestamp - info.stakedAt;
        uint256 multiplier = (tokenId == MASTER_TOKEN_ID) ? MASTER_MULTIPLIER : 1;
        uint256 gross = elapsed * rewardRate * multiplier;

        return gross > info.rewardDebt ? gross - info.rewardDebt : 0;
    }

    function _disperseReward(address staker, uint256 tokenId, uint256 gross) internal {
        uint256 zakatAmt = (gross * ZAKAT_BPS) / BPS_BASE;
        uint256 netAmt   = gross - zakatAmt;

        require(gross <= rewardReserve, "MirrorStaking: insufficient reward reserve");
        rewardReserve -= gross;

        if (netAmt > 0) {
            require(mirrorToken.transfer(staker, netAmt), "MirrorStaking: reward transfer failed");
        }
        if (zakatAmt > 0) {
            require(mirrorToken.transfer(zakatPool, zakatAmt), "MirrorStaking: zakat transfer failed");
        }

        emit RewardsClaimed(staker, tokenId, netAmt, zakatAmt);
    }

    function _removeFromStakerList(address staker, uint256 tokenId) internal {
        uint256[] storage tokens = _stakerTokens[staker];
        uint256 len = tokens.length;
        for (uint256 i = 0; i < len; i++) {
            if (tokens[i] == tokenId) {
                tokens[i] = tokens[len - 1];
                tokens.pop();
                return;
            }
        }
    }
}
