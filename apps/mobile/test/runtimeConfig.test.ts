import { afterEach, describe, expect, it, vi } from "vitest";
import { LINEA_MAINNET, LINEA_SEPOLIA } from "@khabardar/shared";
import {
  DEFAULT_PIMLICO_URL,
  getRuntimeConfig,
  resetRuntimeConfig,
  resolveRuntimeConfig,
  type EnvSnapshot,
} from "../src/runtimeConfig";

const REGISTRY = "0x1111111111111111111111111111111111111111";
const API_KEY = "pim_secret_key_value";
const IPFS_TOKEN = "ipfs_secret_token_value";

/** A live env with every piece filled in. Tests remove or change one thing at a time. */
function fullLive(over: EnvSnapshot = {}): EnvSnapshot {
  return {
    EXPO_PUBLIC_KHABARDAR_MODE: "live",
    EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS: REGISTRY,
    EXPO_PUBLIC_PIMLICO_API_KEY: API_KEY,
    EXPO_PUBLIC_IPFS_API_URL: "https://pin.example/upload",
    EXPO_PUBLIC_IPFS_API_TOKEN: IPFS_TOKEN,
    EXPO_PUBLIC_IPFS_GATEWAY_URL: "https://gw.example/ipfs",
    ...over,
  };
}

describe("mock mode", () => {
  it("is the default and uses every mock with no problems", () => {
    const cfg = resolveRuntimeConfig({});
    expect(cfg.mode).toBe("mock");
    expect(cfg.relayer).toEqual({ kind: "mock" });
    expect(cfg.content).toEqual({ kind: "mock" });
    expect(cfg.feed).toEqual({ kind: "mock" });
    expect(cfg.registryAddress).toBeNull();
    expect(cfg.problems).toEqual([]);
  });

  it("ignores live credentials entirely, so nothing reaches the network", () => {
    const cfg = resolveRuntimeConfig(fullLive({ EXPO_PUBLIC_KHABARDAR_MODE: "mock", EXPO_PUBLIC_INDEXER_URL: "https://idx.example" }));
    expect(cfg.relayer.kind).toBe("mock");
    expect(cfg.content.kind).toBe("mock");
    expect(cfg.feed.kind).toBe("mock");
    expect(cfg.registryAddress).toBeNull();
  });

  it("falls back to mock with a problem for an unknown mode value", () => {
    const cfg = resolveRuntimeConfig({ EXPO_PUBLIC_KHABARDAR_MODE: "prod" });
    expect(cfg.mode).toBe("mock");
    expect(cfg.problems).toEqual([expect.stringContaining('"prod"')]);
  });

  it("does not throw on a mainnet chain, because it never touches the chain", () => {
    expect(() => resolveRuntimeConfig({}, LINEA_MAINNET)).not.toThrow();
  });

  it("flags the old provider variables instead of silently ignoring them", () => {
    const cfg = resolveRuntimeConfig({
      EXPO_PUBLIC_GASLESS_PROVIDER: "pimlico",
      EXPO_PUBLIC_CONTENT_STORE: "ipfs",
    });
    expect(cfg.mode).toBe("mock");
    expect(cfg.problems).toHaveLength(2);
    expect(cfg.problems.join(" ")).toContain("KHABARDAR_MODE=live");
  });

  it("does not flag the old variables when they still say mock", () => {
    const cfg = resolveRuntimeConfig({
      EXPO_PUBLIC_GASLESS_PROVIDER: "mock",
      EXPO_PUBLIC_CONTENT_STORE: "mock",
    });
    expect(cfg.problems).toEqual([]);
  });
});

describe("mode parsing", () => {
  it("lets KHABARDAR_MODE override the app variable", () => {
    expect(resolveRuntimeConfig({ KHABARDAR_MODE: "live", EXPO_PUBLIC_KHABARDAR_MODE: "mock" }).mode).toBe("live");
    expect(resolveRuntimeConfig({ KHABARDAR_MODE: "mock", EXPO_PUBLIC_KHABARDAR_MODE: "live" }).mode).toBe("mock");
  });

  it("accepts any letter case and surrounding spaces", () => {
    expect(resolveRuntimeConfig({ EXPO_PUBLIC_KHABARDAR_MODE: "  LIVE " }).mode).toBe("live");
  });

  it("treats a blank KHABARDAR_MODE as unset and uses the app variable", () => {
    expect(resolveRuntimeConfig({ KHABARDAR_MODE: "", EXPO_PUBLIC_KHABARDAR_MODE: "live" }).mode).toBe("live");
  });
});

describe("live mode", () => {
  it("turns on every live piece when the variables are complete", () => {
    const cfg = resolveRuntimeConfig(fullLive());
    expect(cfg.mode).toBe("live");
    expect(cfg.chain.chainId).toBe(LINEA_SEPOLIA.chainId);
    expect(cfg.registryAddress).toBe(REGISTRY);
    expect(cfg.relayer).toEqual({
      kind: "pimlico",
      apiKey: API_KEY,
      bundlerUrl: DEFAULT_PIMLICO_URL,
      paymasterUrl: DEFAULT_PIMLICO_URL,
      registryAddress: REGISTRY,
    });
    expect(cfg.content).toEqual({
      kind: "ipfs",
      apiUrl: "https://pin.example/upload",
      apiToken: IPFS_TOKEN,
      gatewayUrl: "https://gw.example/ipfs",
    });
    expect(cfg.feed).toEqual({ kind: "chain", registryAddress: REGISTRY });
    expect(cfg.problems).toEqual([]);
  });

  it("uses custom bundler and paymaster URLs when given", () => {
    const cfg = resolveRuntimeConfig(
      fullLive({
        EXPO_PUBLIC_PIMLICO_BUNDLER_URL: "https://bundler.example",
        EXPO_PUBLIC_PIMLICO_PAYMASTER_URL: "https://paymaster.example",
      })
    );
    expect(cfg.relayer).toMatchObject({ bundlerUrl: "https://bundler.example", paymasterUrl: "https://paymaster.example" });
  });

  it("prefers an indexer over direct chain reads", () => {
    const cfg = resolveRuntimeConfig(fullLive({ EXPO_PUBLIC_INDEXER_URL: "https://idx.example" }));
    expect(cfg.feed).toEqual({ kind: "indexer", url: "https://idx.example" });
  });

  it("keeps every piece on mock and explains each one when nothing is set", () => {
    const cfg = resolveRuntimeConfig({ EXPO_PUBLIC_KHABARDAR_MODE: "live" });
    expect(cfg.mode).toBe("live");
    expect(cfg.relayer.kind).toBe("mock");
    expect(cfg.content.kind).toBe("mock");
    expect(cfg.feed.kind).toBe("mock");
    expect(cfg.registryAddress).toBeNull();
    const text = cfg.problems.join("\n");
    expect(text).toContain("EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS");
    expect(text).toContain("EXPO_PUBLIC_PIMLICO_API_KEY");
    expect(text).toContain("EXPO_PUBLIC_IPFS_API_URL, EXPO_PUBLIC_IPFS_API_TOKEN, EXPO_PUBLIC_IPFS_GATEWAY_URL are not set");
  });

  it("rejects a malformed registry address and keeps relayer and feed on mock", () => {
    const cfg = resolveRuntimeConfig(fullLive({ EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS: "0x1234" }));
    expect(cfg.registryAddress).toBeNull();
    expect(cfg.relayer.kind).toBe("mock");
    expect(cfg.feed.kind).toBe("mock");
    expect(cfg.content.kind).toBe("ipfs");
    expect(cfg.problems).toEqual([expect.stringContaining("40 hex characters")]);
  });

  it("keeps the relayer on mock without an API key while the feed still reads the chain", () => {
    const cfg = resolveRuntimeConfig(fullLive({ EXPO_PUBLIC_PIMLICO_API_KEY: "" }));
    expect(cfg.relayer.kind).toBe("mock");
    expect(cfg.feed.kind).toBe("chain");
    expect(cfg.problems).toEqual([expect.stringContaining("EXPO_PUBLIC_PIMLICO_API_KEY")]);
  });

  it("names the single missing IPFS variable", () => {
    const cfg = resolveRuntimeConfig(fullLive({ EXPO_PUBLIC_IPFS_API_TOKEN: "   " }));
    expect(cfg.content.kind).toBe("mock");
    expect(cfg.problems).toEqual(["EXPO_PUBLIC_IPFS_API_TOKEN is not set, so reports are stored with the mock content store."]);
  });

  it("refuses to run against Linea mainnet", () => {
    expect(() => resolveRuntimeConfig(fullLive(), LINEA_MAINNET)).toThrow(/testnet only/);
  });

  it("never puts a secret value into a problem message", () => {
    const cfg = resolveRuntimeConfig(fullLive({ EXPO_PUBLIC_REPORT_REGISTRY_ADDRESS: "not-an-address", EXPO_PUBLIC_IPFS_API_URL: "" }));
    const text = cfg.problems.join("\n");
    expect(cfg.problems.length).toBeGreaterThan(0);
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain(IPFS_TOKEN);
  });
});

describe("getRuntimeConfig", () => {
  const touched = ["KHABARDAR_MODE", "EXPO_PUBLIC_KHABARDAR_MODE"] as const;
  const saved = Object.fromEntries(touched.map((k) => [k, process.env[k]]));

  afterEach(() => {
    for (const k of touched) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetRuntimeConfig();
  });

  it("reads process.env, caches the result, and re-reads after a reset", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    delete process.env.KHABARDAR_MODE;
    process.env.EXPO_PUBLIC_KHABARDAR_MODE = "mock";
    resetRuntimeConfig();
    const first = getRuntimeConfig();
    expect(first.mode).toBe("mock");

    process.env.KHABARDAR_MODE = "live";
    expect(getRuntimeConfig()).toBe(first);

    resetRuntimeConfig();
    const second = getRuntimeConfig();
    expect(second.mode).toBe("live");
    // Live with no credentials in this test env: each fallback is logged once.
    expect(warn).toHaveBeenCalledTimes(second.problems.length);
  });
});
