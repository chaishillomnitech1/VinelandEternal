/**
 * deploy.js — VinelandEternal full-stack deployment script (Hardhat)
 *
 * Deploys all three contracts in dependency order:
 *   1. MirrorToken       ($MIRROR ERC-20)
 *   2. ConsciousnessMirrorNFT  (CMIRROR ERC-721)
 *   3. MirrorStaking     (staking module)
 *
 * After deployment:
 *   • Prints deployed addresses
 *   • Saves a deployment manifest to deployments/<network>.json
 *   • Verifies contracts on Polygonscan / Etherscan if POLYGONSCAN_API_KEY
 *     (or ETHERSCAN_API_KEY) is present in the environment
 *
 * Usage:
 *   npx hardhat run scripts/deploy.js --network mumbai
 *   npx hardhat run scripts/deploy.js --network sepolia
 *   npx hardhat run scripts/deploy.js --network localhost
 *
 * Required .env keys (see .env.example):
 *   DEPLOYER_PRIVATE_KEY, MUMBAI_RPC_URL, ZAKAT_POOL_ADDRESS,
 *   MIRROR_INITIAL_SUPPLY, MINT_PRICE_MATIC, STAKING_REWARD_RATE
 */

const { ethers, run, network } = require("hardhat");
const fs   = require("fs");
const path = require("path");

// ── Helpers ──────────────────────────────────────────────────────────────────

function env(key, fallback) {
  const val = process.env[key];
  if (val === undefined || val === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var: ${key}`);
  }
  return val;
}

async function verify(address, constructorArgs) {
  try {
    console.log(`  ↳ Verifying ${address} …`);
    await run("verify:verify", { address, constructorArguments: constructorArgs });
    console.log("  ✓ Verified");
  } catch (err) {
    // "Already Verified" is fine; anything else is logged but non-fatal
    if (err.message && err.message.includes("Already Verified")) {
      console.log("  ✓ Already verified");
    } else {
      console.warn("  ⚠ Verification failed:", err.message);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;

  console.log("\n════════════════════════════════════════════════════════════");
  console.log(" VinelandEternal — ScrollVerse Deployment");
  console.log(`  Network  : ${networkName}`);
  console.log(`  Deployer : ${deployer.address}`);
  console.log(`  Balance  : ${ethers.formatEther(await deployer.provider.getBalance(deployer.address))} native`);
  console.log("════════════════════════════════════════════════════════════\n");

  // ── 1. Read configuration ─────────────────────────────────────────────────

  const zakatPool        = env("ZAKAT_POOL_ADDRESS");
  const initialSupply    = BigInt(env("MIRROR_INITIAL_SUPPLY", "1000000"));
  const mintPriceMatic   = env("MINT_PRICE_MATIC", "20");
  const mintPriceWei     = ethers.parseEther(mintPriceMatic);
  const rewardRate       = BigInt(env("STAKING_REWARD_RATE", "1000000000000000")); // 0.001 MIRROR/s

  // Placeholder Arweave base URI — update via setBaseURI() after uploading metadata
  const baseURI = env("NFT_BASE_URI", "ar://PLACEHOLDER/");

  // ── 2. Deploy MirrorToken ─────────────────────────────────────────────────

  console.log("▶ Deploying MirrorToken ($MIRROR)…");
  const MirrorToken = await ethers.getContractFactory("MirrorToken");
  const mirrorToken = await MirrorToken.deploy(initialSupply, zakatPool);
  await mirrorToken.waitForDeployment();
  const mirrorTokenAddress = await mirrorToken.getAddress();
  console.log(`  ✓ MirrorToken deployed  → ${mirrorTokenAddress}\n`);

  // ── 3. Deploy ConsciousnessMirrorNFT ─────────────────────────────────────

  console.log("▶ Deploying ConsciousnessMirrorNFT (CMIRROR)…");
  const CNFT = await ethers.getContractFactory("ConsciousnessMirrorNFT");
  const cnft = await CNFT.deploy(baseURI, mintPriceWei);
  await cnft.waitForDeployment();
  const cnftAddress = await cnft.getAddress();
  console.log(`  ✓ ConsciousnessMirrorNFT deployed  → ${cnftAddress}`);

  // Enable minting immediately after deploy
  const enableTx = await cnft.setMintActive(true);
  await enableTx.wait();
  console.log("  ✓ Public mint activated\n");

  // ── 4. Deploy MirrorStaking ───────────────────────────────────────────────

  console.log("▶ Deploying MirrorStaking…");
  const Staking = await ethers.getContractFactory("MirrorStaking");
  const staking = await Staking.deploy(
    mirrorTokenAddress,
    cnftAddress,
    zakatPool,
    rewardRate
  );
  await staking.waitForDeployment();
  const stakingAddress = await staking.getAddress();
  console.log(`  ✓ MirrorStaking deployed  → ${stakingAddress}\n`);

  // ── 5. Save deployment manifest ───────────────────────────────────────────

  const manifest = {
    network:    networkName,
    deployedAt: new Date().toISOString(),
    deployer:   deployer.address,
    contracts: {
      MirrorToken:           mirrorTokenAddress,
      ConsciousnessMirrorNFT: cnftAddress,
      MirrorStaking:         stakingAddress,
    },
    config: {
      mirrorInitialSupply: initialSupply.toString(),
      mintPriceWei:        mintPriceWei.toString(),
      rewardRate:          rewardRate.toString(),
      zakatPool,
      baseURI,
    },
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const outFile = path.join(deploymentsDir, `${networkName}.json`);
  fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2));
  console.log(`📄 Deployment manifest saved → deployments/${networkName}.json\n`);

  // ── 6. Polygonscan / Etherscan verification ───────────────────────────────

  const hasApiKey =
    process.env.POLYGONSCAN_API_KEY || process.env.ETHERSCAN_API_KEY;

  if (hasApiKey && networkName !== "localhost" && networkName !== "hardhat") {
    console.log("▶ Verifying contracts on block explorer…");
    // Wait a few blocks for the explorer to index the contracts
    console.log("  Waiting 15 s for explorer indexing…");
    await new Promise((r) => setTimeout(r, 15_000));

    await verify(mirrorTokenAddress,  [initialSupply, zakatPool]);
    await verify(cnftAddress,         [baseURI, mintPriceWei]);
    await verify(stakingAddress,      [mirrorTokenAddress, cnftAddress, zakatPool, rewardRate]);
  } else {
    console.log("ℹ  Skipping verification (no API key or local network)");
  }

  // ── 7. Summary ────────────────────────────────────────────────────────────

  console.log("\n════════════════════════════════════════════════════════════");
  console.log(" Deployment complete ✅");
  console.log(`  MirrorToken            : ${mirrorTokenAddress}`);
  console.log(`  ConsciousnessMirrorNFT : ${cnftAddress}`);
  console.log(`  MirrorStaking          : ${stakingAddress}`);
  console.log("\n  Next steps:");
  console.log("  1. Run scripts/upload-arweave.js to push metadata to Arweave");
  console.log("  2. Call setBaseURI(arweaveBaseURI) on the NFT contract");
  console.log("  3. Call depositRewards() on MirrorStaking to fund the reward pool");
  console.log("════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
