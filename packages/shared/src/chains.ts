export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
}

export const LINEA_SEPOLIA: ChainConfig = {
  chainId: 59141,
  name: "Linea Sepolia",
  rpcUrl: "https://rpc.sepolia.linea.build",
  explorerUrl: "https://sepolia.lineascan.build",
  nativeCurrency: { name: "Linea Ether", symbol: "ETH", decimals: 18 },
};

export const LINEA_MAINNET: ChainConfig = {
  chainId: 59144,
  name: "Linea",
  rpcUrl: "https://rpc.linea.build",
  explorerUrl: "https://lineascan.build",
  nativeCurrency: { name: "Linea Ether", symbol: "ETH", decimals: 18 },
};

// ERC-4337 v0.7 EntryPoint — same canonical address on all EVM chains.
export const ENTRYPOINT_V07 = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";

export const ACTIVE_CHAIN = LINEA_SEPOLIA;
