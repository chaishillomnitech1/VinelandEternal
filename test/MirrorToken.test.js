/**
 * MirrorToken.test.js
 *
 * Comprehensive test suite for the $MIRROR ERC-20 token.
 * Covers: minting, fee deductions (dividend + zakat), dividend accumulation
 * & claiming, allowances, admin functions, and edge-cases.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MirrorToken ($MIRROR)", function () {
  let mirrorToken;
  let owner, zakat, alice, bob, carol;

  const SUPPLY       = 1_000_000n;
  const DECIMALS     = 18n;
  const SUPPLY_WEI   = SUPPLY * 10n ** DECIMALS;
  const DIVIDEND_BPS = 200n;   // 2 %
  const ZAKAT_BPS    = 250n;   // 2.5 %
  const BPS_BASE     = 10_000n;

  // Expected net amount received by the destination after fees
  function netAmount(amount) {
    const div = (amount * DIVIDEND_BPS) / BPS_BASE;
    const zak = (amount * ZAKAT_BPS)    / BPS_BASE;
    return amount - div - zak;
  }

  beforeEach(async function () {
    [owner, zakat, alice, bob, carol] = await ethers.getSigners();
    const MirrorToken = await ethers.getContractFactory("MirrorToken");
    mirrorToken = await MirrorToken.deploy(SUPPLY, zakat.address);
    await mirrorToken.waitForDeployment();
  });

  // ─── Deployment ────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets correct name and symbol", async function () {
      expect(await mirrorToken.name()).to.equal("Mirror Token");
      expect(await mirrorToken.symbol()).to.equal("MIRROR");
    });

    it("has 18 decimals", async function () {
      expect(await mirrorToken.decimals()).to.equal(18n);
    });

    it("mints total supply to deployer", async function () {
      expect(await mirrorToken.totalSupply()).to.equal(SUPPLY_WEI);
      expect(await mirrorToken.balanceOf(owner.address)).to.equal(SUPPLY_WEI);
    });

    it("stores the zakat pool address", async function () {
      expect(await mirrorToken.zakatPool()).to.equal(zakat.address);
    });

    it("reverts if zakat pool is zero address", async function () {
      const MirrorToken = await ethers.getContractFactory("MirrorToken");
      await expect(
        MirrorToken.deploy(SUPPLY, ethers.ZeroAddress)
      ).to.be.revertedWith("MirrorToken: zakat pool is zero address");
    });

    it("immutable fee constants are correct", async function () {
      expect(await mirrorToken.DIVIDEND_BPS()).to.equal(200n);
      expect(await mirrorToken.ZAKAT_BPS()).to.equal(250n);
    });
  });

  // ─── ERC-20 basics ─────────────────────────────────────────────────────────

  describe("ERC-20 standard", function () {
    it("transfers net amount and deducts fees", async function () {
      const amount = ethers.parseEther("1000");
      const expected = netAmount(amount);

      await mirrorToken.transfer(alice.address, amount);

      expect(await mirrorToken.balanceOf(alice.address)).to.equal(expected);
    });

    it("routes zakat fee to the zakat pool", async function () {
      const amount = ethers.parseEther("1000");
      const zakatFee = (amount * ZAKAT_BPS) / BPS_BASE;

      await mirrorToken.transfer(alice.address, amount);

      expect(await mirrorToken.balanceOf(zakat.address)).to.equal(zakatFee);
    });

    it("approve + transferFrom deducts allowance", async function () {
      const amount = ethers.parseEther("500");
      await mirrorToken.approve(alice.address, amount);

      expect(await mirrorToken.allowance(owner.address, alice.address)).to.equal(amount);

      await mirrorToken.connect(alice).transferFrom(owner.address, bob.address, amount);

      expect(await mirrorToken.allowance(owner.address, alice.address)).to.equal(0n);
    });

    it("reverts transferFrom when allowance too low", async function () {
      const amount = ethers.parseEther("100");
      await mirrorToken.approve(alice.address, amount - 1n);
      await expect(
        mirrorToken.connect(alice).transferFrom(owner.address, bob.address, amount)
      ).to.be.revertedWith("MirrorToken: transfer amount exceeds allowance");
    });

    it("reverts transfer when balance too low", async function () {
      const amount = ethers.parseEther("100");
      await expect(
        mirrorToken.connect(alice).transfer(bob.address, amount)
      ).to.be.revertedWith("MirrorToken: transfer amount exceeds balance");
    });

    it("reverts transfer to zero address", async function () {
      await expect(
        mirrorToken.transfer(ethers.ZeroAddress, 1n)
      ).to.be.revertedWith("MirrorToken: transfer to zero address");
    });

    it("emits Transfer events including fee legs", async function () {
      const amount = ethers.parseEther("1000");
      const net    = netAmount(amount);
      const fees   = amount - net;

      const tx = await mirrorToken.transfer(alice.address, amount);
      await expect(tx)
        .to.emit(mirrorToken, "Transfer").withArgs(owner.address, ethers.ZeroAddress, fees);
      await expect(tx)
        .to.emit(mirrorToken, "Transfer").withArgs(owner.address, alice.address, net);
    });
  });

  // ─── Dividend pool ─────────────────────────────────────────────────────────

  describe("Dividend pool", function () {
    it("accumulates dividend after a transfer", async function () {
      const amount = ethers.parseEther("10000");
      const divFee = (amount * DIVIDEND_BPS) / BPS_BASE;

      await mirrorToken.transfer(alice.address, amount);
      expect(await mirrorToken.dividendPool()).to.equal(divFee);
    });

    it("allows the holder to claim their dividend share", async function () {
      // Give alice some tokens so she has a share of dividends
      const seed = ethers.parseEther("100000");
      await mirrorToken.transfer(alice.address, seed);

      // Transfer from owner generates dividends; owner and alice both have balances
      const amount = ethers.parseEther("10000");
      await mirrorToken.transfer(bob.address, amount);

      const ownerDiv = await mirrorToken.dividendOf(owner.address);
      expect(ownerDiv).to.be.gt(0n);

      const balBefore = await mirrorToken.balanceOf(owner.address);
      await mirrorToken.claimDividend();
      const balAfter = await mirrorToken.balanceOf(owner.address);

      expect(balAfter - balBefore).to.equal(ownerDiv);
    });

    it("emits DividendWithdrawn on claim", async function () {
      const amount = ethers.parseEther("10000");
      await mirrorToken.transfer(alice.address, amount);

      const claimable = await mirrorToken.dividendOf(owner.address);
      await expect(mirrorToken.claimDividend())
        .to.emit(mirrorToken, "DividendWithdrawn")
        .withArgs(owner.address, claimable);
    });

    it("reverts claimDividend when nothing to claim", async function () {
      // Alice has no tokens and no dividends
      await expect(
        mirrorToken.connect(alice).claimDividend()
      ).to.be.revertedWith("MirrorToken: no dividend to claim");
    });
  });

  // ─── Admin functions ───────────────────────────────────────────────────────

  describe("Admin", function () {
    it("owner can update the zakat pool", async function () {
      await expect(mirrorToken.setZakatPool(alice.address))
        .to.emit(mirrorToken, "ZakatPoolUpdated")
        .withArgs(zakat.address, alice.address);

      expect(await mirrorToken.zakatPool()).to.equal(alice.address);
    });

    it("non-owner cannot update zakat pool", async function () {
      await expect(
        mirrorToken.connect(alice).setZakatPool(bob.address)
      ).to.be.revertedWith("MirrorToken: caller is not owner");
    });

    it("setZakatPool reverts on zero address", async function () {
      await expect(
        mirrorToken.setZakatPool(ethers.ZeroAddress)
      ).to.be.revertedWith("MirrorToken: new pool is zero address");
    });

    it("owner can transfer ownership", async function () {
      await expect(mirrorToken.transferOwnership(alice.address))
        .to.emit(mirrorToken, "OwnershipTransferred")
        .withArgs(owner.address, alice.address);

      expect(await mirrorToken.owner()).to.equal(alice.address);
    });

    it("transferOwnership reverts on zero address", async function () {
      await expect(
        mirrorToken.transferOwnership(ethers.ZeroAddress)
      ).to.be.revertedWith("MirrorToken: new owner is zero address");
    });
  });
});
