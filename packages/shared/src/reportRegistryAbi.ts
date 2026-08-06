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
    name: "commitmentFor",
    stateMutability: "pure",
    inputs: [
      { name: "reportId", type: "uint256" },
      { name: "round", type: "uint8" },
      { name: "tier", type: "uint8" },
      { name: "salt", type: "bytes32" },
      { name: "juror", type: "address" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "commitVote",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reportId", type: "uint256" },
      { name: "commitment", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "revealVote",
    stateMutability: "nonpayable",
    inputs: [
      { name: "reportId", type: "uint256" },
      { name: "tier", type: "uint8" },
      { name: "salt", type: "bytes32" },
      { name: "reason", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "closeRound",
    stateMutability: "nonpayable",
    inputs: [{ name: "reportId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "appealVerdict",
    stateMutability: "nonpayable",
    inputs: [{ name: "reportId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "canAppeal",
    stateMutability: "view",
    inputs: [{ name: "reportId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "rounds",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "phase", type: "uint8" },
      { name: "quorum", type: "uint8" },
      { name: "commits", type: "uint8" },
      { name: "reveals", type: "uint8" },
      { name: "decidedTierPlusOne", type: "uint8" },
      { name: "index", type: "uint8" },
      { name: "appealed", type: "bool" },
      { name: "commitDeadline", type: "uint64" },
      { name: "revealDeadline", type: "uint64" },
      { name: "decidedAt", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "hasCommitted",
    stateMutability: "view",
    inputs: [
      { name: "reportId", type: "uint256" },
      { name: "juror", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "jurorBallotsCompleted",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "jurorBallotsAbandoned",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
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
    name: "tierVotes",
    stateMutability: "view",
    inputs: [
      { name: "", type: "uint256" },
      { name: "", type: "uint8" },
      { name: "", type: "uint8" },
    ],
    outputs: [{ name: "", type: "uint8" }],
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
    type: "event",
    name: "JuryVoteCommitted",
    inputs: [
      { name: "reportId", type: "uint256", indexed: true },
      { name: "juror", type: "address", indexed: true },
      { name: "round", type: "uint8", indexed: false },
    ],
  },
  {
    // The public moderation audit trail. Every juror's vote and stated reason
    // is readable by anyone with an RPC endpoint — that is the point. It lands
    // at reveal, by which time the ballot was already locked, so a reason
    // cannot be retrofitted to whatever the majority turned out to be.
    type: "event",
    name: "JuryVoteRevealed",
    inputs: [
      { name: "reportId", type: "uint256", indexed: true },
      { name: "juror", type: "address", indexed: true },
      { name: "tier", type: "uint8", indexed: false },
      { name: "reason", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "VerdictReached",
    inputs: [
      { name: "reportId", type: "uint256", indexed: true },
      { name: "round", type: "uint8", indexed: false },
      { name: "tier", type: "uint8", indexed: false },
      { name: "votes", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "VerdictUndecided",
    inputs: [
      { name: "reportId", type: "uint256", indexed: true },
      { name: "round", type: "uint8", indexed: false },
      { name: "reveals", type: "uint8", indexed: false },
    ],
  },
  {
    type: "event",
    name: "JurorAbandoned",
    inputs: [
      { name: "reportId", type: "uint256", indexed: true },
      { name: "juror", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "VerdictAppealed",
    inputs: [
      { name: "reportId", type: "uint256", indexed: true },
      { name: "newRound", type: "uint8", indexed: false },
      { name: "quorum", type: "uint8", indexed: false },
    ],
  },
] as const;

/** Mirrors ReportRegistry constants so the client can reason without a call. */

/** Sealed ballots needed before the reveal phase opens. */
export const JURY_QUORUM = 3;
/** Panel size when a reporter appeals. */
export const APPEAL_QUORUM = 5;

/**
 * Every juror counts exactly one.
 *
 * Kept as a named constant rather than left implicit, because the thing it
 * replaced — karma-weighted votes, where agreeing with the majority bought
 * influence over the next verdict — is an easy mistake to reintroduce. Weight
 * is not a tuning parameter here; it is the fairness property.
 */
export const JUROR_VOTE_WEIGHT = 1;

export const COMMIT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
export const REVEAL_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
export const APPEAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const MAX_REPORTS_PER_EPOCH = 10;
export const EPOCH_DURATION_MS = 24 * 60 * 60 * 1000;

/** Mirrors `ReportRegistry.RoundPhase`. */
export enum JuryPhase {
  None = 0,
  Committing = 1,
  Revealing = 2,
  Decided = 3,
  Undecided = 4,
}
