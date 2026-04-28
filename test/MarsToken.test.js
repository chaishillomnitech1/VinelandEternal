/**
 * MarsToken.test.js
 *
 * Comprehensive test suite for $MARS ERC-20 token.
 * Covers: deployment, transfer fees (zakat + governance reserve),
 * approvals, admin functions, and edge-cases.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("MarsToken ($MARS)", function () {
  let marsToken;
  let owner, zakat, alice, bob, carol;

  const SUPPLY      = 1_000_000n;
  const DECIMALS    = 18n;
  const SUPPLY_WEI  = SUPPLY * 10n ** DECIMALS;
  const ZAKAT_BPS   = 250n;  // 2.5 %
  const RESERVE_BPS = 100n;  // 1 %
  const BPS_BASE    = 10_000n;

  function netAmount(amount) {
    const z = (amount * ZAKAT_BPS)   / BPS_BASE;
    const r = (amount * RESERVE_BPS) / BPS_BASE;
    return amount - z - r;
  }

  beforeEach(async function () {
    [owner, zakat, alice, bob, carol] = await ethers.getSigners();
    const MarsToken = await ethers.getContractFactory("MarsToken");
    marsToken = await MarsToken.deploy(SUPPLY, zakat.address);
    await marsToken.waitForDeployment();
  });

  // ── Deployment ──────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("sets correct name and symbol", async function () {
      expect(await marsToken.name()).to.equal("Mars Token");
      expect(await marsToken.symbol()).to.equal("MARS");
    });

    it("has 18 decimals", async function () {
      expect(await marsToken.decimals()).to.equal(18n);
    });

    it("mints total supply to deployer", async function () {
      expect(await marsToken.totalSupply()).to.equal(SUPPLY_WEI);
      expect(await marsToken.balanceOf(owner.address)).to.equal(SUPPLY_WEI);
    });

    it("stores the zakat treasury address", async function () {
      expect(await marsToken.zakatTreasury()).to.equal(zakat.address);
    });

    it("reverts if zakat treasury is zero address", async function () {
      const MarsToken = await ethers.getContractFactory("MarsToken");
      await expect(
        MarsToken.deploy(SUPPLY, ethers.ZeroAddress)
      ).to.be.revertedWith("MarsToken: zero zakat treasury");
    });

    it("immutable fee constants are correct", async function () {
      expect(await marsToken.ZAKAT_BPS()).to.equal(250n);
      expect(await marsToken.RESERVE_BPS()).to.equal(100n);
    });

    it("governance reserve starts at zero", async function () {
      expect(await marsToken.governanceReserve()).to.equal(0n);
    });
  });

  // ── ERC-20 standard ─────────────────────────────────────────────────────────

  describe("ERC-20 standard", function () {
    it("transfers net amount after deducting fees", async function () {
      const amount = ethers.parseEther("1000");
      await marsToken.transfer(alice.address, amount);
      expect(await marsToken.balanceOf(alice.address)).to.equal(netAmount(amount));
    });

    it("routes zakat fee to zakat treasury", async function () {
      const amount   = ethers.parseEther("1000");
      const zakatFee = (amount * ZAKAT_BPS) / BPS_BASE;
      await marsToken.transfer(alice.address, amount);
      expect(await marsToken.balanceOf(zakat.address)).to.equal(zakatFee);
    });

    it("accumulates governance reserve in the contract", async function () {
      const amount      = ethers.parseEther("1000");
      const reserveFee  = (amount * RESERVE_BPS) / BPS_BASE;
      await marsToken.transfer(alice.address, amount);
      expect(await marsToken.governanceReserve()).to.equal(reserveFee);
      const addr = await marsToken.getAddress();
      expect(await marsToken.balanceOf(addr)).to.equal(reserveFee);
    });

    it("approve + transferFrom deducts allowance", async function () {
      const amount = ethers.parseEther("500");
      await marsToken.approve(alice.address, amount);
      expect(await marsToken.allowance(owner.address, alice.address)).to.equal(amount);
      await marsToken.connect(alice).transferFrom(owner.address, bob.address, amount);
      expect(await marsToken.allowance(owner.address, alice.address)).to.equal(0n);
    });

    it("reverts transferFrom when allowance too low", async function () {
      const amount = ethers.parseEther("100");
      await marsToken.approve(alice.address, amount - 1n);
      await expect(
        marsToken.connect(alice).transferFrom(owner.address, bob.address, amount)
      ).to.be.revertedWith("MarsToken: transfer amount exceeds allowance");
    });

    it("reverts transfer when balance insufficient", async function () {
      await expect(
        marsToken.connect(alice).transfer(bob.address, 1n)
      ).to.be.revertedWith("MarsToken: transfer amount exceeds balance");
    });

    it("reverts transfer to zero address", async function () {
      await expect(
        marsToken.transfer(ethers.ZeroAddress, 1n)
      ).to.be.revertedWith("MarsToken: transfer to zero address");
    });

    it("emits Transfer events for net, zakat, and reserve legs", async function () {
      const amount = ethers.parseEther("1000");
      const net    = netAmount(amount);
      const fees   = amount - net;
      const tx = await marsToken.transfer(alice.address, amount);
      await expect(tx).to.emit(marsToken, "Transfer")
        .withArgs(owner.address, ethers.ZeroAddress, fees);
      await expect(tx).to.emit(marsToken, "Transfer")
        .withArgs(owner.address, alice.address, net);
    });

    it("emits ZakatTransferred event on each transfer", async function () {
      const amount   = ethers.parseEther("1000");
      const zakatAmt = (amount * ZAKAT_BPS) / BPS_BASE;
      await expect(marsToken.transfer(alice.address, amount))
        .to.emit(marsToken, "ZakatTransferred")
        .withArgs(zakat.address, zakatAmt);
    });
  });

  // ── Governance reserve ──────────────────────────────────────────────────────

  describe("Governance reserve", function () {
    it("owner can withdraw governance reserve", async function () {
      const amount = ethers.parseEther("10000");
      await marsToken.transfer(alice.address, amount);

      const reserve = await marsToken.governanceReserve();
      expect(reserve).to.be.gt(0n);

      const balBefore = await marsToken.balanceOf(bob.address);
      await marsToken.withdrawGovernanceReserve(bob.address, reserve);
      expect(await marsToken.balanceOf(bob.address)).to.equal(balBefore + reserve);
      expect(await marsToken.governanceReserve()).to.equal(0n);
    });

    it("reverts withdrawal exceeding reserve", async function () {
      await expect(
        marsToken.withdrawGovernanceReserve(bob.address, 1n)
      ).to.be.revertedWith("MarsToken: exceeds reserve");
    });

    it("non-owner cannot withdraw reserve", async function () {
      await expect(
        marsToken.connect(alice).withdrawGovernanceReserve(alice.address, 0n)
      ).to.be.revertedWith("MarsToken: caller is not owner");
    });

    it("reverts withdrawal to zero address", async function () {
      await marsToken.transfer(alice.address, ethers.parseEther("1000"));
      const reserve = await marsToken.governanceReserve();
      await expect(
        marsToken.withdrawGovernanceReserve(ethers.ZeroAddress, reserve)
      ).to.be.revertedWith("MarsToken: zero address");
    });
  });

  // ── Admin ────────────────────────────────────────────────────────────────────

  describe("Admin", function () {
    it("owner can update the zakat treasury", async function () {
      await expect(marsToken.setZakatTreasury(alice.address))
        .to.emit(marsToken, "ZakatTreasuryUpdated")
        .withArgs(zakat.address, alice.address);
      expect(await marsToken.zakatTreasury()).to.equal(alice.address);
    });

    it("setZakatTreasury reverts on zero address", async function () {
      await expect(
        marsToken.setZakatTreasury(ethers.ZeroAddress)
      ).to.be.revertedWith("MarsToken: zero address");
    });

    it("non-owner cannot update zakat treasury", async function () {
      await expect(
        marsToken.connect(alice).setZakatTreasury(bob.address)
      ).to.be.revertedWith("MarsToken: caller is not owner");
    });

    it("owner can transfer ownership", async function () {
      await expect(marsToken.transferOwnership(alice.address))
        .to.emit(marsToken, "OwnershipTransferred")
        .withArgs(owner.address, alice.address);
      expect(await marsToken.owner()).to.equal(alice.address);
    });

    it("transferOwnership reverts on zero address", async function () {
      await expect(
        marsToken.transferOwnership(ethers.ZeroAddress)
      ).to.be.revertedWith("MarsToken: zero address");
    });
  });
});
