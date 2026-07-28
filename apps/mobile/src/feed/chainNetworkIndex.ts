import { createPublicClient, hexToString, http, type Address } from "viem";
import { lineaSepolia } from "viem/chains";
import { ACTIVE_CHAIN, REPORT_REGISTRY_ABI } from "@khabardar/shared";
import { applyQuery } from "./mockNetworkIndex";
import type { ChainReportRow, FeedQuery, NetworkIndex } from "./types";

/**
 * Reads the feed straight from ReportSubmitted logs on Linea.
 *
 * Scope caveat: this scans a block range via eth_getLogs, which is fine for a
 * testnet deployment and will not survive real volume. Production wants a
 * proper indexer (Ponder, SubQuery, a subgraph) exposing a queryable API —
 * this class is the honest minimal version and the interface it satisfies is
 * what the indexer should implement.
 */
export class ChainNetworkIndex implements NetworkIndex {
  readonly name = "chain";

  private client = createPublicClient({
    chain: lineaSepolia,
    transport: http(ACTIVE_CHAIN.rpcUrl),
  });

  constructor(private readonly registryAddress: Address, private readonly fromBlock: bigint = 0n) {}

  async list(query?: FeedQuery): Promise<ChainReportRow[]> {
    const logs = await this.client.getContractEvents({
      address: this.registryAddress,
      abi: REPORT_REGISTRY_ABI,
      eventName: "ReportSubmitted",
      fromBlock: this.fromBlock,
      toBlock: "latest",
    });

    const rows = await Promise.all(
      logs.map(async (log) => {
        const args = log.args as {
          reportId?: bigint;
          reporter?: Address;
          reportHash?: `0x${string}`;
          cid?: string;
          category?: number;
          visibility?: number;
          coarseGeohash?: `0x${string}`;
          timestamp?: bigint;
        };
        const id = Number(args.reportId ?? 0n);

        // Tier and corroboration count are mutable, so read current state
        // rather than trusting the emit-time values.
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
          timestamp: Number(args.timestamp ?? 0n) * 1000,
          reporter: args.reporter ?? "0x",
          corroborations: Number(corroborations as bigint),
        } as ChainReportRow;
      })
    );

    return applyQuery(
      rows.sort((a, b) => b.timestamp - a.timestamp),
      query
    );
  }

  async get(onChainReportId: number): Promise<ChainReportRow | null> {
    const rows = await this.list();
    return rows.find((r) => r.onChainReportId === onChainReportId) ?? null;
  }
}

function trimNulls(s: string): string {
  return s.replace(/\0+$/, "");
}
