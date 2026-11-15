require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const deployerAccounts = process.env.DEPLOYER_PRIVATE_KEY
  ? [process.env.DEPLOYER_PRIVATE_KEY]
  : [];
const networks = {
  localhost: { url: "http://127.0.0.1:8545" },
};

// Polygon's public Mumbai, Amoy, and mainnet RPC defaults are not used.
// Configure a maintained provider endpoint explicitly in the secure runtime.
if (process.env.AMOY_RPC_URL) {
  networks.amoy = { url: process.env.AMOY_RPC_URL, accounts: deployerAccounts, chainId: 80002 };
}
if (process.env.POLYGON_RPC_URL) {
  networks.polygon = { url: process.env.POLYGON_RPC_URL, accounts: deployerAccounts, chainId: 137 };
}
if (process.env.SEPOLIA_RPC_URL) {
  networks.sepolia = { url: process.env.SEPOLIA_RPC_URL, accounts: deployerAccounts, chainId: 11155111 };
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks,
  etherscan: {
    apiKey: {
      polygonAmoy: process.env.POLYGONSCAN_API_KEY || "",
      polygon: process.env.POLYGONSCAN_API_KEY || "",
      sepolia: process.env.ETHERSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "polygonAmoy",
        chainId: 80002,
        urls: {
          apiURL: "https://api-amoy.polygonscan.com/api",
          browserURL: "https://amoy.polygonscan.com",
        },
      },
    ],
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    token: "POL",
  },
};
