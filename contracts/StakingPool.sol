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

    function init(
        uint256 _start,
        uint256 _end,
        uint256 _hourlyRatio,
        uint256 _hardCap,
        uint256 _contributionLimit,
        bytes32[] memory _patronRoles
    ) external payable onlyOwner preventReset {
        require(_start >= block.timestamp, "StakingPool: Not started");
        require(_end - _start >= 1 days, "StakingPool: Duration should be at least 1 day");
        require(_hardCap >= _contributionLimit, "StakingPool: Hardcap exceeds contribution limit");

        uint256 maxFutureRewards = compound(
            _hourlyRatio,
            _hardCap,
            _start,
            _end
        ) - _hardCap;

        require(msg.value >= maxFutureRewards, "StakingPool: Rewards lower than expected");

        start = _start;
        end = _end;
        hourlyRatio = _hourlyRatio;
        hardCap = _hardCap;
        contributionLimit = _contributionLimit;
        patronRoles = _patronRoles;
        remainingRewards = msg.value;
        initiator = msg.sender;

        emit StakingPoolInitialized(msg.value, block.timestamp);
    }

    function terminate() external initialized onlyOwner {
        require(start >= block.timestamp, "StakingPool: Cannot terminate after pool was started");
        uint256 payout = remainingRewards;
        address recipient = initiator;

        delete start;
        delete end;
        delete hourlyRatio;
        delete hardCap;
        delete contributionLimit;
        delete patronRoles;
        delete initiator;

        (bool success, ) = payable(recipient).call{value: payout}("");
        require(success, "StakingPool: Transaction has failed");
        //payable(recipient).transfer(payout);
    }

    function stake() public payable onlyPatrons(msg.sender) initialized belowContributionLimit {
        require(block.timestamp >= start, "StakingPool: Pool has not started yet");
        require(block.timestamp <= end, "StakingPool: Pool has already expired");
        require(hardCap - totalStaked >= msg.value, "StakingPool: Pool is full");

        (, uint256 compounded) = total();

        updateStake(stakes[msg.sender].deposit + msg.value, compounded + msg.value);
        accountFutureReward();
        totalStaked += msg.value;
        emit StakeAdded(msg.sender, msg.value, block.timestamp);
    }

    function unstake(uint256 value) public initialized {
        (uint256 deposit, uint256 compounded) = total();
        require(compounded > 0, "StakingPool: No funds to unstake");
        require(compounded >= value, "StakingPool: Requested value is above the compounded funds");
        uint256 depositComponent = value <= deposit ? value : deposit;
        uint256 rewardComponent = value > deposit ? value - deposit : 0;
        if(value == compounded) {
            delete stakes[msg.sender];
        } else {
            updateStake(stakes[msg.sender].deposit - depositComponent, compounded - value);
            accountFutureReward();
        }
        futureRewards -= rewardComponent;
        remainingRewards -= rewardComponent;
        totalStaked -= depositComponent;
        (bool success, ) = payable(msg.sender).call{value: value}("");
        require(success, "StakingPool: Transaction has failed");
        //payable(msg.sender).transfer(value);
        emit StakeWithdrawn(msg.sender, value);
    }

    function unstakeAll() public initialized {
        (, uint256 compounded) = total();
        unstake(compounded);
    }

    function sweep() public initialized onlyOwner {
       require(!sweeped , "StakingPool: Already sweeped");
       require(block.timestamp >= end, "StakingPool: Cannot sweep before expiry");
       uint256 payout = remainingRewards - futureRewards;
       sweeped = true;
       (bool success,) = payable(initiator).call{value: payout}("");
       require(success, "StakingPool: Transaction has failed");
       //payable(initiator).transfer(payout);
    }

    function calculateFutureReward() private view returns (uint256) {
        return 
            compound(hourlyRatio, stakes[msg.sender].compounded, block.timestamp, end) - stakes[msg.sender].deposit;

    }

    function accountFutureReward() private {
        uint256 futureReward = calculateFutureReward();
        futureRewards -= stakes[msg.sender].futureReward;
        futureRewards += futureReward;
        stakes[msg.sender].futureReward = futureReward;
    }

    function updateStake(uint256 deposit, uint256 compounded) private {
        stakes[msg.sender].deposit = deposit;
        stakes[msg.sender].compounded = compounded;
        if(block.timestamp - stakes[msg.sender].time >= 1 hours) {
            stakes[msg.sender].time = block.timestamp;
        }
    }

    function total() public view returns (uint256, uint256) {
        Stake memory senderStake = stakes[msg.sender];

        if(senderStake.time == 0) {
            return(0, 0);
        }

        uint256 compoundEnd = block.timestamp > end ? end : block.timestamp;

        uint256 compounded = compound(hourlyRatio, senderStake.compounded, senderStake.time, compoundEnd);
        return (senderStake.deposit, compounded);
    }

    function compound(
        uint256 hRatio,
        uint256 hCap,
        uint256 compoundStart,
        uint256 compoundEnd
    ) public view returns (uint256) {
        uint256 n = (compoundEnd - compoundStart) / 1 hours;

        return ABDKMath64x64.mulu(
            ABDKMath64x64.pow(
                ABDKMath64x64.add(
                    ABDKMath64x64.fromUInt(1), ABDKMath64x64.divu(hRatio, 10**18)
                ),
                n
            ),
            hCap
        );
    }
}