// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPersonhoodGate
/// @notice Answers one question: is this address plausibly a distinct human?
///
/// This exists because corroboration and karma are only as sybil-resistant as
/// the account set behind them. Anyone can mint a thousand addresses; if a
/// thousand addresses can corroborate, "3 independent witnesses" means nothing
/// and the single strongest trust signal in the protocol is free to forge.
///
/// The interface is deliberately minimal and the implementation deliberately
/// pluggable, because the honest answer to "how do you prove personhood
/// anonymously" is *not settled*, and hard-coding today's answer into the
/// registry would be a mistake. Known candidate implementations:
///
///  - **RLN (Rate-Limiting Nullifiers)** — a semaphore-style membership proof
///    plus a per-epoch nullifier. Anonymous, and a member who exceeds the rate
///    leaks their key and is slashed. This is the intended endgame and needs a
///    zk verifier contract, which is why it is not in this repo.
///  - **Anonymous credentials** — a blind signature from an accrediting body
///    (an NGO, a newsroom) redeemed once per epoch.
///  - **An allowlist** — see {AllowlistPersonhoodGate}. Not anonymous, and
///    only defensible for a closed pilot with known participants.
///
/// CRITICAL CONSTRAINT: a personhood gate must NEVER be applied to
/// `submitReport`. Requiring proof-of-personhood to report corruption would
/// reintroduce exactly the identity chokepoint the whole product exists to
/// remove, and would exclude the people least able to obtain credentials.
/// Submissions are protected by rate limiting instead; only corroboration —
/// the act of vouching for someone else — is gated.
interface IPersonhoodGate {
    /// @notice Whether `account` may perform personhood-gated actions.
    /// @dev Must be a view call and must not revert; the registry treats a
    /// reverting gate as a closed gate rather than failing open.
    function isPerson(address account) external view returns (bool);
}
