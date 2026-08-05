import AsyncStorage from "@react-native-async-storage/async-storage";
import { destroyIdentity } from "./identity";
import { deleteAllReports, destroyLocalKeys } from "./drafts";
import { deleteAllEvidence } from "./evidence";
import { clearMirror } from "./feed/localChainMirror";
import { clearModerationLog } from "./moderation";
import { clearCases } from "./cases";
import { signOutOrg } from "./org";
import { clearQueue } from "./submissionQueue";
import { clearStealth } from "./stealth";
import { deleteAllTips } from "./tips";
import { clearEgressLog } from "./net/transport";
import { disconnectWallet } from "./wallet";

/**
 * Panic delete: irreversibly wipe every trace of Khabardar from this device —
 * drafts, evidence blobs, encryption keys, and the identity keypair.
 * On-chain hashes remain (immutable by design) but nothing on the device
 * links to them afterwards.
 *
 * Ordering note: evidence and drafts are wiped before the keys/identity, so
 * an interrupted wipe still leaves ciphertext without its key rather than
 * the reverse.
 */
export async function panicDelete(): Promise<void> {
  await deleteAllEvidence();
  await deleteAllReports();
  await deleteAllTips();
  await clearModerationLog();
  await clearMirror();
  await clearQueue();
  // The egress log is a record of which hosts this device contacted and when —
  // useful to the user, and equally useful to whoever seizes the phone.
  await clearEgressLog();

  // An org account and a connected wallet are both identifying, so a duress
  // wipe must take them too. Cleared explicitly rather than leaving it to the
  // prefix sweep below: the sweep is a backstop, not the contract.
  await signOutOrg();
  await clearCases();
  await disconnectWallet();

  // Keys last, and only after every blob they protect is already gone.
  // On native these live in the keystore, which the AsyncStorage sweep below
  // cannot see, so they have to be named explicitly.
  await clearStealth();
  await destroyLocalKeys();
  await destroyIdentity();

  const remaining = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith("khabardar."));
  if (remaining.length) await AsyncStorage.multiRemove(remaining);
}
