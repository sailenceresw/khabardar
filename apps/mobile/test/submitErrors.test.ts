import { describe, expect, it } from "vitest";
import { AnonymityRequiredError } from "../src/net/transport";
import { atStage, classifySubmitError, SubmitError } from "../src/submitErrors";
import en from "../src/i18n/en.json";

const fail = (e: unknown) => async () => {
  throw e;
};

describe("atStage", () => {
  it("tags a failure with its stage and keeps the original text", async () => {
    const err = await atStage("content", fail(new Error("IPFS put failed: 503"))).catch((e) => e);
    expect(err).toBeInstanceOf(SubmitError);
    expect(err.stage).toBe("content");
    expect(err.message).toBe("content: IPFS put failed: 503");
  });

  it("keeps the innermost stage when stages nest", async () => {
    const inner = () => atStage("evidence", fail(new Error("chunk upload failed")));
    const err = await atStage("content", inner).catch((e) => e);
    expect(err.stage).toBe("evidence");
  });

  it("passes the value through when nothing fails", async () => {
    expect(await atStage("relay", async () => 42)).toBe(42);
  });
});

describe("classifySubmitError", () => {
  it.each([
    ["a storage failure", new SubmitError("content", new Error("IPFS put failed: 503")), "content"],
    ["an evidence upload failure", new SubmitError("evidence", new Error("IPFS put failed: 413")), "content"],
    ["a relayer failure", new SubmitError("relay", new Error("bundler rejected the user operation")), "relayer"],
    ["a relayer timeout, which is not the phone being offline", new SubmitError("relay", new Error("Timed out waiting for receipt")), "relayer"],
    ["fetch with no connection", new SubmitError("content", new TypeError("Failed to fetch")), "offline"],
    ["React Native with no connection", new SubmitError("relay", new TypeError("Network request failed")), "offline"],
    ["a DNS failure", new SubmitError("content", new Error("getaddrinfo ENOTFOUND api.pinata.cloud")), "offline"],
    ["an aborted request", new SubmitError("relay", Object.assign(new Error("The operation was aborted"), { name: "AbortError" })), "offline"],
    ["viem's chain mismatch", new SubmitError("relay", Object.assign(new Error("chain mismatch"), { name: "ChainMismatchError" })), "network"],
    ["a wallet on another chain", new SubmitError("relay", new Error("The current chain of the wallet (id: 1) does not match the target chain for the transaction (id: 59141)")), "network"],
    ["an error from outside any stage", new Error("something odd"), "unknown"],
    ["a thrown string", "boom", "unknown"],
  ])("reads %s as %s", (_label, error, kind) => {
    expect(classifySubmitError(error)).toBe(kind);
  });

  it("treats the fail-closed refusal as its own case, even when offline", () => {
    const refused = new SubmitError("content", new AnonymityRequiredError("api.pinata.cloud"));
    expect(classifySubmitError(refused)).toBe("anonymity");
    expect(classifySubmitError(refused, true)).toBe("anonymity");
  });

  it("believes the device when it says it is offline", () => {
    expect(classifySubmitError(new SubmitError("relay", new Error("bundler rejected")), true)).toBe("offline");
  });
});

describe("messages", () => {
  const lookup = (key: string) => key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], en);

  it("has a title and body for every kind, and a feed message for every kind the feed can hit", () => {
    for (const kind of ["offline", "anonymity", "content", "relayer", "network", "unknown"]) {
      expect(typeof lookup(`submitError.${kind}.title`), kind).toBe("string");
      expect(typeof lookup(`submitError.${kind}.body`), kind).toBe("string");
    }
    for (const kind of ["offline", "anonymity", "network", "unknown"]) {
      expect(typeof lookup(`feedError.${kind}`), kind).toBe("string");
    }
  });
});
