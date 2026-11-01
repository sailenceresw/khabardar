import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resetStubs, asyncStorageStub } from "./stubs/native";
import * as transport from "../src/net/transport";
import * as drafts from "../src/drafts";
import { checkFollowUps, clearFollowUps } from "../src/followUps";

const REGISTRY = "0x1111111111111111111111111111111111111111";

beforeEach(() => {
  resetStubs();
  process.env.EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS = REGISTRY;
  vi.spyOn(transport, "isAnonymised").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS;
});

function report(over: Record<string, unknown> = {}) {
  return {
    id: "local-1",
    status: "anchored",
    category: 0,
    body: "x",
    coarseGeohash: "tsj9",
    evidence: [],
    createdAt: 0,
    visibility: 0,
    onChainReportId: 7,
    ...over,
  } as never;
}

describe("follow-ups: refusing to leak", () => {
  it("does not check at all without a registry configured", async () => {
    delete process.env.EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS;
    const r = await checkFollowUps();
    expect(r.unavailable).toBe("no-registry");
    expect(r.changes).toHaveLength(0);
  });

  // The core guarantee. Asking the chain about this device's own report ids,
  // over a direct connection, from one IP, is exactly the link the rest of the
  // app exists to prevent. It must refuse rather than quietly do it.
  it("refuses on a direct connection by default", async () => {
    vi.spyOn(transport, "isAnonymised").mockReturnValue(false);
    const spy = vi.spyOn(drafts, "loadAllReports");

    const r = await checkFollowUps();

    expect(r.unavailable).toBe("requires-anonymity");
    // It should not even read which reports exist before deciding.
    expect(spy).not.toHaveBeenCalled();
  });

  it("can be overridden only by an explicit, deliberate call", async () => {
    vi.spyOn(transport, "isAnonymised").mockReturnValue(false);
    vi.spyOn(drafts, "loadAllReports").mockResolvedValue([]);

    const r = await checkFollowUps({ requireAnonymity: false });

    expect(r.unavailable).toBeUndefined();
  });

  it("makes no network call when nothing is anchored", async () => {
    vi.spyOn(drafts, "loadAllReports").mockResolvedValue([
      report({ status: "draft", onChainReportId: undefined }),
    ]);
    const spy = vi.spyOn(transport, "anonymisingRpcTransport");

    const r = await checkFollowUps();

    expect(r.checked).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("ignores drafts and failed submissions, which have nothing on-chain", async () => {
    vi.spyOn(drafts, "loadAllReports").mockResolvedValue([
      report({ id: "a", status: "draft", onChainReportId: undefined }),
      report({ id: "b", status: "failed", onChainReportId: undefined }),
      report({ id: "c", status: "submitting", onChainReportId: undefined }),
    ]);
    const spy = vi.spyOn(transport, "anonymisingRpcTransport");
    await checkFollowUps();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("follow-ups: what gets wiped", () => {
  it("clearFollowUps removes the stored snapshots", async () => {
    await asyncStorageStub.setItem(
      "khabardar.followups.v1",
      JSON.stringify({ "local-1": { tier: 0, corroborations: 0 } })
    );
    expect(await asyncStorageStub.getItem("khabardar.followups.v1")).not.toBeNull();

    await clearFollowUps();

    // The snapshots name every report id this device was watching, which is a
    // map of what its owner filed. Panic delete has to take them.
    expect(await asyncStorageStub.getItem("khabardar.followups.v1")).toBeNull();
  });
});

describe("follow-ups: unavailable is never silent good news", () => {
  it.each([
    ["no-registry" as const],
    ["requires-anonymity" as const],
  ])("reports %s rather than an empty change list", async (reason) => {
    if (reason === "no-registry") delete process.env.EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS;
    if (reason === "requires-anonymity") {
      vi.spyOn(transport, "isAnonymised").mockReturnValue(false);
    }
    const r = await checkFollowUps();
    // "nothing changed" and "could not look" must be distinguishable, or the
    // UI tells a reporter there is no news when it simply never asked.
    expect(r.unavailable).toBe(reason);
    expect(r.changes).toHaveLength(0);
    expect(r.checked).toBe(0);
  });
});
