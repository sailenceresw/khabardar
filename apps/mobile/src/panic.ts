import AsyncStorage from "@react-native-async-storage/async-storage";
import { destroyIdentity } from "./identity";
import { deleteAllReports } from "./drafts";
import { deleteAllEvidence } from "./evidence";
import { clearMirror } from "./feed/localChainMirror";
import { clearModerationLog } from "./moderation";
import { signOutOrg } from "./org";
import { deleteAllTips } from "./tips";
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

  // An org account and a connected wallet are both identifying, so a duress
  // wipe must take them too. Cleared explicitly rather than leaving it to the
  // prefix sweep below: the sweep is a backstop, not the contract.
  await signOutOrg();
  await disconnectWallet();

  await destroyIdentity();

  const remaining = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith("khabardar."));
  if (remaining.length) await AsyncStorage.multiRemove(remaining);
}
