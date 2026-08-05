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
/// | Capture the moderator | Karma-weighted jury | tier verdicts |
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

    /// @notice A juror's individual verdict, published in full.
    ///
    /// The reason travels as an event argument rather than storage: it costs a
    /// fraction as much, and an event is exactly as auditable as storage to
    /// anyone reading the chain — which is the entire point. A moderation
    /// system nobody can audit is censorship with extra steps, so every vote,
    /// its weight, and its stated reason are public the moment it is cast.
    event JuryVoteCast(
        uint256 indexed reportId,
        address indexed juror,
        uint8 tier,
        uint256 weight,
        string reason
    );

    /// @notice A report's verdict reached quorum and is now final.
    event VerdictReached(uint256 indexed reportId, uint8 tier, uint256 weight);

    /// @notice A juror's standing moved because of how they voted.
    /// `agreed` is false when they voted against the verdict their peers reached.
    event JurorSettled(uint256 indexed reportId, address indexed juror, bool agreed, uint256 karmaAfter);

    event JurorUpdated(address indexed juror, bool active);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);
    event PersonhoodGateUpdated(address indexed previousGate, address indexed newGate);

    /// @notice Independent corroborations needed before a report is promoted
    /// from Unverified to CommunityCorroborated automatically.
    uint256 public constant CORROBORATION_THRESHOLD = 3;

    /// @notice Total juror weight required before a verdict is final. With
    /// base weight 1 per juror this is "three fresh jurors agreeing", and a
    /// juror who has been right before gets there faster.
    uint256 public constant JURY_QUORUM_WEIGHT = 3;

    /// @notice Karma needed for one extra unit of jury weight. Capped by
    /// {MAX_JUROR_WEIGHT} so a long-serving juror gains influence but can never
    /// reach quorum alone — a jury of one is the centralization this replaces.
    uint256 public constant KARMA_PER_JURY_WEIGHT = 50;
    uint256 public constant MAX_JUROR_WEIGHT = 2;

    /// @notice Karma a reporter gains when their report is Verified.
    uint256 public constant KARMA_REPORT_VERIFIED = 10;
    /// @notice Karma a reporter loses when their report is Disputed.
    uint256 public constant KARMA_REPORT_DISPUTED = 5;
    /// @notice Karma a juror gains for a verdict their peers agreed with.
    uint256 public constant KARMA_JUROR_AGREED = 3;
    /// @notice Karma a juror loses for a verdict their peers rejected. Larger
    /// than the reward on purpose: a reviewer who is casually wrong should lose
    /// standing faster than a careful one gains it.
    uint256 public constant KARMA_JUROR_DISSENTED = 6;

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

    /// @notice Non-transferable reputation per pseudonymous account. There is
    /// intentionally no transfer/approve function — karma cannot be bought,
    /// sold, or delegated, only earned by reports that survive review and by
    /// jury verdicts that hold up.
    mapping(address => uint256) public karma;

    mapping(uint256 => uint256) public corroborationCount;
    mapping(uint256 => mapping(address => bool)) public hasCorroborated;

    /// @notice Submissions made by an account within a given epoch.
    mapping(address => mapping(uint256 => uint256)) public epochSubmissions;

    mapping(address => bool) public isJuror;
    uint256 public jurorCount;

    /// @notice Recorded vote per juror per report, stored as `tier + 1` so that
    /// zero unambiguously means "has not voted" without a second mapping.
    mapping(uint256 => mapping(address => uint8)) private juryVotePlusOne;
    /// @notice Accumulated juror weight behind each tier, per report.
    mapping(uint256 => mapping(uint8 => uint256)) public tierWeight;
    /// @notice Jurors who have voted on a report, in vote order, so the verdict
    /// can settle every one of them.
    mapping(uint256 => address[]) private jurorsWhoVoted;
    /// @notice True once a report's verdict has reached quorum and settled.
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
    // Karma-weighted jury
    // ---------------------------------------------------------------------

    /// @notice Cast a karma-weighted verdict on a report, with a public reason.
    ///
    /// This replaces the single-moderator address that earlier versions used.
    /// The properties that matter:
    ///
    ///  - **No one decides alone.** A verdict needs {JURY_QUORUM_WEIGHT} of
    ///    agreeing weight, and {MAX_JUROR_WEIGHT} caps any individual below it.
    ///  - **Being wrong costs standing.** When the verdict lands, dissenting
    ///    jurors lose more karma than agreeing jurors gain, so careless review
    ///    decays a juror's influence toward zero.
    ///  - **Every vote is published.** Reason included, before the outcome is
    ///    known, so jurors are accountable for reasoning and not just results.
    ///  - **Judgement is added, never subtracted.** A jury can move a report's
    ///    tier; it cannot edit or delete the report. The content hash is
    ///    anchored and immutable, so moderation sits on top of the record.
    function castJuryVote(uint256 reportId, uint8 tier, string calldata reason) external onlyJuror {
        require(reportId < reportCount, "ReportRegistry: unknown report");
        require(tier <= uint8(VerificationTier.Disputed), "ReportRegistry: bad tier");
        require(!verdictFinal[reportId], "ReportRegistry: verdict final");
        require(juryVotePlusOne[reportId][msg.sender] == 0, "ReportRegistry: already voted");
        require(reports[reportId].reporter != msg.sender, "ReportRegistry: self review");
        require(bytes(reason).length != 0, "ReportRegistry: reason required");

        uint256 weight = jurorWeight(msg.sender);
        juryVotePlusOne[reportId][msg.sender] = tier + 1;
        jurorsWhoVoted[reportId].push(msg.sender);

        uint256 accumulated = tierWeight[reportId][tier] + weight;
        tierWeight[reportId][tier] = accumulated;

        emit JuryVoteCast(reportId, msg.sender, tier, weight, reason);

        if (accumulated >= JURY_QUORUM_WEIGHT) {
            _finalize(reportId, tier, accumulated);
        }
    }

    /// @notice A juror's vote weight: one by default, plus one unit per
    /// {KARMA_PER_JURY_WEIGHT} karma, capped at {MAX_JUROR_WEIGHT}.
    function jurorWeight(address juror) public view returns (uint256) {
        if (!isJuror[juror]) return 0;
        uint256 bonus = karma[juror] / KARMA_PER_JURY_WEIGHT;
        uint256 weight = 1 + bonus;
        return weight > MAX_JUROR_WEIGHT ? MAX_JUROR_WEIGHT : weight;
    }

    /// @notice How a juror voted on a report: `(hasVoted, tier)`.
    function juryVoteOf(uint256 reportId, address juror) external view returns (bool, uint8) {
        uint8 stored = juryVotePlusOne[reportId][juror];
        return stored == 0 ? (false, 0) : (true, stored - 1);
    }

    function jurorsVotedOn(uint256 reportId) external view returns (address[] memory) {
        return jurorsWhoVoted[reportId];
    }

    function _finalize(uint256 reportId, uint8 tier, uint256 weight) private {
        verdictFinal[reportId] = true;

        address reporter = reports[reportId].reporter;
        uint8 previous = reports[reportId].tier;
        reports[reportId].tier = tier;

        if (tier == uint8(VerificationTier.Verified) && previous != uint8(VerificationTier.Verified)) {
            karma[reporter] += KARMA_REPORT_VERIFIED;
        } else if (tier == uint8(VerificationTier.Disputed)) {
            karma[reporter] = karma[reporter] >= KARMA_REPORT_DISPUTED
                ? karma[reporter] - KARMA_REPORT_DISPUTED
                : 0;
        }

        address[] storage voters = jurorsWhoVoted[reportId];
        for (uint256 i = 0; i < voters.length; i++) {
            address juror = voters[i];
            bool agreed = juryVotePlusOne[reportId][juror] == tier + 1;

            if (agreed) {
                karma[juror] += KARMA_JUROR_AGREED;
            } else {
                karma[juror] = karma[juror] >= KARMA_JUROR_DISSENTED
                    ? karma[juror] - KARMA_JUROR_DISSENTED
                    : 0;
            }
            emit JurorSettled(reportId, juror, agreed, karma[juror]);
        }

        emit ReportTierChanged(reportId, tier, msg.sender);
        emit VerdictReached(reportId, tier, weight);
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
