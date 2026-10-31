import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AnonymousReport } from "@khabardar/shared";
import { loadReport, saveReport } from "./drafts";
import { safeJsonParse } from "./safeJson";
import { publishReport, type PublishResult } from "./submitReport";

/**
 * Retry queue for submissions that could not be anchored.
 *
 * ## Why this is a safety feature, not a convenience
 *
 * The moment someone most needs to file a report is often the moment they have
 * the worst connectivity — a district office with no signal, a throttled
 * network, a deliberately degraded one. Without a queue, "submit" fails and the
 * report sits as a draft that the person has to remember to send later, from
 * somewhere else, having already taken the risk of writing it. Losing a report
 * to a dropped connection is a real failure mode with real consequences.
 *
 * ## What it deliberately does not do
 *
 * It does **not** retry on a timer in the background. A queue that fires
 * whenever the OS wakes it would submit while the user is somewhere they did
 * not choose to submit from — a location, a network, a moment they did not pick.
 * For an ordinary app that is good behaviour; for this one it means the app
 * decides when a reporter's IP touches the relayer, which is precisely the
 * decision that must stay with the reporter.
 *
 * So retries happen when the app is open and the user is present: on app
 * resume, and on an explicit "retry now". Predictable, and never behind
 * someone's back.
 */

const QUEUE_KEY = "khabardar.queue.v1";

/** Give up after this many attempts and let the user decide what to do. */
export const MAX_ATTEMPTS = 5;

export interface QueuedSubmission {
  reportId: string;
  queuedAt: number;
  attempts: number;
  lastAttemptAt?: number;
  lastError?: string;
}

export async function readQueue(): Promise<QueuedSubmission[]> {
  return safeJsonParse<QueuedSubmission[]>(await AsyncStorage.getItem(QUEUE_KEY)) ?? [];
}

async function writeQueue(queue: QueuedSubmission[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function enqueue(reportId: string, error?: string): Promise<void> {
  const queue = await readQueue();
  const existing = queue.find((q) => q.reportId === reportId);

  if (existing) {
    existing.attempts += 1;
    existing.lastAttemptAt = Date.now();
    existing.lastError = error;
  } else {
    queue.push({
      reportId,
      queuedAt: Date.now(),
      attempts: 1,
      lastAttemptAt: Date.now(),
      lastError: error,
    });
  }

  await writeQueue(queue);
}

export async function dequeue(reportId: string): Promise<void> {
  await writeQueue((await readQueue()).filter((q) => q.reportId !== reportId));
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

/** Entries that have not yet burned through {@link MAX_ATTEMPTS}. */
export async function retryableEntries(): Promise<QueuedSubmission[]> {
  return (await readQueue()).filter((q) => q.attempts < MAX_ATTEMPTS);
}

export async function abandonedEntries(): Promise<QueuedSubmission[]> {
  return (await readQueue()).filter((q) => q.attempts >= MAX_ATTEMPTS);
}

export interface FlushResult {
  submitted: Array<{ reportId: string; result: PublishResult }>;
  failed: Array<{ reportId: string; error: string }>;
  skipped: number;
}

/**
 * Attempt every retryable queued submission, oldest first.
 *
 * Sequential rather than parallel on purpose: several UserOperations leaving at
 * once, from one IP, within one second is a correlation gift — it groups
 * reports that the reporter may well have intended to be unlinkable.
 */
export async function flushQueue(): Promise<FlushResult> {
  const entries = (await retryableEntries()).sort((a, b) => a.queuedAt - b.queuedAt);
  const result: FlushResult = { submitted: [], failed: [], skipped: 0 };

  for (const entry of entries) {
    const report = await loadReport(entry.reportId);
    if (!report) {
      // The draft is gone — deleted, or wiped by panic delete. Drop the entry
      // rather than retrying forever against something that no longer exists.
      await dequeue(entry.reportId);
      result.skipped += 1;
      continue;
    }

    // Anything already anchored got there another way; do not double-submit.
    if (report.status === "anchored") {
      await dequeue(entry.reportId);
      result.skipped += 1;
      continue;
    }

    try {
      const published = await publishReport(report);
      await saveReport(anchoredFrom(report, published));
      await dequeue(entry.reportId);
      result.submitted.push({ reportId: entry.reportId, result: published });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await enqueue(entry.reportId, message);
      await saveReport({ ...report, status: "failed" });
      result.failed.push({ reportId: entry.reportId, error: message });
    }
  }

  return result;
}

/**
 * Build the anchored report from a publish result. Shared with the review
 * screen so a queued retry stores exactly what a first-try submission does —
 * including the evidence CIDs, without which the blobs are uploaded but the
 * device has forgotten where.
 */
export function anchoredFrom(report: AnonymousReport, published: PublishResult): AnonymousReport {
  return {
    ...report,
    status: "anchored",
    reportHash: published.reportHash,
    cid: published.cid,
    entityTag: published.entityTag,
    evidence: published.evidence,
    txHash: published.relay.txHash,
    onChainReportId: published.relay.onChainReportId,
    anchoredAt: Date.now(),
  };
}
