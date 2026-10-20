import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

/**
 * Vanilla Tor bridges, stored on this device.
 *
 * A bridge line is how this app reaches Tor when the public directory is
 * blocked. The set of bridges a person uses is identifying — two users who
 * share a rare bridge are one correlation away from each other — so the
 * paste lives in the keystore, not in AsyncStorage, and panic delete
 * wipes it.
 *
 * This build can only use *vanilla* bridges: an address, a port, a
 * fingerprint. obfs4, snowflake, meek and webtunnel need a pluggable
 * transport binary we do not ship. Accepting those lines and then failing
 * inside Arti with an opaque error would look like Tor is broken. Refusing
 * them here names the transport and the reason.
 */

const BRIDGES_KEY = "khabardar.net.bridges.v1";

const UNSUPPORTED_PTS = [
  "obfs4",
  "obfs3",
  "snowflake",
  "meek",
  "meek_lite",
  "webtunnel",
  "scramblesuit",
] as const;

const FINGERPRINT = /^\$?[0-9a-f]{40}$/i;

function isAddrPort(s: string): boolean {
  const m = /^(?:\[([0-9a-f:.]+)\]|(\d{1,3}(?:\.\d{1,3}){3})):(\d{1,5})$/i.exec(s);
  if (!m) return false;
  const port = Number(m[3]);
  if (port < 1 || port > 65535) return false;
  if (m[2]) return m[2].split(".").every((o) => Number(o) <= 255);
  return m[1].includes(":");
}

export interface BridgeParse {
  /** Lines that this build can hand to Arti. */
  vanilla: string[];
  /** Human-readable reasons a line was refused. Empty if the paste is usable. */
  errors: string[];
}

export function parseBridgePaste(raw: string): BridgeParse {
  const vanilla: string[] = [];
  const errors: string[] = [];

  raw.split(/\r?\n/).forEach((rawLine, i) => {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const line = trimmed.replace(/^Bridge\s+/i, "").trim();
    const token = line.split(/\s+/)[0] ?? "";
    const pt = UNSUPPORTED_PTS.find((name) => name.toLowerCase() === token.toLowerCase());
    if (pt) {
      errors.push(
        `Line ${i + 1} uses ${pt}. This build can only use vanilla bridges (IP, port, fingerprint). ${pt} needs a pluggable-transport binary we do not ship yet.`
      );
      return;
    }

    // A vanilla line is `addr:port fingerprint`. IPv6 comes in [brackets].
    // Checking the shape here matters for the same reason as the PT list: a
    // line Arti cannot parse fails late and looks like Tor is broken.
    const parts = line.split(/\s+/);
    if (!isAddrPort(token)) {
      errors.push(
        /^[a-z][a-z0-9_-]*$/i.test(token)
          ? `Line ${i + 1} uses ${token}. This build can only use vanilla bridges (IP, port, fingerprint). ${token} needs a pluggable-transport binary we do not ship yet.`
          : `Line ${i + 1} is not a vanilla bridge. It needs an address:port and a fingerprint.`
      );
      return;
    }
    if (parts.length < 2 || !FINGERPRINT.test(parts[1])) {
      errors.push(`Line ${i + 1} is missing the bridge fingerprint (40 hex characters after the address).`);
      return;
    }
    vanilla.push(line);
  });

  return { vanilla, errors };
}

export function serializeBridges(lines: string[]): string {
  return lines.join("\n");
}

async function storeGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") return AsyncStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function storeSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") return AsyncStorage.setItem(key, value);
  await SecureStore.setItemAsync(key, value);
}

async function storeDelete(key: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function loadBridgePaste(): Promise<string> {
  return (await storeGet(BRIDGES_KEY)) ?? "";
}

export async function saveBridgePaste(raw: string): Promise<BridgeParse> {
  const parsed = parseBridgePaste(raw);
  if (parsed.errors.length) return parsed;
  if (parsed.vanilla.length === 0) await storeDelete(BRIDGES_KEY);
  else await storeSet(BRIDGES_KEY, serializeBridges(parsed.vanilla));
  return parsed;
}

export async function clearBridges(): Promise<void> {
  await storeDelete(BRIDGES_KEY);
}
