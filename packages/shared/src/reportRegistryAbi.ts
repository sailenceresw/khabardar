// Hand-maintained minimal ABI for ReportRegistry.sol. If the contract changes,
// re-run `npm run contracts:compile` and sync this from
// packages/contracts/artifacts/contracts/ReportRegistry.sol/ReportRegistry.json
export const REPORT_REGISTRY_ABI = [
  {
    type: "function",
    name: "submitReport",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reportHash", type: "bytes32" },
      { name: "category", type: "uint8" },
      { name: "coarseGeohash", type: "bytes32" },
    ],
    outputs: [{ name: "reportId", type: "uint256" }],
  },
  {
    type: "function",
    name: "karma",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "reportCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "reports",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "reportHash", type: "bytes32" },
      { name: "coarseGeohash", type: "bytes32" },
      { name: "category", type: "uint8" },
      { name: "timestamp", type: "uint64" },
      { name: "reporter", type: "address" },
    ],
  },
  {
    type: "event",
    name: "ReportSubmitted",
    inputs: [
      { name: "reportId", type: "uint256", indexed: true },
      { name: "reporter", type: "address", indexed: true },
      { name: "reportHash", type: "bytes32", indexed: false },
      { name: "category", type: "uint8", indexed: false },
      { name: "coarseGeohash", type: "bytes32", indexed: false },
      { name: "timestamp", type: "uint64", indexed: false },
    ],
  },
] as const;
