/**
 * ConsciousnessMirrorNFT.test.js
 *
 * Comprehensive test suite for the CMIRROR ERC-721 collection.
 * Covers: deployment, publicMint, ownerMint, transfers, approvals,
 * metadata, admin functions, and edge-cases.
 */

const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ConsciousnessMirrorNFT (CMIRROR)", function () {
  let cnft;
  let owner, alice, bob, carol;

  const BASE_URI     = "ar://TEST_TXID/";
  const MINT_PRICE   = ethers.parseEther("20");   // 20 MATIC
  const TOTAL_SUPPLY = 20n;

  beforeEach(async function () {
    [owner, alice, bob, carol] = await ethers.getSigners();
    const CNFT = await ethers.getContractFactory("ConsciousnessMirrorNFT");
    cnft = await CNFT.deploy(BASE_URI, MINT_PRICE);
    await cnft.waitForDeployment();
  });

  // ─── Deployment ────────────────────────────────────────────────────────────

  describe("Deployment", function () {
    it("stores correct name and symbol", async function () {
      expect(await cnft.name()).to.equal("Consciousness Mirror");
      expect(await cnft.symbol()).to.equal("CMIRROR");
    });

    it("initialises nextMintId to 1", async function () {
      expect(await cnft.nextMintId()).to.equal(1n);
    });

    it("mint is inactive by default", async function () {
      expect(await cnft.mintActive()).to.equal(false);
    });

    it("stores the correct mint price", async function () {
      expect(await cnft.mintPrice()).to.equal(MINT_PRICE);
    });

    it("stores the base URI (visible via tokenURI after mint)", async function () {
      await cnft.setMintActive(true);
      await cnft.ownerMint(owner.address, 1);
      expect(await cnft.tokenURI(1)).to.equal(`${BASE_URI}1.json`);
    });

    it("reports correct TOTAL_SUPPLY constant", async function () {
      expect(await cnft.TOTAL_SUPPLY()).to.equal(TOTAL_SUPPLY);
    });
  });

  // ─── ERC-165 interface detection ───────────────────────────────────────────

  describe("ERC-165", function () {
    it("supports ERC-721 interface", async function () {
      expect(await cnft.supportsInterface("0x80ac58cd")).to.equal(true);
    });
    it("supports ERC-721Metadata interface", async function () {
      expect(await cnft.supportsInterface("0x5b5e139f")).to.equal(true);
    });
    it("supports ERC-165 interface", async function () {
      expect(await cnft.supportsInterface("0x01ffc9a7")).to.equal(true);
    });
    it("returns false for unknown interface", async function () {
      expect(await cnft.supportsInterface("0xdeadbeef")).to.equal(false);
    });
  });

  // ─── Public mint ───────────────────────────────────────────────────────────

  describe("publicMint", function () {
    beforeEach(async function () {
      await cnft.setMintActive(true);
    });

    it("mints token 1 when mint is active and exact payment sent", async function () {
      await cnft.connect(alice).publicMint({ value: MINT_PRICE });
      expect(await cnft.ownerOf(1)).to.equal(alice.address);
      expect(await cnft.balanceOf(alice.address)).to.equal(1n);
    });

    it("accepts overpayment and refunds excess", async function () {
      const overpay   = MINT_PRICE + ethers.parseEther("5");
      const balBefore = await ethers.provider.getBalance(alice.address);

      const tx = await cnft.connect(alice).publicMint({ value: overpay });
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;

      const balAfter = await ethers.provider.getBalance(alice.address);
      // alice spent exactly MINT_PRICE + gas (excess refunded)
      const spent = balBefore - balAfter;
      expect(spent).to.be.closeTo(MINT_PRICE + gasUsed, ethers.parseEther("0.01"));
    });

    it("increments nextMintId", async function () {
      await cnft.connect(alice).publicMint({ value: MINT_PRICE });
      expect(await cnft.nextMintId()).to.equal(2n);
    });

    it("reverts when mint is inactive", async function () {
      await cnft.setMintActive(false);
      await expect(
        cnft.connect(alice).publicMint({ value: MINT_PRICE })
      ).to.be.revertedWith("ConsciousnessMirrorNFT: mint not active");
    });

    it("reverts when insufficient payment", async function () {
      await expect(
        cnft.connect(alice).publicMint({ value: MINT_PRICE - 1n })
      ).to.be.revertedWith("ConsciousnessMirrorNFT: insufficient payment");
    });

    it("reverts when sold out", async function () {
      await cnft.ownerMint(owner.address, 20);
      await expect(
        cnft.connect(alice).publicMint({ value: MINT_PRICE })
      ).to.be.revertedWith("ConsciousnessMirrorNFT: sold out");
    });

    it("emits Transfer on mint", async function () {
      await expect(cnft.connect(alice).publicMint({ value: MINT_PRICE }))
        .to.emit(cnft, "Transfer")
        .withArgs(ethers.ZeroAddress, alice.address, 1n);
    });

    it("mint collects ETH in the contract", async function () {
      await cnft.connect(alice).publicMint({ value: MINT_PRICE });
      const addr = await cnft.getAddress();
      expect(await ethers.provider.getBalance(addr)).to.equal(MINT_PRICE);
    });
  });

  // ─── Owner mint ────────────────────────────────────────────────────────────

  describe("ownerMint", function () {
    it("owner can mint multiple tokens at once", async function () {
      await cnft.ownerMint(alice.address, 5);
      expect(await cnft.balanceOf(alice.address)).to.equal(5n);
      expect(await cnft.nextMintId()).to.equal(6n);
    });

    it("reverts when exceeding total supply", async function () {
      await expect(
        cnft.ownerMint(alice.address, 21)
      ).to.be.revertedWith("ConsciousnessMirrorNFT: exceeds supply");
    });

    it("reverts when minting to zero address", async function () {
      await expect(
        cnft.ownerMint(ethers.ZeroAddress, 1)
      ).to.be.revertedWith("ConsciousnessMirrorNFT: zero address");
    });

    it("non-owner cannot call ownerMint", async function () {
      await expect(
        cnft.connect(alice).ownerMint(alice.address, 1)
      ).to.be.revertedWith("ConsciousnessMirrorNFT: caller is not owner");
    });
  });

  // ─── Transfers & approvals ─────────────────────────────────────────────────

  describe("Transfers and approvals", function () {
    beforeEach(async function () {
      await cnft.setMintActive(true);
      await cnft.connect(alice).publicMint({ value: MINT_PRICE });
      // alice owns token 1
    });

    it("transferFrom moves token to recipient", async function () {
      await cnft.connect(alice).transferFrom(alice.address, bob.address, 1n);
      expect(await cnft.ownerOf(1n)).to.equal(bob.address);
      expect(await cnft.balanceOf(alice.address)).to.equal(0n);
      expect(await cnft.balanceOf(bob.address)).to.equal(1n);
    });

    it("approved operator can transferFrom", async function () {
      await cnft.connect(alice).approve(bob.address, 1n);
      await cnft.connect(bob).transferFrom(alice.address, carol.address, 1n);
      expect(await cnft.ownerOf(1n)).to.equal(carol.address);
    });

    it("operator approved for all can transferFrom", async function () {
      await cnft.connect(alice).setApprovalForAll(bob.address, true);
      expect(await cnft.isApprovedForAll(alice.address, bob.address)).to.equal(true);
      await cnft.connect(bob).transferFrom(alice.address, carol.address, 1n);
      expect(await cnft.ownerOf(1n)).to.equal(carol.address);
    });

    it("reverts transferFrom if not approved", async function () {
      await expect(
        cnft.connect(bob).transferFrom(alice.address, carol.address, 1n)
      ).to.be.revertedWith("ConsciousnessMirrorNFT: not approved");
    });

    it("clears approval after transfer", async function () {
      await cnft.connect(alice).approve(bob.address, 1n);
      await cnft.connect(bob).transferFrom(alice.address, carol.address, 1n);
      expect(await cnft.getApproved(1n)).to.equal(ethers.ZeroAddress);
    });

    it("reverts setApprovalForAll to self", async function () {
      await expect(
        cnft.connect(alice).setApprovalForAll(alice.address, true)
      ).to.be.revertedWith("ConsciousnessMirrorNFT: approve to caller");
    });
  });

  // ─── Metadata ──────────────────────────────────────────────────────────────

  describe("Metadata", function () {
    beforeEach(async function () {
      await cnft.ownerMint(owner.address, 3);
    });

    it("tokenURI returns base + tokenId + .json", async function () {
      expect(await cnft.tokenURI(1)).to.equal(`${BASE_URI}1.json`);
      expect(await cnft.tokenURI(3)).to.equal(`${BASE_URI}3.json`);
    });

    it("reverts tokenURI for unminted token", async function () {
      await expect(cnft.tokenURI(4))
        .to.be.revertedWith("ConsciousnessMirrorNFT: nonexistent token");
    });

    it("categoryOf returns Journey for 1–12", async function () {
      expect(await cnft.categoryOf(1)).to.equal("Journey");
      expect(await cnft.categoryOf(12)).to.equal("Journey");
    });

    it("categoryOf returns Pillar for 13–19", async function () {
      expect(await cnft.categoryOf(13)).to.equal("Pillar");
      expect(await cnft.categoryOf(19)).to.equal("Pillar");
    });

    it("categoryOf returns Master for 20", async function () {
      expect(await cnft.categoryOf(20)).to.equal("Master");
    });

    it("categoryOf reverts out of range", async function () {
      await expect(cnft.categoryOf(0))
        .to.be.revertedWith("ConsciousnessMirrorNFT: out of range");
      await expect(cnft.categoryOf(21))
        .to.be.revertedWith("ConsciousnessMirrorNFT: out of range");
    });
  });

  // ─── Admin ─────────────────────────────────────────────────────────────────

  describe("Admin", function () {
    it("setMintActive toggles mint state", async function () {
      await expect(cnft.setMintActive(true))
        .to.emit(cnft, "MintActiveUpdated").withArgs(true);
      expect(await cnft.mintActive()).to.equal(true);

      await cnft.setMintActive(false);
      expect(await cnft.mintActive()).to.equal(false);
    });

    it("setMintPrice updates price and emits event", async function () {
      const newPrice = ethers.parseEther("10");
      await expect(cnft.setMintPrice(newPrice))
        .to.emit(cnft, "MintPriceUpdated")
        .withArgs(MINT_PRICE, newPrice);
      expect(await cnft.mintPrice()).to.equal(newPrice);
    });

    it("withdraw sends balance to owner", async function () {
      await cnft.setMintActive(true);
      await cnft.connect(alice).publicMint({ value: MINT_PRICE });

      const balBefore = await ethers.provider.getBalance(owner.address);
      const tx = await cnft.withdraw();
      const receipt = await tx.wait();
      const gasUsed = receipt.gasUsed * receipt.gasPrice;
      const balAfter = await ethers.provider.getBalance(owner.address);

      expect(balAfter - balBefore + gasUsed).to.equal(MINT_PRICE);
    });

    it("withdraw reverts when nothing to withdraw", async function () {
      await expect(cnft.withdraw())
        .to.be.revertedWith("ConsciousnessMirrorNFT: nothing to withdraw");
    });

    it("setBaseURI updates token URIs and emits event", async function () {
      await cnft.ownerMint(alice.address, 1);
      const newURI = "ar://NEW_TXID/";

      await expect(cnft.setBaseURI(newURI))
        .to.emit(cnft, "BaseURIUpdated")
        .withArgs(BASE_URI, newURI);

      expect(await cnft.tokenURI(1)).to.equal(`${newURI}1.json`);
    });

    it("non-owner cannot call admin functions", async function () {
      await expect(cnft.connect(alice).setMintActive(true))
        .to.be.revertedWith("ConsciousnessMirrorNFT: caller is not owner");
      await expect(cnft.connect(alice).setMintPrice(0n))
        .to.be.revertedWith("ConsciousnessMirrorNFT: caller is not owner");
      await expect(cnft.connect(alice).withdraw())
        .to.be.revertedWith("ConsciousnessMirrorNFT: caller is not owner");
      await expect(cnft.connect(alice).setBaseURI("x"))
        .to.be.revertedWith("ConsciousnessMirrorNFT: caller is not owner");
    });

    it("transferOwnership moves ownership and emits event", async function () {
      await expect(cnft.transferOwnership(alice.address))
        .to.emit(cnft, "OwnershipTransferred")
        .withArgs(owner.address, alice.address);
      expect(await cnft.owner()).to.equal(alice.address);
    });

    it("transferOwnership reverts on zero address", async function () {
      await expect(cnft.transferOwnership(ethers.ZeroAddress))
        .to.be.revertedWith("ConsciousnessMirrorNFT: zero address");
    });
  });
});
