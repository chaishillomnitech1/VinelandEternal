/**
 * MirrorStakingBatch.test.js
 *
 * Tests for MirrorStaking batch operations:
 *   • batchStake(tokenIds)
 *   • batchClaimRewards(tokenIds)
 *   • batchUnstake(tokenIds)
 *   • totalPendingRewards(staker)
 */

const { expect }  = require("chai");
const { ethers }  = require("hardhat");
const { time }    = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("MirrorStaking — Batch Operations", function () {
  let mirrorToken, cnft, staking;
  let owner, zakatPool, alice, bob;

  const MIRROR_SUPPLY  = 1_000_000n;
  const DECIMALS       = 18n;
  const NFT_BASE_URI   = "ar://TEST/";
  const NFT_MINT_PRICE = 0n;
  // 1 MIRROR per second per NFT
  const REWARD_RATE    = ethers.parseEther("1");

  const ZAKAT_BPS  = 250n;
  const BPS_BASE   = 10_000n;
  const MASTER_ID  = 20n;

  function netReward(gross) {
    const zakat = (gross * ZAKAT_BPS) / BPS_BASE;
    return gross - zakat;
  }

  // Helper: approve-for-all + batchStake
  async function batchStake(staker, tokenIds) {
    await cnft.connect(staker).setApprovalForAll(await staking.getAddress(), true);
    await staking.connect(staker).batchStake(tokenIds);
  }

  beforeEach(async function () {
    [owner, zakatPool, alice, bob] = await ethers.getSigners();

    // Deploy MirrorToken
    const MirrorToken = await ethers.getContractFactory("MirrorToken");
    mirrorToken = await MirrorToken.deploy(MIRROR_SUPPLY, zakatPool.address);
    await mirrorToken.waitForDeployment();

    // Deploy ConsciousnessMirrorNFT
    const CNFT = await ethers.getContractFactory("ConsciousnessMirrorNFT");
    cnft = await CNFT.deploy(NFT_BASE_URI, NFT_MINT_PRICE);
    await cnft.waitForDeployment();
    await cnft.setMintActive(true);

    // Deploy MirrorStaking
    const Staking = await ethers.getContractFactory("MirrorStaking");
    staking = await Staking.deploy(
      await mirrorToken.getAddress(),
      await cnft.getAddress(),
      zakatPool.address,
      REWARD_RATE
    );
    await staking.waitForDeployment();

    // Seed 100,000 $MIRROR as reward reserve
    const seed = ethers.parseEther("100000");
    await mirrorToken.approve(await staking.getAddress(), seed);
    await staking.depositRewards(seed);

    // Mint tokens 1–19 to alice, token 20 to alice
    await cnft.ownerMint(alice.address, 19); // mints IDs 1–19
    await cnft.ownerMint(alice.address, 1);  // mints ID  20
  });

  // ─── batchStake ────────────────────────────────────────────────────────────

  describe("batchStake", function () {
    it("reverts when called with an empty array", async function () {
      await expect(
        staking.connect(alice).batchStake([])
      ).to.be.revertedWith("MirrorStaking: empty array");
    });

    it("stakes a single token via batchStake", async function () {
      await batchStake(alice, [1n]);
      const info = await staking.stakes(1n);
      expect(info.staker).to.equal(alice.address);
    });

    it("stakes multiple tokens and records each one", async function () {
      const ids = [1n, 2n, 3n, 4n, 5n];
      await batchStake(alice, ids);

      for (const id of ids) {
        const info = await staking.stakes(id);
        expect(info.staker).to.equal(alice.address);
      }
    });

    it("transfers NFTs to the staking contract", async function () {
      const ids = [1n, 2n, 3n];
      await batchStake(alice, ids);
      const stakingAddr = await staking.getAddress();
      for (const id of ids) {
        expect(await cnft.ownerOf(id)).to.equal(stakingAddr);
      }
    });

    it("emits a Staked event for each token and one BatchStaked summary", async function () {
      const ids = [1n, 2n, 3n];
      await cnft.connect(alice).setApprovalForAll(await staking.getAddress(), true);
      const tx = await staking.connect(alice).batchStake(ids);

      for (const id of ids) {
        await expect(tx).to.emit(staking, "Staked").withArgs(alice.address, id);
      }
      await expect(tx)
        .to.emit(staking, "BatchStaked")
        .withArgs(alice.address, 3n);
    });

    it("updates stakedTokensOf after batchStake", async function () {
      const ids = [1n, 2n, 3n];
      await batchStake(alice, ids);
      const staked = await staking.stakedTokensOf(alice.address);
      expect(staked.map(Number).sort((a, b) => a - b)).to.deep.equal([1, 2, 3]);
    });

    it("reverts if any token is not owned by the caller", async function () {
      // Token 1 belongs to alice; bob tries to stake it
      await cnft.connect(bob).setApprovalForAll(await staking.getAddress(), true);
      await expect(
        staking.connect(bob).batchStake([1n])
      ).to.be.revertedWith("MirrorStaking: not token owner");
    });

    it("reverts if any token is already staked", async function () {
      await batchStake(alice, [1n]);
      await expect(batchStake(alice, [1n])).to.be.revertedWith(
        "MirrorStaking: already staked"
      );
    });
  });

  // ─── totalPendingRewards ───────────────────────────────────────────────────

  describe("totalPendingRewards", function () {
    it("returns 0 when nothing is staked", async function () {
      expect(await staking.totalPendingRewards(alice.address)).to.equal(0n);
    });

    it("accumulates rewards across all staked tokens over time", async function () {
      const ids = [1n, 2n, 3n];
      await batchStake(alice, ids);

      const ELAPSED = 100n; // seconds
      await time.increase(Number(ELAPSED));

      const expected = ELAPSED * REWARD_RATE * BigInt(ids.length);
      const actual   = await staking.totalPendingRewards(alice.address);

      // Allow ±1 second of drift from block timing
      expect(actual).to.be.within(expected - REWARD_RATE, expected + REWARD_RATE);
    });

    it("includes the Master NFT multiplier in the total", async function () {
      // Stake token 1 (1×) and token 20 (3×)
      await batchStake(alice, [1n, 20n]);

      const ELAPSED = 50n;
      await time.increase(Number(ELAPSED));

      // 1 token @ 1× + 1 token @ 3× = 4× base
      const expected = ELAPSED * REWARD_RATE * 4n;
      const actual   = await staking.totalPendingRewards(alice.address);
      expect(actual).to.be.within(
        expected - REWARD_RATE * 4n,
        expected + REWARD_RATE * 4n
      );
    });
  });

  // ─── batchClaimRewards ─────────────────────────────────────────────────────

  describe("batchClaimRewards", function () {
    it("reverts when called with an empty array", async function () {
      await expect(
        staking.connect(alice).batchClaimRewards([])
      ).to.be.revertedWith("MirrorStaking: empty array");
    });

    it("reverts if caller is not the staker of a token", async function () {
      await batchStake(alice, [1n]);
      await expect(
        staking.connect(bob).batchClaimRewards([1n])
      ).to.be.revertedWith("MirrorStaking: not staker");
    });

    it("silently skips tokens with zero pending rewards", async function () {
      // Stake but do NOT advance time — rewards = 0 at exactly t=0
      await batchStake(alice, [1n, 2n]);
      // Should not revert; emits BatchRewardsClaimed with count=2
      await expect(
        staking.connect(alice).batchClaimRewards([1n, 2n])
      ).to.emit(staking, "BatchRewardsClaimed").withArgs(alice.address, 2n);
    });

    it("pays out rewards for multiple tokens and deducts zakat", async function () {
      const ids = [1n, 2n, 3n];
      await batchStake(alice, ids);

      const ELAPSED = 60n;
      await time.increase(Number(ELAPSED));

      const aliceBefore  = await mirrorToken.balanceOf(alice.address);
      const zakatBefore  = await mirrorToken.balanceOf(zakatPool.address);
      const reserveBefore = await staking.rewardReserve();

      await staking.connect(alice).batchClaimRewards(ids);

      const aliceAfter  = await mirrorToken.balanceOf(alice.address);
      const zakatAfter  = await mirrorToken.balanceOf(zakatPool.address);
      const reserveAfter = await staking.rewardReserve();

      // Alice received net rewards; zakat pool received zakat cut
      expect(aliceAfter).to.be.gt(aliceBefore);
      expect(zakatAfter).to.be.gt(zakatBefore);
      // Reserve decreased by the gross amount dispensed
      expect(reserveAfter).to.be.lt(reserveBefore);
    });

    it("emits BatchRewardsClaimed with the correct token count", async function () {
      const ids = [1n, 2n, 3n, 4n, 5n];
      await batchStake(alice, ids);
      await time.increase(10);

      await expect(
        staking.connect(alice).batchClaimRewards(ids)
      )
        .to.emit(staking, "BatchRewardsClaimed")
        .withArgs(alice.address, BigInt(ids.length));
    });

    it("resets pending rewards to ~0 after claiming", async function () {
      const ids = [1n, 2n];
      await batchStake(alice, ids);
      await time.increase(30);

      await staking.connect(alice).batchClaimRewards(ids);

      // pendingRewards should be 0 (or at most 1 second of drift)
      for (const id of ids) {
        expect(await staking.pendingRewards(id)).to.be.lte(REWARD_RATE);
      }
    });
  });

  // ─── batchUnstake ──────────────────────────────────────────────────────────

  describe("batchUnstake", function () {
    it("reverts when called with an empty array", async function () {
      await expect(
        staking.connect(alice).batchUnstake([])
      ).to.be.revertedWith("MirrorStaking: empty array");
    });

    it("reverts if caller is not the staker of a token", async function () {
      await batchStake(alice, [1n]);
      await expect(
        staking.connect(bob).batchUnstake([1n])
      ).to.be.revertedWith("MirrorStaking: not staker");
    });

    it("returns NFTs to the caller after unstaking", async function () {
      const ids = [1n, 2n, 3n];
      await batchStake(alice, ids);
      await time.increase(10);
      await staking.connect(alice).batchUnstake(ids);

      for (const id of ids) {
        expect(await cnft.ownerOf(id)).to.equal(alice.address);
      }
    });

    it("clears stake records after unstaking", async function () {
      const ids = [1n, 2n];
      await batchStake(alice, ids);
      await staking.connect(alice).batchUnstake(ids);

      for (const id of ids) {
        const info = await staking.stakes(id);
        expect(info.staker).to.equal(ethers.ZeroAddress);
      }
    });

    it("removes tokens from stakedTokensOf after unstaking", async function () {
      const ids = [1n, 2n, 3n];
      await batchStake(alice, ids);
      await staking.connect(alice).batchUnstake(ids);
      expect((await staking.stakedTokensOf(alice.address)).length).to.equal(0);
    });

    it("pays accrued rewards on unstake", async function () {
      const ids = [1n, 2n];
      await batchStake(alice, ids);
      await time.increase(50);

      const aliceBefore = await mirrorToken.balanceOf(alice.address);
      await staking.connect(alice).batchUnstake(ids);
      const aliceAfter  = await mirrorToken.balanceOf(alice.address);

      expect(aliceAfter).to.be.gt(aliceBefore);
    });

    it("emits Unstaked for each token and BatchUnstaked summary", async function () {
      const ids = [1n, 2n];
      await batchStake(alice, ids);
      await time.increase(10);

      const tx = await staking.connect(alice).batchUnstake(ids);

      for (const id of ids) {
        await expect(tx).to.emit(staking, "Unstaked");
      }
      await expect(tx)
        .to.emit(staking, "BatchUnstaked")
        .withArgs(alice.address, BigInt(ids.length));
    });

    it("can re-stake tokens after unstaking them", async function () {
      const ids = [1n, 2n];
      await batchStake(alice, ids);
      await staking.connect(alice).batchUnstake(ids);
      // Should not revert
      await batchStake(alice, ids);
      for (const id of ids) {
        const info = await staking.stakes(id);
        expect(info.staker).to.equal(alice.address);
      }
    });
  });

  // ─── Integration: batch stake → advance time → batch claim → batch unstake ─

  describe("Full batch lifecycle", function () {
    it("stake → claim → unstake multiple tokens end-to-end", async function () {
      const ids = [1n, 2n, 3n, 4n, 5n];

      await batchStake(alice, ids);
      await time.increase(100);

      // Claim mid-way
      await staking.connect(alice).batchClaimRewards(ids);

      await time.increase(100);

      const aliceBefore = await mirrorToken.balanceOf(alice.address);
      await staking.connect(alice).batchUnstake(ids);
      const aliceAfter  = await mirrorToken.balanceOf(alice.address);

      expect(aliceAfter).to.be.gt(aliceBefore);

      // All NFTs returned
      for (const id of ids) {
        expect(await cnft.ownerOf(id)).to.equal(alice.address);
      }
    });

    it("totalPendingRewards returns 0 after batchUnstake", async function () {
      const ids = [1n, 2n, 3n];
      await batchStake(alice, ids);
      await time.increase(50);
      await staking.connect(alice).batchUnstake(ids);
      expect(await staking.totalPendingRewards(alice.address)).to.equal(0n);
    });
  });
});
