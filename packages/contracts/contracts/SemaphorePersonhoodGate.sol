// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISemaphore} from "@semaphore-protocol/contracts/interfaces/ISemaphore.sol";
import {IPersonhoodGate} from "./IPersonhoodGate.sol";

/// @title SemaphorePersonhoodGate
/// @notice Proof-of-personhood by zero-knowledge group membership.
///
/// This is the implementation {IPersonhoodGate} was written for, and the one
/// that closes the gap the allowlist version leaves open.
///
/// ## What the proof actually says
///
/// A member proves, in zero knowledge: *"I am one of the identities in this
/// group, and I have not already signalled in this scope."* It does not say
/// which identity. The verifier learns a `nullifier` — a value derived from the
/// member's secret and the scope — which is unlinkable to the member and
/// unlinkable to their nullifiers in any other scope.
///
/// That is the whole trick, and it is worth being precise about why it matters
/// here. The allowlist gate makes corroboration sybil-resistant by making the
/// operator learn who every corroborator is. It trades one problem for another:
/// a list of everyone willing to vouch for a corruption report is itself a
/// target, and it is exactly the list a subpoena asks for. This gate gets the
/// same sybil resistance with nobody holding that list — the operator enrols
/// identity *commitments*, which are hashes, and can never tell which one acted.
///
/// ## Scopes, and why one report is one scope
///
/// `scope` is what the nullifier is bound to. Using the report id means a
/// member can corroborate each report once and cannot be tracked across
/// reports, because the nullifiers for two different reports share nothing.
/// Using a per-epoch scope instead would give RLN-style rate limiting; the
/// registry's per-epoch submission cap already covers that need, so the report
/// is the right granularity here.
///
/// ## What this does NOT provide
///
/// Not privacy of the *transaction*. Linea is a zkEVM rollup — its proofs
/// convince Ethereum that the rollup executed correctly, and they hide nothing
/// from anyone reading Linea. The sender address, the calldata, and the
/// nullifier are all public. What is hidden is only the link between the
/// proving member and the group, and that is hidden by *this* circuit, not by
/// the chain.
///
/// So a corroboration submitted from an address that has done other identifying
/// things on-chain is still linkable through that address. Anonymity here
/// requires the ERC-4337 path — a fresh smart account per action, gas sponsored
/// so the account never needs funding from a traceable source. The zk proof and
/// the account abstraction are two halves of one guarantee; either alone leaks.
contract SemaphorePersonhoodGate is IPersonhoodGate {
    ISemaphore public immutable semaphore;

    /// @notice The Semaphore group whose members count as verified persons.
    uint256 public immutable groupId;

    address public operator;

    /// @notice Nullifiers already spent, per scope.
    ///
    /// Semaphore's own `validateProof` also rejects a reused nullifier, but it
    /// is tracked here too because {isPerson} is a `view` and cannot call it —
    /// see the note on {proveForScope}.
    mapping(uint256 => bool) public nullifierUsed;

    /// @notice Addresses that have completed a proof and may now act.
    ///
    /// The redemption step. A member proves anonymously from one address, and
    /// that address is marked eligible; the registry then checks it through the
    /// plain {isPerson} call it already makes.
    mapping(address => uint256) public verifiedUntil;

    /// @notice How long a successful proof keeps an address eligible.
    ///
    /// Bounded rather than permanent so a compromised or resold account stops
    /// being a person eventually. Long enough that a reporter is not re-proving
    /// constantly, short enough that the window is not a standing asset.
    uint256 public constant VERIFICATION_TTL = 30 days;

    event OperatorTransferred(address indexed previousOperator, address indexed newOperator);
    event MemberEnrolled(uint256 indexed identityCommitment);
    event PersonhoodProved(address indexed account, uint256 nullifier, uint256 validUntil);

    error NotOperator();
    error NullifierAlreadyUsed();
    error ProofRejected();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(ISemaphore semaphore_, address initialOperator) {
        require(address(semaphore_) != address(0), "Gate: zero semaphore");
        require(initialOperator != address(0), "Gate: zero operator");

        semaphore = semaphore_;
        operator = initialOperator;
        groupId = semaphore_.createGroup(address(this));
    }

    /// @notice Enrol a verified person by their identity commitment.
    ///
    /// The operator sees a commitment — `poseidon(secret)` — and never the
    /// secret. Accrediting someone therefore does not create a record capable
    /// of identifying their later actions, which is the entire difference
    /// between this and the allowlist.
    function enroll(uint256 identityCommitment) external onlyOperator {
        semaphore.addMember(groupId, identityCommitment);
        emit MemberEnrolled(identityCommitment);
    }

    function enrollMany(uint256[] calldata identityCommitments) external onlyOperator {
        semaphore.addMembers(groupId, identityCommitments);
        for (uint256 i = 0; i < identityCommitments.length; i++) {
            emit MemberEnrolled(identityCommitments[i]);
        }
    }

    /// @notice Prove membership anonymously and make `msg.sender` eligible.
    ///
    /// ## Why this is a two-step redemption rather than a proof per action
    ///
    /// {IPersonhoodGate.isPerson} is a `view`, because the registry calls it
    /// inside `corroborate` and a view cannot record a spent nullifier. A proof
    /// that cannot be recorded is a proof that can be replayed, so verifying
    /// inside the view would be worse than useless.
    ///
    /// Splitting it means the anonymity set is the group, and the linkage this
    /// creates is `address -> proved at time T`, not `address -> which member`.
    /// The cost is that one address doing several actions links those actions
    /// to each other — which was already true of any on-chain activity, and is
    /// what a fresh ERC-4337 account per action is for.
    ///
    /// @param proof A Semaphore proof whose `scope` is this contract's address
    /// and whose `message` is the redeeming address, so a proof cannot be
    /// lifted from the mempool and redeemed by someone else.
    function proveForScope(ISemaphore.SemaphoreProof calldata proof) external {
        if (nullifierUsed[proof.nullifier]) revert NullifierAlreadyUsed();

        // Bind the proof to this gate and to the address redeeming it. Without
        // the message binding, an observer could copy a pending proof out of
        // the mempool and spend the nullifier as themselves.
        if (proof.scope != uint256(uint160(address(this)))) revert ProofRejected();
        if (proof.message != uint256(uint160(msg.sender))) revert ProofRejected();

        // Reverts on an invalid proof or a reused nullifier.
        semaphore.validateProof(groupId, proof);

        nullifierUsed[proof.nullifier] = true;
        uint256 validUntil = block.timestamp + VERIFICATION_TTL;
        verifiedUntil[msg.sender] = validUntil;

        emit PersonhoodProved(msg.sender, proof.nullifier, validUntil);
    }

    /// @inheritdoc IPersonhoodGate
    function isPerson(address account) external view returns (bool) {
        return verifiedUntil[account] > block.timestamp;
    }

    /// @notice Expire an address early.
    ///
    /// The only lever the operator has after enrolment, and it is deliberately
    /// blunt: they can stop an address acting, and they still cannot tell which
    /// member it was. Revoking membership itself requires a Merkle proof and is
    /// done through Semaphore directly.
    function revokeAddress(address account) external onlyOperator {
        verifiedUntil[account] = 0;
    }

    function transferOperator(address newOperator) external onlyOperator {
        require(newOperator != address(0), "Gate: zero operator");
        emit OperatorTransferred(operator, newOperator);
        operator = newOperator;
    }
}
