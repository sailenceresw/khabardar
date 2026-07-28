// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ReportRegistry
/// @notice On-chain anchor for anonymous corruption reports. Only a hash of the
/// encrypted, off-chain evidence bundle is stored — never raw content or PII.
/// `msg.sender` is expected to be a pseudonymous, device-bound account (a
/// counterfactual ERC-4337 smart account or a 7702-delegated EOA), submitted
/// through a sponsoring relayer so the reporter never needs to hold ETH.
contract ReportRegistry {
    enum Category {
        Bribery,
        Embezzlement,
        Nepotism,
        ProcurementFraud,
        AbuseOfPower,
        Other
    }

    struct ReportRecord {
        bytes32 reportHash; // keccak256/sha256 of the encrypted evidence bundle
        bytes32 coarseGeohash; // truncated geohash prefix only (city/district-level, never precise)
        uint8 category;
        uint64 timestamp;
        address reporter; // pseudonymous account, not a real-world identity
    }

    event ReportSubmitted(
        uint256 indexed reportId,
        address indexed reporter,
        bytes32 reportHash,
        uint8 category,
        bytes32 coarseGeohash,
        uint64 timestamp
    );

    event ReportVerified(uint256 indexed reportId, address indexed moderator, bool credible);
    event ModeratorUpdated(address indexed previousModerator, address indexed newModerator);

    address public moderator;
    uint256 public reportCount;

    mapping(uint256 => ReportRecord) public reports;

    /// @notice Non-transferable reputation score per pseudonymous reporter.
    /// There is intentionally no transfer/approve function — karma cannot be
    /// bought, sold, or delegated, only earned through verified reports.
    mapping(address => uint256) public karma;

    modifier onlyModerator() {
        require(msg.sender == moderator, "ReportRegistry: not moderator");
        _;
    }

    constructor(address initialModerator) {
        require(initialModerator != address(0), "ReportRegistry: zero moderator");
        moderator = initialModerator;
    }

    /// @notice Anchor a new report on-chain. Called via a sponsored (gasless)
    /// transaction — the caller pays no gas, a paymaster/relayer does.
    /// @param reportHash Hash of the encrypted evidence bundle stored off-chain.
    /// @param category Corruption category (see {Category}).
    /// @param coarseGeohash Truncated geohash prefix; callers must never pass
    /// full-precision coordinates.
    function submitReport(
        bytes32 reportHash,
        uint8 category,
        bytes32 coarseGeohash
    ) external returns (uint256 reportId) {
        require(reportHash != bytes32(0), "ReportRegistry: empty hash");
        require(category <= uint8(Category.Other), "ReportRegistry: bad category");

        reportId = reportCount++;
        reports[reportId] = ReportRecord({
            reportHash: reportHash,
            coarseGeohash: coarseGeohash,
            category: category,
            timestamp: uint64(block.timestamp),
            reporter: msg.sender
        });

        emit ReportSubmitted(reportId, msg.sender, reportHash, category, coarseGeohash, uint64(block.timestamp));
    }

    /// @notice Moderation stub: a moderator marks a report credible or not,
    /// adjusting the reporter's karma. v0 uses a single moderator address;
    /// a future pass should replace this with a karma-weighted jury or
    /// multi-sig so no single party controls credibility scoring.
    function verifyReport(uint256 reportId, bool credible) external onlyModerator {
        require(reportId < reportCount, "ReportRegistry: unknown report");
        address reporter = reports[reportId].reporter;

        if (credible) {
            karma[reporter] += 10;
        } else if (karma[reporter] >= 5) {
            karma[reporter] -= 5;
        } else {
            karma[reporter] = 0;
        }

        emit ReportVerified(reportId, msg.sender, credible);
    }

    function setModerator(address newModerator) external onlyModerator {
        require(newModerator != address(0), "ReportRegistry: zero moderator");
        emit ModeratorUpdated(moderator, newModerator);
        moderator = newModerator;
    }
}
