//SPDX-License-Identifier: MIT
pragma solidity 0.8.6;

import "./libs/Roles.sol";
import "./libs/ABDKMath64x64.sol";

contract StakingPool {
    using ABDKMath64x64 for int128;
    using RolesLibrary for address;

    address public claimManager;
    uint256 public start;
    uint256 public end;
    uint256 public hourlyRatio;
    uint256 public hardCap;
    uint256 public contributionLimit;
    uint256 public totalStaked;
    bytes32[] private patronRoles;
    bytes32 private ownerRole;
    uint256 private remainingRewards;
    uint256 private futureRewards;
    bool public sweeped;
    address internal initiator;

    struct Stake {
        uint256 deposit;
        uint256 compounded;
        uint256 time;
        uint256 futureReward;
    }

    mapping(address => Stake) public stakes;

    event StakeAdded(address indexed sender, uint256 amount, uint256 time);
    event StakeWithdrawn(address indexed sender, uint256 amount /*uint256 time*/);
    event StakingPoolInitialized(uint256 funded, uint256 timestamp);

    modifier onlyOwner() virtual {
        require(msg.sender.isOwner(claimManager, ownerRole), "StakingPool: Not an owner");
        _;
    }

    modifier onlyPatrons(address _agent) virtual {
        require(_agent.hasRole(claimManager, patronRoles), "StakingPool: Not a patron");
        _;
    }

    modifier belowContributionLimit() {
        require(stakes[msg.sender].deposit + msg.value <= contributionLimit, "Stake is greater than contribution limit");
        _;
    }

    modifier initialized() {
        require(start != 0, "StakingPool is not initialized yet");
        _;
    }

    modifier preventReset() {
        require(start == 0, "StakingPool already initialized");
        _;
    }

    constructor(bytes32 _ownerRole, address _claimManager) {
        ownerRole = _ownerRole;
        claimManager = _claimManager;
    }


}