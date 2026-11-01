import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { resetStubs } from "./stubs/native";
import {
  fingerprintOf,
  wellKnownUrl,
  checkPublishedKey,
  availableRecipients,
  journalistKeysArePlaceholders,
  PINNED_RECIPIENTS,
  WELL_KNOWN_PATH,
  type Recipient,
} from "../src/content/recipients";
import * as transport from "../src/net/transport";

beforeEach(resetStubs);
afterEach(() => vi.restoreAllMocks());

const KEY_A = "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5";
const KEY_B = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";

const recipient: Recipient = {
  id: "r",
  name: "Example Newsroom",
  pubKey: KEY_A,
  domain: "example.org",
  demo: false,
};

function respond(body: string, ok = true, status = 200) {
  vi.spyOn(transport, "netFetch").mockResolvedValue({
    ok,
    status,
    text: async () => body,
  } as unknown as Response);
}

describe("fingerprints", () => {
  it("is stable for the same key", () => {
    expect(fingerprintOf(KEY_A)).toBe(fingerprintOf(KEY_A));
  });

  it("differs for different keys", () => {
    expect(fingerprintOf(KEY_A)).not.toBe(fingerprintOf(KEY_B));
  });

  it("ignores a 0x prefix, so the same key never shows two fingerprints", () => {
    expect(fingerprintOf(`0x${KEY_A}`)).toBe(fingerprintOf(KEY_A));
  });

  it("is grouped so a human can actually compare it", () => {
    // Five blocks of four. An ungrouped 64-character string is a check nobody
    // performs, which is the same as no check.
    expect(fingerprintOf(KEY_A)).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){4}$/);
  });
});

describe("well-known URL", () => {
  it("uses https on the organisation's own domain", () => {
    expect(wellKnownUrl("example.org")).toBe(`https://example.org${WELL_KNOWN_PATH}`);
  });

  it("normalises a scheme or trailing slash rather than producing a broken URL", () => {
    expect(wellKnownUrl("https://example.org/")).toBe(`https://example.org${WELL_KNOWN_PATH}`);
    expect(wellKnownUrl("http://example.org")).toBe(`https://example.org${WELL_KNOWN_PATH}`);
  });
});

describe("checking a pinned key against what is published", () => {
  it("reports a match when the domain agrees", async () => {
    respond(JSON.stringify({ pubKey: KEY_A }));
    const r = await checkPublishedKey(recipient);
    expect(r.state).toBe("match");
  });

  it("tolerates a 0x prefix and different case in the published copy", async () => {
    respond(JSON.stringify({ pubKey: `0x${KEY_A.toUpperCase()}` }));
    expect((await checkPublishedKey(recipient)).state).toBe("match");
  });

  // The whole point of the module. A published key that differs must never be
  // quietly adopted, and must never be reported as fine.
  it("reports a mismatch when the published key differs", async () => {
    respond(JSON.stringify({ pubKey: KEY_B }));
    const r = await checkPublishedKey(recipient);
    expect(r.state).toBe("mismatch");
    if (r.state !== "mismatch") throw new Error("unreachable");
    expect(r.fingerprint).toBe(fingerprintOf(KEY_A));
    expect(r.publishedFingerprint).toBe(fingerprintOf(KEY_B));
  });

  it("never returns the published key, only a verdict about it", async () => {
    respond(JSON.stringify({ pubKey: KEY_B }));
    const r = await checkPublishedKey(recipient);
    expect(JSON.stringify(r)).not.toContain(KEY_B);
  });

  it("degrades to unverified when the lookup fails, and keeps the pin", async () => {
    respond("", false, 404);
    const r = await checkPublishedKey(recipient);
    expect(r.state).toBe("unverified");
    expect(r.fingerprint).toBe(fingerprintOf(KEY_A));
  });

  it("degrades to unverified when the network throws", async () => {
    vi.spyOn(transport, "netFetch").mockRejectedValue(new Error("offline"));
    const r = await checkPublishedKey(recipient);
    expect(r.state).toBe("unverified");
    if (r.state !== "unverified") throw new Error("unreachable");
    expect(r.reason).toContain("offline");
  });

  it.each([
    ["not json at all", "<html>nope</html>"],
    ["missing the field", JSON.stringify({ note: "hi" })],
    ["wrong length", JSON.stringify({ pubKey: "02ab" })],
    ["not hex", JSON.stringify({ pubKey: "z".repeat(66) })],
  ])("treats a malformed document as unverified: %s", async (_label, body) => {
    respond(body);
    expect((await checkPublishedKey(recipient)).state).toBe("unverified");
  });

  it("says unverified without a lookup when no domain is published", async () => {
    const spy = vi.spyOn(transport, "netFetch");
    const r = await checkPublishedKey({ ...recipient, domain: undefined });
    expect(r.state).toBe("unverified");
    expect(spy).not.toHaveBeenCalled();
  });

  it("goes through the transport, so the lookup is not a hole in it", async () => {
    const spy = vi.spyOn(transport, "netFetch").mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ pubKey: KEY_A }),
    } as unknown as Response);
    await checkPublishedKey(recipient);
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe("what a build offers", () => {
  it("ships no recipients by default", () => {
    expect(PINNED_RECIPIENTS).toHaveLength(0);
    expect(availableRecipients()).toHaveLength(0);
  });

  it("treats an empty set as placeholders, so the UI keeps warning", () => {
    expect(journalistKeysArePlaceholders()).toBe(true);
  });
});
