// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC2771Forwarder} from "@openzeppelin/contracts/metatx/ERC2771Forwarder.sol";

/// @title KhabardarForwarder
/// @notice OpenZeppelin's ERC-2771 forwarder, unchanged, under a fixed EIP-712
/// domain name. A relayer submits a request the reporter's device key signed;
/// the forwarder checks the signature, nonce and deadline, then calls the
/// registry with the signer's address appended so the registry records the
/// signer, not the relayer, as the caller.
///
/// Kept as a thin subclass on purpose. Anything added here would sit between a
/// signature and the address the registry trusts, which is the one place in the
/// system a bug could let someone report as somebody else.
contract KhabardarForwarder is ERC2771Forwarder {
    constructor() ERC2771Forwarder("KhabardarForwarder") {}
}
