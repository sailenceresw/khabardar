import AsyncStorage from "@react-native-async-storage/async-storage";
import { createPublicClient, decodeEventLog, encodeFunctionData, type Hex } from "viem";
import { lineaSepolia } from "viem/chains";
import { ACTIVE_CHAIN, ENTRYPOINT_V07, REPORT_REGISTRY_ABI } from "@khabardar/shared";
import { anonymisingRpcTransport, rpcCall } from "../net/transport";
import { encodeSubmitReportCall } from "./encoding";
import type { GaslessRelayer, RelayResult, SubmitReportParams } from "./types";

/**
 * Real ERC-4337 gasless submission via Pimlico on Linea.
 *
 * Flow (all sponsored — the reporter's account never holds ETH):
 *  1. The device key owns a counterfactual SimpleAccount, deployed lazily on
 *     first submission via `initCode`.
 *  2. A UserOperation carrying the submitReport() calldata is built.
 *  3. pm_getPaymasterStubData / pm_getPaymasterData attach sponsorship from a
 *     verifying paymaster (requires a funded sponsorship policy).
 *  4. The device key signs the userOpHash.
 *  5. eth_sendUserOperation submits it to the bundler, which wraps it in an
 *     EntryPoint.handleOps() tx on Linea.
 *
 * What you need to run this for real (see README "Gasless relayer"):
 *  - EXPO_PUBLIC_PIMLICO_API_KEY      — from dashboard.pimlico.io
 *  - a sponsorship policy allowing calls to the ReportRegistry address
 *  - EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS — deployed via contracts workspace
 *  - EXPO_PUBLIC_GASLESS_PROVIDER=pimlico
 *
 * This class uses raw bundler JSON-RPC rather than permissionless.js so the
 * protocol surface stays explicit and auditable. The trade-off is that account
 * abstraction has sharp edges — gas estimation and paymaster stub data in
 * particular — and a production deployment may well prefer the SDK.
 *
 * **Privacy note that outranks all of the above:** a paymaster sees the sender
 * address, the calldata, and the IP of whoever submitted. Calldata is only a
 * hash plus coarse metadata, so content stays private — but the IP↔pseudonym
 * link is real and is why every call here goes through `net/transport` rather
 * than raw fetch.
 */

/** Canonical SimpleAccountFactory for EntryPoint v0.7. */
const SIMPLE_ACCOUNT_FACTORY = "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985" as const;

const SIMPLE_ACCOUNT_FACTORY_ABI = [
  {
    type: "function",
    name: "createAccount",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "ret", type: "address" }],
  },
  {
    type: "function",
    name: "getAddress",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "salt", type: "uint256" },
    ],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const SIMPLE_ACCOUNT_ABI = [
  {
    type: "function",
    name: "execute",
    stateMutability: "nonpayable",
    inputs: [
      { name: "dest", type: "address" },
      { name: "value", type: "uint256" },
      { name: "func", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const ENTRYPOINT_ABI = [
  {
    type: "function",
    name: "getNonce",
    stateMutability: "view",
    inputs: [
      { name: "sender", type: "address" },
      { name: "key", type: "uint192" },
    ],
    outputs: [{ name: "nonce", type: "uint256" }],
  },
] as const;

/** One account per device key; a second salt would fragment karma. */
const ACCOUNT_SALT = 0n;

/** Trust-on-first-use pin of the derived account address, per owner. */
const ACCOUNT_PIN_PREFIX = "khabardar.aa.account.v1.";

interface UserOperation {
  sender: Hex;
  nonce: Hex;
  callData: Hex;
  callGasLimit: Hex;
  verificationGasLimit: Hex;
  preVerificationGas: Hex;
  maxFeePerGas: Hex;
  maxPriorityFeePerGas: Hex;
  factory?: Hex;
  factoryData?: Hex;
  paymaster?: Hex;
  paymasterVerificationGasLimit?: Hex;
  paymasterPostOpGasLimit?: Hex;
  paymasterData?: Hex;
  signature: Hex;
}

export class PimlicoRelayer implements GaslessRelayer {
  readonly name = "pimlico";

  private readonly publicClient;

  constructor(
    private readonly config: {
      apiKey: string;
      bundlerUrl: string;
      paymasterUrl: string;
      registryAddress: `0x${string}`;
    }
  ) {
    this.publicClient = createPublicClient({
      chain: lineaSepolia,
      transport: anonymisingRpcTransport(ACTIVE_CHAIN.rpcUrl, "chain:rpc"),
    });
  }

  async submitReport(params: SubmitReportParams): Promise<RelayResult> {
    const owner = params.signer;

    const registryCall = encodeSubmitReportCall(
      params.reportHash,
      params.cid,
      params.category,
      params.visibility,
      params.coarseGeohash,
      params.entityTag
    );

    // The account calls the registry; the UserOp calls the account.
    const callData = encodeFunctionData({
      abi: SIMPLE_ACCOUNT_ABI,
      functionName: "execute",
      args: [this.config.registryAddress, 0n, registryCall],
    });

    const { sender, factory, factoryData } = await this.resolveAccount(owner.address as Hex);
    const nonce = await this.nonceOf(sender);
    const fees = await this.gasPrice();

    let userOp: UserOperation = {
      sender,
      nonce,
      callData,
      // Stub limits; the bundler replaces these during estimation. Non-zero
      // because some estimators reject an all-zero op outright.
      callGasLimit: "0x100000",
      verificationGasLimit: "0x100000",
      preVerificationGas: "0x10000",
      maxFeePerGas: fees.maxFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      ...(factory ? { factory, factoryData } : {}),
      // Dummy signature of the right shape so estimation prices the real thing.
      signature: `0x${"fd".repeat(65)}`,
    };

    userOp = await this.sponsor(userOp, params.sponsorPoolId);
    userOp = await this.estimate(userOp);

    // Sign the hash the EntryPoint will actually check.
    const userOpHash = await this.userOpHash(userOp);
    userOp.signature = await owner.signMessage({ raw: userOpHash });

    const submittedHash = await rpcCall<Hex>(
      this.withKey(this.config.bundlerUrl),
      "eth_sendUserOperation",
      [userOp, ENTRYPOINT_V07],
      "relayer:send"
    );

    const receipt = await this.waitForReceipt(submittedHash);

    return {
      txHash: receipt.txHash,
      onChainReportId: receipt.reportId,
      explorerUrl: `${ACTIVE_CHAIN.explorerUrl}/tx/${receipt.txHash}`,
      simulated: false,
    };
  }

  /**
   * Counterfactual SimpleAccount for this owner.
   *
   * The account does not exist on-chain until its first transaction: the
   * address is a CREATE2 prediction, and `factory` + `factoryData` on the first
   * UserOperation deploy it. That is what lets a reporter hold a stable
   * pseudonymous address without anyone paying to create it up front — and it
   * is why the sender is a smart account rather than the owner EOA, which is
   * what this relayer used to send and which would have made every report
   * trivially linkable to the device key.
   */
  private async resolveAccount(
    owner: Hex
  ): Promise<{ sender: Hex; factory?: Hex; factoryData?: Hex }> {
    const factoryData = encodeFunctionData({
      abi: SIMPLE_ACCOUNT_FACTORY_ABI,
      functionName: "createAccount",
      args: [owner, ACCOUNT_SALT],
    });

    const sender = await this.accountAddress(owner);

    // Once deployed, the factory fields must be omitted or the EntryPoint reverts.
    const deployed = await this.isDeployed(sender);
    return deployed ? { sender } : { sender, factory: SIMPLE_ACCOUNT_FACTORY, factoryData };
  }

  /**
   * Address the factory would create for this owner, pinned on first use.
   *
   * The address comes from the factory's own `getAddress` view rather than a
   * local CREATE2 computation, because the proxy init-code hash depends on
   * which account implementation the factory was deployed against — hard-coding
   * it would break silently against a different factory build.
   *
   * That means trusting the RPC, so the answer is pinned the first time and
   * checked on every subsequent call. A hostile or swapped RPC that starts
   * returning a different account — one it controls, that would receive this
   * reporter's karma and appear as them — is refused loudly instead of quietly
   * obeyed.
   */
  private async accountAddress(owner: Hex): Promise<Hex> {
    const predicted = (await this.publicClient.readContract({
      address: SIMPLE_ACCOUNT_FACTORY,
      abi: SIMPLE_ACCOUNT_FACTORY_ABI,
      functionName: "getAddress",
      args: [owner, ACCOUNT_SALT],
    })) as Hex;

    const pinKey = `${ACCOUNT_PIN_PREFIX}${owner.toLowerCase()}`;
    const pinned = await AsyncStorage.getItem(pinKey);

    if (pinned && pinned.toLowerCase() !== predicted.toLowerCase()) {
      throw new Error(
        `Smart-account address changed: pinned ${pinned}, RPC now says ${predicted}. ` +
          `Refusing to submit — a different sender would publish under a different pseudonym.`
      );
    }
    if (!pinned) await AsyncStorage.setItem(pinKey, predicted);

    return predicted;
  }

  private async isDeployed(address: Hex): Promise<boolean> {
    const code = await this.publicClient.getCode({ address });
    return !!code && code !== "0x";
  }

  private async nonceOf(sender: Hex): Promise<Hex> {
    const nonce = (await this.publicClient.readContract({
      address: ENTRYPOINT_V07,
      abi: ENTRYPOINT_ABI,
      functionName: "getNonce",
      args: [sender, 0n],
    })) as bigint;
    return `0x${nonce.toString(16)}`;
  }

  private async gasPrice(): Promise<{ maxFeePerGas: Hex; maxPriorityFeePerGas: Hex }> {
    const result = await rpcCall<{
      fast: { maxFeePerGas: Hex; maxPriorityFeePerGas: Hex };
    }>(this.withKey(this.config.bundlerUrl), "pimlico_getUserOperationGasPrice", [], "relayer:gas");
    return result.fast;
  }

  /**
   * Attach paymaster sponsorship.
   *
   * `sponsorPoolId` rides along as sponsorship-policy context so the correct
   * funded pool is debited. It is accounting metadata only and never enters
   * callData — no report carries a sponsor marker on-chain, because a
   * narrowly-scoped sponsor tag would shrink a report's anonymity set below
   * what the reporter consented to.
   */
  private async sponsor(userOp: UserOperation, sponsorPoolId?: string): Promise<UserOperation> {
    const context = sponsorPoolId ? { sponsorshipPolicyId: sponsorPoolId } : {};

    const data = await rpcCall<{
      paymaster?: Hex;
      paymasterData?: Hex;
      paymasterVerificationGasLimit?: Hex;
      paymasterPostOpGasLimit?: Hex;
    }>(
      this.withKey(this.config.paymasterUrl),
      "pm_getPaymasterData",
      [userOp, ENTRYPOINT_V07, `0x${ACTIVE_CHAIN.chainId.toString(16)}`, context],
      "relayer:sponsor"
    );

    return { ...userOp, ...data };
  }

  private async estimate(userOp: UserOperation): Promise<UserOperation> {
    const gas = await rpcCall<{
      callGasLimit: Hex;
      verificationGasLimit: Hex;
      preVerificationGas: Hex;
    }>(
      this.withKey(this.config.bundlerUrl),
      "eth_estimateUserOperationGas",
      [userOp, ENTRYPOINT_V07],
      "relayer:estimate"
    );

    return { ...userOp, ...gas };
  }

  private async userOpHash(userOp: UserOperation): Promise<Hex> {
    return rpcCall<Hex>(
      this.withKey(this.config.bundlerUrl),
      "pimlico_getUserOperationHash",
      [userOp, ENTRYPOINT_V07],
      "relayer:hash"
    );
  }

  /**
   * Poll until the bundler includes the UserOperation, then read the report id
   * out of the ReportSubmitted log rather than guessing from `reportCount`.
   *
   * Reading `reportCount` after the fact — what this used to do — is a race:
   * any report submitted between inclusion and the read shifts the answer, and
   * the user is shown someone else's report id.
   */
  private async waitForReceipt(
    userOpHash: Hex,
    { timeoutMs = 90_000, intervalMs = 2_000 } = {}
  ): Promise<{ txHash: Hex; reportId: number }> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const receipt = await rpcCall<{
        success: boolean;
        reason?: string;
        receipt: { transactionHash: Hex };
        logs: Array<{ address: Hex; topics: Hex[]; data: Hex }>;
      } | null>(
        this.withKey(this.config.bundlerUrl),
        "eth_getUserOperationReceipt",
        [userOpHash],
        "relayer:receipt"
      );

      if (receipt) {
        if (!receipt.success) {
          throw new Error(`UserOperation reverted: ${receipt.reason ?? "unknown reason"}`);
        }
        return {
          txHash: receipt.receipt.transactionHash,
          reportId: this.reportIdFromLogs(receipt.logs),
        };
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }

    throw new Error(`UserOperation ${userOpHash} was not included within ${timeoutMs / 1000}s`);
  }

  private reportIdFromLogs(logs: Array<{ address: Hex; topics: Hex[]; data: Hex }>): number {
    for (const log of logs) {
      if (log.address.toLowerCase() !== this.config.registryAddress.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: REPORT_REGISTRY_ABI,
          topics: log.topics as [Hex, ...Hex[]],
          data: log.data,
        });
        if (decoded.eventName === "ReportSubmitted") {
          return Number((decoded.args as { reportId: bigint }).reportId);
        }
      } catch {
        // Not one of ours, or an ABI mismatch — keep looking.
      }
    }
    throw new Error("Transaction landed but carried no ReportSubmitted event");
  }

  private withKey(url: string): string {
    return `${url}?apikey=${this.config.apiKey}`;
  }
}

export { SIMPLE_ACCOUNT_FACTORY };
