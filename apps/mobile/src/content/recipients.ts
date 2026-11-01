import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/ciphers/utils";
import { netFetch } from "../net/transport";
import { safeJsonParse } from "../safeJson";

/**
 * Journalist and NGO recipients a reporter can seal a restricted report or a
 * tip to. These are the accountable side of the asymmetric identity model:
 * reporters stay anonymous, verifiers are named and publicly known.
 *
 * ## Why a hard-coded list is not enough on its own
 *
 * A recipient key decides who can read a report. If the app takes that key
 * from a server at run time, then whoever controls the server decides who can
 * read every restricted report, and can swap in a key they hold without
 * anybody noticing. The encryption keeps working perfectly, pointed at the
 * attacker. That is the single worst failure this module can have, and it
 * leaves no trace for the reporter to find.
 *
 * So the key is **pinned**: it ships compiled into the app, and the published
 * copy is only ever used to *check* the pin, never to replace it. A mismatch
 * is surfaced loudly and the recipient becomes unusable. Rotating a key
 * requires an app release, which is slow on purpose, because the alternative
 * is a silent swap.
 *
 * ## What publishing buys, if it cannot change the key
 *
 * Independent corroboration. The organisation publishes the same key at a
 * location only it controls, so a reporter, a journalist, or a researcher can
 * fetch it from a different device on a different network and compare. The
 * app cannot prove it shipped the right key; the two sources agreeing is what
 * makes that credible.
 */
export interface Recipient {
  id: string;
  /** Display name of the newsroom or NGO. */
  name: string;
  /** secp256k1 public key, hex, 33-byte compressed. The pin. */
  pubKey: string;
  /**
   * Domain the organisation controls, where the same key is published at
   * {@link wellKnownPath}. Absent means the key cannot be corroborated.
   */
  domain?: string;
  /**
   * True for placeholder keys that no real organisation holds.
   * Absent is treated as a placeholder: the UI must never claim a newsroom can
   * read something sealed to an unverified key.
   */
  demo?: boolean;
}

/**
 * Where an organisation publishes its key.
 *
 * A path under `.well-known` on the organisation's own domain, so control of
 * the domain is control of the claim, and no third party sits in between.
 */
export const WELL_KNOWN_PATH = "/.well-known/khabardar-recipient.json";

export function wellKnownUrl(domain: string): string {
  return `https://${domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}${WELL_KNOWN_PATH}`;
}

/**
 * A short, human-comparable digest of a key.
 *
 * Shown in the UI so a reporter can read it back to a journalist over a
 * channel the app does not control: a phone call, an article footer, a
 * conference badge. Comparing 66 hex characters by eye is something nobody
 * actually does, and a check nobody performs is not a check.
 *
 * Grouped into five blocks of four, like every other fingerprint people are
 * asked to compare, because the format is what makes a mismatch visible.
 */
export function fingerprintOf(pubKey: string): string {
  const digest = bytesToHex(sha256(hexToBytes(pubKey.replace(/^0x/, ""))));
  return (digest.slice(0, 20).toUpperCase().match(/.{4}/g) ?? []).join("-");
}

export type KeyCheck =
  /** The published key matches the pin. Independently corroborated. */
  | { state: "match"; fingerprint: string }
  /**
   * The published key differs from the pin. Either the organisation rotated
   * without a release, or somebody is trying to read their mail. The app
   * cannot tell which, and must not guess.
   */
  | { state: "mismatch"; fingerprint: string; publishedFingerprint: string }
  /** Nothing published, or it could not be read. The pin still stands. */
  | { state: "unverified"; fingerprint: string; reason: string };

/**
 * Check a pinned key against the organisation's published copy.
 *
 * Never returns a key. The caller already has the only key it is allowed to
 * use. This answers one question: does the organisation's own domain agree?
 *
 * Goes through {@link netFetch} like every other request, so the lookup is not
 * a hole in the transport: asking example.org for its key over clearnet tells
 * an observer which newsroom a reporter is about to write to, which is close
 * to telling them the content.
 */
export async function checkPublishedKey(recipient: Recipient): Promise<KeyCheck> {
  const fingerprint = fingerprintOf(recipient.pubKey);

  if (!recipient.domain) {
    return { state: "unverified", fingerprint, reason: "no-domain" };
  }

  let body: string;
  try {
    const res = await netFetch(
      wellKnownUrl(recipient.domain),
      undefined,
      "recipients:key-check"
    );
    if (!res.ok) {
      return { state: "unverified", fingerprint, reason: `http-${res.status}` };
    }
    body = await res.text();
  } catch (e) {
    return {
      state: "unverified",
      fingerprint,
      reason: e instanceof Error ? e.message : "unreachable",
    };
  }

  const doc = safeJsonParse<{ pubKey?: unknown }>(body);
  const published = typeof doc?.pubKey === "string" ? doc.pubKey.replace(/^0x/, "") : null;
  if (!published || !/^[0-9a-fA-F]{66}$/.test(published)) {
    return { state: "unverified", fingerprint, reason: "malformed" };
  }

  const pinned = recipient.pubKey.replace(/^0x/, "").toLowerCase();
  if (published.toLowerCase() === pinned) {
    return { state: "match", fingerprint };
  }

  return {
    state: "mismatch",
    fingerprint,
    publishedFingerprint: fingerprintOf(published),
  };
}

/**
 * Recipients compiled into the build.
 *
 * Empty in a release. There is no newsroom running this yet, and shipping a
 * plausible-looking name with a key nobody holds would be worse than shipping
 * nothing: it invites someone to seal a real report to it.
 */
export const PINNED_RECIPIENTS: Recipient[] = [];

/**
 * Placeholder recipients, so the sealing flow is demonstrable on a build that
 * has no real ones. Nobody holds these private keys, which means anything
 * sealed to them is readable by anyone who reads this file.
 *
 * Gated on an explicit opt-in rather than on `__DEV__`, so turning them on is
 * a decision somebody made rather than a side effect of how the app was built.
 */
export const DEMO_RECIPIENTS: Recipient[] = [
  {
    id: "demo-newsroom",
    name: "Sample Newsroom (demo)",
    pubKey: "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5",
    demo: true,
  },
  {
    id: "demo-ngo",
    name: "Sample Transparency NGO (demo)",
    pubKey: "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
    demo: true,
  },
];

export function demoRecipientsEnabled(): boolean {
  const flag = process.env.EXPO_PUBLIC_DEMO_RECIPIENTS;
  return flag === "1" || flag === "true";
}

/** Recipients this build will actually offer. */
export function availableRecipients(): Recipient[] {
  return demoRecipientsEnabled()
    ? [...PINNED_RECIPIENTS, ...DEMO_RECIPIENTS]
    : PINNED_RECIPIENTS;
}

/** True when a "journalists only" report would be sealed to a key no newsroom holds. */
export function journalistKeysArePlaceholders(): boolean {
  const available = availableRecipients();
  return available.length === 0 || available.some((r) => r.demo !== false);
}
