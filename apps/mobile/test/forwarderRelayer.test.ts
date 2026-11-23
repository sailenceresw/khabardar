import { describe, expect, it } from "vitest";
import { decodeFunctionData, recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { REPORT_REGISTRY_ABI } from "@khabardar/shared";
import {
  FORWARD_GAS,
  FORWARD_REQUEST_TYPES,
  FORWARD_VALIDITY_SECONDS,
  ForwarderRelayer,
} from "../src/relayer/forwarderRelayer";
import type { ReportSigner } from "../src/signer";

// A throwaway test key, not used anywhere else.
const account = privateKeyToAccount("0x0123456789012345678901234567890123456789012345678901234567890123");
const signer: ReportSigner = {
  address: account.address,
  kind: "device",
  signMessage: (m) => account.signMessage({ message: m }),
  signTypedData: (d) => account.signTypedData(d),
};

const FORWARDER = "0x2222222222222222222222222222222222222222" as const;
const REGISTRY = "0x1111111111111111111111111111111111111111" as const;
const HASH = `0x${"ab".repeat(32)}` as Hex;
const NOW = 1_800_000_000;

const params = {
  reportHash: HASH,
  cid: "bafy-test",
  category: 2,
  visibility: 0,
  coarseGeohash: "tsj9",
  entityTag: `0x${"00".repeat(32)}` as Hex,
  signer,
};

function relayerWith(respond: (body: any) => Response, sent: { url?: string; body?: any } = {}) {
  return new ForwarderRelayer({
    relayerUrl: "https://relay.example",
    forwarderAddress: FORWARDER,
    registryAddress: REGISTRY,
    chainId: 59141,
    explorerUrl: "https://sepolia.lineascan.build",
    readNonce: async () => 7n,
    now: () => NOW,
    post: async (url, body) => {
      sent.url = url;
      sent.body = JSON.parse(body);
      return respond(sent.body);
    },
  });
}

describe("ForwarderRelayer", () => {
  it("posts a request signed by the device key for submitReport on the registry", async () => {
    const sent: { url?: string; body?: any } = {};
    const relayer = relayerWith(
      () => new Response(JSON.stringify({ txHash: "0xabc", reportId: "12" }), { status: 200 }),
      sent
    );
    const result = await relayer.submitReport(params);

    expect(sent.url).toBe("https://relay.example/relay");
    const r = sent.body.request;
    expect(r).toMatchObject({ from: account.address, to: REGISTRY, value: "0", gas: FORWARD_GAS.toString() });
    expect(r.deadline).toBe(String(NOW + FORWARD_VALIDITY_SECONDS));
    // The relayer allows at most 500k gas and an hour of validity.
    expect(FORWARD_GAS).toBeLessThanOrEqual(500_000n);
    expect(FORWARD_VALIDITY_SECONDS).toBeLessThan(3600);

    const call = decodeFunctionData({ abi: REPORT_REGISTRY_ABI, data: r.data });
    expect(call.functionName).toBe("submitReport");
    expect(call.args?.[0]).toBe(HASH);

    // The signature must recover to the reporter over exactly what the forwarder checks,
    // with the nonce the forwarder holds.
    const recovered = await recoverTypedDataAddress({
      domain: { name: "KhabardarForwarder", version: "1", chainId: 59141, verifyingContract: FORWARDER },
      types: FORWARD_REQUEST_TYPES,
      primaryType: "ForwardRequest",
      message: {
        from: r.from,
        to: r.to,
        value: 0n,
        gas: BigInt(r.gas),
        nonce: 7n,
        deadline: Number(r.deadline),
        data: r.data,
      },
      signature: r.signature,
    });
    expect(recovered).toBe(account.address);

    expect(result).toEqual({
      txHash: "0xabc",
      onChainReportId: 12,
      explorerUrl: "https://sepolia.lineascan.build/tx/0xabc",
      simulated: false,
      status: "anchored",
    });
  });

  it("surfaces the relayer's reason when it refuses", async () => {
    const relayer = relayerWith(() => new Response(JSON.stringify({ error: "daily gas budget used up" }), { status: 503 }));
    await expect(relayer.submitReport(params)).rejects.toThrow("Relayer refused the report (503): daily gas budget used up");
  });

  it("does not treat a success status without a report id as anchored", async () => {
    const relayer = relayerWith(() => new Response("<html>proxy</html>", { status: 200 }));
    await expect(relayer.submitReport(params)).rejects.toThrow("Relayer refused the report (200)");
  });
});
