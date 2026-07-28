import * as path from "path";
import * as dotenv from "dotenv";
import "@nomicfoundation/hardhat-toolbox";
import type { HardhatUserConfig } from "hardhat/config";

// Root .env is shared across the monorepo (contracts + mobile read from it).
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {},
    lineaSepolia: {
      url: process.env.LINEA_SEPOLIA_RPC_URL || "https://rpc.sepolia.linea.build",
      chainId: 59141,
      accounts,
    },
    lineaMainnet: {
      url: process.env.LINEA_MAINNET_RPC_URL || "https://rpc.linea.build",
      chainId: 59144,
      accounts,
    },
  },
  etherscan: {
    apiKey: {
      lineaSepolia: process.env.LINEASCAN_API_KEY || "",
      lineaMainnet: process.env.LINEASCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "lineaSepolia",
        chainId: 59141,
        urls: {
          apiURL: "https://api-sepolia.lineascan.build/api",
          browserURL: "https://sepolia.lineascan.build",
        },
      },
      {
        network: "lineaMainnet",
        chainId: 59144,
        urls: {
          apiURL: "https://api.lineascan.build/api",
          browserURL: "https://lineascan.build",
        },
      },
    ],
  },
};

export default config;
