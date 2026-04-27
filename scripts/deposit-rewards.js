/**
 * deposit-rewards.js — Seed the MirrorStaking reward reserve
 *
 * Reads deployed contract addresses from deployments/<network>.json and
 * transfers a specified amount of $MIRROR into the MirrorStaking contract
 * so that stakers can earn rewards.
 *
 * Usage:
 *   npx hardhat run scripts/deposit-rewards.js --network mumbai
 *
 * Optional env overrides:
 *   REWARD_DEPOSIT_AMOUNT  — amount of $MIRROR to deposit (whole tokens, no decimals)
 *                            Default: 100,000 $MIRROR
 */

"use strict";

const { ethers, network } = require("hardhat");
const fs   = require("fs");
const path = require("path");

// Minimal ABIs — only the functions this script calls
const MIRROR_ABI = [
  "function balanceOf(address) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

const STAKING_ABI = [
  "function depositRewards(uint256 amount) external",
  "function rewardReserve() external view returns (uint256)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;

  // ── Load deployment manifest ────────────────────────────────────────────────
  const deploymentPath = path.join(__dirname, "..", "deployments", `${networkName}.json`);
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(
      `No deployment manifest for network "${networkName}".\n` +
      `Run: npx hardhat run scripts/deploy.js --network ${networkName}`
    );
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const mirrorAddress  = deployment.contracts.MirrorToken;
  const stakingAddress = deployment.contracts.MirrorStaking;

  // ── Configuration ───────────────────────────────────────────────────────────
  const depositWhole  = BigInt(process.env.REWARD_DEPOSIT_AMOUNT || "100000");
  const depositAmount = depositWhole * 10n ** 18n;

  console.log("\n════════════════════════════════════════════════════════════");
  console.log(" VinelandEternal — Deposit Staking Rewards");
  console.log(`  Network       : ${networkName}`);
  console.log(`  Deployer      : ${deployer.address}`);
  console.log(`  MirrorToken   : ${mirrorAddress}`);
  console.log(`  MirrorStaking : ${stakingAddress}`);
  console.log(`  Deposit       : ${depositWhole.toLocaleString()} $MIRROR`);
  console.log("════════════════════════════════════════════════════════════\n");

  const mirrorToken  = new ethers.Contract(mirrorAddress,  MIRROR_ABI,  deployer);
  const staking      = new ethers.Contract(stakingAddress, STAKING_ABI, deployer);

  // ── Pre-flight checks ───────────────────────────────────────────────────────
  const deployerBalance = await mirrorToken.balanceOf(deployer.address);
  console.log(`▶ Deployer $MIRROR balance : ${ethers.formatEther(deployerBalance)} MIRROR`);

  if (deployerBalance < depositAmount) {
    throw new Error(
      `Insufficient $MIRROR balance.\n` +
      `  Have : ${ethers.formatEther(deployerBalance)} MIRROR\n` +
      `  Need : ${ethers.formatEther(depositAmount)} MIRROR`
    );
  }

  const reserveBefore = await staking.rewardReserve();
  console.log(`  Current reserve : ${ethers.formatEther(reserveBefore)} MIRROR\n`);

  // ── Approve ─────────────────────────────────────────────────────────────────
  console.log("▶ Approving MirrorStaking to spend $MIRROR…");
  const approveTx = await mirrorToken.approve(stakingAddress, depositAmount);
  console.log(`  tx: ${approveTx.hash}`);
  await approveTx.wait();
  console.log("  ✓ Approved\n");

  // ── Deposit ─────────────────────────────────────────────────────────────────
  console.log("▶ Calling depositRewards()…");
  const depositTx = await staking.depositRewards(depositAmount);
  console.log(`  tx: ${depositTx.hash}`);
  await depositTx.wait();
  console.log("  ✓ Deposited\n");

  // ── Summary ─────────────────────────────────────────────────────────────────
  const reserveAfter = await staking.rewardReserve();
  console.log("════════════════════════════════════════════════════════════");
  console.log(" Deposit complete ✅");
  console.log(`  Reserve before : ${ethers.formatEther(reserveBefore)} MIRROR`);
  console.log(`  Deposited      : ${ethers.formatEther(depositAmount)} MIRROR`);
  console.log(`  Reserve after  : ${ethers.formatEther(reserveAfter)} MIRROR`);
  console.log("════════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
