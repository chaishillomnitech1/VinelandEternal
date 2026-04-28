/**
 * deploy-mars-dao.js
 *
 * Deploys MarsToken and MarsDAO to the configured network.
 *
 * Environment variables (set in .env):
 *   DEPLOYER_PRIVATE_KEY      — wallet that pays gas and holds initial supply
 *   ZAKAT_TREASURY            — address receiving 2.5 % zakat on every transfer
 *   COUNCIL_0 … COUNCIL_4    — five founding council member addresses
 *   MARS_INITIAL_SUPPLY       — token supply (without decimals; default 1,000,000)
 *   MIRROR_TOKEN_ADDRESS      — already-deployed MirrorToken address (for secondary weight)
 *   REWARD_RATE               — (optional) participation reward in wei per vote
 *
 * Usage:
 *   npx hardhat run scripts/deploy-mars-dao.js --network mumbai
 *   npx hardhat run scripts/deploy-mars-dao.js --network polygon
 */

const hre    = require("hardhat");
const fs     = require("fs");
const path   = require("path");

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();

  const networkName = network.name;
  console.log(`\n🚀 Deploying Mars DAO to: ${networkName}`);
  console.log(`   Deployer: ${deployer.address}`);
  console.log(`   Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} MATIC/ETH\n`);

  // ── Config ─────────────────────────────────────────────────────────────────

  const zakatTreasury = process.env.ZAKAT_TREASURY;
  if (!zakatTreasury) throw new Error("ZAKAT_TREASURY env var not set");

  const initialSupply = BigInt(process.env.MARS_INITIAL_SUPPLY ?? "1000000");

  const council = [
    process.env.COUNCIL_0,
    process.env.COUNCIL_1,
    process.env.COUNCIL_2,
    process.env.COUNCIL_3,
    process.env.COUNCIL_4,
  ];
  for (let i = 0; i < 5; i++) {
    if (!council[i]) throw new Error(`COUNCIL_${i} env var not set`);
  }

  const mirrorTokenAddress = process.env.MIRROR_TOKEN_ADDRESS;
  if (!mirrorTokenAddress) throw new Error("MIRROR_TOKEN_ADDRESS env var not set");

  // ── Deploy MarsToken ────────────────────────────────────────────────────────

  console.log("1️⃣  Deploying MarsToken ($MARS)…");
  const MarsToken = await ethers.getContractFactory("MarsToken");
  const marsToken = await MarsToken.deploy(initialSupply, zakatTreasury);
  await marsToken.waitForDeployment();
  const marsTokenAddress = await marsToken.getAddress();
  console.log(`   ✅ MarsToken deployed at: ${marsTokenAddress}`);

  // ── Deploy MarsDAO ──────────────────────────────────────────────────────────

  console.log("\n2️⃣  Deploying MarsDAO…");
  const MarsDAO = await ethers.getContractFactory("MarsDAO");
  const dao = await MarsDAO.deploy(
    marsTokenAddress,
    mirrorTokenAddress,
    zakatTreasury,
    council
  );
  await dao.waitForDeployment();
  const daoAddress = await dao.getAddress();
  console.log(`   ✅ MarsDAO deployed at: ${daoAddress}`);

  // ── Optional: set participation reward ─────────────────────────────────────

  if (process.env.REWARD_RATE) {
    console.log("\n3️⃣  Setting participation reward rate…");
    const tx = await dao.setParticipationReward(BigInt(process.env.REWARD_RATE));
    await tx.wait();
    console.log(`   ✅ Reward rate set to: ${process.env.REWARD_RATE} wei per vote`);
  }

  // ── Save deployment manifest ─────────────────────────────────────────────────

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const manifestPath = path.join(deploymentsDir, `mars-dao-${networkName}.json`);
  const manifest = {
    network:            networkName,
    deployedAt:         new Date().toISOString(),
    deployer:           deployer.address,
    contracts: {
      MarsToken: {
        address:        marsTokenAddress,
        initialSupply:  initialSupply.toString(),
        zakatTreasury,
      },
      MarsDAO: {
        address:        daoAddress,
        mirrorToken:    mirrorTokenAddress,
        zakatTreasury,
        council,
      },
    },
  };

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\n📄 Deployment manifest saved → ${manifestPath}`);

  // ── Next steps ────────────────────────────────────────────────────────────────

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║               MARS DAO DEPLOYMENT COMPLETE                  ║
╠══════════════════════════════════════════════════════════════╣
║  MarsToken ($MARS)  ${marsTokenAddress}
║  MarsDAO            ${daoAddress}
╠══════════════════════════════════════════════════════════════╣
║  NEXT STEPS                                                  ║
║  1. Verify contracts on Polygonscan:                         ║
║     npm run verify:polygon -- --address ${marsTokenAddress}  ║
║     npm run verify:polygon -- --address ${daoAddress}        ║
║  2. Transfer initial $MARS to DAO members & council          ║
║  3. Fund DAO treasury by sending MATIC to ${daoAddress}      ║
║  4. Set guild leads via setGuildLead()                       ║
║  5. Open frontend/mars-dao/index.html to present & interact  ║
╚══════════════════════════════════════════════════════════════╝
`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
