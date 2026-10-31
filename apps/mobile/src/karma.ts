import { createPublicClient, type Address } from "viem";
import { lineaSepolia } from "viem/chains";
import { ACTIVE_CHAIN, REPORT_REGISTRY_ABI } from "@khabardar/shared";
import { anonymisingRpcTransport } from "./net/transport";

/**
 * Read a reporter's karma from the registry.
 *
 * Karma lives on-chain and there was previously no read path at all, so the
 * home screen printed a hardcoded `0` — which is wrong for anyone who has
 * actually earned any, and indistinguishable from the real thing.
 *
 * Returns `null` rather than throwing, and rather than falling back to `0`.
 * Those are three different states and only `null` is honest when the read
 * fails: "no karma" and "could not find out" must not look the same, because
 * the second one silently understates a reporter's standing.
 *
 * The read goes through the same transport seam as every other RPC. If the
 * user has required anonymity and no anonymising transport is up, the read
 * fails and this returns unknown — it does not open a private door around the
 * policy. It does not invent that policy: with Tor off and the fail-closed
 * switch off, this is a direct RPC like the feed, and it is logged as one.
 */
export async function readKarma(address: Address): Promise<bigint | null> {
  const registry = process.env.EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS as Address | undefined;
  if (!registry) return null;

  try {
    const client = createPublicClient({
      chain: lineaSepolia,
      transport: anonymisingRpcTransport(ACTIVE_CHAIN.rpcUrl, "karma:read"),
    });

    return await client.readContract({
      address: registry,
      abi: REPORT_REGISTRY_ABI,
      functionName: "karma",
      args: [address],
    });
  } catch {
    return null;
  }
}
