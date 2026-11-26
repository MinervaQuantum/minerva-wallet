// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MinervaTypes} from "./lib/MinervaTypes.sol";

contract SecurityModeRegistry {
    mapping(address account => MinervaTypes.SecurityMode mode) public accountMode;

    event SecurityModeRecorded(address indexed account, MinervaTypes.SecurityMode mode);

    function recordMode(address account, MinervaTypes.SecurityMode mode) external {
        require(account != address(0), "SecurityModeRegistry: account required");
        require(msg.sender == account, "SecurityModeRegistry: only account");
        accountMode[account] = mode;
        emit SecurityModeRecorded(account, mode);
    }

    function label(MinervaTypes.SecurityMode mode) external pure returns (string memory) {
        if (mode == MinervaTypes.SecurityMode.Legacy) return "Legacy";
        if (mode == MinervaTypes.SecurityMode.SmartAccountReady) return "Smart Account Ready";
        if (mode == MinervaTypes.SecurityMode.HybridProtected) return "Hybrid Protected";
        if (mode == MinervaTypes.SecurityMode.PQReady) return "PQ Ready";
        return "PQ Native";
    }
}

