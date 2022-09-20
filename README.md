STAKING_POOL
------------

This contract is implementation of ETH Staking pool with hourly compounding, hardcap, contribution limits and expiry date

Staking Pool can be in one of the following states during it's lifecycle:
1. DEPLOYED - Smart contracts are deployed to the network or terminate() called when in INITIALIZED state
2. INITIALIZED - init() function executed
3. OPEN - When current block.timestamp is greater than or equal start
4. EXPIRED - When current block.timestamp is greater than or equal end
5. SWEPT / CLEANED - sweep() function executed

State vs Staking Pool operations
------------------------------------------------------------------------
########    | Rewards locked | Staking | Unstaking | Compounding 
DEPLOYED    |   No           |  No     |    No     |    No 
INITIALIZED |   Yes          |  No     |    No     |    No
OPEN        |   Yes          |  Yes    |    Yes    |    Yes
EXPIRED     |   Yes          |  No     |    Yes    |    No
SWEPT       |   No           |  No     |    Yes    |    No
------------------------------------------------------------------------


FUNDING

This Staking Pool implementation requires the owner of the pool to provide funds to cover all potential rewards including hardCap, ratio and staking pool time dimension.
    maxFutureRewards = hardCap - hardCap * compound(1+ratio)**((end-start)/1 hour)


COMPOUNDING

This Staking Pool implementation utilizes linear compounding function
    compounded = compounded * (1+ratio)**n
        compounded = deposit + compounded rewards
        ratio = hourly compounding ratio
        n = amount of hourly intervals

Function that powers compounding process comes from ABDKMath64x64 solidity math library
In order to keep Smart Contract design minimalistic Stake struct in stakes mapping keeps compounded value that is being updated on every additional stake and unstake function calls (every function that changes stake.deposit)


SWEEPING AFTER EXPIRY

When the contract is initialized it requires maximum amount of rewards to be provided. 
The sweep functionality is standard smart contract patter to reclaim unused / unnecessary funds.
Sweep function can be only called by the owner of the contract when the contract is in EXPIRED state.
In this state compounding has already stopped and that means the total amount of reward is fixed.
The definition of Unused/Unnecessary funds = maxFutureRewards - rewards when staking pool enters EXPIRED state.
