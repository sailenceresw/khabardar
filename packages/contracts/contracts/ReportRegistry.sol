// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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
    event ModeratorUpdated(address indexed previousModerator, address indexed newModerator);

    /// @notice Independent corroborations needed before a report is promoted
    /// from Unverified to CommunityCorroborated automatically.
    uint256 public constant CORROBORATION_THRESHOLD = 3;

    address public moderator;
    uint256 public reportCount;

    mapping(uint256 => ReportRecord) public reports;

    /// @notice Non-transferable reputation per pseudonymous reporter. There is
    /// intentionally no transfer/approve function — karma cannot be bought,
    /// sold, or delegated, only earned through reports that survive review.
    mapping(address => uint256) public karma;

    mapping(uint256 => uint256) public corroborationCount;
    mapping(uint256 => mapping(address => bool)) public hasCorroborated;

    /// @notice Report ids grouped by blinded entity tag. This is what lets
    /// several independent reports about the same office or official be shown
    /// together without anyone publishing that entity's name on-chain, and
    /// without linking the reporters to each other.
    mapping(bytes32 => uint256[]) private entityReports;

    modifier onlyModerator() {
        require(msg.sender == moderator, "ReportRegistry: not moderator");
        _;
    }

    constructor(address initialModerator) {
        require(initialModerator != address(0), "ReportRegistry: zero moderator");
        moderator = initialModerator;
    }

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

    /// @notice All report ids sharing an entity tag — the cluster of
    /// independent allegations against the same office or official.
    function reportsForEntity(bytes32 entityTag) external view returns (uint256[] memory) {
        return entityReports[entityTag];
    }

    function entityReportCount(bytes32 entityTag) external view returns (uint256) {
        return entityReports[entityTag].length;
    }

    /// @notice Signal that you independently witnessed the same incident.
    /// Corroboration is the strongest trust signal the protocol has because it
    /// requires no trust in any single reporter — but on its own it is only
    /// sybil-resistant to the degree the caller set is. Production must gate
    /// this behind proof-of-personhood (RLN / anonymous credentials) so one
    /// person cannot corroborate themselves from many accounts.
    function corroborate(uint256 reportId) external {
        require(reportId < reportCount, "ReportRegistry: unknown report");
        require(reports[reportId].reporter != msg.sender, "ReportRegistry: self corroboration");
        require(!hasCorroborated[reportId][msg.sender], "ReportRegistry: already corroborated");

        hasCorroborated[reportId][msg.sender] = true;
        uint256 count = ++corroborationCount[reportId];

        // Auto-promote, but never downgrade a moderator's verdict.
        if (count >= CORROBORATION_THRESHOLD && reports[reportId].tier == uint8(VerificationTier.Unverified)) {
            reports[reportId].tier = uint8(VerificationTier.CommunityCorroborated);
            emit ReportTierChanged(reportId, uint8(VerificationTier.CommunityCorroborated), address(0));
        }

        emit ReportCorroborated(reportId, msg.sender, count);
    }

    /// @notice Moderation stub: a verifier sets the report's tier and karma
    /// moves with it. v0 uses a single moderator address; production should
    /// replace this with a karma-weighted jury or an NGO multi-sig so no single
    /// party controls credibility scoring.
    function setVerificationTier(uint256 reportId, uint8 tier) external onlyModerator {
        require(reportId < reportCount, "ReportRegistry: unknown report");
        require(tier <= uint8(VerificationTier.Disputed), "ReportRegistry: bad tier");

        address reporter = reports[reportId].reporter;
        uint8 previous = reports[reportId].tier;
        reports[reportId].tier = tier;

        if (tier == uint8(VerificationTier.Verified) && previous != uint8(VerificationTier.Verified)) {
            karma[reporter] += 10;
        } else if (tier == uint8(VerificationTier.Disputed)) {
            karma[reporter] = karma[reporter] >= 5 ? karma[reporter] - 5 : 0;
        }

        emit ReportTierChanged(reportId, tier, msg.sender);
    }

    function setModerator(address newModerator) external onlyModerator {
        require(newModerator != address(0), "ReportRegistry: zero moderator");
        emit ModeratorUpdated(moderator, newModerator);
        moderator = newModerator;
    }
}
