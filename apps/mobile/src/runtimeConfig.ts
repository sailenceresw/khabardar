import { ACTIVE_CHAIN, LINEA_MAINNET, type ChainConfig } from "@khabardar/shared";

/**
 * The one place that decides whether the app talks to real infrastructure.
 *
 * `KHABARDAR_MODE=mock` (the default) keeps everything on the device: the mock
 * relayer, the mock content store and the mock feed, with no network calls.
 * `KHABARDAR_MODE=live` turns on each live piece whose variables are complete.
 *
 * Live mode never fails open into a half-configured service. A piece with
 * missing or malformed variables stays on its mock and the reason is added to
 * `problems`, so the app keeps working and a script like the live smoke test
 * can refuse to run instead of quietly testing mocks.
 */

export type Mode = "mock" | "live";

export type RelayerConfig =
  | { kind: "mock" }
  | {
      kind: "pimlico";
      apiKey: string;
      bundlerUrl: string;
      paymasterUrl: string;
      registryAddress: `0x${string}`;
    };

export type ContentConfig =
  | { kind: "mock" }
  | { kind: "ipfs"; apiUrl: string; apiToken: string; gatewayUrl: string };

export type FeedConfig =
  | { kind: "mock" }
  | { kind: "indexer"; url: string }
  | { kind: "chain"; registryAddress: `0x${string}` };

export interface RuntimeConfig {
  mode: Mode;
  chain: ChainConfig;
  /** Set only in live mode with a valid address. Mock mode never reads the chain. */
  registryAddress: `0x${string}` | null;
  relayer: RelayerConfig;
  content: ContentConfig;
  feed: FeedConfig;
  /** Plain-language reasons a live piece fell back to its mock. Empty in mock mode unless the env is inconsistent. */
  problems: string[];
}

/** Every variable the resolver reads. Kept explicit so tests can pass a plain object. */
export interface EnvSnapshot {
  KHABARDAR_MODE?: string;
  EXPO_PUBLIC_KHABARDAR_MODE?: string;
  EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS?: string;
  EXPO_PUBLIC_PIMLICO_API_KEY?: string;
  EXPO_PUBLIC_PIMLICO_BUNDLER_URL?: string;
  EXPO_PUBLIC_PIMLICO_PAYMASTER_URL?: string;
  EXPO_PUBLIC_IPFS_API_URL?: string;
  EXPO_PUBLIC_IPFS_API_TOKEN?: string;
  EXPO_PUBLIC_IPFS_GATEWAY_URL?: string;
  EXPO_PUBLIC_INDEXER_URL?: string;
  /** No longer read. Only checked so a stale `.env` gets a clear message. */
  EXPO_PUBLIC_GASLESS_PROVIDER?: string;
  /** No longer read. Only checked so a stale `.env` gets a clear message. */
  EXPO_PUBLIC_CONTENT_STORE?: string;
}

export const DEFAULT_PIMLICO_URL = "https://api.pimlico.io/v2/linea-sepolia/rpc";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Treat empty and whitespace-only values as unset, the way a blank `.env` line reads. */
function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parseMode(env: EnvSnapshot, problems: string[]): Mode {
  // KHABARDAR_MODE wins so a one-off `KHABARDAR_MODE=live npm run ...` overrides
  // whatever the app's `.env` says. The bundled app only ever sees the
  // EXPO_PUBLIC_ variant.
  const raw = clean(env.KHABARDAR_MODE) ?? clean(env.EXPO_PUBLIC_KHABARDAR_MODE);
  if (raw === undefined) return "mock";
  const value = raw.toLowerCase();
  if (value === "mock" || value === "live") return value;
  problems.push(`KHABARDAR_MODE="${raw}" is not "mock" or "live", so the app stays in mock mode.`);
  return "mock";
}

/**
 * Turn an env snapshot into the config every service reads.
 *
 * `chain` is a parameter only so tests can prove the mainnet guard. App code
 * calls `getRuntimeConfig()`, which passes `ACTIVE_CHAIN`.
 */
export function resolveRuntimeConfig(env: EnvSnapshot, chain: ChainConfig = ACTIVE_CHAIN): RuntimeConfig {
  const problems: string[] = [];
  const mode = parseMode(env, problems);

  for (const legacy of ["EXPO_PUBLIC_GASLESS_PROVIDER", "EXPO_PUBLIC_CONTENT_STORE"] as const) {
    const value = clean(env[legacy]);
    if (value && value !== "mock") {
      problems.push(`${legacy} is no longer read. Set KHABARDAR_MODE=live instead.`);
    }
  }

  if (mode === "mock") {
    return {
      mode,
      chain,
      registryAddress: null,
      relayer: { kind: "mock" },
      content: { kind: "mock" },
      feed: { kind: "mock" },
      problems,
    };
  }

  // This build is for testnet work only. Refusing here is cheaper than finding
  // out from a real transaction.
  if (chain.chainId === LINEA_MAINNET.chainId) {
    throw new Error("Live mode is testnet only and refuses to run against Linea mainnet (chain 59144).");
  }

  let registryAddress: `0x${string}` | null = null;
  const rawRegistry = clean(env.EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS);
  if (rawRegistry === undefined) {
    problems.push("EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS is not set, so the relayer and the chain feed stay on mock.");
  } else if (!ADDRESS_RE.test(rawRegistry)) {
    problems.push("EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS is not a 0x address with 40 hex characters.");
  } else {
    registryAddress = rawRegistry as `0x${string}`;
  }

  let relayer: RelayerConfig = { kind: "mock" };
  const apiKey = clean(env.EXPO_PUBLIC_PIMLICO_API_KEY);
  if (!apiKey) {
    problems.push("EXPO_PUBLIC_PIMLICO_API_KEY is not set, so submissions use the mock relayer.");
  } else if (registryAddress) {
    relayer = {
      kind: "pimlico",
      apiKey,
      bundlerUrl: clean(env.EXPO_PUBLIC_PIMLICO_BUNDLER_URL) ?? DEFAULT_PIMLICO_URL,
      paymasterUrl: clean(env.EXPO_PUBLIC_PIMLICO_PAYMASTER_URL) ?? DEFAULT_PIMLICO_URL,
      registryAddress,
    };
  }

  let content: ContentConfig = { kind: "mock" };
  const apiUrl = clean(env.EXPO_PUBLIC_IPFS_API_URL);
  const apiToken = clean(env.EXPO_PUBLIC_IPFS_API_TOKEN);
  const gatewayUrl = clean(env.EXPO_PUBLIC_IPFS_GATEWAY_URL);
  const missingContent = [
    !apiUrl && "EXPO_PUBLIC_IPFS_API_URL",
    !apiToken && "EXPO_PUBLIC_IPFS_API_TOKEN",
    !gatewayUrl && "EXPO_PUBLIC_IPFS_GATEWAY_URL",
  ].filter(Boolean);
  if (apiUrl && apiToken && gatewayUrl) {
    content = { kind: "ipfs", apiUrl, apiToken, gatewayUrl };
  } else {
    const verb = missingContent.length === 1 ? "is" : "are";
    problems.push(`${missingContent.join(", ")} ${verb} not set, so reports are stored with the mock content store.`);
  }

  // An indexer is preferred because direct log scans do not scale. Without one
  // the feed reads the registry directly, which needs a valid address.
  let feed: FeedConfig = { kind: "mock" };
  const indexerUrl = clean(env.EXPO_PUBLIC_INDEXER_URL);
  if (indexerUrl) feed = { kind: "indexer", url: indexerUrl };
  else if (registryAddress) feed = { kind: "chain", registryAddress };

  return { mode, chain, registryAddress, relayer, content, feed, problems };
}

/**
 * Snapshot the environment.
 *
 * Expo inlines `EXPO_PUBLIC_*` values at build time only where the code names
 * them literally as `process.env.EXPO_PUBLIC_X`. Passing `process.env` around
 * as an object would read an empty object in the bundled app, so every
 * variable is listed here by name.
 */
export function readEnv(): EnvSnapshot {
  return {
    KHABARDAR_MODE: process.env.KHABARDAR_MODE,
    EXPO_PUBLIC_KHABARDAR_MODE: process.env.EXPO_PUBLIC_KHABARDAR_MODE,
    EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS: process.env.EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS,
    EXPO_PUBLIC_PIMLICO_API_KEY: process.env.EXPO_PUBLIC_PIMLICO_API_KEY,
    EXPO_PUBLIC_PIMLICO_BUNDLER_URL: process.env.EXPO_PUBLIC_PIMLICO_BUNDLER_URL,
    EXPO_PUBLIC_PIMLICO_PAYMASTER_URL: process.env.EXPO_PUBLIC_PIMLICO_PAYMASTER_URL,
    EXPO_PUBLIC_IPFS_API_URL: process.env.EXPO_PUBLIC_IPFS_API_URL,
    EXPO_PUBLIC_IPFS_API_TOKEN: process.env.EXPO_PUBLIC_IPFS_API_TOKEN,
    EXPO_PUBLIC_IPFS_GATEWAY_URL: process.env.EXPO_PUBLIC_IPFS_GATEWAY_URL,
    EXPO_PUBLIC_INDEXER_URL: process.env.EXPO_PUBLIC_INDEXER_URL,
    EXPO_PUBLIC_GASLESS_PROVIDER: process.env.EXPO_PUBLIC_GASLESS_PROVIDER,
    EXPO_PUBLIC_CONTENT_STORE: process.env.EXPO_PUBLIC_CONTENT_STORE,
  };
}

let cached: RuntimeConfig | null = null;

/** The config for this run, resolved once. Problems are logged once, never the values. */
export function getRuntimeConfig(): RuntimeConfig {
  if (cached) return cached;
  cached = resolveRuntimeConfig(readEnv());
  for (const problem of cached.problems) console.warn(`[config] ${problem}`);
  return cached;
}

/** Test seam: forget the cached config so the next call re-reads the env. */
export function resetRuntimeConfig(): void {
  cached = null;
}
