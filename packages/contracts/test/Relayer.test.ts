import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { AddressInfo } from "net";
import { createRelayer, type RelayerLimits } from "../relayer/relayer";
import { createServer } from "../relayer/server";

const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const GEO = ethers.encodeBytes32String("tsj9");
const ZERO_TAG = ethers.ZeroHash;

const FORWARD_REQUEST_TYPES = {
  ForwardRequest: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "gas", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint48" },
    { name: "data", type: "bytes" },
  ],
};

describe("Self-hosted relayer", () => {
  async function setup(limits: Partial<RelayerLimits> = {}) {
    const [admin, reporter, relayerWallet, other] = await ethers.getSigners();
    const forwarder = await (await ethers.getContractFactory("KhabardarForwarder")).deploy();
    const registry = await (await ethers.getContractFactory("ReportRegistry")).deploy(
      admin.address,
      await forwarder.getAddress()
    );
    const { chainId } = await ethers.provider.getNetwork();
    const domain = {
      name: "KhabardarForwarder",
      version: "1",
      chainId,
      verifyingContract: await forwarder.getAddress(),
    };
    // The relayer's clock follows the chain, so moving block time moves it too.
    let clock = await time.latest();
    const relayer = createRelayer({
      wallet: relayerWallet,
      forwarderAddress: await forwarder.getAddress(),
      registryAddress: await registry.getAddress(),
      limits,
      now: () => clock,
    });
    const tick = async (seconds: number) => {
      await time.increase(seconds);
      clock = await time.latest();
    };
    return { admin, reporter, relayerWallet, other, forwarder, registry, domain, relayer, tick };
  }

  type Setup = Awaited<ReturnType<typeof setup>>;

  function submitData(s: Setup, salt: string, hash?: string) {
    const reportHash = hash ?? ethers.keccak256(ethers.toUtf8Bytes(`bundle-${salt}`));
    return s.registry.interface.encodeFunctionData("submitReport", [reportHash, CID, 0, 0, GEO, ZERO_TAG]);
  }

  async function sign(
    s: Setup,
    signer: any,
    data: string,
    o: { from?: string; to?: string; value?: bigint; gas?: bigint; deadline?: number } = {}
  ) {
    const from = o.from ?? signer.address;
    const message = {
      from,
      to: o.to ?? (await s.registry.getAddress()),
      value: o.value ?? 0n,
      gas: o.gas ?? 300_000n,
      nonce: await s.forwarder.nonces(from),
      deadline: o.deadline ?? (await time.latest()) + 600,
      data,
    };
    const signature = await signer.signTypedData(s.domain, FORWARD_REQUEST_TYPES, message);
    return {
      request: {
        from: message.from,
        to: message.to,
        value: message.value.toString(),
        gas: message.gas.toString(),
        deadline: message.deadline.toString(),
        data: message.data,
        signature,
      },
    };
  }

  it("relays a signed report and the reporter is recorded", async () => {
    const s = await setup();
    const res = await s.relayer.relay(await sign(s, s.reporter, submitData(s, "1")));
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property("reportId", "0");
    expect((await s.registry.reports(0)).reporter).to.equal(s.reporter.address);
  });

  it("only calls the registry", async () => {
    const s = await setup();
    const res = await s.relayer.relay(
      await sign(s, s.reporter, submitData(s, "1"), { to: await s.forwarder.getAddress() })
    );
    expect(res.status).to.equal(403);
  });

  it("only relays submitReport", async () => {
    const s = await setup();
    const data = s.registry.interface.encodeFunctionData("corroborate", [0]);
    const res = await s.relayer.relay(await sign(s, s.reporter, data));
    expect(res).to.deep.equal({ status: 403, body: { error: "only submitReport can be relayed" } });
  });

  it("refuses value and oversized gas", async () => {
    const s = await setup();
    expect((await s.relayer.relay(await sign(s, s.reporter, submitData(s, "v"), { value: 1n }))).status).to.equal(403);
    expect(
      (await s.relayer.relay(await sign(s, s.reporter, submitData(s, "g"), { gas: 5_000_000n }))).status
    ).to.equal(403);
  });

  it("refuses expired requests and deadlines too far ahead", async () => {
    const s = await setup();
    const now = await time.latest();
    expect(
      (await s.relayer.relay(await sign(s, s.reporter, submitData(s, "a"), { deadline: now - 1 }))).status
    ).to.equal(400);
    expect(
      (await s.relayer.relay(await sign(s, s.reporter, submitData(s, "b"), { deadline: now + 86_400 }))).status
    ).to.equal(400);
  });

  it("refuses a forged request without spending gas", async () => {
    const s = await setup();
    const before = await ethers.provider.getBalance(s.relayerWallet.address);
    // Signed by someone else but claiming to be the reporter.
    const res = await s.relayer.relay(
      await sign(s, s.other, submitData(s, "forged"), { from: s.reporter.address })
    );
    expect(res.status).to.equal(403);
    expect(await ethers.provider.getBalance(s.relayerWallet.address)).to.equal(before);
  });

  it("refuses a report the registry would reject without spending gas", async () => {
    const s = await setup();
    const before = await ethers.provider.getBalance(s.relayerWallet.address);
    const res = await s.relayer.relay(await sign(s, s.reporter, submitData(s, "empty", ethers.ZeroHash)));
    expect(res.status).to.equal(422);
    expect(await ethers.provider.getBalance(s.relayerWallet.address)).to.equal(before);
  });

  it("rejects malformed bodies", async () => {
    const s = await setup();
    expect((await s.relayer.relay(null)).status).to.equal(400);
    expect((await s.relayer.relay({ request: { from: "x" } })).status).to.equal(400);
    const good = await sign(s, s.reporter, submitData(s, "m"));
    expect((await s.relayer.relay({ request: { ...good.request, gas: "-1" } })).status).to.equal(400);
    expect((await s.relayer.relay({ request: { ...good.request, from: "not-an-address" } })).status).to.equal(400);
  });

  it("limits requests per minute across everyone", async () => {
    const s = await setup({ requestsPerMinute: 2 });
    for (const salt of ["1", "2"]) {
      expect((await s.relayer.relay(await sign(s, s.reporter, submitData(s, salt)))).status).to.equal(200);
    }
    expect((await s.relayer.relay(await sign(s, s.other, submitData(s, "3")))).status).to.equal(429);
    await s.tick(61);
    expect((await s.relayer.relay(await sign(s, s.other, submitData(s, "4")))).status).to.equal(200);
  });

  it("stops when the daily gas budget is used up", async () => {
    const s = await setup({ dailySpendWei: 1n });
    expect((await s.relayer.relay(await sign(s, s.reporter, submitData(s, "1")))).status).to.equal(200);
    expect((await s.relayer.relay(await sign(s, s.reporter, submitData(s, "2")))).status).to.equal(503);
    await s.tick(86_400);
    expect((await s.relayer.relay(await sign(s, s.reporter, submitData(s, "3")))).status).to.equal(200);
  });

  describe("HTTP server", () => {
    async function listen(s: Setup) {
      const server = createServer(s.relayer, { chainId: "31337" });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      return { server, base: `http://127.0.0.1:${port}` };
    }

    it("serves health, relays, and refuses junk and oversized bodies", async () => {
      const s = await setup();
      const { server, base } = await listen(s);
      try {
        const health = await fetch(`${base}/health`);
        expect(health.status).to.equal(200);
        expect(await health.json()).to.deep.equal({ ok: true, chainId: "31337" });

        const junk = await fetch(`${base}/relay`, { method: "POST", body: "{not json" });
        expect(junk.status).to.equal(400);

        const big = await fetch(`${base}/relay`, { method: "POST", body: "x".repeat(20_000) });
        expect(big.status).to.equal(413);

        const ok = await fetch(`${base}/relay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(await sign(s, s.reporter, submitData(s, "http"))),
        });
        expect(ok.status).to.equal(200);
        expect(ok.headers.get("access-control-allow-origin")).to.equal("*");
        expect(await ok.json()).to.have.property("reportId", "0");

        expect((await fetch(`${base}/elsewhere`)).status).to.equal(404);
      } finally {
        server.close();
      }
    });
  });
});
