/**
 * flight-mint.js — VinelandEternal Drone Alchemy: Harvest IS Token Minter
 *
 * Each completed drone delivery flight mints an on-chain NFT (ERC-721) that
 * records the surplus cleared, carbon saved, and community impact score.
 * Token metadata is pinned to IPFS and the CID is appended to the Zaire ∞ ledger.
 *
 * Usage:
 *   npm install ethers axios form-data
 *   INFURA_URL=https://... PRIVATE_KEY=0x... CONTRACT_ADDRESS=0x... node flight-mint.js
 */

"use strict";

const { ethers } = require("ethers");
const axios = require("axios");
const FormData = require("form-data");

// ---------------------------------------------------------------------------
// Configuration (override via environment variables)
// ---------------------------------------------------------------------------
const INFURA_URL = process.env.INFURA_URL || "https://rpc.ankr.com/eth_sepolia";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "";
const IPFS_API = process.env.IPFS_API || "https://api.pinata.cloud/pinning/pinJSONToIPFS";
const PINATA_JWT = process.env.PINATA_JWT || "";

// Minimal ERC-721 ABI — only the mint function we need
const MINT_ABI = [
  "function safeMint(address to, string uri) returns (uint256)",
];

// ---------------------------------------------------------------------------
// IPFS helpers
// ---------------------------------------------------------------------------

/**
 * Pin JSON metadata to IPFS via Pinata and return the CID.
 * Falls back to a deterministic mock CID when no JWT is configured.
 *
 * @param {object} metadata
 * @returns {Promise<string>} IPFS CID
 */
async function pinMetadataToIPFS(metadata) {
  if (!PINATA_JWT) {
    const hash = Buffer.from(JSON.stringify(metadata)).toString("base64").slice(0, 46);
    console.warn("PINATA_JWT not set — using mock CID:", `Qm${hash}`);
    return `Qm${hash}`;
  }

  const response = await axios.post(
    IPFS_API,
    { pinataContent: metadata, pinataMetadata: { name: `harvest-${metadata.flight_id}` } },
    { headers: { Authorization: `Bearer ${PINATA_JWT}`, "Content-Type": "application/json" } }
  );
  return response.data.IpfsHash;
}

// ---------------------------------------------------------------------------
// Token minting
// ---------------------------------------------------------------------------

/**
 * Mint a Harvest IS Token for a completed drone delivery flight.
 *
 * @param {object} flightData
 * @param {string} flightData.flight_id      - Unique flight identifier
 * @param {string} flightData.tray_id        - Source tray
 * @param {string} flightData.crop_type      - Crop delivered
 * @param {number} flightData.surplus_g      - Surplus weight delivered (grams)
 * @param {number} flightData.distance_km    - Flight distance
 * @param {number} flightData.carbon_saved_g - Estimated carbon offset (grams CO₂)
 * @param {number} flightData.agape_value    - Community impact score 0-100
 * @param {string} flightData.recipient      - Ethereum address of recipient
 * @returns {Promise<object>} Receipt including tokenId and tokenURI
 */
async function mintHarvestToken(flightData) {
  const {
    flight_id,
    tray_id,
    crop_type,
    surplus_g,
    distance_km,
    carbon_saved_g,
    agape_value,
    recipient,
  } = flightData;

  // Build NFT metadata (OpenSea-compatible)
  const metadata = {
    name: `Harvest IS Token — ${crop_type} Flight ${flight_id}`,
    description:
      "A Proof-of-Love NFT minted by the VinelandEternal Drone Alchemy grid. " +
      "Each token represents a surplus-clearing delivery that nourishes the community.",
    image: "ipfs://QmVinelandLogoPlaceholder",
    attributes: [
      { trait_type: "Crop Type",        value: crop_type },
      { trait_type: "Tray ID",          value: tray_id },
      { trait_type: "Surplus (g)",      value: surplus_g },
      { trait_type: "Distance (km)",    value: distance_km },
      { trait_type: "Carbon Saved (g)", value: carbon_saved_g },
      { trait_type: "Agape Value",      value: agape_value },
      { trait_type: "Flight ID",        value: flight_id },
      { trait_type: "Timestamp",        value: new Date().toISOString() },
    ],
  };

  const cid = await pinMetadataToIPFS(metadata);
  const tokenURI = `ipfs://${cid}`;

  console.log(`\n🚁 Flight ${flight_id} — Minting Harvest IS Token`);
  console.log(`   Crop: ${crop_type} | Surplus: ${surplus_g}g | Agape: ${agape_value}`);
  console.log(`   Token URI: ${tokenURI}`);

  // If no contract is configured, return a dry-run result
  if (!PRIVATE_KEY || !CONTRACT_ADDRESS) {
    console.warn("   ⚠️  PRIVATE_KEY or CONTRACT_ADDRESS not set — dry-run mode.");
    return { flight_id, tokenURI, txHash: null, tokenId: null };
  }

  const provider = new ethers.JsonRpcProvider(INFURA_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, MINT_ABI, signer);

  const tx = await contract.safeMint(recipient, tokenURI);
  const receipt = await tx.wait();

  const tokenId = receipt.logs[0]?.topics[3]
    ? parseInt(receipt.logs[0].topics[3], 16)
    : null;

  console.log(`   ✅ Minted! Tx: ${receipt.hash} | Token ID: ${tokenId}`);
  return { flight_id, tokenURI, txHash: receipt.hash, tokenId };
}

// ---------------------------------------------------------------------------
// Demo — runs when executed directly
// ---------------------------------------------------------------------------
if (require.main === module) {
  const sampleFlight = {
    flight_id: "flight-2026-001",
    tray_id: "tray3",
    crop_type: "Pea Shoots",
    surplus_g: 450,
    distance_km: 3.2,
    carbon_saved_g: 180,
    agape_value: 94,
    recipient: "0x0000000000000000000000000000000000000001",
  };

  mintHarvestToken(sampleFlight)
    .then((result) => {
      console.log("\n💎 Zaire ∞ Token Result:", JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error("Mint error:", err.message);
      process.exit(1);
    });
}

module.exports = { mintHarvestToken };
