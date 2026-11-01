// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPersonhoodGate} from "./IPersonhoodGate.sol";

/// @title AllowlistPersonhoodGate
/// @notice The simplest possible {IPersonhoodGate}: an operator-curated list.
///
/// Be clear about what this is and is not. It IS a working gate that makes
/// corroboration meaningfully sybil-resistant for a closed pilot — a cohort of
/// known participants at a partner NGO, say, where the operator has already met
/// everyone. It is NOT anonymous: the operator learns which addresses are
/// admitted, and can therefore link a corroboration to a person they enrolled.
///
/// That makes it acceptable for a testnet pilot and unacceptable for anything
/// where a corroborator faces real risk. Ship RLN before you ship risk.
contract AllowlistPersonhoodGate is IPersonhoodGate {
    address public operator;

    mapping(address => bool) private allowed;
    uint256 public memberCount;

    event OperatorTransferred(address indexed previousOperator, address indexed newOperator);
    event MembershipChanged(address indexed account, bool allowed);

    modifier onlyOperator() {
        require(msg.sender == operator, "Allowlist: not operator");
        _;
    }

    constructor(address initialOperator) {
        require(initialOperator != address(0), "Allowlist: zero operator");
        operator = initialOperator;
    }

    /// @inheritdoc IPersonhoodGate
    function isPerson(address account) external view returns (bool) {
        return allowed[account];
    }

    function setMember(address account, bool isAllowed) public onlyOperator {
        require(account != address(0), "Allowlist: zero account");
        if (allowed[account] == isAllowed) return;

        allowed[account] = isAllowed;
        if (isAllowed) memberCount++;
        else memberCount--;

        emit MembershipChanged(account, isAllowed);
    }

    function setMembers(address[] calldata accounts, bool isAllowed) external onlyOperator {
        for (uint256 i = 0; i < accounts.length; i++) {
            setMember(accounts[i], isAllowed);
        }
    }

    function transferOperator(address newOperator) external onlyOperator {
        require(newOperator != address(0), "Allowlist: zero operator");
        emit OperatorTransferred(operator, newOperator);
        operator = newOperator;
    }
}
