import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

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

const REASON = "Cross-checked against the published tender record.";

describe("ReportRegistry", () => {
  async function deployFixture() {
    const [admin, reporterA, reporterB, witnessA, witnessB, jurorA, jurorB, jurorC] =
      await ethers.getSigners();
    const Factory = await ethers.getContractFactory("ReportRegistry");
    const registry = await Factory.deploy(admin.address);
    await registry.waitForDeployment();

    // A real jury, seated. The admin is auto-seated by the constructor so a
    // fresh deployment is usable, but no verdict here relies on that alone.
    for (const j of [jurorA, jurorB, jurorC]) {
      await (await registry.connect(admin).setJuror(j.address, true)).wait();
    }

    const geohash = ethers.encodeBytes32String(GEO);
    return {
      registry,
      admin,
      reporterA,
      reporterB,
      witnessA,
      witnessB,
      jurorA,
      jurorB,
      jurorC,
      geohash,
    };
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

  /** Drive a report to a final verdict with three agreeing base-weight jurors. */
  async function reachVerdict(registry: any, jurors: any[], reportId: number, tier: number) {
    for (const j of jurors) {
      await (await registry.connect(j).castJuryVote(reportId, tier, REASON)).wait();
    }
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

  describe("rate limiting", () => {
    it("allows a genuine reporter several reports in one epoch", async () => {
      const { registry, reporterA, geohash } = await deployFixture();
      for (let i = 0; i < 5; i++) await submit(registry, reporterA, geohash, `burst-${i}`);
      expect(await registry.reportCount()).to.equal(5n);
    });

    it("caps submissions per account per epoch", async () => {
      const { registry, reporterA, geohash } = await deployFixture();
      const max = Number(await registry.MAX_REPORTS_PER_EPOCH());

      for (let i = 0; i < max; i++) await submit(registry, reporterA, geohash, `flood-${i}`);
      expect(await registry.remainingSubmissions(reporterA.address)).to.equal(0n);

      await expect(submit(registry, reporterA, geohash, "over")).to.be.revertedWith(
        "ReportRegistry: epoch limit"
      );
    });

    it("counts the cap per account, not globally", async () => {
      const { registry, reporterA, reporterB, geohash } = await deployFixture();
      const max = Number(await registry.MAX_REPORTS_PER_EPOCH());

      for (let i = 0; i < max; i++) await submit(registry, reporterA, geohash, `a-${i}`);
      // reporterB is unaffected by reporterA exhausting their own budget.
      await submit(registry, reporterB, geohash, "b-0");
      expect(await registry.reportCount()).to.equal(BigInt(max + 1));
    });

    it("refills the budget in the next epoch", async () => {
      const { registry, reporterA, geohash } = await deployFixture();
      const max = Number(await registry.MAX_REPORTS_PER_EPOCH());
      for (let i = 0; i < max; i++) await submit(registry, reporterA, geohash, `e0-${i}`);

      await time.increase(Number(await registry.EPOCH_DURATION()));

      expect(await registry.remainingSubmissions(reporterA.address)).to.equal(BigInt(max));
      await submit(registry, reporterA, geohash, "e1-0");
      expect(await registry.reportCount()).to.equal(BigInt(max + 1));
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

    it("does not downgrade a final jury verdict", async () => {
      const { registry, reporterA, reporterB, witnessA, witnessB, jurorA, jurorB, jurorC, geohash } =
        await deployFixture();
      await submit(registry, reporterA, geohash);
      await reachVerdict(registry, [jurorA, jurorB, jurorC], 0, Tier.Verified);

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

  describe("personhood gate", () => {
    async function withGate() {
      const fixture = await deployFixture();
      const Gate = await ethers.getContractFactory("AllowlistPersonhoodGate");
      const gate = await Gate.deploy(fixture.admin.address);
      await gate.waitForDeployment();
      await (await fixture.registry.connect(fixture.admin).setPersonhoodGate(await gate.getAddress())).wait();
      return { ...fixture, gate };
    }

    it("treats an unset gate as open", async () => {
      const { registry, witnessA } = await deployFixture();
      expect(await registry.isPerson(witnessA.address)).to.equal(true);
    });

    it("blocks corroboration from an address the gate rejects", async () => {
      const { registry, reporterA, witnessA, geohash } = await withGate();
      await submit(registry, reporterA, geohash);

      expect(await registry.isPerson(witnessA.address)).to.equal(false);
      await expect(registry.connect(witnessA).corroborate(0)).to.be.revertedWith(
        "ReportRegistry: personhood required"
      );
    });

    it("allows corroboration once the gate admits the address", async () => {
      const { registry, gate, admin, reporterA, witnessA, geohash } = await withGate();
      await submit(registry, reporterA, geohash);

      await (await gate.connect(admin).setMember(witnessA.address, true)).wait();
      await (await registry.connect(witnessA).corroborate(0)).wait();

      expect(await registry.corroborationCount(0)).to.equal(1n);
    });

    it("never gates submitting a report", async () => {
      // The whole point: reporting must stay open to anyone, gate or no gate.
      const { registry, reporterB, geohash } = await withGate();
      expect(await registry.isPerson(reporterB.address)).to.equal(false);
      await submit(registry, reporterB, geohash, "ungated");
      expect(await registry.reportCount()).to.equal(1n);
    });

    it("tracks membership count as members are added and removed", async () => {
      const { gate, admin, witnessA, witnessB } = await withGate();
      await (await gate.connect(admin).setMembers([witnessA.address, witnessB.address], true)).wait();
      expect(await gate.memberCount()).to.equal(2n);

      await (await gate.connect(admin).setMember(witnessA.address, false)).wait();
      expect(await gate.memberCount()).to.equal(1n);
    });

    it("blocks a non-operator from changing membership", async () => {
      const { gate, witnessA } = await withGate();
      await expect(gate.connect(witnessA).setMember(witnessA.address, true)).to.be.revertedWith(
        "Allowlist: not operator"
      );
    });
  });

  describe("karma-weighted jury", () => {
    it("holds the tier until quorum weight is reached", async () => {
      const { registry, reporterA, jurorA, jurorB, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      await (await registry.connect(jurorA).castJuryVote(0, Tier.Verified, REASON)).wait();
      expect((await registry.reports(0)).tier).to.equal(Tier.Unverified);
      expect(await registry.verdictFinal(0)).to.equal(false);

      await (await registry.connect(jurorB).castJuryVote(0, Tier.Verified, REASON)).wait();
      expect((await registry.reports(0)).tier).to.equal(Tier.Unverified);
    });

    it("finalizes at quorum and awards the reporter karma", async () => {
      const { registry, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await reachVerdict(registry, [jurorA, jurorB, jurorC], 0, Tier.Verified);

      expect((await registry.reports(0)).tier).to.equal(Tier.Verified);
      expect(await registry.verdictFinal(0)).to.equal(true);
      expect(await registry.karma(reporterA.address)).to.equal(10n);
    });

    it("publishes each vote with its reason before the outcome is known", async () => {
      const { registry, reporterA, jurorA, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      await expect(registry.connect(jurorA).castJuryVote(0, Tier.UnderReview, REASON))
        .to.emit(registry, "JuryVoteCast")
        .withArgs(0, jurorA.address, Tier.UnderReview, 1, REASON);
    });

    it("requires a reason for every vote", async () => {
      const { registry, reporterA, jurorA, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await expect(registry.connect(jurorA).castJuryVote(0, Tier.Verified, "")).to.be.revertedWith(
        "ReportRegistry: reason required"
      );
    });

    it("rewards jurors who agreed and penalizes those who dissented", async () => {
      const { registry, reporterA, jurorA, jurorB, jurorC, admin, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      // The admin is seated as a juror by the constructor; use them as the dissenter.
      await (await registry.connect(admin).castJuryVote(0, Tier.Disputed, "Looks fabricated.")).wait();
      await reachVerdict(registry, [jurorA, jurorB, jurorC], 0, Tier.Verified);

      expect(await registry.karma(jurorA.address)).to.equal(3n);
      expect(await registry.karma(jurorB.address)).to.equal(3n);
      expect(await registry.karma(jurorC.address)).to.equal(3n);
      // Dissenter had no karma to lose; penalty floors at zero rather than underflowing.
      expect(await registry.karma(admin.address)).to.equal(0n);
    });

    it("does not let juror karma underflow below zero", async () => {
      const { registry, reporterA, reporterB, admin, jurorA, jurorB, jurorC, geohash } =
        await deployFixture();
      await submit(registry, reporterA, geohash, "1");
      await submit(registry, reporterB, geohash, "2");

      // jurorA banks karma on report 0, then loses more than that on report 1.
      await reachVerdict(registry, [jurorA, jurorB, jurorC], 0, Tier.Verified);
      expect(await registry.karma(jurorA.address)).to.equal(3n);

      await (await registry.connect(jurorA).castJuryVote(1, Tier.Verified, "Disagree.")).wait();
      await reachVerdict(registry, [jurorB, jurorC, admin], 1, Tier.Disputed);

      expect(await registry.karma(jurorA.address)).to.equal(0n);
    });

    it("weights a high-karma juror more, but never enough to decide alone", async () => {
      const { registry, admin, reporterA, reporterB, jurorA, jurorB, jurorC, geohash } =
        await deployFixture();

      // Bank enough karma for jurorA to earn the weight bonus. Submissions
      // alternate between two reporters so the per-account epoch cap — which is
      // doing its job — does not stop the fixture from being built.
      const perWeight = Number(await registry.KARMA_PER_JURY_WEIGHT());
      const perVerdict = Number(await registry.KARMA_JUROR_AGREED());
      const rounds = Math.ceil(perWeight / perVerdict);

      for (let i = 0; i < rounds; i++) {
        await submit(registry, i % 2 === 0 ? reporterA : reporterB, geohash, `k-${i}`);
        await reachVerdict(registry, [jurorA, jurorB, jurorC], i, Tier.Verified);
      }

      expect(await registry.jurorWeight(jurorA.address)).to.equal(2n);
      expect(await registry.MAX_JUROR_WEIGHT()).to.equal(2n);

      // Weight 2 is still below the quorum of 3: one juror cannot finalize.
      await submit(registry, reporterB, geohash, "solo");
      const solo = rounds;
      await (await registry.connect(jurorA).castJuryVote(solo, Tier.Disputed, "Alone.")).wait();
      expect(await registry.verdictFinal(solo)).to.equal(false);

      // One more base-weight juror tips it over.
      await (await registry.connect(admin).castJuryVote(solo, Tier.Disputed, "Agreed.")).wait();
      expect(await registry.verdictFinal(solo)).to.equal(true);
    });

    it("lowers reporter karma without underflowing when Disputed", async () => {
      const { registry, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await reachVerdict(registry, [jurorA, jurorB, jurorC], 0, Tier.Disputed);

      expect(await registry.karma(reporterA.address)).to.equal(0n);
    });

    it("moves a report into UnderReview without touching reporter karma", async () => {
      const { registry, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await reachVerdict(registry, [jurorA, jurorB, jurorC], 0, Tier.UnderReview);

      expect((await registry.reports(0)).tier).to.equal(Tier.UnderReview);
      expect(await registry.karma(reporterA.address)).to.equal(0n);
    });

    it("does not auto-promote a report already moved by the jury", async () => {
      const { registry, reporterA, reporterB, witnessA, witnessB, jurorA, jurorB, jurorC, geohash } =
        await deployFixture();
      await submit(registry, reporterA, geohash);
      await reachVerdict(registry, [jurorA, jurorB, jurorC], 0, Tier.UnderReview);

      await (await registry.connect(witnessA).corroborate(0)).wait();
      await (await registry.connect(witnessB).corroborate(0)).wait();
      await (await registry.connect(reporterB).corroborate(0)).wait();

      expect((await registry.reports(0)).tier).to.equal(Tier.UnderReview);
    });

    it("blocks a second vote from the same juror", async () => {
      const { registry, reporterA, jurorA, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await (await registry.connect(jurorA).castJuryVote(0, Tier.Verified, REASON)).wait();

      await expect(registry.connect(jurorA).castJuryVote(0, Tier.Disputed, REASON)).to.be.revertedWith(
        "ReportRegistry: already voted"
      );
    });

    it("blocks voting once the verdict is final", async () => {
      const { registry, admin, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await reachVerdict(registry, [jurorA, jurorB, jurorC], 0, Tier.Verified);

      await expect(registry.connect(admin).castJuryVote(0, Tier.Disputed, REASON)).to.be.revertedWith(
        "ReportRegistry: verdict final"
      );
    });

    it("blocks a juror from reviewing their own report", async () => {
      const { registry, jurorA, geohash } = await deployFixture();
      await submit(registry, jurorA, geohash);
      await expect(registry.connect(jurorA).castJuryVote(0, Tier.Verified, REASON)).to.be.revertedWith(
        "ReportRegistry: self review"
      );
    });

    it("rejects an out-of-range tier", async () => {
      const { registry, reporterA, jurorA, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await expect(registry.connect(jurorA).castJuryVote(0, 99, REASON)).to.be.revertedWith(
        "ReportRegistry: bad tier"
      );
    });

    it("blocks non-jurors from voting", async () => {
      const { registry, reporterA, reporterB, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await expect(registry.connect(reporterB).castJuryVote(0, Tier.Verified, REASON)).to.be.revertedWith(
        "ReportRegistry: not juror"
      );
    });

    it("reports how each juror voted", async () => {
      const { registry, reporterA, jurorA, jurorB, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await (await registry.connect(jurorA).castJuryVote(0, Tier.Disputed, REASON)).wait();

      expect(await registry.juryVoteOf(0, jurorA.address)).to.deep.equal([true, BigInt(Tier.Disputed)]);
      expect(await registry.juryVoteOf(0, jurorB.address)).to.deep.equal([false, 0n]);
      expect(await registry.jurorsVotedOn(0)).to.deep.equal([jurorA.address]);
    });

    it("gives no weight to a revoked juror", async () => {
      const { registry, admin, jurorA } = await deployFixture();
      expect(await registry.jurorWeight(jurorA.address)).to.equal(1n);

      await (await registry.connect(admin).setJuror(jurorA.address, false)).wait();
      expect(await registry.jurorWeight(jurorA.address)).to.equal(0n);
    });
  });

  describe("administration", () => {
    it("seats the deployer as the first juror so a fresh deployment works", async () => {
      const { registry, admin } = await deployFixture();
      expect(await registry.isJuror(admin.address)).to.equal(true);
    });

    it("tracks juror count as jurors are seated and revoked", async () => {
      const { registry, admin, reporterA } = await deployFixture();
      const before = await registry.jurorCount();

      await (await registry.connect(admin).setJuror(reporterA.address, true)).wait();
      expect(await registry.jurorCount()).to.equal(before + 1n);

      await (await registry.connect(admin).setJuror(reporterA.address, false)).wait();
      expect(await registry.jurorCount()).to.equal(before);
    });

    it("blocks a non-admin from managing the jury", async () => {
      const { registry, reporterA } = await deployFixture();
      await expect(registry.connect(reporterA).setJuror(reporterA.address, true)).to.be.revertedWith(
        "ReportRegistry: not admin"
      );
    });

    it("gives the admin no power to set a tier directly", async () => {
      // The whole point of replacing the single moderator: there is no
      // admin-only path to a verdict. The admin votes as one juror or not at all.
      const { registry } = await deployFixture();
      expect((registry as any).setVerificationTier).to.equal(undefined);
    });

    it("transfers admin", async () => {
      const { registry, admin, reporterA } = await deployFixture();
      await (await registry.connect(admin).transferAdmin(reporterA.address)).wait();
      expect(await registry.admin()).to.equal(reporterA.address);

      await expect(registry.connect(admin).setJuror(admin.address, false)).to.be.revertedWith(
        "ReportRegistry: not admin"
      );
    });
  });
});
