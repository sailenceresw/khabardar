import {
  http,
  createPublicClient,
  encodeFunctionData,
  concat,
  type Hex,
  type Address,
  decodeEventLog,
} from "viem";
import { lineaSepolia } from "viem/chains";
import { ACTIVE_CHAIN, ENTRYPOINT_V07, REPORT_REGISTRY_ABI } from "@khabardar/shared";
import { encodeSubmitReportCall } from "./encoding";
import { savePendingOp, clearPendingOp } from "./pendingOps";
import type { GaslessRelayer, RelayResult, SubmitReportParams } from "./types";

/**
 * Canonical SimpleAccountFactory for EntryPoint v0.7 (eth-infinitism reference).
 * Deployed at the same address on most EVM chains including Linea.
 * @see https://docs.pimlico.io
 */
const SIMPLE_ACCOUNT_FACTORY = "0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985" as const;

const FACTORY_ABI = [
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

const ACCOUNT_EXECUTE_ABI = [
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

const SALT = 0n;

/** Max time to wait for a UserOperation receipt before marking failed. */
const RECEIPT_TIMEOUT_MS = 90_000;
const RECEIPT_POLL_MS = 2_500;

/**
 * Real ERC-4337 gasless submission via Pimlico on Linea Sepolia.
 *
 * Flow (all sponsored — the reporter's account never holds ETH):
 *  1. Derive the counterfactual SimpleAccount address from factory + owner + salt.
 *  2. Build a UserOperation: factory/factoryData on first use, empty thereafter.
 *  3. pm_sponsorUserOperation attaches paymaster sponsorship.
 *  4. Device key signs the userOpHash.
 *  5. eth_sendUserOperation → bundler → EntryPoint.handleOps on Linea.
 *  6. Poll eth_getUserOperationReceipt until included or timeout.
 *
 * Required env (see .env.example):
 *  - EXPO_PUBLIC_PIMLICO_API_KEY
 *  - EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS
 *  - EXPO_PUBLIC_GASLESS_PROVIDER=pimlico
 *  - A Pimlico sponsorship policy scoped to ReportRegistry.submitReport
 */
export class PimlicoRelayer implements GaslessRelayer {
  readonly name = "pimlico";

  constructor(
    private readonly config: {
      apiKey: string;
      bundlerUrl: string;
      paymasterUrl: string;
      registryAddress: `0x${string}`;
    }
  ) {}

  async submitReport(params: SubmitReportParams): Promise<RelayResult> {
    const owner = params.signer;
    const publicClient = createPublicClient({
      chain: lineaSepolia,
      transport: http(ACTIVE_CHAIN.rpcUrl),
    });

    // -- 1. Counterfactual SimpleAccount (integration point 1 / #3) ---------
    const { sender, factory, factoryData } = await this.resolveAccount(
      publicClient,
      owner.address as Address
    );

    // Calldata the smart account will execute: registry.submitReport(...)
    const registryCall = encodeSubmitReportCall(
      params.reportHash,
      params.cid,
      params.category,
      params.visibility,
      params.coarseGeohash,
      params.entityTag
    );
    const callData = encodeFunctionData({
      abi: ACCOUNT_EXECUTE_ABI,
      functionName: "execute",
      args: [this.config.registryAddress, 0n, registryCall],
    });

    const nonce = await publicClient.readContract({
      address: ENTRYPOINT_V07 as Address,
      abi: ENTRYPOINT_ABI,
      functionName: "getNonce",
      args: [sender, 0n],
    });

    // Partial UserOp — gas fields filled by the paymaster response.
    const userOp partial: Record<string, unknown> = {
      sender,
      nonce: `0x${nonce.toString(16)}`,
      callData,
      callGasLimit: "0x0",
      verificationGasLimit: "0x0",
      preVerificationGas: "0x0",
      maxFeePerGas: "0x0",
      maxPriorityFeePerGas: "0x0",
      // EP v0.7 uses factory / factoryData instead of initCode
      ...(factory && factoryData
        ? { factory, factoryData }
        : { factory: null, factoryData: null }),
      paymaster: null,
      paymasterData: null,
      paymasterVerificationGasLimit: "0x0",
      paymasterPostOpGasLimit: "0x0",
      signature: "0x",
    };

    // -- 2. Sponsorship (pm_sponsorUserOperation) ---------------------------
    // sponsorPoolId is accounting-only; never enters calldata.
    const sponsorContext = params.sponsorPoolId
      ? { sponsorshipPolicyId: params.sponsorPoolId }
      : undefined;

    const sponsorship = await this.rpc(this.withKey(this.config.paymasterUrl), "pm_sponsorUserOperation", [
      userOp,
      ENTRYPOINT_V07,
      ...(sponsorContext ? [sponsorContext] : []),
    ]);

    const sponsoredOp = {
      ...userOp,
      ...(sponsorship?.paymaster ? { paymaster: sponsorship.paymaster } : {}),
      ...(sponsorship?.paymasterData ? { paymasterData: sponsorship.paymasterData } : {}),
      ...(sponsorship?.paymasterVerificationGasLimit
        ? { paymasterVerificationGasLimit: sponsorship.paymasterVerificationGasLimit }
        : {}),
      ...(sponsorship?.paymasterPostOpGasLimit
        ? { paymasterPostOpGasLimit: sponsorship.paymasterPostOpGasLimit }
        : {}),
      ...(sponsorship?.callGasLimit ? { callGasLimit: sponsorship.callGasLimit } : {}),
      ...(sponsorship?.verificationGasLimit
        ? { verificationGasLimit: sponsorship.verificationGasLimit }
        : {}),
      ...(sponsorship?.preVerificationGas
        ? { preVerificationGas: sponsorship.preVerificationGas }
        : {}),
      ...(sponsorship?.maxFeePerGas ? { maxFeePerGas: sponsorship.maxFeePerGas } : {}),
      ...(sponsorship?.maxPriorityFeePerGas
        ? { maxPriorityFeePerGas: sponsorship.maxPriorityFeePerGas }
        : {}),
      // Some paymasters return a full userOperation object
      ...(sponsorship?.userOperation ?? {}),
    };

    // -- 3. Sign userOpHash with the device (or wallet) key -----------------
    // Prefer the hash returned by the paymaster; otherwise ask the bundler.
    let userOpHash = (sponsorship?.userOpHash as Hex | undefined) ?? null;
    if (!userOpHash) {
      userOpHash = (await this.rpc(this.withKey(this.config.bundlerUrl), "eth_getUserOperationHash", [
        sponsoredOp,
        ENTRYPOINT_V07,
      ])) as Hex;
    }

    const signature = await owner.signMessage({ raw: userOpHash });
    const signedOp = { ...sponsoredOp, signature };

    // -- 4. Submit to the bundler ------------------------------------------
    const submittedUserOpHash = (await this.rpc(
      this.withKey(this.config.bundlerUrl),
      "eth_sendUserOperation",
      [signedOp, ENTRYPOINT_V07]
    )) as Hex;

    // Persist so a killed app can resume polling (#4).
    // reportId is not in SubmitReportParams; use the hash as a stable key.
    const pendingKey = params.reportHash;
    await savePendingOp({
      userOpHash: submittedUserOpHash,
      reportId: pendingKey,
      submittedAt: Date.now(),
      registryAddress: this.config.registryAddress,
    });

    // -- 5. Poll for receipt (integration point 2 / #4) ---------------------
    const receipt = await this.waitForReceipt(submittedUserOpHash);

    if (!receipt) {
      return {
        txHash: submittedUserOpHash,
        userOpHash: submittedUserOpHash,
        onChainReportId: -1,
        explorerUrl: `${ACTIVE_CHAIN.explorerUrl}/tx/${submittedUserOpHash}`,
        simulated: false,
        status: "failed",
      };
    }

    await clearPendingOp(pendingKey);

    const txHash = (receipt.receipt?.transactionHash as string) ?? submittedUserOpHash;
    const onChainReportId = this.decodeReportId(receipt) ?? (await this.readReportCount(publicClient));

    return {
      txHash,
      userOpHash: submittedUserOpHash,
      onChainReportId,
      explorerUrl: `${ACTIVE_CHAIN.explorerUrl}/tx/${txHash}`,
      simulated: false,
      status: receipt.success === false ? "failed" : "anchored",
    };
  }

  /**
   * Derive the counterfactual SimpleAccount address and decide whether this
   * UserOp needs factory/factoryData (first deployment) or not.
   */
  private async resolveAccount(
    publicClient: ReturnType<typeof createPublicClient>,
    owner: Address
  ): Promise<{ sender: Address; factory: Address | null; factoryData: Hex | null }> {
    // Prefer the factory's view helper when the contract is reachable.
    let sender: Address;
    try {
      sender = (await publicClient.readContract({
        address: SIMPLE_ACCOUNT_FACTORY,
        abi: FACTORY_ABI,
        functionName: "getAddress",
        args: [owner, SALT],
      })) as Address;
    } catch {
      // Fallback: EntryPoint.getSenderAddress via eth_call (reverts with address).
      const factoryData = encodeFunctionData({
        abi: FACTORY_ABI,
        functionName: "createAccount",
        args: [owner, SALT],
      });
      const initCode = concat([SIMPLE_ACCOUNT_FACTORY, factoryData]);
      sender = await this.getSenderAddress(publicClient, initCode);
    }

    const code = await publicClient.getBytecode({ address: sender });
    const deployed = !!code && code !== "0x";

    if (deployed) {
      return { sender, factory: null, factoryData: null };
    }

    const factoryData = encodeFunctionData({
      abi: FACTORY_ABI,
      functionName: "createAccount",
      args: [owner, SALT],
    });
    return { sender, factory: SIMPLE_ACCOUNT_FACTORY, factoryData };
  }

  /**
   * EntryPoint.getSenderAddress reverts with the counterfactual address packed
   * into the revert data. We simulate the call and parse it out.
   */
  private async getSenderAddress(
    publicClient: ReturnType<typeof createPublicClient>,
    initCode: Hex
  ): Promise<Address> {
    try {
      await publicClient.call({
        to: ENTRYPOINT_V07 as Address,
        data: encodeFunctionData({
          abi: [
            {
              type: "function",
              name: "getSenderAddress",
              stateMutability: "nonpayable",
              inputs: [{ name: "initCode", type: "bytes" }],
              outputs: [],
            },
          ] as const,
          functionName: "getSenderAddress",
          args: [initCode],
        }),
      });
      throw new Error("getSenderAddress did not revert as expected");
    } catch (e: any) {
      const data: string =
        e?.data ?? e?.cause?.data ?? e?.metaMessages?.join?.("") ?? e?.shortMessage ?? "";
      const match = /0x[a-fA-F0-9]{40}/.exec(String(data));
      if (match) return match[0] as Address;
      // Last resort: some clients put the address in the error message.
      const msgMatch = /0x[a-fA-F0-9]{40}/.exec(String(e?.message ?? e));
      if (msgMatch) return msgMatch[0] as Address;
      throw new Error(`Could not derive counterfactual account address: ${e?.message ?? e}`);
    }
  }

  private async waitForReceipt(userOpHash: Hex): Promise<any | null> {
    const deadline = Date.now() + RECEIPT_TIMEOUT_MS;
    let delay = RECEIPT_POLL_MS;

    while (Date.now() < deadline) {
      try {
        const receipt = await this.rpc(
          this.withKey(this.config.bundlerUrl),
          "eth_getUserOperationReceipt",
          [userOpHash]
        );
        if (receipt) return receipt;
      } catch {
        // Transient RPC errors — keep polling until timeout.
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.3, 8_000);
    }
    return null;
  }

  private decodeReportId(receipt: any): number | null {
    try {
      const logs = receipt?.logs ?? receipt?.receipt?.logs ?? [];
      for (const log of logs) {
        try {
          const decoded = decodeEventLog({
            abi: REPORT_REGISTRY_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === "ReportSubmitted") {
            const args = decoded.args as { reportId?: bigint };
            if (args.reportId !== undefined) return Number(args.reportId);
          }
        } catch {
          // not our event
        }
      }
    } catch {
      // fall through
    }
    return null;
  }

  private async readReportCount(
    publicClient: ReturnType<typeof createPublicClient>
  ): Promise<number> {
    try {
      const count = (await publicClient.readContract({
        address: this.config.registryAddress,
        abi: [
          {
            type: "function",
            name: "reportCount",
            stateMutability: "view",
            inputs: [],
            outputs: [{ type: "uint256" }],
          },
        ] as const,
        functionName: "reportCount",
      })) as bigint;
      // reportCount is total; latest id is count - 1 when ids are sequential from 0.
      return count > 0n ? Number(count - 1n) : 0;
    } catch {
      return -1;
    }
  }

  private withKey(url: string): string {
    if (url.includes("apikey=")) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}apikey=${this.config.apiKey}`;
  }

  private async rpc(url: string, method: string, params: unknown[]): Promise<any> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const json = await res.json();
    if (json.error) {
      throw new Error(`${method} failed: ${json.error.message ?? JSON.stringify(json.error)}`);
    }
    return json.result;
  }
}
