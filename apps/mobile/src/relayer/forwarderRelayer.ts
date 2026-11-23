import { createPublicClient, parseAbi, type Address, type Hex } from "viem";
import { lineaSepolia } from "viem/chains";
import { ACTIVE_CHAIN } from "@khabardar/shared";
import { anonymisingRpcTransport, netFetch } from "../net/transport";
import { encodeSubmitReportCall } from "./encoding";
import type { GaslessRelayer, RelayResult, SubmitReportParams } from "./types";

/** Must match KhabardarForwarder's EIP-712 domain name. */
export const FORWARDER_DOMAIN_NAME = "KhabardarForwarder";

/** Gas the forwarder passes to submitReport. The relayer refuses anything above 500k. */
export const FORWARD_GAS = 400_000n;

/** How long a signed request stays usable. The relayer refuses anything past an hour. */
export const FORWARD_VALIDITY_SECONDS = 30 * 60;

export const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
} as const;

const FORWARDER_ABI = parseAbi(["function nonces(address owner) view returns (uint256)"]);

export interface ForwarderRelayerConfig {
  relayerUrl: string;
  forwarderAddress: Address;
  registryAddress: Address;
  chainId?: number;
  explorerUrl?: string;
  /** Injected in tests. Defaults to reading the forwarder through the anonymising transport. */
  readNonce?: (owner: Address) => Promise<bigint>;
  /** Injected in tests. Defaults to `netFetch`, so the request takes the app's one egress path. */
  post?: (url: string, body: string) => Promise<Response>;
  /** Seconds since the epoch. Injected in tests. */
  now?: () => number;
}

/**
 * Submits through the self-hosted relayer.
 *
 * The device key signs an ERC-2771 ForwardRequest for `submitReport`; the
 * relayer checks it, pays the gas and sends it through KhabardarForwarder,
 * which hands the registry the signer's address. The relayer never holds a key
 * that could report as anyone, and the reporter never needs ETH.
 */
export class ForwarderRelayer implements GaslessRelayer {
  readonly name = "forwarder";

  constructor(private readonly config: ForwarderRelayerConfig) {}

  async submitReport(params: SubmitReportParams): Promise<RelayResult> {
    const chainId = this.config.chainId ?? ACTIVE_CHAIN.chainId;
    const from = params.signer.address as Address;
    const data = encodeSubmitReportCall(
      params.reportHash,
      params.cid,
      params.category,
      params.visibility,
      params.coarseGeohash,
      params.entityTag
    );

    const nonce = await (this.config.readNonce ?? ((owner) => this.readNonce(owner)))(from);
    const now = this.config.now ?? (() => Math.floor(Date.now() / 1000));
    const message = {
      from,
      to: this.config.registryAddress,
      value: 0n,
      gas: FORWARD_GAS,
      nonce,
      deadline: now() + FORWARD_VALIDITY_SECONDS,
      data,
    };

    const signature: Hex = await params.signer.signTypedData({
      domain: {
        name: FORWARDER_DOMAIN_NAME,
        version: "1",
        chainId,
        verifyingContract: this.config.forwarderAddress,
      },
      types: FORWARD_REQUEST_TYPES,
      primaryType: "ForwardRequest",
      message,
    });

    // The nonce is not sent: the forwarder reads its own and the signature covers it.
    const body = JSON.stringify({
      request: {
        from,
        to: message.to,
        value: "0",
        gas: message.gas.toString(),
        deadline: message.deadline.toString(),
        data,
        signature,
      },
    });

    const url = `${this.config.relayerUrl}/relay`;
    const post =
      this.config.post ??
      ((u: string, b: string) =>
        netFetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: b }, "relayer:submit"));
    const res = await post(url, body);

    let json: { txHash?: string; reportId?: string; error?: string } = {};
    try {
      json = await res.json();
    } catch {
      // A proxy error page or an empty body; the status still says what happened.
    }
    if (!res.ok || !json.txHash || json.reportId === undefined) {
      throw new Error(`Relayer refused the report (${res.status}): ${json.error ?? "no reason given"}`);
    }

    const explorerUrl = this.config.explorerUrl ?? ACTIVE_CHAIN.explorerUrl;
    return {
      txHash: json.txHash,
      onChainReportId: Number(json.reportId),
      explorerUrl: `${explorerUrl}/tx/${json.txHash}`,
      simulated: false,
      // The relayer answers only after the receipt, so the report is already on chain.
      status: "anchored",
    };
  }

  private async readNonce(owner: Address): Promise<bigint> {
    const client = createPublicClient({
      chain: lineaSepolia,
      transport: anonymisingRpcTransport(ACTIVE_CHAIN.rpcUrl, "relayer:chain"),
    });
    return client.readContract({
      address: this.config.forwarderAddress,
      abi: FORWARDER_ABI,
      functionName: "nonces",
      args: [owner],
    });
  }
}
