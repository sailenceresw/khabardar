import { describe, it, expect, beforeEach } from "vitest";
import { resetStubs, EXPO_RANDOM_LIMIT } from "./stubs/native";
import { padToBucket, unpadFromBucket, TIP_LENGTH_BUCKETS } from "../src/tips";
import { randomBytes } from "../src/cryptoUtils";

beforeEach(resetStubs);

/**
 * Padding exists so ciphertext length does not leak message length. A tip that
 * throws instead of sending is not a padding bug in the abstract: it is the
 * whole feature failing closed on exactly the longer, more detailed reports
 * that matter most.
 */
describe("tip padding", () => {
  it("pads a short message to the smallest bucket", () => {
    const out = padToBucket("hello");
    expect(out.length).toBe(TIP_LENGTH_BUCKETS[0]);
  });

  it("round-trips the message through padding", () => {
    const msg = "the clerk asked for 5,000 in cash, outside the office";
    expect(unpadFromBucket(padToBucket(msg))).toBe(msg);
  });

  it("gives two different short messages the same stored length", () => {
    const a = padToBucket("x");
    const b = padToBucket("a far longer tip, but still under the first bucket");
    expect(a.length).toBe(b.length);
  });

  // Regression: padToBucket called Crypto.getRandomBytes(size) directly, and
  // expo-crypto refuses anything over 1024 bytes. Every tip whose payload
  // crossed the 512-byte bucket threw a TypeError and could not be sent. The
  // stub enforces the real ceiling, so this fails against the old code.
  it("sends a message past the first bucket", () => {
    const msg = "e".repeat(TIP_LENGTH_BUCKETS[0]);
    const out = padToBucket(msg);
    expect(out.length).toBeGreaterThan(EXPO_RANDOM_LIMIT);
    expect(unpadFromBucket(out)).toBe(msg);
  });

  it("sends a message far past every bucket", () => {
    const msg = "e".repeat(TIP_LENGTH_BUCKETS[TIP_LENGTH_BUCKETS.length - 1] + 10);
    const out = padToBucket(msg);
    expect(unpadFromBucket(out)).toBe(msg);
  });

  it.each(TIP_LENGTH_BUCKETS)("round-trips either side of bucket %i", (bucket) => {
    for (const len of [bucket - 5, bucket - 4, bucket - 3]) {
      if (len <= 0) continue;
      const msg = "y".repeat(len);
      expect(unpadFromBucket(padToBucket(msg))).toBe(msg);
    }
  });

  it("refuses a payload claiming a length it does not contain", () => {
    const out = padToBucket("short");
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    view.setUint32(0, out.byteLength, false);
    expect(() => unpadFromBucket(out)).toThrow();
  });
});

describe("randomBytes", () => {
  it("returns the requested length below the native ceiling", () => {
    expect(randomBytes(32).length).toBe(32);
  });

  // Regression: anything above the ceiling used to throw.
  it("returns the requested length above the native ceiling", () => {
    for (const n of [EXPO_RANDOM_LIMIT, EXPO_RANDOM_LIMIT + 1, 8192, 131072]) {
      expect(randomBytes(n).length).toBe(n);
    }
  });

  it("fills the whole buffer, including past the first chunk", () => {
    const out = randomBytes(4096);
    // A chunking bug that left a tail unwritten shows up as a run of zeroes.
    const tail = out.subarray(EXPO_RANDOM_LIMIT);
    expect(tail.some((b) => b !== 0)).toBe(true);
  });

  it("does not repeat the same chunk", () => {
    const out = randomBytes(2048);
    const first = out.subarray(0, EXPO_RANDOM_LIMIT).join(",");
    const second = out.subarray(EXPO_RANDOM_LIMIT, 2 * EXPO_RANDOM_LIMIT).join(",");
    expect(first).not.toBe(second);
  });
});
