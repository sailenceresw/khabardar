/**
 * Journalist / NGO recipients that a reporter can address a restricted report
 * to. These are the accountable side of the asymmetric identity model:
 * reporters stay anonymous, verifiers are named and publicly known.
 *
 * v0 ships a hard-coded list so the flow is demonstrable. Production must
 * replace this with keys published at a verifiable location (DNS TXT, a
 * well-known URI on the organisation's own domain, or an on-chain registry)
 * and pinned in-app, so a compromised backend cannot silently swap in its own
 * key and read every restricted report.
 */
export interface Recipient {
  id: string;
  /** Display name of the newsroom or NGO. */
  name: string;
  /** secp256k1 public key, hex (33-byte compressed). */
  pubKey: string;
  /** Where the key can be independently checked. */
  keyProofUrl?: string;
  /**
   * True for placeholder keys that no real organisation holds.
   * Absent is treated as a placeholder — the UI must not claim a
   * newsroom can read a report sealed to an unmarked key.
   */
  demo?: boolean;
}

// Demo keypairs — placeholders with no real organisation behind them.
// Replace before any real deployment.
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

/** True when a "journalists only" report would be sealed to keys no newsroom holds. */
export function journalistKeysArePlaceholders(): boolean {
  return DEMO_RECIPIENTS.length === 0 || DEMO_RECIPIENTS.some((r) => r.demo !== false);
}
