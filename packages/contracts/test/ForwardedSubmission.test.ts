import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

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

/**
 * A relayer pays the gas, the reporter's key signs, and the registry must record
 * the reporter. These tests pin that down, plus the ways a relayer could try to
 * get around it.
 */
describe("Forwarded submission (ERC-2771)", () => {
  async function deployFixture() {
    const [admin, reporter, relayer, other] = await ethers.getSigners();
    const forwarder = await (await ethers.getContractFactory("KhabardarForwarder")).deploy();
    await forwarder.waitForDeployment();
    const registry = await (await ethers.getContractFactory("ReportRegistry")).deploy(
      admin.address,
      await forwarder.getAddress()
    );
    await registry.waitForDeployment();
    const { chainId } = await ethers.provider.getNetwork();
    const domain = {
      name: "KhabardarForwarder",
      version: "1",
      chainId,
      verifyingContract: await forwarder.getAddress(),
    };
    return { admin, reporter, relayer, other, forwarder, registry, domain };
  }

  function submitCalldata(registry: any, salt: string) {
    const hash = ethers.keccak256(ethers.toUtf8Bytes(`encrypted-bundle-${salt}`));
    return {
      hash,
      data: registry.interface.encodeFunctionData("submitReport", [hash, CID, 0, 0, GEO, ZERO_TAG]),
    };
  }

  async function signedRequest(
    f: Awaited<ReturnType<typeof deployFixture>>,
    signer: any,
    data: string,
    overrides: { from?: string; to?: string; deadline?: number } = {}
  ) {
    const from = overrides.from ?? signer.address;
    const message = {
      from,
      to: overrides.to ?? (await f.registry.getAddress()),
      value: 0n,
      gas: 500_000n,
      nonce: await f.forwarder.nonces(from),
      deadline: overrides.deadline ?? (await time.latest()) + 3600,
      data,
    };
    const signature = await signer.signTypedData(f.domain, FORWARD_REQUEST_TYPES, message);
    const { nonce: _nonce, ...request } = message;
    return { ...request, signature };
  }

  it("records the signer as the reporter while the relayer pays", async () => {
    const f = await deployFixture();
    const { hash, data } = submitCalldata(f.registry, "1");
    const request = await signedRequest(f, f.reporter, data);

    const reporterBefore = await ethers.provider.getBalance(f.reporter.address);
    await expect(f.forwarder.connect(f.relayer).execute(request))
      .to.emit(f.registry, "ReportSubmitted")
      .withArgs(0, f.reporter.address, ZERO_TAG, hash, CID, 0, 0, GEO, (v: bigint) => v > 0n);

    expect((await f.registry.reports(0)).reporter).to.equal(f.reporter.address);
    expect(await ethers.provider.getBalance(f.reporter.address)).to.equal(reporterBefore);
  });

  it("counts the rate limit against the signer, not the relayer", async () => {
    const f = await deployFixture();
    const limit = Number(await f.registry.MAX_REPORTS_PER_EPOCH());
    for (let i = 0; i < limit; i++) {
      const { data } = submitCalldata(f.registry, `limit-${i}`);
      await (await f.forwarder.connect(f.relayer).execute(await signedRequest(f, f.reporter, data))).wait();
    }
    expect(await f.registry.remainingSubmissions(f.reporter.address)).to.equal(0);
    expect(await f.registry.remainingSubmissions(f.relayer.address)).to.equal(limit);

    // The forwarder checks the inner call succeeded, so the cap surfaces as a revert.
    const { data } = submitCalldata(f.registry, "one-too-many");
    await expect(f.forwarder.connect(f.relayer).execute(await signedRequest(f, f.reporter, data))).to.be
      .reverted;

    // Someone else, through the same relayer, is unaffected.
    const { data: otherData } = submitCalldata(f.registry, "other");
    await (await f.forwarder.connect(f.relayer).execute(await signedRequest(f, f.other, otherData))).wait();
  });

  it("rejects a request whose contents were changed after signing", async () => {
    const f = await deployFixture();
    const request = await signedRequest(f, f.reporter, submitCalldata(f.registry, "signed").data);
    const tampered = { ...request, data: submitCalldata(f.registry, "swapped").data };
    await expect(f.forwarder.connect(f.relayer).execute(tampered)).to.be.revertedWithCustomError(
      f.forwarder,
      "ERC2771ForwarderInvalidSigner"
    );
  });

  it("will not let a relayer report in someone else's name", async () => {
    const f = await deployFixture();
    const { data } = submitCalldata(f.registry, "impersonation");
    // The relayer signs, but claims the request is from the reporter.
    const request = await signedRequest(f, f.relayer, data, { from: f.reporter.address });
    await expect(f.forwarder.connect(f.relayer).execute(request)).to.be.revertedWithCustomError(
      f.forwarder,
      "ERC2771ForwarderInvalidSigner"
    );
  });

  it("will not replay a request that was already executed", async () => {
    const f = await deployFixture();
    const request = await signedRequest(f, f.reporter, submitCalldata(f.registry, "once").data);
    await (await f.forwarder.connect(f.relayer).execute(request)).wait();
    await expect(f.forwarder.connect(f.relayer).execute(request)).to.be.revertedWithCustomError(
      f.forwarder,
      "ERC2771ForwarderInvalidSigner"
    );
  });

  it("refuses an expired request", async () => {
    const f = await deployFixture();
    const deadline = (await time.latest()) + 60;
    const request = await signedRequest(f, f.reporter, submitCalldata(f.registry, "late").data, { deadline });
    await time.increase(120);
    await expect(f.forwarder.connect(f.relayer).execute(request)).to.be.revertedWithCustomError(
      f.forwarder,
      "ERC2771ForwarderExpiredRequest"
    );
  });

  it("is ignored by a registry that does not trust this forwarder", async () => {
    const f = await deployFixture();
    const untrusting = await (await ethers.getContractFactory("ReportRegistry")).deploy(
      f.admin.address,
      ethers.ZeroAddress
    );
    const data = untrusting.interface.encodeFunctionData("submitReport", [
      ethers.keccak256(ethers.toUtf8Bytes("x")),
      CID,
      0,
      0,
      GEO,
      ZERO_TAG,
    ]);
    const request = await signedRequest(f, f.reporter, data, { to: await untrusting.getAddress() });
    await expect(f.forwarder.connect(f.relayer).execute(request)).to.be.revertedWithCustomError(
      f.forwarder,
      "ERC2771UntrustfulTarget"
    );
  });

  it("still records the direct caller when nothing is forwarded", async () => {
    const f = await deployFixture();
    const { hash } = submitCalldata(f.registry, "direct");
    await (await f.registry.connect(f.reporter).submitReport(hash, CID, 0, 0, GEO, ZERO_TAG)).wait();
    expect((await f.registry.reports(0)).reporter).to.equal(f.reporter.address);
  });
});
