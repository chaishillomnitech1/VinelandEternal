/**
 * MirrorStaking.test.js
 *
 * Comprehensive test suite for the MirrorStaking contract.
 * Covers: staking, reward accrual, zakat deduction, Master-token multiplier,
 * unstaking, admin functions, and reserve-safety checks.
 */

const { expect }  = require("chai");
const { ethers }  = require("hardhat");
const { time }    = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("MirrorStaking", function () {
  let mirrorToken, cnft, staking;
  let owner, zakatPool, alice, bob;

  const MIRROR_SUPPLY     = 1_000_000n;
  const DECIMALS          = 18n;

  const NFT_MINT_PRICE = ethers.parseEther("0"); // free for tests
  const NFT_BASE_URI   = "ar://TEST/";

  // 1 MIRROR per second (expressed in wei)
  const REWARD_RATE    = ethers.parseEther("1");

  const ZAKAT_BPS      = 250n;
  const BPS_BASE       = 10_000n;
  const MASTER_ID      = 20n;

  // Helper: approve + stake a token
  async function stake(staker, tokenId) {
    await cnft.connect(staker).approve(await staking.getAddress(), tokenId);
    await staking.connect(staker).stake(tokenId);
  }

  beforeEach(async function () {
    [owner, zakatPool, alice, bob] = await ethers.getSigners();

    // 1. Deploy MirrorToken
    const MirrorToken = await ethers.getContractFactory("MirrorToken");
    mirrorToken = await MirrorToken.deploy(MIRROR_SUPPLY, zakatPool.address);
    await mirrorToken.waitForDeployment();

    // 2. Deploy ConsciousnessMirrorNFT (free mint for tests)
    const CNFT = await ethers.getContractFactory("ConsciousnessMirrorNFT");
    cnft = await CNFT.deploy(NFT_BASE_URI, NFT_MINT_PRICE);
    await cnft.waitForDeployment();
    await cnft.setMintActive(true);

    // 3. Deploy MirrorStaking
    const Staking = await ethers.getContractFactory("MirrorStaking");
    staking = await Staking.deploy(
      await mirrorToken.getAddress(),
      await cnft.getAddress(),
      zakatPool.address,
      REWARD_RATE
    );
    await staking.waitForDeployment();

    // 4. Seed staking contract with 10,000 $MIRROR reward reserve
    const seed = ethers.parseEther("10000");
    await mirrorToken.approve(await staking.getAddress(), seed);
    await staking.depositRewards(seed);

    // 5. Mint tokens 1–19 to alice, then token 20 (Master) to alice
    await cnft.ownerMint(alice.address, 19); // mints IDs 1–19
    await cnft.ownerMint(alice.address, 1);  // mints ID  20
  });

  // ─── Deployment ────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("stores contract addresses", async function () {
      expect(await staking.mirrorToken()).to.equal(await mirrorToken.getAddress());
      expect(await staking.nftContract()).to.equal(await cnft.getAddress());
    });

    it("stores initial zakat pool and reward rate", async function () {
      expect(await staking.zakatPool()).to.equal(zakatPool.address);
      expect(await staking.rewardRate()).to.equal(REWARD_RATE);
    });

    it("reverts when zero address passed to constructor", async function () {
      const Staking = await ethers.getContractFactory("MirrorStaking");
      await expect(
        Staking.deploy(ethers.ZeroAddress, await cnft.getAddress(), zakatPool.address, REWARD_RATE)
      ).to.be.revertedWith("MirrorStaking: zero mirrorToken");
      await expect(
        Staking.deploy(await mirrorToken.getAddress(), ethers.ZeroAddress, zakatPool.address, REWARD_RATE)
      ).to.be.revertedWith("MirrorStaking: zero nftContract");
      await expect(
        Staking.deploy(await mirrorToken.getAddress(), await cnft.getAddress(), ethers.ZeroAddress, REWARD_RATE)
      ).to.be.revertedWith("MirrorStaking: zero zakatPool");
    });
  });

  // ─── Stake ─────────────────────────────────────────────────────────────────

  describe("stake()", function () {
    it("transfers NFT to staking contract", async function () {
      await stake(alice, 1n);
      expect(await cnft.ownerOf(1n)).to.equal(await staking.getAddress());
    });

    it("records staker and timestamp", async function () {
      await stake(alice, 1n);
      const info = await staking.stakes(1n);
      expect(info.staker).to.equal(alice.address);
      expect(info.stakedAt).to.be.gt(0n);
    });

    it("emits Staked event", async function () {
      await cnft.connect(alice).approve(await staking.getAddress(), 1n);
      await expect(staking.connect(alice).stake(1n))
        .to.emit(staking, "Staked")
        .withArgs(alice.address, 1n);
    });

    it("tracks staker token list", async function () {
      await stake(alice, 1n);
      await stake(alice, 2n);
      const tokens = await staking.stakedTokensOf(alice.address);
      expect(tokens.map(Number)).to.include.members([1, 2]);
    });

    it("reverts if caller is not the token owner", async function () {
      await expect(
        staking.connect(bob).stake(1n)
      ).to.be.revertedWith("MirrorStaking: not token owner");
    });

    it("reverts if token already staked", async function () {
      await stake(alice, 1n);
      // NFT is now in staking contract; alice no longer owns it
      await expect(
        staking.connect(alice).stake(1n)
      ).to.be.revertedWith("MirrorStaking: not token owner");
    });
  });

  // ─── Reward accrual ────────────────────────────────────────────────────────

  describe("Reward accrual", function () {
    it("pendingRewards grows with time (regular token)", async function () {
      await stake(alice, 1n);
      await time.increase(100);
      const pending = await staking.pendingRewards(1n);
      // 100 s × 1 MIRROR/s = 100 MIRROR
      expect(pending).to.equal(ethers.parseEther("100"));
    });

    it("Master token (#20) earns 3× multiplier", async function () {
      await stake(alice, MASTER_ID);
      await time.increase(100);
      const pending = await staking.pendingRewards(MASTER_ID);
      // 100 s × 1 MIRROR/s × 3 = 300 MIRROR
      expect(pending).to.equal(ethers.parseEther("300"));
    });

    it("pendingRewards returns 0 for non-staked token", async function () {
      expect(await staking.pendingRewards(1n)).to.equal(0n);
    });
  });

  // ─── claimRewards ──────────────────────────────────────────────────────────

  describe("claimRewards()", function () {
    it("pays net reward to staker and zakat to pool", async function () {
      await stake(alice, 1n);
      await time.increase(1000); // 1000 MIRROR gross

      const aliceBefore = await mirrorToken.balanceOf(alice.address);
      const zakatBefore = await mirrorToken.balanceOf(zakatPool.address);

      await staking.connect(alice).claimRewards(1n);

      expect(await mirrorToken.balanceOf(alice.address)).to.be.gt(aliceBefore);
      expect(await mirrorToken.balanceOf(zakatPool.address)).to.be.gt(zakatBefore);
    });

    it("emits RewardsClaimed with net and zakat amounts", async function () {
      await stake(alice, 1n);
      await time.increase(100); // 100 MIRROR gross

      const gross    = ethers.parseEther("100");
      const zakatAmt = (gross * ZAKAT_BPS) / BPS_BASE;
      const netAmt   = gross - zakatAmt;

      await expect(staking.connect(alice).claimRewards(1n))
        .to.emit(staking, "RewardsClaimed")
        .withArgs(alice.address, 1n, netAmt, zakatAmt);
    });

    it("reverts if caller is not the staker", async function () {
      await stake(alice, 1n);
      await time.increase(100);
      await expect(
        staking.connect(bob).claimRewards(1n)
      ).to.be.revertedWith("MirrorStaking: not staker");
    });

    it("reverts if no rewards yet (same block)", async function () {
      await stake(alice, 1n);
      await expect(
        staking.connect(alice).claimRewards(1n)
      ).to.be.revertedWith("MirrorStaking: no rewards");
    });

    it("reduces reward reserve by the gross claimed amount", async function () {
      await stake(alice, 1n);
      await time.increase(100); // 100 MIRROR gross

      const reserveBefore = await staking.rewardReserve();
      await staking.connect(alice).claimRewards(1n);
      const reserveAfter = await staking.rewardReserve();

      const gross = ethers.parseEther("100");
      expect(reserveBefore - reserveAfter).to.equal(gross);
    });
  });

  // ─── unstake ───────────────────────────────────────────────────────────────

  describe("unstake()", function () {
    it("returns NFT to staker", async function () {
      await stake(alice, 1n);
      await time.increase(60);
      await staking.connect(alice).unstake(1n);
      expect(await cnft.ownerOf(1n)).to.equal(alice.address);
    });

    it("clears the stake record", async function () {
      await stake(alice, 1n);
      await time.increase(60);
      await staking.connect(alice).unstake(1n);
      const info = await staking.stakes(1n);
      expect(info.staker).to.equal(ethers.ZeroAddress);
    });

    it("removes token from staker list", async function () {
      await stake(alice, 1n);
      await stake(alice, 2n);
      await time.increase(60);
      await staking.connect(alice).unstake(1n);
      const tokens = await staking.stakedTokensOf(alice.address);
      expect(tokens.map(Number)).to.not.include(1);
      expect(tokens.map(Number)).to.include(2);
    });

    it("emits Unstaked with pending reward", async function () {
      await stake(alice, 1n);
      await time.increase(100);
      const gross = ethers.parseEther("100");
      await expect(staking.connect(alice).unstake(1n))
        .to.emit(staking, "Unstaked")
        .withArgs(alice.address, 1n, gross);
    });

    it("reverts when caller is not staker", async function () {
      await stake(alice, 1n);
      await expect(
        staking.connect(bob).unstake(1n)
      ).to.be.revertedWith("MirrorStaking: not staker");
    });

    it("unstake with zero rewards does not revert", async function () {
      // stake and unstake in same block → 0 reward
      await stake(alice, 1n);
      await staking.connect(alice).unstake(1n);
      expect(await cnft.ownerOf(1n)).to.equal(alice.address);
    });
  });

  // ─── Reward reserve safety ─────────────────────────────────────────────────

  describe("Reward reserve safety", function () {
    it("reverts claimRewards when reserve is insufficient", async function () {
      const reserve = await staking.rewardReserve();
      await staking.recoverRewards(reserve);

      await stake(alice, 1n);
      await time.increase(1);

      await expect(
        staking.connect(alice).claimRewards(1n)
      ).to.be.revertedWith("MirrorStaking: insufficient reward reserve");
    });
  });

  // ─── Admin ─────────────────────────────────────────────────────────────────

  describe("Admin", function () {
    it("owner can update reward rate", async function () {
      const newRate = ethers.parseEther("2");
      await expect(staking.setRewardRate(newRate))
        .to.emit(staking, "RewardRateUpdated")
        .withArgs(REWARD_RATE, newRate);
      expect(await staking.rewardRate()).to.equal(newRate);
    });

    it("owner can update zakat pool", async function () {
      await expect(staking.setZakatPool(alice.address))
        .to.emit(staking, "ZakatPoolUpdated")
        .withArgs(zakatPool.address, alice.address);
      expect(await staking.zakatPool()).to.equal(alice.address);
    });

    it("setZakatPool reverts on zero address", async function () {
      await expect(
        staking.setZakatPool(ethers.ZeroAddress)
      ).to.be.revertedWith("MirrorStaking: zero address");
    });

    it("owner can recover excess rewards", async function () {
      const before = await staking.rewardReserve();
      await staking.recoverRewards(before);
      expect(await staking.rewardReserve()).to.equal(0n);
    });

    it("recoverRewards reverts when amount exceeds reserve", async function () {
      const reserve = await staking.rewardReserve();
      await expect(
        staking.recoverRewards(reserve + 1n)
      ).to.be.revertedWith("MirrorStaking: exceeds reserve");
    });

    it("transferOwnership works correctly", async function () {
      await expect(staking.transferOwnership(alice.address))
        .to.emit(staking, "OwnershipTransferred")
        .withArgs(owner.address, alice.address);
      expect(await staking.owner()).to.equal(alice.address);
    });

    it("transferOwnership reverts on zero address", async function () {
      await expect(
        staking.transferOwnership(ethers.ZeroAddress)
      ).to.be.revertedWith("MirrorStaking: zero address");
    });

    it("non-owner cannot call admin functions", async function () {
      await expect(staking.connect(alice).setRewardRate(1n))
        .to.be.revertedWith("MirrorStaking: caller is not owner");
      await expect(staking.connect(alice).setZakatPool(alice.address))
        .to.be.revertedWith("MirrorStaking: caller is not owner");
      await expect(staking.connect(alice).recoverRewards(1n))
        .to.be.revertedWith("MirrorStaking: caller is not owner");
      await expect(staking.connect(alice).depositRewards(1n))
        .to.be.revertedWith("MirrorStaking: caller is not owner");
    });
  });
});
