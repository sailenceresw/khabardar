import { describe, it, expect, beforeEach } from "vitest";
import { resetStubs } from "./stubs/native";
import {
  setUnlockPin,
  setDuressPin,
  attemptUnlock,
  StealthPinRejected,
  MIN_PIN_LENGTH,
} from "../src/stealth";

beforeEach(resetStubs);

const REAL = "428613";

/**
 * Of everything in this app, the duress PIN is the one feature whose failure
 * mode is destroying the user's own evidence. It is worth over-testing.
 */
describe("unlock PIN rules", () => {
  it("rejects a PIN shorter than the minimum", async () => {
    await expect(setUnlockPin("1".repeat(MIN_PIN_LENGTH - 1))).rejects.toBeInstanceOf(
      StealthPinRejected
    );
  });

  it("rejects a repeated digit and a straight run", async () => {
    for (const weak of ["111111", "123456", "654321"]) {
      await expect(setUnlockPin(weak)).rejects.toBeInstanceOf(StealthPinRejected);
    }
  });

  it("accepts a reasonable PIN", async () => {
    await expect(setUnlockPin(REAL)).resolves.not.toThrow();
  });
});

describe("duress PIN", () => {
  it("cannot be set before a real PIN exists", async () => {
    await expect(setDuressPin("905172", REAL)).rejects.toMatchObject({
      code: "real-pin-required",
    });
  });

  it("requires the real PIN to authorise the change", async () => {
    await setUnlockPin(REAL);
    await expect(setDuressPin("905172", "000000")).rejects.toMatchObject({
      code: "real-pin-wrong",
    });
  });

  it("refuses a duress PIN identical to the real one", async () => {
    await setUnlockPin(REAL);
    await expect(setDuressPin(REAL, REAL)).rejects.toMatchObject({
      code: "duress-matches-real",
    });
  });

  // Regression: the near-miss check was documented but never implemented, so a
  // duress PIN one digit from the real one was accepted. Under stress that gets
  // entered by accident, and the wipe it triggers cannot be undone.
  it.each([
    ["528613", "first digit"],
    ["438613", "second digit"],
    ["428619", "last digit"],
  ])("refuses %s, which differs only in the %s", async (near) => {
    await setUnlockPin(REAL);
    await expect(setDuressPin(near, REAL)).rejects.toMatchObject({
      code: "duress-near-real",
    });
  });

  it("accepts a duress PIN that differs in two or more digits", async () => {
    await setUnlockPin(REAL);
    await expect(setDuressPin("538613", REAL)).resolves.not.toThrow();
  });

  it("does not treat a different-length PIN as a near miss", async () => {
    await setUnlockPin(REAL);
    await expect(setDuressPin("4286137", REAL)).resolves.not.toThrow();
  });
});

describe("classifying an entered PIN", () => {
  beforeEach(async () => {
    await setUnlockPin(REAL);
    await setDuressPin("538613", REAL);
  });

  it("unlocks on the real PIN", async () => {
    expect(await attemptUnlock(REAL)).toBe("unlocked");
  });

  it("reports duress on the duress PIN", async () => {
    expect(await attemptUnlock("538613")).toBe("duress");
  });

  it("rejects anything else", async () => {
    expect(await attemptUnlock("777555")).toBe("rejected");
  });

  // A PIN beginning with 0 was unenterable through the calculator disguise.
  // The classifier must at least treat it as ordinary, so the entry fix has
  // something correct to hand it to.
  it("treats a PIN starting with zero as ordinary", async () => {
    resetStubs();
    await setUnlockPin("092317");
    expect(await attemptUnlock("092317")).toBe("unlocked");
    expect(await attemptUnlock("92317")).toBe("rejected");
  });
});
