/**
 * set-base-uri.js — Update ConsciousnessMirrorNFT baseURI after Arweave upload
 *
 * Reads the Arweave path manifest from deployments/arweave-manifest.json
 * and the deployed contract address from deployments/<network>.json,
 * then calls setBaseURI() on-chain.
 *
 * Usage:
 *   npx hardhat run scripts/set-base-uri.js --network mumbai
 *
 * Or pass a URI directly via env:
 *   BASE_URI="ar://YOUR_TXID/" npx hardhat run scripts/set-base-uri.js --network mumbai
 */

"use strict";

const { ethers, network } = require("hardhat");
const fs   = require("fs");
const path = require("path");

// Minimal ABI — only the function we need
const ABI = [
  "function setBaseURI(string calldata newURI) external",
  "function tokenURI(uint256 tokenId) external view returns (string memory)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;

  // ── Resolve contract address ─────────────────────────────────────────────
  const deploymentPath = path.join(__dirname, "..", "deployments", `${networkName}.json`);
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(
      `No deployment manifest found for network "${networkName}".\n` +
      `Run: npx hardhat run scripts/deploy.js --network ${networkName}`
    );
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const cnftAddress = deployment.contracts.ConsciousnessMirrorNFT;

  // ── Resolve new base URI ─────────────────────────────────────────────────
  let baseURI = process.env.BASE_URI;
  if (!baseURI) {
    const arManifestPath = path.join(__dirname, "..", "deployments", "arweave-manifest.json");
    if (!fs.existsSync(arManifestPath)) {
      throw new Error(
        "No BASE_URI env var and no deployments/arweave-manifest.json found.\n" +
        "Run: node scripts/upload-arweave.js   — or set BASE_URI=ar://YOUR_TXID/"
      );
    }
    const arManifest = JSON.parse(fs.readFileSync(arManifestPath, "utf8"));
    baseURI = arManifest.baseURI;
    if (!baseURI) {
      throw new Error(
        "arweave-manifest.json exists but baseURI is null — " +
        "the path manifest upload may have failed. Re-run upload-arweave.js."
      );
    }
  }

  console.log("\n════════════════════════════════════════════════════════════");
  console.log(" VinelandEternal — Set Base URI");
  console.log(`  Network  : ${networkName}`);
  console.log(`  Contract : ${cnftAddress}`);
  console.log(`  New URI  : ${baseURI}`);
  console.log("════════════════════════════════════════════════════════════\n");

  const cnft = new ethers.Contract(cnftAddress, ABI, deployer);

  console.log("▶ Sending setBaseURI() transaction…");
  const tx = await cnft.setBaseURI(baseURI);
  console.log(`  tx hash: ${tx.hash}`);
  await tx.wait();
  console.log("  ✓ Confirmed\n");

  // Quick smoke-test: read token #1 URI
  const uri1 = await cnft.tokenURI(1).catch(() => "(token 1 not yet minted)");
  console.log(`  tokenURI(1) → ${uri1}`);

  console.log("\n════════════════════════════════════════════════════════════");
  console.log(" Base URI updated ✅");
  console.log("════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
