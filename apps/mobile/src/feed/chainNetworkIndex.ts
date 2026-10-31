import { createPublicClient, hexToString, type Address } from "viem";
import { lineaSepolia } from "viem/chains";
import { ACTIVE_CHAIN, REPORT_REGISTRY_ABI } from "@khabardar/shared";
import { anonymisingRpcTransport } from "../net/transport";
import { applyQuery } from "./mockNetworkIndex";
import type { ChainReportRow, FeedQuery, NetworkIndex } from "./types";

/**
 * Reads the feed straight from ReportSubmitted logs on Linea.
 *
 * This is the no-infrastructure option: correct, self-hosting-free, and
 * fundamentally limited. Every `list()` rescans the log range and then makes
 * two contract reads per report to pick up mutable state, so cost grows with
 * total corpus size on every single page view. It is fine for a testnet
 * deployment and it will fall over well before real volume.
 *
 * {@link IndexerNetworkIndex} is the answer for production. This class stays
 * because it is the only implementation that needs nothing but an RPC URL —
 * useful for verification, and useful as the thing an indexer is checked
 * against.
 */

/**
 * Blocks per `eth_getLogs` call. Public RPCs reject unbounded ranges outright
 * (Linea's caps at 10k), so scanning has to be chunked rather than asked for in
 * one go — a single `fromBlock: 0` request simply errors on any real endpoint.
 */
const LOG_CHUNK_BLOCKS = 9_000n;

/** Newest-first scan stops here unless a query asks for more. */
const DEFAULT_MAX_ROWS = 200;

export class ChainNetworkIndex implements NetworkIndex {
  readonly name = "chain";

  private client = createPublicClient({
    chain: lineaSepolia,
    transport: anonymisingRpcTransport(ACTIVE_CHAIN.rpcUrl, "feed:logs"),
  });

  constructor(private readonly registryAddress: Address, private readonly fromBlock: bigint = 0n) {}

  async list(query?: FeedQuery): Promise<ChainReportRow[]> {
    const latest = await this.client.getBlockNumber();
    const rows: ChainReportRow[] = [];
    const limit = query?.limit ?? DEFAULT_MAX_ROWS;

    // Walk backwards from head: the feed shows newest first, so a partial scan
    // that stops early still returns the right reports rather than the oldest.
    let to = latest;
    while (to >= this.fromBlock && rows.length < limit) {
      const from = to > this.fromBlock + LOG_CHUNK_BLOCKS ? to - LOG_CHUNK_BLOCKS : this.fromBlock;

      const logs = await this.client.getContractEvents({
        address: this.registryAddress,
        abi: REPORT_REGISTRY_ABI,
        eventName: "ReportSubmitted",
        fromBlock: from,
        toBlock: to,
      });

      for (const log of [...logs].reverse()) {
        rows.push(await this.hydrate(log));
        if (rows.length >= limit) break;
      }

      if (from === this.fromBlock) break;
      to = from - 1n;
    }

    return applyQuery(
      rows.sort((a, b) => b.timestamp - a.timestamp),
      query
    );
  }

  private async hydrate(log: { args: unknown }): Promise<ChainReportRow> {
    const args = log.args as {
      reportId?: bigint;
      reporter?: Address;
      reportHash?: `0x${string}`;
      cid?: string;
      category?: number;
      visibility?: number;
      coarseGeohash?: `0x${string}`;
      entityTag?: `0x${string}`;
      timestamp?: bigint;
    };
    const id = Number(args.reportId ?? 0n);

    // Tier and corroboration count are mutable, so read current state rather
    // than trusting the emit-time values.
    const [record, corroborations] = await Promise.all([
      this.client.readContract({
        address: this.registryAddress,
        abi: REPORT_REGISTRY_ABI,
        functionName: "reports",
        args: [BigInt(id)],
      }),
      this.client.readContract({
        address: this.registryAddress,
        abi: REPORT_REGISTRY_ABI,
        functionName: "corroborationCount",
        args: [BigInt(id)],
      }),
    ]);

    const tier = Number((record as unknown as { tier: number }).tier ?? 0);

    return {
      onChainReportId: id,
      reportHash: args.reportHash ?? "0x",
      cid: args.cid ?? "",
      category: Number(args.category ?? 0),
      visibility: Number(args.visibility ?? 0),
      tier,
      coarseGeohash: args.coarseGeohash ? trimNulls(hexToString(args.coarseGeohash)) : "",
      // Indexed on the event, so it arrives with the log — without it a
      // `FeedQuery.entityTag` filter matches nothing and entity clustering
      // silently returns an empty cluster against a real deployment.
      entityTag: args.entityTag,
      timestamp: Number(args.timestamp ?? 0n) * 1000,
      reporter: args.reporter ?? "0x",
      corroborations: Number(corroborations as bigint),
    } as ChainReportRow;
  }

  async get(onChainReportId: number): Promise<ChainReportRow | null> {
    const rows = await this.list();
    return rows.find((r) => r.onChainReportId === onChainReportId) ?? null;
  }
}

function trimNulls(s: string): string {
  return s.replace(/\0+$/, "");
}
