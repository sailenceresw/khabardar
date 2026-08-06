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

  const SALT = (n: number) => ethers.zeroPadValue(ethers.toBeHex(0xbeef00 + n), 32);

  const Phase = { None: 0n, Committing: 1n, Revealing: 2n, Decided: 3n, Undecided: 4n };

  /**
   * The round index the next commit will land in.
   *
   * A client has to predict this, because the first commit is what opens the
   * round — the commitment has to be built against an index that does not exist
   * on-chain yet.
   */
  async function nextRoundIndex(registry: any, reportId: number): Promise<number> {
    const r = await registry.rounds(reportId);
    const opensNew = r.phase === Phase.None || r.phase === Phase.Undecided;
    return Number(r.index) + (opensNew ? 1 : 0);
  }

  /** Commit a sealed ballot, exactly as a client would (salt never on-chain). */
  async function commitVote(
    registry: any,
    juror: any,
    reportId: number,
    tier: number,
    salt: string,
    round: number
  ) {
    const commitment = await registry.commitmentFor(reportId, round, tier, salt, juror.address);
    await (await registry.connect(juror).commitVote(reportId, commitment)).wait();
  }

  /**
   * Run a full panel through commit then reveal.
   *
   * `tiers` may be one tier for everyone, or one per juror to model dissent.
   */
  async function runRound(
    registry: any,
    jurors: any[],
    reportId: number,
    tiers: number[] | number
  ): Promise<number> {
    const votes = Array.isArray(tiers) ? tiers : jurors.map(() => tiers);
    const round = await nextRoundIndex(registry, reportId);

    for (let i = 0; i < jurors.length; i++) {
      await commitVote(registry, jurors[i], reportId, votes[i], SALT(i), round);
    }
    for (let i = 0; i < jurors.length; i++) {
      await (
        await registry.connect(jurors[i]).revealVote(reportId, votes[i], SALT(i), REASON)
      ).wait();
    }
    return round;
  }

  /** Drive a report to a unanimous verdict with the given panel. */
  async function reachVerdict(registry: any, jurors: any[], reportId: number, tier: number) {
    return runRound(registry, jurors, reportId, tier);
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

  describe("jury — fairness properties", () => {
    it("gives every juror exactly one vote", async () => {
      const { registry, jurorA, jurorB } = await deployFixture();
      expect(await registry.jurorWeight(jurorA.address)).to.equal(1n);
      expect(await registry.jurorWeight(jurorB.address)).to.equal(1n);
    });

    it("does not let reporting karma buy jury influence", async () => {
      // The bug this replaced: reporter karma and juror weight shared one
      // mapping, so filing reports that got Verified bought judicial power over
      // the review of one's own later accusations.
      const { registry, admin, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await (await registry.connect(admin).setJuror(reporterA.address, true)).wait();

      await submit(registry, reporterA, geohash, "earn-karma");
      await reachVerdict(registry, [jurorA, jurorB, jurorC], 0, Tier.Verified);

      expect(await registry.karma(reporterA.address)).to.equal(10n);
      expect(await registry.jurorWeight(reporterA.address)).to.equal(1n);
    });

    it("costs a juror nothing to disagree with the verdict", async () => {
      // The mechanism this replaced charged a dissenter more karma than an
      // agreeing juror earned, which made voting with the expected winner the
      // rational play regardless of the evidence.
      const { registry, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      // Two say Verified, jurorC dissents. The majority carries.
      await runRound(
        registry,
        [jurorA, jurorB, jurorC],
        0,
        [Tier.Verified, Tier.Verified, Tier.Disputed]
      );

      expect((await registry.reports(0)).tier).to.equal(Tier.Verified);

      // The dissenter's record shows a completed duty, not a demerit.
      expect(await registry.jurorBallotsCompleted(jurorC.address)).to.equal(1n);
      expect(await registry.jurorBallotsAbandoned(jurorC.address)).to.equal(0n);
      expect(await registry.jurorWeight(jurorC.address)).to.equal(1n);

      // And agreeing bought nobody anything either.
      expect(await registry.jurorWeight(jurorA.address)).to.equal(1n);
      expect(await registry.karma(jurorA.address)).to.equal(0n);
      expect(await registry.karma(jurorC.address)).to.equal(0n);
    });

    it("closes the panel at quorum rather than letting it grow unbounded", async () => {
      const { registry, admin, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      const round = await nextRoundIndex(registry, 0);
      for (const [i, j] of [jurorA, jurorB, jurorC].entries()) {
        await commitVote(registry, j, 0, Tier.Verified, SALT(i), round);
      }

      // A fourth juror arrives after the panel filled.
      const late = await registry.commitmentFor(0, round, Tier.Disputed, SALT(3), admin.address);
      await expect(registry.connect(admin).commitVote(0, late)).to.be.revertedWith(
        "ReportRegistry: not committing"
      );
    });

    it("keeps the tally invisible until every ballot is sealed", async () => {
      // The property that makes independence real: a juror deciding whether to
      // join cannot see which way the panel is leaning.
      const { registry, reporterA, jurorA, jurorB, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      const round = await nextRoundIndex(registry, 0);
      await commitVote(registry, jurorA, 0, Tier.Verified, SALT(0), round);
      await commitVote(registry, jurorB, 0, Tier.Disputed, SALT(1), round);

      // Two very different ballots are in, and nothing about them is readable.
      for (const tier of [Tier.Unverified, Tier.UnderReview, Tier.CommunityCorroborated, Tier.Verified, Tier.Disputed]) {
        expect(await registry.tierVotes(0, round, tier)).to.equal(0n);
      }
      expect(await registry.juryVoteOf(0, jurorA.address)).to.deep.equal([false, 0n]);
      expect((await registry.reports(0)).tier).to.equal(Tier.Unverified);
    });

    it("refuses to turn a plurality into a verdict", async () => {
      // Three jurors, three different answers. Manufacturing a verdict from
      // that would be dressing up disagreement as a decision.
      const { registry, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      await runRound(
        registry,
        [jurorA, jurorB, jurorC],
        0,
        [Tier.Verified, Tier.Disputed, Tier.UnderReview]
      );

      expect((await registry.rounds(0)).phase).to.equal(4n); // Undecided
      expect(await registry.verdictFinal(0)).to.equal(false);
      expect((await registry.reports(0)).tier).to.equal(Tier.Unverified);
    });

    it("emits VerdictUndecided rather than silently stalling", async () => {
      const { registry, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      const round = await nextRoundIndex(registry, 0);
      for (const [i, j] of [jurorA, jurorB, jurorC].entries()) {
        await commitVote(registry, j, 0, [Tier.Verified, Tier.Disputed, Tier.UnderReview][i], SALT(i), round);
      }
      await (await registry.connect(jurorA).revealVote(0, Tier.Verified, SALT(0), REASON)).wait();
      await (await registry.connect(jurorB).revealVote(0, Tier.Disputed, SALT(1), REASON)).wait();

      await expect(registry.connect(jurorC).revealVote(0, Tier.UnderReview, SALT(2), REASON))
        .to.emit(registry, "VerdictUndecided")
        .withArgs(0, round, 3);
    });
  });

  describe("jury — commit/reveal mechanics", () => {
    it("reaches a verdict and awards the reporter karma", async () => {
      const { registry, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await reachVerdict(registry, [jurorA, jurorB, jurorC], 0, Tier.Verified);

      expect((await registry.reports(0)).tier).to.equal(Tier.Verified);
      expect(await registry.verdictFinal(0)).to.equal(true);
      expect(await registry.karma(reporterA.address)).to.equal(10n);
    });

    it("does not open reveals until the panel is full", async () => {
      const { registry, reporterA, jurorA, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      const round = await nextRoundIndex(registry, 0);
      await commitVote(registry, jurorA, 0, Tier.UnderReview, SALT(0), round);

      await expect(
        registry.connect(jurorA).revealVote(0, Tier.UnderReview, SALT(0), REASON)
      ).to.be.revertedWith("ReportRegistry: not revealing");
    });

    it("publishes the reason alongside the revealed tier", async () => {
      const { registry, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      const round = await nextRoundIndex(registry, 0);
      for (const [i, j] of [jurorA, jurorB, jurorC].entries()) {
        await commitVote(registry, j, 0, Tier.Verified, SALT(i), round);
      }

      await expect(registry.connect(jurorA).revealVote(0, Tier.Verified, SALT(0), REASON))
        .to.emit(registry, "JuryVoteRevealed")
        .withArgs(0, jurorA.address, Tier.Verified, REASON);
    });

    it("requires a reason on every reveal", async () => {
      const { registry, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      const round = await nextRoundIndex(registry, 0);
      for (const [i, j] of [jurorA, jurorB, jurorC].entries()) {
        await commitVote(registry, j, 0, Tier.Verified, SALT(i), round);
      }
      await expect(
        registry.connect(jurorA).revealVote(0, Tier.Verified, SALT(0), "")
      ).to.be.revertedWith("ReportRegistry: reason required");
    });

    it("rejects a reveal that does not match the commitment", async () => {
      const { registry, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      const round = await nextRoundIndex(registry, 0);
      for (const [i, j] of [jurorA, jurorB, jurorC].entries()) {
        await commitVote(registry, j, 0, Tier.Verified, SALT(i), round);
      }

      // Committed to Verified, trying to reveal Disputed.
      await expect(
        registry.connect(jurorA).revealVote(0, Tier.Disputed, SALT(0), REASON)
      ).to.be.revertedWith("ReportRegistry: commitment mismatch");
    });

    it("rejects a reveal from a juror who never committed", async () => {
      const { registry, admin, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      const round = await nextRoundIndex(registry, 0);
      for (const [i, j] of [jurorA, jurorB, jurorC].entries()) {
        await commitVote(registry, j, 0, Tier.Verified, SALT(i), round);
      }

      await expect(
        registry.connect(admin).revealVote(0, Tier.Verified, SALT(9), REASON)
      ).to.be.revertedWith("ReportRegistry: nothing committed");
    });

    it("binds a commitment to the juror, so it cannot be copied", async () => {
      const { registry, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      const round = await nextRoundIndex(registry, 0);
      // jurorB front-runs by submitting a commitment built for jurorA.
      const foreign = await registry.commitmentFor(0, round, Tier.Verified, SALT(0), jurorA.address);
      await (await registry.connect(jurorB).commitVote(0, foreign)).wait();
      await commitVote(registry, jurorA, 0, Tier.Verified, SALT(1), round);
      await commitVote(registry, jurorC, 0, Tier.Verified, SALT(2), round);

      // jurorB cannot open it: the hash binds jurorA's address, not theirs.
      await expect(
        registry.connect(jurorB).revealVote(0, Tier.Verified, SALT(0), REASON)
      ).to.be.revertedWith("ReportRegistry: commitment mismatch");
    });

    it("blocks committing twice in the same round", async () => {
      const { registry, reporterA, jurorA, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      const round = await nextRoundIndex(registry, 0);
      await commitVote(registry, jurorA, 0, Tier.Verified, SALT(0), round);
      await expect(
        commitVote(registry, jurorA, 0, Tier.Disputed, SALT(1), round)
      ).to.be.revertedWith("ReportRegistry: already committed");
    });

    it("blocks a juror from judging their own report", async () => {
      const { registry, jurorA, geohash } = await deployFixture();
      await submit(registry, jurorA, geohash);
      const round = await nextRoundIndex(registry, 0);
      await expect(
        commitVote(registry, jurorA, 0, Tier.Verified, SALT(0), round)
      ).to.be.revertedWith("ReportRegistry: self review");
    });

    it("blocks non-jurors from committing", async () => {
      const { registry, reporterA, reporterB, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      const round = await nextRoundIndex(registry, 0);
      await expect(
        commitVote(registry, reporterB, 0, Tier.Verified, SALT(0), round)
      ).to.be.revertedWith("ReportRegistry: not juror");
    });
  });

  describe("jury — abandonment and deadlines", () => {
    it("penalises committing and never revealing", async () => {
      const { registry, admin, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      const round = await nextRoundIndex(registry, 0);
      for (const [i, j] of [jurorA, jurorB, jurorC].entries()) {
        await commitVote(registry, j, 0, Tier.Verified, SALT(i), round);
      }
      void admin;

      await (await registry.connect(jurorA).revealVote(0, Tier.Verified, SALT(0), REASON)).wait();
      await (await registry.connect(jurorB).revealVote(0, Tier.Verified, SALT(1), REASON)).wait();
      // jurorC never reveals.

      await time.increase(Number(await registry.REVEAL_WINDOW()) + 1);
      await (await registry.closeRound(0)).wait();

      expect(await registry.jurorBallotsAbandoned(jurorC.address)).to.equal(1n);
      expect(await registry.jurorBallotsAbandoned(jurorA.address)).to.equal(0n);
      expect(await registry.jurorBallotsCompleted(jurorA.address)).to.equal(1n);

      // Two of three revealed, both agreeing — that is still a majority.
      expect((await registry.reports(0)).tier).to.equal(Tier.Verified);
    });

    it("lets anyone close an expired round", async () => {
      // A round only a juror can close is a round a juror can leave open
      // forever, which is a cheap way to bury a report.
      const { registry, reporterA, reporterB, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      const round = await nextRoundIndex(registry, 0);
      for (const [i, j] of [jurorA, jurorB, jurorC].entries()) {
        await commitVote(registry, j, 0, Tier.Verified, SALT(i), round);
      }
      await time.increase(Number(await registry.REVEAL_WINDOW()) + 1);

      // reporterB is neither a juror nor the reporter.
      await (await registry.connect(reporterB).closeRound(0)).wait();
      expect((await registry.rounds(0)).phase).to.equal(4n); // nobody revealed
    });

    it("abandons a round that never filled its panel, and allows a retry", async () => {
      const { registry, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      const first = await nextRoundIndex(registry, 0);
      await commitVote(registry, jurorA, 0, Tier.Verified, SALT(0), first);

      await time.increase(Number(await registry.COMMIT_WINDOW()) + 1);
      await (await registry.closeRound(0)).wait();
      expect((await registry.rounds(0)).phase).to.equal(4n);

      // A fresh panel can start over on a new round index.
      const second = await nextRoundIndex(registry, 0);
      expect(second).to.equal(first + 1);
      await reachVerdict(registry, [jurorA, jurorB, jurorC], 0, Tier.Verified);
      expect((await registry.reports(0)).tier).to.equal(Tier.Verified);
    });

    it("lets a juror unseated mid-round still open their ballot", async () => {
      // Otherwise an admin could strip a juror after they sealed a dissenting
      // vote and have it scored as abandonment — suppressing the ballot before
      // anyone saw it, which is the capture the sealed ballot exists to stop.
      const { registry, admin, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);

      const round = await nextRoundIndex(registry, 0);
      for (const [i, j] of [jurorA, jurorB, jurorC].entries()) {
        await commitVote(registry, j, 0, i === 2 ? Tier.Disputed : Tier.Verified, SALT(i), round);
      }

      // The admin unseats the dissenter after the panel filled.
      await (await registry.connect(admin).setJuror(jurorC.address, false)).wait();
      expect(await registry.isJuror(jurorC.address)).to.equal(false);

      await expect(registry.connect(jurorC).revealVote(0, Tier.Disputed, SALT(2), REASON))
        .to.emit(registry, "JuryVoteRevealed")
        .withArgs(0, jurorC.address, Tier.Disputed, REASON);

      expect(await registry.jurorBallotsAbandoned(jurorC.address)).to.equal(0n);
    });

    it("refuses to close a round whose window is still open", async () => {
      const { registry, reporterA, jurorA, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      const round = await nextRoundIndex(registry, 0);
      await commitVote(registry, jurorA, 0, Tier.Verified, SALT(0), round);

      await expect(registry.closeRound(0)).to.be.revertedWith(
        "ReportRegistry: commit window open"
      );
    });
  });

  describe("jury — appeal", () => {
    it("lets the reporter contest a verdict before a larger panel", async () => {
      const { registry, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await reachVerdict(registry, [jurorA, jurorB, jurorC], 0, Tier.Disputed);

      expect(await registry.canAppeal(0)).to.equal(true);
      await expect(registry.connect(reporterA).appealVerdict(0)).to.emit(registry, "VerdictAppealed");

      // Contested verdicts do not keep standing while under appeal.
      expect((await registry.reports(0)).tier).to.equal(Tier.UnderReview);
      expect(await registry.verdictFinal(0)).to.equal(false);
      expect((await registry.rounds(0)).quorum).to.equal(await registry.APPEAL_QUORUM());
    });

    it("undoes the karma the overturned verdict moved", async () => {
      const { registry, admin, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash, "1");
      await submit(registry, reporterA, geohash, "2");

      // Bank karma on report 0, then lose some on report 1.
      await reachVerdict(registry, [jurorA, jurorB, jurorC], 0, Tier.Verified);
      expect(await registry.karma(reporterA.address)).to.equal(10n);

      await reachVerdict(registry, [jurorA, jurorB, jurorC], 1, Tier.Disputed);
      expect(await registry.karma(reporterA.address)).to.equal(5n);

      // Appealing the Disputed verdict restores what it took.
      await (await registry.connect(reporterA).appealVerdict(1)).wait();
      expect(await registry.karma(reporterA.address)).to.equal(10n);
      void admin;
    });

    it("re-hears the report and can overturn the outcome", async () => {
      const { registry, admin, reporterA, jurorA, jurorB, jurorC, witnessA, geohash } =
        await deployFixture();
      await (await registry.connect(admin).setJuror(witnessA.address, true)).wait();
      await submit(registry, reporterA, geohash);

      await reachVerdict(registry, [jurorA, jurorB, jurorC], 0, Tier.Disputed);
      await (await registry.connect(reporterA).appealVerdict(0)).wait();

      // Five jurors on appeal, and this time they say Verified.
      await runRound(registry, [jurorA, jurorB, jurorC, admin, witnessA], 0, Tier.Verified);

      expect((await registry.reports(0)).tier).to.equal(Tier.Verified);
      expect(await registry.karma(reporterA.address)).to.equal(10n);
    });

    it("allows only one appeal", async () => {
      const { registry, admin, reporterA, jurorA, jurorB, jurorC, witnessA, geohash } =
        await deployFixture();
      await (await registry.connect(admin).setJuror(witnessA.address, true)).wait();
      await submit(registry, reporterA, geohash);

      await reachVerdict(registry, [jurorA, jurorB, jurorC], 0, Tier.Disputed);
      await (await registry.connect(reporterA).appealVerdict(0)).wait();
      await runRound(registry, [jurorA, jurorB, jurorC, admin, witnessA], 0, Tier.Disputed);

      expect(await registry.canAppeal(0)).to.equal(false);
      await expect(registry.connect(reporterA).appealVerdict(0)).to.be.revertedWith(
        "ReportRegistry: already appealed"
      );
    });

    it("lets nobody but the reporter appeal", async () => {
      const { registry, reporterA, reporterB, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await reachVerdict(registry, [jurorA, jurorB, jurorC], 0, Tier.Disputed);

      await expect(registry.connect(reporterB).appealVerdict(0)).to.be.revertedWith(
        "ReportRegistry: not the reporter"
      );
      await expect(registry.connect(jurorA).appealVerdict(0)).to.be.revertedWith(
        "ReportRegistry: not the reporter"
      );
    });

    it("closes the appeal window", async () => {
      const { registry, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await reachVerdict(registry, [jurorA, jurorB, jurorC], 0, Tier.Disputed);

      await time.increase(Number(await registry.APPEAL_WINDOW()) + 1);
      expect(await registry.canAppeal(0)).to.equal(false);
      await expect(registry.connect(reporterA).appealVerdict(0)).to.be.revertedWith(
        "ReportRegistry: appeal window closed"
      );
    });

    it("blocks voting on a decided report without an appeal", async () => {
      const { registry, admin, reporterA, jurorA, jurorB, jurorC, geohash } = await deployFixture();
      await submit(registry, reporterA, geohash);
      await reachVerdict(registry, [jurorA, jurorB, jurorC], 0, Tier.Verified);

      const commitment = await registry.commitmentFor(0, 1, Tier.Disputed, SALT(7), admin.address);
      await expect(registry.connect(admin).commitVote(0, commitment)).to.be.revertedWith(
        "ReportRegistry: not committing"
      );
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
      expect((registry as any).castJuryVote).to.equal(undefined);
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
