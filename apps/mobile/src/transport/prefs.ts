import AsyncStorage from "@react-native-async-storage/async-storage";
import { configFromEnv, initTransport } from "./index";
import type { TransportMode } from "./types";

const MODE_KEY = "khabardar.transport.mode";
const ORBOT_KEY = "khabardar.transport.orbotActive";

export interface TransportPrefs {
  mode: TransportMode;
  orbotActive: boolean;
}

/**
 * Load saved transport preferences (or fall back to env / defaults).
 */
export async function loadTransportPrefs(): Promise<TransportPrefs> {
  const [modeRaw, orbotRaw] = await Promise.all([
    AsyncStorage.getItem(MODE_KEY),
    AsyncStorage.getItem(ORBOT_KEY),
  ]);

  const envMode = process.env.EXPO_PUBLIC_TRANSPORT_MODE;
  const mode: TransportMode =
    modeRaw === "tor" || modeRaw === "clearnet"
      ? modeRaw
      : envMode === "tor"
        ? "tor"
        : "clearnet";

  const orbotActive =
    orbotRaw === "1" ||
    orbotRaw === "true" ||
    process.env.EXPO_PUBLIC_ORBOT_ACTIVE === "1" ||
    process.env.EXPO_PUBLIC_ORBOT_ACTIVE === "true";

  return { mode, orbotActive };
}

/**
 * Persist prefs and re-initialise the active transport.
 */
export async function saveTransportPrefs(prefs: TransportPrefs): Promise<void> {
  await Promise.all([
    AsyncStorage.setItem(MODE_KEY, prefs.mode),
    AsyncStorage.setItem(ORBOT_KEY, prefs.orbotActive ? "1" : "0"),
  ]);
  initTransport(prefs.mode, configFromEnv(), prefs.orbotActive);
}

/**
 * Apply saved prefs at app start (call once from content/relayer bootstrap or AppProvider).
 */
export async function applySavedTransportPrefs(): Promise<TransportPrefs> {
  const prefs = await loadTransportPrefs();
  initTransport(prefs.mode, configFromEnv(), prefs.orbotActive);
  return prefs;
}
