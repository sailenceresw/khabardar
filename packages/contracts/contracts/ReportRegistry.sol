// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPersonhoodGate} from "./IPersonhoodGate.sol";

/// @title ReportRegistry
/// @notice On-chain anchor and index for anonymous corruption reports.
///
/// What goes on-chain: a hash of the encrypted evidence bundle, a content
/// pointer (CID) to where that encrypted bundle lives, and coarse metadata.
/// What never goes on-chain: report text, evidence bytes, precise location,
/// or anything identifying the reporter.
///
/// `msg.sender` is a pseudonymous, device-bound account (a counterfactual
/// ERC-4337 smart account or a 7702-delegated EOA), submitted through a
/// sponsoring relayer so the reporter never needs to hold ETH.
///
/// ## Three defences, applied at different points
///
/// The three ways to attack a system like this are to flood it, to forge
/// consensus within it, and to capture the people judging it. Each gets its own
/// mechanism, and — importantly — they are applied asymmetrically:
///
/// | Attack | Defence | Applied to |
/// |---|---|---|
/// | Flood the gasless endpoint | Per-epoch submission cap | `submitReport` |
/// | Sybil the witness set | {IPersonhoodGate} | `corroborate` |
/// | Capture the review | Equal-weight secret-ballot jury, appealable | tier verdicts |
///
/// Note what is deliberately absent: there is no personhood check on
/// `submitReport`. Requiring anyone to prove who they are before reporting
/// corruption would rebuild the identity chokepoint this entire design exists
/// to remove, and would silence exactly the people least able to obtain
/// credentials. Reporting stays open to any address; only *vouching for someone
/// else* is gated, because that is where sybils actually buy something.
contract ReportRegistry {
    enum Category {
        Bribery,
        Embezzlement,
        Nepotism,
        ProcurementFraud,
        AbuseOfPower,
        Other
    }

    /// @notice Who can decrypt the bundle at `cid`.
    /// Public      — the content key is published alongside the report.
    /// Journalists — the content key is wrapped to specific recipient pubkeys.
    enum Visibility {
        Public,
        JournalistsOnly
    }

    /// @notice How much scrutiny a report has survived. Reports start
    /// Unverified and are never shown as credible until they move up.
    enum VerificationTier {
        Unverified,
        UnderReview,
        CommunityCorroborated,
        Verified,
        Disputed
    }

    struct ReportRecord {
        bytes32 reportHash; // keccak256 of the encrypted evidence bundle
        string cid; // content pointer (IPFS/Arweave) to the encrypted bundle
        bytes32 coarseGeohash; // truncated geohash prefix only (district-level)
        bytes32 entityTag; // blinded identifier of the accused office/official
        uint8 category;
        uint8 visibility;
        uint8 tier;
        uint64 timestamp;
        address reporter; // pseudonymous account, not a real-world identity
    }

    event ReportSubmitted(
        uint256 indexed reportId,
        address indexed reporter,
        bytes32 indexed entityTag,
        bytes32 reportHash,
        string cid,
        uint8 category,
        uint8 visibility,
        bytes32 coarseGeohash,
        uint64 timestamp
    );

    event ReportCorroborated(uint256 indexed reportId, address indexed witness, uint256 count);
    event ReportTierChanged(uint256 indexed reportId, uint8 tier, address indexed by);

    /// @notice A juror has committed to a verdict without revealing it.
    /// Carries no tier: that is the entire point of the commit phase.
    event JuryVoteCommitted(uint256 indexed reportId, address indexed juror, uint8 round);

    /// @notice A juror's verdict and stated reason, published in full at reveal.
    ///
    /// The reason travels as an event argument rather than storage: it costs a
    /// fraction as much, and an event is exactly as auditable as storage to
    /// anyone reading the chain — which is the entire point. A moderation
    /// system nobody can audit is censorship with extra steps.
    event JuryVoteRevealed(
        uint256 indexed reportId,
        address indexed juror,
        uint8 tier,
        string reason
    );

    /// @notice A round produced a majority verdict.
    event VerdictReached(uint256 indexed reportId, uint8 round, uint8 tier, uint8 votes);

    /// @notice A round ended without a majority. The report is not judged, and
    /// saying so is more honest than manufacturing a verdict from a plurality.
    event VerdictUndecided(uint256 indexed reportId, uint8 round, uint8 reveals);

    /// @notice A juror committed and then never revealed, so their ballot could
    /// not be counted. This is a process failure and the only thing a juror is
    /// ever penalised for.
    event JurorAbandoned(uint256 indexed reportId, address indexed juror);

    /// @notice The reporter contested a verdict; a larger panel will re-hear it.
    event VerdictAppealed(uint256 indexed reportId, uint8 newRound, uint8 quorum);

    event JurorUpdated(address indexed juror, bool active);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event PersonhoodGateUpdated(address indexed previousGate, address indexed newGate);

    /// @notice Independent corroborations needed before a report is promoted
    /// from Unverified to CommunityCorroborated automatically.
    uint256 public constant CORROBORATION_THRESHOLD = 3;

    // ---------------------------------------------------------------------
    // Jury parameters
    //
    // WHY EVERY JUROR COUNTS EXACTLY ONE
    //
    // An earlier version of this contract weighted a juror's vote by their
    // karma, and paid them for agreeing with the eventual verdict while
    // charging them more for dissenting. That was a mistake serious enough to
    // be worth recording rather than quietly deleting.
    //
    // It made agreement profitable and disagreement expensive, so the rational
    // move for any juror was to vote with whoever they expected to win rather
    // than with the evidence. Worse, the reward compounded: agreeing bought
    // karma, karma bought weight, weight bought influence over the next
    // verdict. A juror who was right before the majority caught up was
    // stripped of standing for it.
    //
    // That is precisely backwards for this application. The reports most
    // likely to attract a confidently wrong majority are the ones accusing
    // powerful or popular people — exactly the reports that most need a juror
    // willing to be the only "no" in the room. A mechanism that prices
    // dissent is a mechanism for burying them.
    //
    // So: equal weight, no reward for agreeing, no penalty for disagreeing.
    // The only thing a juror loses standing for is committing to a verdict and
    // then never revealing it, which is a failure to do the job rather than a
    // wrong opinion about the evidence. Bad jurors are removed by an explicit,
    // visible decision of whoever holds {admin} — a contestable human act,
    // rather than an automatic metric that mistakes conformity for judgement.
    // ---------------------------------------------------------------------

    /// @notice Ballots that must be committed before the reveal phase opens.
    ///
    /// KNOWN LIMITATION: the panel fills first-come-first-served, so a
    /// coordinated group watching for new reports can take all the seats. That
    /// is a real capture vector and this contract does not close it. The
    /// standard answer is sortition — draw the panel at random from the juror
    /// set — which needs a randomness source that a block proposer cannot
    /// grind. Building a weak version of that would be worse than not having
    /// it, because it would look like a defence while being one.
    ///
    /// Until then the mitigations are off-chain and unglamorous: keep the
    /// juror set small and vetted, watch the published ballots for panels that
    /// always seat the same faces, and unseat jurors who behave that way.
    uint8 public constant JURY_QUORUM = 3;

    /// @notice Panel size when a reporter appeals. Larger, so an appeal is a
    /// genuine re-hearing rather than a coin flip re-run.
    uint8 public constant APPEAL_QUORUM = 5;

    /// @notice How long jurors have to commit once a round opens. A round that
    /// never fills can be abandoned and restarted rather than blocking forever.
    uint64 public constant COMMIT_WINDOW = 3 days;

    /// @notice How long jurors have to reveal once the panel is full.
    uint64 public constant REVEAL_WINDOW = 2 days;

    /// @notice How long a reporter has to contest a verdict.
    uint64 public constant APPEAL_WINDOW = 7 days;

    /// @notice Karma a reporter gains when their report is Verified.
    uint256 public constant KARMA_REPORT_VERIFIED = 10;
    /// @notice Karma a reporter loses when their report is Disputed.
    uint256 public constant KARMA_REPORT_DISPUTED = 5;

    /// @notice Rate-limit window and per-account submission cap inside it.
    ///
    /// This is the non-anonymous half of what RLN gives you: it stops one
    /// account draining a sponsored gas pool, but an attacker with many
    /// addresses is only slowed, not stopped. RLN's per-epoch nullifier is what
    /// closes that, and it needs a zk verifier — see {IPersonhoodGate}.
    /// The cap is generous by design: a genuine reporter with several incidents
    /// to file in one day must never be turned away.
    uint256 public constant EPOCH_DURATION = 1 days;
    uint256 public constant MAX_REPORTS_PER_EPOCH = 10;

    /// @notice Manages the juror set. Deliberately CANNOT set a report's tier —
    /// that power belongs to the jury alone. An admin who could override
    /// verdicts would be the single moderator this design replaced.
    address public admin;

    /// @notice Optional sybil-resistance for corroboration. Zero means open,
    /// which is honest for a testnet and unacceptable for mainnet.
    IPersonhoodGate public personhoodGate;

    uint256 public reportCount;

    mapping(uint256 => ReportRecord) public reports;

    /// @notice Non-transferable credibility earned by REPORTING. There is
    /// intentionally no transfer/approve function — it cannot be bought, sold,
    /// or delegated.
    ///
    /// It is deliberately kept separate from anything to do with the jury.
    /// Being a reliable source says nothing about being a fair judge, and when
    /// these shared one mapping (as they did) a prolific reporter accumulated
    /// judicial power simply by filing — which is a way to buy influence over
    /// the review of one's own accusations.
    mapping(address => uint256) public karma;

    /// @notice Ballots a juror committed and then revealed. Published as a
    /// participation record, and deliberately NOT used to weight anything.
    mapping(address => uint256) public jurorBallotsCompleted;

    /// @notice Ballots a juror committed and then abandoned. The one thing a
    /// juror's record is allowed to hold against them, because it is about
    /// doing the job rather than about which way they voted.
    mapping(address => uint256) public jurorBallotsAbandoned;

    mapping(uint256 => uint256) public corroborationCount;
    mapping(uint256 => mapping(address => bool)) public hasCorroborated;

    /// @notice Submissions made by an account within a given epoch.
    mapping(address => mapping(uint256 => uint256)) public epochSubmissions;

    mapping(address => bool) public isJuror;
    uint256 public jurorCount;

    enum RoundPhase {
        None,
        Committing,
        Revealing,
        Decided,
        Undecided
    }

    struct JuryRound {
        RoundPhase phase;
        /// Ballots required to close the commit phase.
        uint8 quorum;
        uint8 commits;
        uint8 reveals;
        /// Winning tier + 1 once decided; 0 otherwise.
        uint8 decidedTierPlusOne;
        /// Round index, incremented on appeal so stale ballots cannot be reused.
        uint8 index;
        bool appealed;
        uint64 commitDeadline;
        uint64 revealDeadline;
        uint64 decidedAt;
    }

    mapping(uint256 => JuryRound) public rounds;

    /// @notice reportId => round index => juror => commitment.
    /// Keyed by round so an appeal starts clean without clearing storage.
    mapping(uint256 => mapping(uint8 => mapping(address => bytes32))) public commitmentOf;

    /// @notice reportId => round => juror => revealed tier + 1 (0 = unrevealed).
    mapping(uint256 => mapping(uint8 => mapping(address => uint8))) private revealedPlusOne;

    /// @notice Jurors who committed in a round, so abandonment can be settled.
    mapping(uint256 => mapping(uint8 => address[])) private panel;

    /// @notice reportId => round => tier => revealed vote count.
    mapping(uint256 => mapping(uint8 => mapping(uint8 => uint8))) public tierVotes;

    /// @notice True once a report has a standing verdict (appealable, not eternal).
    mapping(uint256 => bool) public verdictFinal;

    /// @notice Report ids grouped by blinded entity tag. This is what lets
    /// several independent reports about the same office or official be shown
    /// together without anyone publishing that entity's name on-chain, and
    /// without linking the reporters to each other.
    mapping(bytes32 => uint256[]) private entityReports;

    modifier onlyAdmin() {
        require(msg.sender == admin, "ReportRegistry: not admin");
        _;
    }

    modifier onlyJuror() {
        require(isJuror[msg.sender], "ReportRegistry: not juror");
        _;
    }

    /// @param initialAdmin Manages the juror set. Also seated as the first
    /// juror so a fresh deployment has a functioning (if not yet decentralized)
    /// review path; add more before relying on any verdict.
    constructor(address initialAdmin) {
        require(initialAdmin != address(0), "ReportRegistry: zero admin");
        admin = initialAdmin;
        _setJuror(initialAdmin, true);
    }

    // ---------------------------------------------------------------------
    // Reporting
    // ---------------------------------------------------------------------

    /// @notice Anchor a new report. Called via a sponsored (gasless) tx — the
    /// reporter pays no gas, a paymaster does.
    /// @param reportHash Hash of the encrypted bundle stored at `cid`.
    /// @param cid Content pointer to the encrypted bundle (never plaintext).
    /// @param category Corruption category (see {Category}).
    /// @param visibility Public or JournalistsOnly (see {Visibility}).
    /// @param coarseGeohash Truncated geohash prefix; callers must never pass
    /// full-precision coordinates.
    /// @param entityTag Blinded tag for the accused office/official, computed
    /// client-side as keccak256(normalizedName, sharedSalt). Pass bytes32(0)
    /// when the reporter names no specific entity. The tag is deliberately
    /// derived from a value that is not itself secret — what must stay secret
    /// is the reporter, not the accused.
    function submitReport(
        bytes32 reportHash,
        string calldata cid,
        uint8 category,
        uint8 visibility,
        bytes32 coarseGeohash,
        bytes32 entityTag
    ) external returns (uint256 reportId) {
        require(reportHash != bytes32(0), "ReportRegistry: empty hash");
        require(bytes(cid).length != 0, "ReportRegistry: empty cid");
        require(category <= uint8(Category.Other), "ReportRegistry: bad category");
        require(visibility <= uint8(Visibility.JournalistsOnly), "ReportRegistry: bad visibility");

        // Rate limit, not identity check. See the contract-level table.
        uint256 epoch = currentEpoch();
        uint256 used = epochSubmissions[msg.sender][epoch];
        require(used < MAX_REPORTS_PER_EPOCH, "ReportRegistry: epoch limit");
        epochSubmissions[msg.sender][epoch] = used + 1;

        reportId = reportCount++;
        reports[reportId] = ReportRecord({
            reportHash: reportHash,
            cid: cid,
            coarseGeohash: coarseGeohash,
            entityTag: entityTag,
            category: category,
            visibility: visibility,
            tier: uint8(VerificationTier.Unverified),
            timestamp: uint64(block.timestamp),
            reporter: msg.sender
        });

        if (entityTag != bytes32(0)) {
            entityReports[entityTag].push(reportId);
        }

        emit ReportSubmitted(
            reportId,
            msg.sender,
            entityTag,
            reportHash,
            cid,
            category,
            visibility,
            coarseGeohash,
            uint64(block.timestamp)
        );
    }

    /// @notice Current rate-limiting epoch.
    function currentEpoch() public view returns (uint256) {
        return block.timestamp / EPOCH_DURATION;
    }

    /// @notice Submissions `account` has left in the current epoch.
    function remainingSubmissions(address account) external view returns (uint256) {
        uint256 used = epochSubmissions[account][currentEpoch()];
        return used >= MAX_REPORTS_PER_EPOCH ? 0 : MAX_REPORTS_PER_EPOCH - used;
    }

    /// @notice All report ids sharing an entity tag — the cluster of
    /// independent allegations against the same office or official.
    function reportsForEntity(bytes32 entityTag) external view returns (uint256[] memory) {
        return entityReports[entityTag];
    }

    function entityReportCount(bytes32 entityTag) external view returns (uint256) {
        return entityReports[entityTag].length;
    }

    // ---------------------------------------------------------------------
    // Corroboration
    // ---------------------------------------------------------------------

    /// @notice Signal that you independently witnessed the same incident.
    /// Corroboration is the strongest trust signal the protocol has because it
    /// requires no trust in any single reporter — and it is worthless unless
    /// the witnesses are distinct people, which is what {personhoodGate}
    /// enforces when one is configured.
    function corroborate(uint256 reportId) external {
        require(reportId < reportCount, "ReportRegistry: unknown report");
        require(reports[reportId].reporter != msg.sender, "ReportRegistry: self corroboration");
        require(!hasCorroborated[reportId][msg.sender], "ReportRegistry: already corroborated");
        require(_isPerson(msg.sender), "ReportRegistry: personhood required");

        hasCorroborated[reportId][msg.sender] = true;
        uint256 count = ++corroborationCount[reportId];

        // Auto-promote, but never overwrite a jury verdict.
        if (
            count >= CORROBORATION_THRESHOLD &&
            !verdictFinal[reportId] &&
            reports[reportId].tier == uint8(VerificationTier.Unverified)
        ) {
            reports[reportId].tier = uint8(VerificationTier.CommunityCorroborated);
            emit ReportTierChanged(reportId, uint8(VerificationTier.CommunityCorroborated), address(0));
        }

        emit ReportCorroborated(reportId, msg.sender, count);
    }

    /// @notice Whether `account` may corroborate right now. An unset gate means
    /// open; a gate that reverts is treated as closed, so a broken verifier
    /// fails safe rather than waving everyone through.
    function isPerson(address account) external view returns (bool) {
        return _isPerson(account);
    }

    function _isPerson(address account) private view returns (bool) {
        if (address(personhoodGate) == address(0)) return true;
        try personhoodGate.isPerson(account) returns (bool ok) {
            return ok;
        } catch {
            return false;
        }
    }

    // ---------------------------------------------------------------------
    // Jury: equal weight, secret ballot
    //
    // Two phases. Jurors first COMMIT a hash of their verdict, then REVEAL it.
    // Nobody can see which way the panel is leaning while there is still time
    // to join it, because the tally does not exist until the reveal phase and
    // every ballot is already locked by then.
    //
    // That is not ceremony. The failure it prevents is the one that quietly
    // ruins open voting: the third juror sees two votes for "Verified", reads
    // the room instead of the evidence, and the panel converges on whatever the
    // first mover said. Commit–reveal makes voting-with-the-crowd impossible
    // rather than merely discouraged, which matters most for exactly the
    // reports where the crowd is likely to be wrong.
    // ---------------------------------------------------------------------

    /// @notice The hash a juror must submit to {commitVote}.
    ///
    /// Binds the report, the round, and the juror's own address, so a
    /// commitment cannot be replayed onto another report, reused after an
    /// appeal, or copied from a juror who has already committed.
    ///
    /// Compute this OFF-CHAIN. Calling it on-chain with the real salt would put
    /// the salt in calldata for anyone to read, which defeats the entire
    /// mechanism — it exists so a client can be checked against the contract,
    /// not so a juror can call it before voting.
    function commitmentFor(
        uint256 reportId,
        uint8 round,
        uint8 tier,
        bytes32 salt,
        address juror
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(reportId, round, tier, salt, juror));
    }

    /// @notice Commit to a verdict without revealing it.
    ///
    /// The first commitment on a report opens a round. Once {JURY_QUORUM}
    /// ballots are in (or {APPEAL_QUORUM} for an appeal), the panel is full and
    /// the reveal phase opens.
    function commitVote(uint256 reportId, bytes32 commitment) external onlyJuror {
        require(reportId < reportCount, "ReportRegistry: unknown report");
        require(commitment != bytes32(0), "ReportRegistry: empty commitment");
        require(reports[reportId].reporter != msg.sender, "ReportRegistry: self review");

        JuryRound storage round = rounds[reportId];

        // A finished round has to be cleared before another can open, so an
        // appeal or a retry starts from a clean panel rather than inheriting
        // half of the previous one.
        if (round.phase == RoundPhase.Undecided) {
            _openRound(round, round.quorum);
        } else if (round.phase == RoundPhase.None) {
            _openRound(round, JURY_QUORUM);
        }

        require(round.phase == RoundPhase.Committing, "ReportRegistry: not committing");
        require(block.timestamp <= round.commitDeadline, "ReportRegistry: commit window closed");
        require(
            commitmentOf[reportId][round.index][msg.sender] == bytes32(0),
            "ReportRegistry: already committed"
        );

        commitmentOf[reportId][round.index][msg.sender] = commitment;
        panel[reportId][round.index].push(msg.sender);
        round.commits += 1;

        emit JuryVoteCommitted(reportId, msg.sender, round.index);

        if (round.commits >= round.quorum) {
            round.phase = RoundPhase.Revealing;
            round.revealDeadline = uint64(block.timestamp) + REVEAL_WINDOW;
        }
    }

    /// @notice Reveal a committed verdict, with the reason published alongside.
    ///
    /// The reason is required and public. A juror is accountable for their
    /// reasoning, not only for landing on the popular answer — and since the
    /// vote was locked at commit time, the reason cannot be retrofitted to
    /// whatever the majority turned out to be.
    ///
    /// Deliberately NOT `onlyJuror`. A juror unseated between committing and
    /// revealing must still be able to open the ballot they cast in good faith
    /// while seated: blocking them would score it as abandonment, the one thing
    /// this design penalises, for an admin action they had no part in. It also
    /// closes a nastier door — an admin who could strip a juror mid-round would
    /// be able to suppress a dissenting ballot before anyone saw it, which is
    /// precisely the capture the sealed ballot exists to prevent. Only a
    /// matching commitment can be opened, so nothing is granted to anyone else.
    function revealVote(
        uint256 reportId,
        uint8 tier,
        bytes32 salt,
        string calldata reason
    ) external {
        require(reportId < reportCount, "ReportRegistry: unknown report");
        require(tier <= uint8(VerificationTier.Disputed), "ReportRegistry: bad tier");
        require(bytes(reason).length != 0, "ReportRegistry: reason required");

        JuryRound storage round = rounds[reportId];
        require(round.phase == RoundPhase.Revealing, "ReportRegistry: not revealing");
        require(block.timestamp <= round.revealDeadline, "ReportRegistry: reveal window closed");

        bytes32 expected = commitmentOf[reportId][round.index][msg.sender];
        require(expected != bytes32(0), "ReportRegistry: nothing committed");
        require(
            revealedPlusOne[reportId][round.index][msg.sender] == 0,
            "ReportRegistry: already revealed"
        );
        require(
            commitmentFor(reportId, round.index, tier, salt, msg.sender) == expected,
            "ReportRegistry: commitment mismatch"
        );

        revealedPlusOne[reportId][round.index][msg.sender] = tier + 1;
        tierVotes[reportId][round.index][tier] += 1;
        round.reveals += 1;
        jurorBallotsCompleted[msg.sender] += 1;

        emit JuryVoteRevealed(reportId, msg.sender, tier, reason);

        // Everyone who committed has now spoken; no reason to wait out the clock.
        if (round.reveals == round.commits) _closeRound(reportId, round);
    }

    /// @notice Close a round whose window has expired.
    ///
    /// Deliberately callable by anyone: a round that can only be closed by a
    /// juror is a round that a juror can leave open forever, which is a cheap
    /// way to bury a report by never finishing its review.
    function closeRound(uint256 reportId) external {
        require(reportId < reportCount, "ReportRegistry: unknown report");
        JuryRound storage round = rounds[reportId];

        if (round.phase == RoundPhase.Committing) {
            require(block.timestamp > round.commitDeadline, "ReportRegistry: commit window open");
            // Never filled the panel. Not anyone's fault, and not a verdict.
            round.phase = RoundPhase.Undecided;
            emit VerdictUndecided(reportId, round.index, round.reveals);
            return;
        }

        require(round.phase == RoundPhase.Revealing, "ReportRegistry: nothing to close");
        require(block.timestamp > round.revealDeadline, "ReportRegistry: reveal window open");
        _closeRound(reportId, round);
    }

    /// @notice Contest a verdict. Only the reporter, once, within
    /// {APPEAL_WINDOW}, and it re-hears the report before a larger panel.
    ///
    /// A first-instance verdict with no way to challenge it is not a fair
    /// process, however carefully the panel was assembled — three people can be
    /// wrong, and the reporter is the one who carries the cost of that.
    /// Appealing clears the standing verdict and undoes the karma it moved, so
    /// a report is never punished twice for a decision that gets overturned.
    function appealVerdict(uint256 reportId) external {
        require(reportId < reportCount, "ReportRegistry: unknown report");
        require(reports[reportId].reporter == msg.sender, "ReportRegistry: not the reporter");

        JuryRound storage round = rounds[reportId];
        require(round.phase == RoundPhase.Decided, "ReportRegistry: no verdict to appeal");
        require(!round.appealed, "ReportRegistry: already appealed");
        require(
            block.timestamp <= round.decidedAt + APPEAL_WINDOW,
            "ReportRegistry: appeal window closed"
        );

        _undoVerdictKarma(reportId);

        round.appealed = true;
        verdictFinal[reportId] = false;
        round.decidedTierPlusOne = 0;

        // Under appeal is not the same as unjudged, and showing the contested
        // verdict as if it still stood would be the unfair part.
        reports[reportId].tier = uint8(VerificationTier.UnderReview);
        emit ReportTierChanged(reportId, uint8(VerificationTier.UnderReview), address(0));

        _openRound(round, APPEAL_QUORUM);
        emit VerdictAppealed(reportId, round.index, APPEAL_QUORUM);
    }

    function _openRound(JuryRound storage round, uint8 quorum) private {
        round.index += 1;
        round.phase = RoundPhase.Committing;
        round.quorum = quorum;
        round.commits = 0;
        round.reveals = 0;
        round.commitDeadline = uint64(block.timestamp) + COMMIT_WINDOW;
        round.revealDeadline = 0;
    }

    /// @notice Tally the revealed ballots and settle the round.
    function _closeRound(uint256 reportId, JuryRound storage round) private {
        (uint8 winner, uint8 votes, bool majority) = _tally(reportId, round);

        _settleAbandoned(reportId, round);

        if (!majority) {
            // A plurality is not a verdict. Saying "the jury did not agree" is
            // more honest than promoting whichever tier happened to edge ahead,
            // and it leaves the report open for a fresh panel.
            round.phase = RoundPhase.Undecided;
            emit VerdictUndecided(reportId, round.index, round.reveals);
            return;
        }

        round.phase = RoundPhase.Decided;
        round.decidedTierPlusOne = winner + 1;
        round.decidedAt = uint64(block.timestamp);
        verdictFinal[reportId] = true;

        _applyVerdictKarma(reportId, winner);

        reports[reportId].tier = winner;
        emit ReportTierChanged(reportId, winner, address(0));
        emit VerdictReached(reportId, round.index, winner, votes);
    }

    /// @dev Winning tier, its vote count, and whether it holds an outright
    /// majority of the ballots actually revealed.
    function _tally(uint256 reportId, JuryRound storage round)
        private
        view
        returns (uint8 winner, uint8 votes, bool majority)
    {
        uint8 runnerUp;
        for (uint8 tier = 0; tier <= uint8(VerificationTier.Disputed); tier++) {
            uint8 count = tierVotes[reportId][round.index][tier];
            if (count > votes) {
                runnerUp = votes;
                votes = count;
                winner = tier;
            } else if (count > runnerUp) {
                runnerUp = count;
            }
        }

        // Strictly more than half the revealed ballots, and not tied for first.
        majority = votes > runnerUp && uint16(votes) * 2 > uint16(round.reveals);
    }

    /// @dev Charge the jurors who committed and then never revealed.
    ///
    /// The only thing a juror's record is allowed to hold against them. Note
    /// what is absent: no juror is penalised for the tier they chose. Pricing
    /// dissent is how a jury stops being one.
    function _settleAbandoned(uint256 reportId, JuryRound storage round) private {
        address[] storage jurors = panel[reportId][round.index];
        for (uint256 i = 0; i < jurors.length; i++) {
            address juror = jurors[i];
            if (revealedPlusOne[reportId][round.index][juror] == 0) {
                jurorBallotsAbandoned[juror] += 1;
                emit JurorAbandoned(reportId, juror);
            }
        }
    }

    /// @dev How much karma a verdict actually moved, so an appeal can put back
    /// exactly that and no more.
    ///
    /// Recording the real amount rather than recomputing it from the tier is
    /// not pedantry: a Disputed verdict against a reporter who had less than
    /// {KARMA_REPORT_DISPUTED} takes only what was there, and crediting the
    /// full penalty back on appeal would mint karma out of a floored
    /// subtraction. Overturning a verdict must restore the reporter, not
    /// reward them for having been wrongly disputed.
    mapping(uint256 => int256) private appliedKarmaDelta;

    function _applyVerdictKarma(uint256 reportId, uint8 tier) private {
        address reporter = reports[reportId].reporter;
        int256 delta;

        if (tier == uint8(VerificationTier.Verified)) {
            karma[reporter] += KARMA_REPORT_VERIFIED;
            delta = int256(KARMA_REPORT_VERIFIED);
        } else if (tier == uint8(VerificationTier.Disputed)) {
            uint256 taken = karma[reporter] >= KARMA_REPORT_DISPUTED
                ? KARMA_REPORT_DISPUTED
                : karma[reporter];
            karma[reporter] -= taken;
            delta = -int256(taken);
        }

        appliedKarmaDelta[reportId] = delta;
    }

    function _undoVerdictKarma(uint256 reportId) private {
        int256 delta = appliedKarmaDelta[reportId];
        if (delta == 0) return;

        address reporter = reports[reportId].reporter;
        if (delta > 0) {
            uint256 given = uint256(delta);
            karma[reporter] = karma[reporter] >= given ? karma[reporter] - given : 0;
        } else {
            karma[reporter] += uint256(-delta);
        }

        appliedKarmaDelta[reportId] = 0;
    }

    // ---------------------------------------------------------------------
    // Jury views
    // ---------------------------------------------------------------------

    /// @notice Every juror counts exactly one. Kept as a function so the
    /// property is explicit on-chain rather than implied by its absence.
    function jurorWeight(address juror) public view returns (uint256) {
        return isJuror[juror] ? 1 : 0;
    }

    /// @notice How a juror voted, once they have revealed. Returns
    /// `(false, 0)` while a ballot is still sealed — which is the point.
    function juryVoteOf(uint256 reportId, address juror) external view returns (bool, uint8) {
        uint8 stored = revealedPlusOne[reportId][rounds[reportId].index][juror];
        return stored == 0 ? (false, 0) : (true, stored - 1);
    }

    function hasCommitted(uint256 reportId, address juror) external view returns (bool) {
        return commitmentOf[reportId][rounds[reportId].index][juror] != bytes32(0);
    }

    function jurorsVotedOn(uint256 reportId) external view returns (address[] memory) {
        return panel[reportId][rounds[reportId].index];
    }

    /// @notice Whether the reporter can still contest the standing verdict.
    function canAppeal(uint256 reportId) external view returns (bool) {
        JuryRound storage round = rounds[reportId];
        return
            round.phase == RoundPhase.Decided &&
            !round.appealed &&
            block.timestamp <= round.decidedAt + APPEAL_WINDOW;
    }

    // ---------------------------------------------------------------------
    // Administration
    // ---------------------------------------------------------------------

    function setJuror(address juror, bool active) external onlyAdmin {
        require(juror != address(0), "ReportRegistry: zero juror");
        _setJuror(juror, active);
    }

    function _setJuror(address juror, bool active) private {
        if (isJuror[juror] == active) return;
        isJuror[juror] = active;
        if (active) jurorCount++;
        else jurorCount--;
        emit JurorUpdated(juror, active);
    }

    /// @notice Point corroboration at a personhood verifier, or unset it.
    /// Setting this is the single highest-value change before mainnet; until
    /// then corroboration counts are only as meaningful as the caller set.
    function setPersonhoodGate(address gate) external onlyAdmin {
        emit PersonhoodGateUpdated(address(personhoodGate), gate);
        personhoodGate = IPersonhoodGate(gate);
    }

    function transferAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "ReportRegistry: zero admin");
        emit AdminTransferred(admin, newAdmin);
        admin = newAdmin;
    }
}
