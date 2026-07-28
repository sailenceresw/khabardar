import { expect } from "chai";
import { ethers } from "hardhat";

const CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const GEO = "tsj9"; // coarse prefix only, never full precision

const Tier = {
  Unverified: 0,
  UnderReview: 1,
  CommunityCorroborated: 2,
  Verified: 3,
  Disputed: 4,
};
const Visibility = { Public: 0, JournalistsOnly: 1 };
const ZERO_TAG = ethers.ZeroHash;
const TAG_A = ethers.keccak256(ethers.toUtf8Bytes("entity-a"));
const TAG_B = ethers.keccak256(ethers.toUtf8Bytes("entity-b"));

describe("ReportRegistry", () => {
  async function deployFixture() {
    const [moderator, reporterA, reporterB, witnessA, witnessB] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("ReportRegistry");
    const registry = await Factory.deploy(moderator.address);
    await registry.waitForDeployment();
    const geohash = ethers.encodeBytes32String(GEO);
    return { registry, moderator, reporterA, reporterB, witnessA, witnessB, geohash };
  }

  async function submit(
    registry: any,
    signer: any,
    geohash: string,
    salt = "1",
    entityTag: string = ZERO_TAG
  ) {
    const hash = ethers.keccak256(ethers.toUtf8Bytes(`encrypted-bundle-${salt}`));
    await (
      await registry
        .connect(signer)
        .submitReport(hash, CID, 0, Visibility.Public, geohash, entityTag)
    ).wait();
    return hash;
  }

  describe("submitReport", () => {
    it("anchors hash + cid and increments reportCount", async () => {
      const { registry, reporterA, geohash } = await deployFixture();
      const hash = await submit(registry, reporterA, geohash);

      expect(await registry.reportCount()).to.equal(1n);

      const record = await registry.reports(0);
      expect(record.reportHash).to.equal(hash);
      expect(record.cid).to.equal(CID);
      expect(record.reporter).to.equal(reporterA.address);
      expect(record.category).to.equal(0);
      expect(record.visibility).to.equal(Visibility.Public);
      expect(record.tier).to.equal(Tier.Unverified);
    });

    it("starts every report at Unverified", async () => {
      const { registry, reporterA, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      expect((await registry.reports(0)).tier).to.equal(Tier.Unverified);
    });

    it("rejects an empty report hash", async () => {
      const { registry, reporterA, geohash } = await deployFixture();
      await expect(
        registry.connect(reporterA).submitReport(ethers.ZeroHash, CID, 0, Visibility.Public, geohash, ZERO_TAG)
      ).to.be.revertedWith("ReportRegistry: empty hash");
    });

    it("rejects an empty cid", async () => {
      const { registry, reporterA, geohash } = await deployFixture();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("x"));
      await expect(
        registry.connect(reporterA).submitReport(hash, "", 0, Visibility.Public, geohash, ZERO_TAG)
      ).to.be.revertedWith("ReportRegistry: empty cid");
    });

    it("rejects an out-of-range category and visibility", async () => {
      const { registry, reporterA, geohash } = await deployFixture();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("x"));
      await expect(
        registry.connect(reporterA).submitReport(hash, CID, 99, Visibility.Public, geohash, ZERO_TAG)
      ).to.be.revertedWith("ReportRegistry: bad category");
      await expect(
        registry.connect(reporterA).submitReport(hash, CID, 0, 99, geohash, ZERO_TAG)
      ).to.be.revertedWith("ReportRegistry: bad visibility");
    });

    it("records journalist-only visibility", async () => {
      const { registry, reporterA, geohash } = await deployFixture();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("sensitive"));
      await (
        await registry.connect(reporterA).submitReport(hash, CID, 3, Visibility.JournalistsOnly, geohash, ZERO_TAG)
      ).wait();
      expect((await registry.reports(0)).visibility).to.equal(Visibility.JournalistsOnly);
    });
  });

  describe("entity clustering", () => {
    it("groups reports sharing an entity tag", async () => {
      const { registry, reporterA, reporterB, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash, "1", TAG_A);
      await submit(registry, reporterB, geohash, "2", TAG_A);
      await submit(registry, reporterA, geohash, "3", TAG_B);

      const clusterA = await registry.reportsForEntity(TAG_A);
      expect(clusterA.map((n: bigint) => Number(n))).to.deep.equal([0, 1]);
      expect(await registry.entityReportCount(TAG_A)).to.equal(2n);
      expect(await registry.entityReportCount(TAG_B)).to.equal(1n);
    });

    it("stores the entity tag on the record", async () => {
      const { registry, reporterA, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash, "1", TAG_A);
      expect((await registry.reports(0)).entityTag).to.equal(TAG_A);
    });

    it("excludes untagged reports from clustering", async () => {
      const { registry, reporterA, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash, "1", ZERO_TAG);
      expect(await registry.entityReportCount(ZERO_TAG)).to.equal(0n);
    });

    it("does not link the reporters of a cluster to each other", async () => {
      // The cluster exposes report ids only; each report still carries its own
      // independent pseudonymous address and nothing joins them.
      const { registry, reporterA, reporterB, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash, "1", TAG_A);
      await submit(registry, reporterB, geohash, "2", TAG_A);

      const [r0, r1] = [await registry.reports(0), await registry.reports(1)];
      expect(r0.reporter).to.not.equal(r1.reporter);
    });
  });

  describe("corroborate", () => {
    it("counts independent corroborations", async () => {
      const { registry, reporterA, witnessA, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      await (await registry.connect(witnessA).corroborate(0)).wait();
      expect(await registry.corroborationCount(0)).to.equal(1n);
      expect(await registry.hasCorroborated(0, witnessA.address)).to.equal(true);
    });

    it("blocks the reporter from corroborating their own report", async () => {
      const { registry, reporterA, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await expect(registry.connect(reporterA).corroborate(0)).to.be.revertedWith(
        "ReportRegistry: self corroboration"
      );
    });

    it("blocks the same witness corroborating twice", async () => {
      const { registry, reporterA, witnessA, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await (await registry.connect(witnessA).corroborate(0)).wait();
      await expect(registry.connect(witnessA).corroborate(0)).to.be.revertedWith(
        "ReportRegistry: already corroborated"
      );
    });

    it("auto-promotes to CommunityCorroborated at the threshold", async () => {
      const { registry, reporterA, reporterB, witnessA, witnessB, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      await (await registry.connect(witnessA).corroborate(0)).wait();
      await (await registry.connect(witnessB).corroborate(0)).wait();
      expect((await registry.reports(0)).tier).to.equal(Tier.Unverified);

      await (await registry.connect(reporterB).corroborate(0)).wait();
      expect(await registry.corroborationCount(0)).to.equal(3n);
      expect((await registry.reports(0)).tier).to.equal(Tier.CommunityCorroborated);
    });

    it("does not downgrade a moderator's Verified verdict", async () => {
      const { registry, moderator, reporterA, reporterB, witnessA, witnessB, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await (await registry.connect(moderator).setVerificationTier(0, Tier.Verified)).wait();

      await (await registry.connect(witnessA).corroborate(0)).wait();
      await (await registry.connect(witnessB).corroborate(0)).wait();
      await (await registry.connect(reporterB).corroborate(0)).wait();

      expect((await registry.reports(0)).tier).to.equal(Tier.Verified);
    });

    it("rejects corroborating an unknown report", async () => {
      const { registry, witnessA } = await deployFixture();
      await expect(registry.connect(witnessA).corroborate(42)).to.be.revertedWith(
        "ReportRegistry: unknown report"
      );
    });
  });

  describe("setVerificationTier", () => {
    it("awards karma when a report is Verified", async () => {
      const { registry, moderator, reporterA, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await (await registry.connect(moderator).setVerificationTier(0, Tier.Verified)).wait();

      expect(await registry.karma(reporterA.address)).to.equal(10n);
      expect((await registry.reports(0)).tier).to.equal(Tier.Verified);
    });

    it("does not double-award karma when re-verified", async () => {
      const { registry, moderator, reporterA, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await (await registry.connect(moderator).setVerificationTier(0, Tier.Verified)).wait();
      await (await registry.connect(moderator).setVerificationTier(0, Tier.Verified)).wait();

      expect(await registry.karma(reporterA.address)).to.equal(10n);
    });

    it("lowers karma without underflowing when Disputed", async () => {
      const { registry, moderator, reporterA, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await (await registry.connect(moderator).setVerificationTier(0, Tier.Disputed)).wait();

      expect(await registry.karma(reporterA.address)).to.equal(0n);
    });

    it("moves a report into UnderReview without touching karma", async () => {
      const { registry, moderator, reporterA, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await (await registry.connect(moderator).setVerificationTier(0, Tier.UnderReview)).wait();

      expect((await registry.reports(0)).tier).to.equal(Tier.UnderReview);
      expect(await registry.karma(reporterA.address)).to.equal(0n);
    });

    it("does not auto-promote a report already under review", async () => {
      const { registry, moderator, reporterA, reporterB, witnessA, witnessB, geohash } =
        await deployFixture();
      await submit(registry, reporterA, geohash);
      await (await registry.connect(moderator).setVerificationTier(0, Tier.UnderReview)).wait();

      await (await registry.connect(witnessA).corroborate(0)).wait();
      await (await registry.connect(witnessB).corroborate(0)).wait();
      await (await registry.connect(reporterB).corroborate(0)).wait();

      expect((await registry.reports(0)).tier).to.equal(Tier.UnderReview);
    });

    it("rejects an out-of-range tier", async () => {
      const { registry, moderator, reporterA, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await expect(registry.connect(moderator).setVerificationTier(0, 99)).to.be.revertedWith(
        "ReportRegistry: bad tier"
      );
    });

    it("blocks non-moderators", async () => {
      const { registry, reporterA, reporterB, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await expect(registry.connect(reporterB).setVerificationTier(0, Tier.Verified)).to.be.revertedWith(
        "ReportRegistry: not moderator"
      );
    });
  });
});
