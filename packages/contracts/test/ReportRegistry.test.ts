import { expect } from "chai";
import { ethers } from "hardhat";

describe("ReportRegistry", () => {
  async function deployFixture() {
    const [moderator, reporterA, reporterB] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("ReportRegistry");
    const registry = await Factory.deploy(moderator.address);
    await registry.waitForDeployment();
    return { registry, moderator, reporterA, reporterB };
  }

  it("anchors a report hash and increments reportCount", async () => {
    const { registry, reporterA } = await deployFixture();
    const hash = ethers.keccak256(ethers.toUtf8Bytes("encrypted-evidence-bundle-1"));
    const geohash = ethers.encodeBytes32String("tsj9"); // coarse prefix only, never full precision

    const tx = await registry.connect(reporterA).submitReport(hash, 0, geohash);
    await tx.wait();

    expect(await registry.reportCount()).to.equal(1n);

    const record = await registry.reports(0);
    expect(record.reportHash).to.equal(hash);
    expect(record.reporter).to.equal(reporterA.address);
    expect(record.category).to.equal(0);
  });

  it("rejects an empty report hash", async () => {
    const { registry, reporterA } = await deployFixture();
    const geohash = ethers.encodeBytes32String("tsj9");
    await expect(registry.connect(reporterA).submitReport(ethers.ZeroHash, 0, geohash)).to.be.revertedWith(
      "ReportRegistry: empty hash"
    );
  });

  it("lets the moderator raise karma for a credible report", async () => {
    const { registry, moderator, reporterA } = await deployFixture();
    const hash = ethers.keccak256(ethers.toUtf8Bytes("encrypted-evidence-bundle-2"));
    const geohash = ethers.encodeBytes32String("tsj9");

    await (await registry.connect(reporterA).submitReport(hash, 1, geohash)).wait();
    await (await registry.connect(moderator).verifyReport(0, true)).wait();

    expect(await registry.karma(reporterA.address)).to.equal(10n);
  });

  it("lowers karma without underflowing when a report is marked not credible", async () => {
    const { registry, moderator, reporterA } = await deployFixture();
    const hash = ethers.keccak256(ethers.toUtf8Bytes("encrypted-evidence-bundle-3"));
    const geohash = ethers.encodeBytes32String("tsj9");

    await (await registry.connect(reporterA).submitReport(hash, 2, geohash)).wait();
    await (await registry.connect(moderator).verifyReport(0, false)).wait();

    expect(await registry.karma(reporterA.address)).to.equal(0n);
  });

  it("blocks non-moderators from verifying reports", async () => {
    const { registry, reporterA, reporterB } = await deployFixture();
    const hash = ethers.keccak256(ethers.toUtf8Bytes("encrypted-evidence-bundle-4"));
    const geohash = ethers.encodeBytes32String("tsj9");

    await (await registry.connect(reporterA).submitReport(hash, 0, geohash)).wait();
    await expect(registry.connect(reporterB).verifyReport(0, true)).to.be.revertedWith(
      "ReportRegistry: not moderator"
    );
  });
});
