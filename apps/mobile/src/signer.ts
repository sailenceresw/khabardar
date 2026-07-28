import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getPrivateKey } from "./identity";
import { getWalletSession, signWithWallet } from "./wallet";

/**
 * Whatever is currently authorised to sign a report submission.
 *
 * Two kinds exist deliberately:
 *  - "device": the embedded, app-generated key. The default and the only one
 *    that preserves the anonymity guarantee, because it is created here, used
 *    only here, and has no history anywhere else.
 *  - "wallet": an external wallet over WalletConnect. Opt-in only. Convenient
 *    for people who already manage keys, but any wallet reused elsewhere
 *    carries its own on-chain history, so submissions become linkable to that
 *    history. The UI must say so before anyone connects.
 */
export interface ReportSigner {
  address: string;
  kind: "device" | "wallet";
  signMessage(message: { raw: Hex }): Promise<Hex>;
}

export async function getDeviceSigner(): Promise<ReportSigner | null> {
  const pk = await getPrivateKey();
  if (!pk) return null;

  const account = privateKeyToAccount(pk);
  return {
    address: account.address,
    kind: "device",
    signMessage: (message) => account.signMessage({ message }),
  };
}

export async function getWalletSigner(): Promise<ReportSigner | null> {
  const session = await getWalletSession();
  if (!session) return null;

  return {
    address: session.address,
    kind: "wallet",
    signMessage: ({ raw }) => signWithWallet(session, raw),
  };
}

/**
 * Resolve the signer to use for a submission. A connected wallet takes
 * precedence only because connecting is an explicit, deliberate act — the
 * device key remains the default for anyone who never touches that screen.
 */
export async function getActiveSigner(): Promise<ReportSigner> {
  const wallet = await getWalletSigner();
  if (wallet) return wallet;

  const device = await getDeviceSigner();
  if (!device) throw new Error("No identity on this device");
  return device;
}
