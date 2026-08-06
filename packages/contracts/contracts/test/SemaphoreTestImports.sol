// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Pulls Semaphore's concrete contracts into Hardhat's compilation set.
 *
 * `SemaphorePersonhoodGate` only imports the *interface*, so without this file
 * Hardhat never compiles `Semaphore` or `SemaphoreVerifier` and the tests have
 * no artifacts to deploy. Importing them here rather than in the gate keeps the
 * production contract's dependency surface to the interface alone.
 *
 * On a real deployment you do not deploy these at all — Semaphore is already
 * live on the target chain and the gate is pointed at the canonical address.
 * That matters: the verifier embeds a trusted-setup verification key, and using
 * the deployment everyone else audits is worth more than deploying your own.
 */

// solhint-disable-next-line no-unused-import
import {Semaphore} from "@semaphore-protocol/contracts/Semaphore.sol";
// solhint-disable-next-line no-unused-import
import {SemaphoreVerifier} from "@semaphore-protocol/contracts/base/SemaphoreVerifier.sol";
// Semaphore's Merkle tree hashes with Poseidon, deployed as a linked library
// because it is far too large to inline into every contract that uses it.
// solhint-disable-next-line no-unused-import
import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
