import AsyncStorage from "@react-native-async-storage/async-storage";
import { createPublicClient } from "viem";
import { lineaSepolia } from "viem/chains";
import {
  ACTIVE_CHAIN,
  REPORT_REGISTRY_ABI,
  VerificationTier,
  type AnonymousReport,
} from "@khabardar/shared";
import { anonymisingRpcTransport, isAnonymised } from "./net/transport";
import { loadAllReports } from "./drafts";
import { safeJsonParse } from "./safeJson";

/**
 * What became of a reporter's own reports.
 *
 * ## Why this exists
 *
 * Until now a reporter filed something and then heard nothing, ever. No
 * corroboration, no verdict, no sign anyone read it. For a tool that asks
 * people to take a real risk, silence afterwards is its own kind of failure:
 * it gives them no reason to believe the thing worked, and no reason to come
 * back when they see something worse.
 *
 * ## Why it pulls instead of pushing
 *
 * The obvious design is a push notification, and it is the one thing this must
 * never do. A push token is a stable identifier issued to one device and held
 * by a third party. Registering one against a report id hands that party, and
 * anyone who subpoenas them, a direct map from report to device to person. The
 * cryptography everywhere else in this app exists to prevent exactly that
 * link, and a convenience feature must not reintroduce it.
 *
 * So the device asks, rather than being told. Nothing is registered anywhere,
 * nothing is stored off-device, and the whole feature disappears if the app is
 * deleted.
 *
 * ## Why it reads in one batch
 *
 * Fetching the reporter's report ids one at a time, from one IP, in sequence,
 * tells an RPC provider which reports belong to a single person, which is most
 * of what the entity tag and coarse geohash exist to hide. The reads are
 * issued as one multicall-shaped batch so the provider sees a single request,
 * and they go through the anonymising transport like every other RPC.
 *
 * It still is not perfect. An observer who sees the batch learns that these
 * ids interest one client. That is why {@link checkFollowUps} refuses to run
 * unprompted on a direct connection, and why the caller has to ask for it.
 */

const SNAPSHOT_KEY = "khabardar.followups.v1";

/** Chain-visible state of one report, as of the last time we looked. */
export interface ReportSnapshot {
  tier: VerificationTier;
  corroborations: number;
}

export type FollowUpChange =
  | { kind: "tier"; reportId: number; localId: string; from: VerificationTier; to: VerificationTier }
  | { kind: "corroboration"; reportId: number; localId: string; from: number; to: number };

export interface FollowUpResult {
  changes: FollowUpChange[];
  /** Reports that were checked, so "nothing changed" is distinguishable from "nothing checked". */
  checked: number;
  /** Set when the check could not run. The UI must not render this as "no news". */
  unavailable?: "no-registry" | "requires-anonymity" | "unreachable";
}

async function readSnapshots(): Promise<Record<string, ReportSnapshot>> {
  const raw = await AsyncStorage.getItem(SNAPSHOT_KEY);
  return safeJsonParse<Record<string, ReportSnapshot>>(raw ?? "") ?? {};
}

async function writeSnapshots(s: Record<string, ReportSnapshot>): Promise<void> {
  await AsyncStorage.setItem(SNAPSHOT_KEY, JSON.stringify(s));
}

/** Anchored reports are the only ones with anything on-chain to ask about. */
function anchored(reports: AnonymousReport[]): AnonymousReport[] {
  return reports.filter(
    (r) => r.status === "anchored" && typeof r.onChainReportId === "number" && r.onChainReportId >= 0
  );
}

/**
 * Look for changes to this device's own reports since the last check.
 *
 * `requireAnonymity` defaults to true. A background or screen-load call must
 * not quietly make a direct RPC request keyed to the reporter's own report
 * ids: that is precisely the IP-to-pseudonym link the transport exists to
 * avoid, and it would happen without the reporter ever asking for it. A
 * deliberate, user-initiated check may pass false, the same way the feed is a
 * direct read when the user chooses to browse.
 */
export async function checkFollowUps(
  options: { requireAnonymity?: boolean } = {}
): Promise<FollowUpResult> {
  const requireAnonymity = options.requireAnonymity ?? true;

  const registry = process.env.EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS as `0x${string}` | undefined;
  if (!registry) return { changes: [], checked: 0, unavailable: "no-registry" };

  if (requireAnonymity && !isAnonymised()) {
    return { changes: [], checked: 0, unavailable: "requires-anonymity" };
  }

  const mine = anchored(await loadAllReports());
  if (mine.length === 0) return { changes: [], checked: 0 };

  const client = createPublicClient({
    chain: lineaSepolia,
    transport: anonymisingRpcTransport(ACTIVE_CHAIN.rpcUrl, "followups:read"),
  });

  let rows: Array<{ tier: number; corroborations: bigint } | null>;
  try {
    rows = await Promise.all(
      mine.map(async (r) => {
        try {
          const [record, corroborations] = await Promise.all([
            client.readContract({
              address: registry,
              abi: REPORT_REGISTRY_ABI,
              functionName: "reports",
              args: [BigInt(r.onChainReportId!)],
            }) as Promise<unknown>,
            client.readContract({
              address: registry,
              abi: REPORT_REGISTRY_ABI,
              functionName: "corroborationCount",
              args: [BigInt(r.onChainReportId!)],
            }) as Promise<bigint>,
          ]);
          // Same shape the feed index reads, so the two cannot disagree about
          // what tier a report is in.
          const tier = Number((record as unknown as { tier: number }).tier ?? 0);
          return { tier, corroborations };
        } catch {
          return null;
        }
      })
    );
  } catch {
    return { changes: [], checked: 0, unavailable: "unreachable" };
  }

  if (rows.every((r) => r === null)) {
    return { changes: [], checked: 0, unavailable: "unreachable" };
  }

  const snapshots = await readSnapshots();
  const changes: FollowUpChange[] = [];
  let checked = 0;

  mine.forEach((report, i) => {
    const row = rows[i];
    if (!row) return;
    checked += 1;

    const reportId = report.onChainReportId!;
    const next: ReportSnapshot = {
      tier: row.tier as VerificationTier,
      corroborations: Number(row.corroborations),
    };
    const prev = snapshots[report.id];

    // The first sight of a report is not news. Recording it silently means the
    // reporter is told about the next change rather than about the state it
    // was already in when they submitted it.
    if (prev) {
      if (prev.tier !== next.tier) {
        changes.push({
          kind: "tier",
          reportId,
          localId: report.id,
          from: prev.tier,
          to: next.tier,
        });
      }
      if (next.corroborations > prev.corroborations) {
        changes.push({
          kind: "corroboration",
          reportId,
          localId: report.id,
          from: prev.corroborations,
          to: next.corroborations,
        });
      }
    }

    snapshots[report.id] = next;
  });

  await writeSnapshots(snapshots);
  return { changes, checked };
}

/**
 * Forget every snapshot.
 *
 * Called from panic delete. The snapshots are a list of report ids this device
 * cares about, which is a map of what its owner filed, so they have to go with
 * everything else.
 */
export async function clearFollowUps(): Promise<void> {
  await AsyncStorage.removeItem(SNAPSHOT_KEY);
}
