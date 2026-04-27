require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  networks: {
    // ── Local development ──────────────────────────────────────────────────
    localhost: {
      url: "http://127.0.0.1:8545",
    },

    // ── Mumbai (Polygon testnet) ───────────────────────────────────────────
    // Set MUMBAI_RPC_URL and DEPLOYER_PRIVATE_KEY in .env
    mumbai: {
      url: process.env.MUMBAI_RPC_URL || "https://rpc-mumbai.maticvigil.com",
      accounts:
        process.env.DEPLOYER_PRIVATE_KEY !== undefined
          ? [process.env.DEPLOYER_PRIVATE_KEY]
          : [],
      chainId: 80001,
    },

    // ── Sepolia testnet (optional secondary target) ────────────────────────
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts:
        process.env.DEPLOYER_PRIVATE_KEY !== undefined
          ? [process.env.DEPLOYER_PRIVATE_KEY]
          : [],
      chainId: 11155111,
    },
  },

  // ── Etherscan / Polygonscan verification ──────────────────────────────────
  etherscan: {
    apiKey: {
      polygonMumbai: process.env.POLYGONSCAN_API_KEY || "",
      sepolia:       process.env.ETHERSCAN_API_KEY   || "",
    },
  },

  // ── Gas reporter ──────────────────────────────────────────────────────────
  gasReporter: {
    enabled:  process.env.REPORT_GAS === "true",
    currency: "USD",
    token:    "MATIC",
  },
};
