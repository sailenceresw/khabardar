import { Contract, Interface, getAddress, isHexString, type ContractRunner, type TransactionReceipt } from "ethers";

/**
 * The self-hosted relayer's decision logic, kept apart from HTTP so it can be
 * tested against an in-process chain.
 *
 * The phone signs an ERC-2771 ForwardRequest for `submitReport`; this relayer
 * checks it, submits it through the forwarder and pays the gas. The registry
 * records the signer as the reporter, so the relayer never becomes one.
 *
 * Everything here is about what the relayer refuses to pay for. Its wallet
 * holds real (testnet) ETH, and a relayer that forwards any signed call is a
 * free gas tap for whoever finds it.
 */

/** Chains this relayer will run on. Linea mainnet is refused on purpose. */
export const ALLOWED_CHAIN_IDS = new Set([59141n, 31337n]);

export const FORWARDER_ABI = [
  "function verify((address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) view returns (bool)",
  "function execute((address from,address to,uint256 value,uint256 gas,uint48 deadline,bytes data,bytes signature) request) payable",
  "function nonces(address owner) view returns (uint256)",
];

const REGISTRY_ABI = [
  "function submitReport(bytes32 reportHash,string cid,uint8 category,uint8 visibility,bytes32 coarseGeohash,bytes32 entityTag) returns (uint256)",
  "event ReportSubmitted(uint256 indexed reportId,address indexed reporter,bytes32 indexed entityTag,bytes32 reportHash,string cid,uint8 category,uint8 visibility,bytes32 coarseGeohash,uint64 timestamp)",
];

const registryInterface = new Interface(REGISTRY_ABI);
const SUBMIT_SELECTOR = registryInterface.getFunction("submitReport")!.selector;

export interface ForwardRequest {
  from: string;
  to: string;
  value: string;
  gas: string;
  deadline: string;
  data: string;
  signature: string;
}

export interface RelayerLimits {
  /** Most gas a single request may ask the forwarder to pass on. */
  maxGasPerRequest: bigint;
  /** Latest deadline accepted, in seconds from now. Bounds how long a signed request stays usable. */
  maxDeadlineSeconds: number;
  /** Requests accepted per minute, across everyone. */
  requestsPerMinute: number;
  /** Total gas spend allowed per UTC day, in wei. The relayer refuses once it is used up. */
  dailySpendWei: bigint;
}

export const DEFAULT_LIMITS: RelayerLimits = {
  maxGasPerRequest: 500_000n,
  maxDeadlineSeconds: 60 * 60,
  requestsPerMinute: 30,
  dailySpendWei: 10n ** 16n, // 0.01 ETH
};

export interface RelayResponse {
  status: number;
  body: { txHash: string; reportId: string } | { error: string };
}

export interface RelayerOptions {
  /** Anything that can send transactions: an ethers Wallet in production, a test signer in tests. */
  wallet: ContractRunner;
  forwarderAddress: string;
  registryAddress: string;
  limits?: Partial<RelayerLimits>;
  /** Seconds since the epoch. Injected so tests can move time. */
  now?: () => number;
}

class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

export function createRelayer(options: RelayerOptions) {
  const limits: RelayerLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const forwarder = new Contract(options.forwarderAddress, FORWARDER_ABI, options.wallet);
  const registryAddress = getAddress(options.registryAddress);

  // Rate and spend accounting are global on purpose. Keeping them per IP would
  // mean keeping IPs, and the relayer should hold nothing that links a request
  // to where it came from.
  let windowStart = 0;
  let windowCount = 0;
  let spendDay = -1;
  let spentToday = 0n;

  function checkShape(input: unknown): ForwardRequest {
    const r = (input as { request?: Record<string, unknown> } | null)?.request;
    if (!r || typeof r !== "object") throw new Refusal(400, "missing request");
    const fields = ["from", "to", "value", "gas", "deadline", "data", "signature"] as const;
    for (const f of fields) {
      if (typeof r[f] !== "string") throw new Refusal(400, `request.${f} must be a string`);
    }
    const req = r as unknown as ForwardRequest;
    for (const f of ["data", "signature"] as const) {
      if (!isHexString(req[f])) throw new Refusal(400, `request.${f} must be hex`);
    }
    try {
      req.from = getAddress(req.from);
      req.to = getAddress(req.to);
    } catch {
      throw new Refusal(400, "request.from and request.to must be addresses");
    }
    for (const f of ["value", "gas", "deadline"] as const) {
      if (!/^\d+$/.test(req[f])) throw new Refusal(400, `request.${f} must be a decimal integer`);
    }
    return req;
  }

  function checkPolicy(req: ForwardRequest) {
    if (req.to !== registryAddress) throw new Refusal(403, "only the report registry can be called");
    if (req.data.slice(0, 10).toLowerCase() !== SUBMIT_SELECTOR) {
      throw new Refusal(403, "only submitReport can be relayed");
    }
    try {
      registryInterface.decodeFunctionData("submitReport", req.data);
    } catch {
      throw new Refusal(400, "submitReport arguments do not decode");
    }
    if (BigInt(req.value) !== 0n) throw new Refusal(403, "value must be 0");
    if (BigInt(req.gas) > limits.maxGasPerRequest) throw new Refusal(403, "gas limit too high");
    const deadline = Number(req.deadline);
    const t = now();
    if (deadline <= t) throw new Refusal(400, "request has expired");
    if (deadline > t + limits.maxDeadlineSeconds) throw new Refusal(400, "deadline too far ahead");
  }

  function checkBudget() {
    const t = now();
    if (t - windowStart >= 60) {
      windowStart = t;
      windowCount = 0;
    }
    if (windowCount >= limits.requestsPerMinute) throw new Refusal(429, "too many requests, try again shortly");
    const day = Math.floor(t / 86_400);
    if (day !== spendDay) {
      spendDay = day;
      spentToday = 0n;
    }
    if (spentToday >= limits.dailySpendWei) throw new Refusal(503, "daily gas budget used up, try again tomorrow");
    windowCount++;
  }

  async function relay(input: unknown): Promise<RelayResponse> {
    try {
      const req = checkShape(input);
      checkPolicy(req);
      checkBudget();

      // The forwarder would revert on a bad signature anyway; checking first
      // means a forged request costs the relayer nothing.
      if (!(await forwarder.verify(req))) throw new Refusal(403, "signature, nonce or deadline is not valid");

      // Simulate before paying, so a call that would revert (an epoch cap, a
      // malformed report) is refused rather than mined.
      try {
        await forwarder.execute.staticCall(req);
      } catch {
        throw new Refusal(422, "the registry would reject this report");
      }

      const tx = await forwarder.execute(req);
      const receipt: TransactionReceipt | null = await tx.wait();
      if (!receipt || receipt.status !== 1) throw new Refusal(502, "transaction failed on chain");
      spentToday += receipt.gasUsed * (receipt.gasPrice ?? 0n);

      const reportId = findReportId(receipt);
      if (reportId === null) throw new Refusal(502, "no report event in the receipt");
      return { status: 200, body: { txHash: receipt.hash, reportId: reportId.toString() } };
    } catch (e) {
      if (e instanceof Refusal) return { status: e.status, body: { error: e.message } };
      return { status: 500, body: { error: "relayer error" } };
    }
  }

  function findReportId(receipt: TransactionReceipt): bigint | null {
    for (const log of receipt.logs) {
      if (getAddress(log.address) !== registryAddress) continue;
      try {
        const parsed = registryInterface.parseLog(log);
        if (parsed?.name === "ReportSubmitted") return parsed.args.reportId as bigint;
      } catch {
        // not a registry event we know
      }
    }
    return null;
  }

  return { relay, limits };
}

export type Relayer = ReturnType<typeof createRelayer>;
