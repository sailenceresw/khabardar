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
      { name: "cid", type: "string" },
      { name: "category", type: "uint8" },
      { name: "visibility", type: "uint8" },
      { name: "coarseGeohash", type: "bytes32" },
      { name: "entityTag", type: "bytes32" },
    ],
    outputs: [{ name: "reportId", type: "uint256" }],
  },
  {
    type: "function",
    name: "reportsForEntity",
    stateMutability: "view",
    inputs: [{ name: "entityTag", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "entityReportCount",
    stateMutability: "view",
    inputs: [{ name: "entityTag", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "corroborate",
    stateMutability: "nonpayable",
    inputs: [{ name: "reportId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "castJuryVote",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reportId", type: "uint256" },
      { name: "tier", type: "uint8" },
      { name: "reason", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "jurorWeight",
    stateMutability: "view",
    inputs: [{ name: "juror", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "juryVoteOf",
    stateMutability: "view",
    inputs: [
      { name: "reportId", type: "uint256" },
      { name: "juror", type: "address" },
    ],
    outputs: [
      { name: "", type: "bool" },
      { name: "", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "jurorsVotedOn",
    stateMutability: "view",
    inputs: [{ name: "reportId", type: "uint256" }],
    outputs: [{ name: "", type: "address[]" }],
  },
  {
    type: "function",
    name: "verdictFinal",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "tierWeight",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "uint8" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isJuror",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "jurorCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "isPerson",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "personhoodGate",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "remainingSubmissions",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "currentEpoch",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
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
    name: "corroborationCount",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "hasCorroborated",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "reports",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "reportHash", type: "bytes32" },
      { name: "cid", type: "string" },
      { name: "coarseGeohash", type: "bytes32" },
      { name: "entityTag", type: "bytes32" },
      { name: "category", type: "uint8" },
      { name: "visibility", type: "uint8" },
      { name: "tier", type: "uint8" },
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
      { name: "entityTag", type: "bytes32", indexed: true },
      { name: "reportHash", type: "bytes32", indexed: false },
      { name: "cid", type: "string", indexed: false },
      { name: "category", type: "uint8", indexed: false },
      { name: "visibility", type: "uint8", indexed: false },
      { name: "coarseGeohash", type: "bytes32", indexed: false },
      { name: "timestamp", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ReportCorroborated",
    inputs: [
      { name: "reportId", type: "uint256", indexed: true },
      { name: "witness", type: "address", indexed: true },
      { name: "count", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ReportTierChanged",
    inputs: [
      { name: "reportId", type: "uint256", indexed: true },
      { name: "tier", type: "uint8", indexed: false },
      { name: "by", type: "address", indexed: true },
    ],
  },
  {
    // The public moderation audit trail. Every juror's vote and stated reason
    // is readable by anyone with an RPC endpoint — that is the point.
    type: "event",
    name: "JuryVoteCast",
    inputs: [
      { name: "reportId", type: "uint256", indexed: true },
      { name: "juror", type: "address", indexed: true },
      { name: "tier", type: "uint8", indexed: false },
      { name: "weight", type: "uint256", indexed: false },
      { name: "reason", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "VerdictReached",
    inputs: [
      { name: "reportId", type: "uint256", indexed: true },
      { name: "tier", type: "uint8", indexed: false },
      { name: "weight", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "JurorSettled",
    inputs: [
      { name: "reportId", type: "uint256", indexed: true },
      { name: "juror", type: "address", indexed: true },
      { name: "agreed", type: "bool", indexed: false },
      { name: "karmaAfter", type: "uint256", indexed: false },
    ],
  },
] as const;

/** Mirrors ReportRegistry constants so the client can reason without a call. */
export const JURY_QUORUM_WEIGHT = 3;
export const MAX_JUROR_WEIGHT = 2;
export const KARMA_PER_JURY_WEIGHT = 50;
export const MAX_REPORTS_PER_EPOCH = 10;
export const EPOCH_DURATION_MS = 24 * 60 * 60 * 1000;
