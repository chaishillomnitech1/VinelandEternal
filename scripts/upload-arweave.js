/**
 * upload-arweave.js — VinelandEternal NFT metadata upload to Arweave
 *
 * Reads every JSON file in contracts/nft-metadata/, uploads each one to
 * the Arweave permaweb, and writes a manifest file mapping tokenId → txId.
 * When all 20 are uploaded it prints the Arweave base URI ready to paste
 * into deploy.js or to pass to ConsciousnessMirrorNFT.setBaseURI().
 *
 * Usage:
 *   node scripts/upload-arweave.js
 *
 * Required .env keys:
 *   ARWEAVE_KEY_PATH  — path to your Arweave wallet JSON keyfile
 *                       (funded with enough AR for 20 small uploads)
 *
 * Output:
 *   deployments/arweave-manifest.json  — tokenId → txId mapping
 *
 * Cost estimate: ~0.0001 AR per metadata file (~$0.001 at current AR price).
 * Fund your wallet at https://faucet.arweave.net (testnet) or buy AR.
 */

"use strict";

require("dotenv").config();
const Arweave = require("arweave");
const fs      = require("fs");
const path    = require("path");

// ── Configuration ─────────────────────────────────────────────────────────

const KEY_PATH    = process.env.ARWEAVE_KEY_PATH || "./arweave-wallet.json";
const METADATA_DIR = path.join(__dirname, "..", "contracts", "nft-metadata");
const OUT_DIR      = path.join(__dirname, "..", "deployments");
const MANIFEST_OUT = path.join(OUT_DIR, "arweave-manifest.json");

// Use arweave.net mainnet by default; switch host/port/protocol for testnet
const arweave = Arweave.init({
  host:     "arweave.net",
  port:     443,
  protocol: "https",
  timeout:  20_000,
  logging:  false,
});

// ── Helpers ───────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function uploadFile(wallet, tokenId, filePath) {
  const data = fs.readFileSync(filePath, "utf8");

  const tx = await arweave.createTransaction({ data }, wallet);
  tx.addTag("Content-Type",   "application/json");
  tx.addTag("App-Name",       "VinelandEternal");
  tx.addTag("Collection",     "ConsciousnessMirrorNFT");
  tx.addTag("Token-Id",       String(tokenId));
  tx.addTag("Standard",       "ERC-721-Metadata");

  await arweave.transactions.sign(tx, wallet);

  const resp = await arweave.transactions.post(tx);
  if (resp.status !== 200 && resp.status !== 202) {
    throw new Error(`Arweave post failed for token ${tokenId}: HTTP ${resp.status}`);
  }

  return tx.id;
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  // Load wallet
  if (!fs.existsSync(KEY_PATH)) {
    console.error(
      `\n❌  Arweave wallet not found at: ${KEY_PATH}\n` +
      `    Generate one with: node -e "const Arweave=require('arweave'); ` +
      `Arweave.init({}).wallets.generate().then(k=>require('fs').writeFileSync('arweave-wallet.json',JSON.stringify(k)))"`
    );
    process.exit(1);
  }

  const wallet = JSON.parse(fs.readFileSync(KEY_PATH, "utf8"));
  const address = await arweave.wallets.jwkToAddress(wallet);
  const balanceWinston = await arweave.wallets.getBalance(address);
  const balanceAR = arweave.ar.winstonToAr(balanceWinston);

  console.log("\n════════════════════════════════════════════════════════════");
  console.log(" VinelandEternal — Arweave Metadata Upload");
  console.log(`  Wallet  : ${address}`);
  console.log(`  Balance : ${balanceAR} AR`);
  console.log("════════════════════════════════════════════════════════════\n");

  if (parseFloat(balanceAR) < 0.001) {
    console.warn("⚠  Low AR balance — uploads may fail. Fund your wallet first.");
  }

  // Collect metadata files
  const files = fs
    .readdirSync(METADATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort((a, b) => {
      // Sort numerically by token id
      const idA = parseInt(a, 10);
      const idB = parseInt(b, 10);
      return idA - idB;
    });

  if (files.length === 0) {
    console.error(`❌  No JSON files found in ${METADATA_DIR}`);
    process.exit(1);
  }

  console.log(`▶ Uploading ${files.length} metadata files…\n`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Load existing manifest (allows resuming interrupted uploads)
  let manifest = {};
  if (fs.existsSync(MANIFEST_OUT)) {
    try {
      manifest = JSON.parse(fs.readFileSync(MANIFEST_OUT, "utf8"));
      console.log(`  ↳ Resuming from existing manifest (${Object.keys(manifest).length} already uploaded)\n`);
    } catch {
      manifest = {};
    }
  }

  for (const file of files) {
    const tokenId = parseInt(file, 10);
    if (isNaN(tokenId)) continue;

    if (manifest[tokenId]) {
      console.log(`  [${String(tokenId).padStart(2, "0")}] ✓ Already uploaded → ar://${manifest[tokenId]}`);
      continue;
    }

    const filePath = path.join(METADATA_DIR, file);
    process.stdout.write(`  [${String(tokenId).padStart(2, "0")}] Uploading ${file} … `);

    try {
      const txId = await uploadFile(wallet, tokenId, filePath);
      manifest[tokenId] = txId;
      fs.writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2));
      console.log(`✓ ${txId}`);
    } catch (err) {
      console.error(`\n  ❌ Failed: ${err.message}`);
    }

    // Throttle — Arweave gateway rate-limits at ~1 req/s
    await sleep(1_100);
  }

  // ── Build Arweave base URI ────────────────────────────────────────────────
  //
  // For metadata to be served as tokenId.json, we create an Arweave path
  // manifest that maps "1.json" → txId, "2.json" → txId, etc.
  // The base URI consumers use is:  ar://<pathManifestTxId>/
  //
  // Alternatively, if using individual file TXIDs you can update tokenURI
  // on-chain per token. The simpler pattern for this collection is a path
  // manifest so the base URI pattern (baseURI + tokenId + ".json") works.

  console.log("\n▶ Creating Arweave path manifest…");

  const pathManifestData = {
    manifest: "arweave/paths",
    version:  "0.1.0",
    index:    { path: "1.json" },
    paths:    {},
  };

  for (const [tokenId, txId] of Object.entries(manifest)) {
    pathManifestData.paths[`${tokenId}.json`] = { id: txId };
  }

  let pathManifestTxId = null;
  try {
    const pathTx = await arweave.createTransaction(
      { data: JSON.stringify(pathManifestData) },
      wallet
    );
    pathTx.addTag("Content-Type", "application/x.arweave-manifest+json");
    pathTx.addTag("App-Name",     "VinelandEternal");
    await arweave.transactions.sign(pathTx, wallet);
    const pmResp = await arweave.transactions.post(pathTx);
    if (pmResp.status === 200 || pmResp.status === 202) {
      pathManifestTxId = pathTx.id;
      console.log(`  ✓ Path manifest uploaded → ${pathManifestTxId}`);
    } else {
      console.warn(`  ⚠ Path manifest failed: HTTP ${pmResp.status}`);
    }
  } catch (err) {
    console.warn(`  ⚠ Path manifest error: ${err.message}`);
  }

  // ── Save final manifest ───────────────────────────────────────────────────

  const finalManifest = {
    uploadedAt:       new Date().toISOString(),
    wallet:           address,
    tokenTxIds:       manifest,
    pathManifestTxId: pathManifestTxId,
    baseURI:          pathManifestTxId ? `ar://${pathManifestTxId}/` : null,
  };
  fs.writeFileSync(MANIFEST_OUT, JSON.stringify(finalManifest, null, 2));

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log("\n════════════════════════════════════════════════════════════");
  console.log(" Upload complete ✅");
  console.log(`  Manifest saved → deployments/arweave-manifest.json`);
  if (pathManifestTxId) {
    console.log(`\n  Arweave base URI:`);
    console.log(`    ar://${pathManifestTxId}/`);
    console.log(`\n  Next step — update the NFT contract base URI:`);
    console.log(`    npx hardhat run scripts/set-base-uri.js --network mumbai`);
    console.log(`  or call setBaseURI("ar://${pathManifestTxId}/") directly.`);
  }
  console.log("════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
