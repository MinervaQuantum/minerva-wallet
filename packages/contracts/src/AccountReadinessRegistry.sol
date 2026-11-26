// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MinervaTypes} from "./lib/MinervaTypes.sol";

contract AccountReadinessRegistry {
    struct Readiness {
        bool isMinervaAccount;
        MinervaTypes.SecurityMode securityMode;
        bytes32 pqPublicKeyCommitment;
        uint256 lastKeyRotation;
        uint256 updatedAt;
    }

    mapping(address account => Readiness readiness) public accountReadiness;

    event ReadinessRecorded(
        address indexed account,
        MinervaTypes.SecurityMode securityMode,
        bytes32 pqPublicKeyCommitment,
        uint256 lastKeyRotation
    );

    function recordPQNative(bytes32 pqPublicKeyCommitment, uint256 lastKeyRotation) external {
        accountReadiness[msg.sender] = Readiness({
            isMinervaAccount: true,
            securityMode: MinervaTypes.SecurityMode.PQNative,
            pqPublicKeyCommitment: pqPublicKeyCommitment,
            lastKeyRotation: lastKeyRotation,
            updatedAt: block.timestamp
        });

        emit ReadinessRecorded(
            msg.sender,
            MinervaTypes.SecurityMode.PQNative,
            pqPublicKeyCommitment,
            lastKeyRotation
        );
    }
}

