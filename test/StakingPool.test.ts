import { expect, use } from "chai";
import { StakingPool } from "../ethers"; // artifacts ?
import { Wallet, utils, BigNumber } from "ethers";
import { claimManagerABI } from "./utils/claimManager_abi";
import { deployMockContract } from "@ethereum-waffle/mock-contract";
import { deployContract, loadFixture, MockProvider, solidity } from "ethereum-waffle";
import  StakingPoolContract from "../artifacts/contracts/StakingPool.sol/StakingPool.json";

use(solidity);

describe("Staking Pool", function () {
    const oneETH = utils.parseUnits("1", "ether");
    const hardCap = oneETH.mul(5000000);
    const contributionLimit = oneETH.mul(50000);
    const ratio = 0.0000225;
    const ratioInt = utils.parseUnits(ratio.toString(), 18); 
    const defaultRoleVersion = 1;
    const patronRoleDef = utils.namehash("email.roles.verification.app.stakingPool.iam.ewc");
    const ownerRoleDef = utils.namehash("owner.roles.staking.app.stakingPool.iam.ewc");
    const timeTravel = async (provider: MockProvider, seconds: number) => {
        await provider.send("evm_increaseTime", [seconds]);
        await provider.send("evm_mine", []);
    };

    async function stakeAndTravel(stakingPool: StakingPool, value: BigNumber, seconds: number, provider: any) {
        await stakingPool.stake({ value });
        await timeTravel(provider, seconds);
    }

    async function fixture( 
        hardCap: BigNumber,
        start: number,
        [owner, owner2, patron1, patron2]: Wallet[],
        provider: MockProvider,
        initializePool = true,
        travel = true,
    ) {
        const duration = 3600 * 24 * 30;
        const end = start + duration;
        const claimManagerMocked = await deployMockContract(patron1, claimManagerABI);
        const stakingPool = (await deployContract(owner, StakingPoolContract, [
            ownerRoleDef,
            claimManagerMocked.address,
        ])) as StakingPool;
        const rewards = (await stakingPool.compound(ratioInt, hardCap, start, end)).sub(hardCap);

        if (initializePool) {
            const asOwner = stakingPool.connect(owner);
            try {
                await claimManagerMocked.mock.hasRole.withArgs(owner.address, ownerRoleDef, defaultRoleVersion).returns(true);
                await claimManagerMocked.mock.hasRole.withArgs(owner2.address, ownerRoleDef, defaultRoleVersion).returns(true);

                await claimManagerMocked.mock.hasRole.withArgs(patron1.address, patronRoleDef, defaultRoleVersion).returns(true);
                await claimManagerMocked.mock.hasRole.withArgs(patron2.address, patronRoleDef, defaultRoleVersion).returns(true);

                const tx = await asOwner.init(start, end, ratioInt, hardCap, contributionLimit, [patronRoleDef], { value: rewards });
                const { blockNumber } = await tx.wait();
                const { timestamp } = await provider.getBlock(blockNumber);
                await expect(tx).to.emit(stakingPool, "StakingPoolInitialized").withArgs(rewards, timestamp);
                if(travel) {
                    const travelTo = start - timestamp;
                    await timeTravel(provider, travelTo);
                }
            } catch (error) {
                console.log("Initialization Error: ");
                console.log(error);
            }
        }

        return {
            stakingPool,
            patron1,
            patron2,
            owner,
            asPatron1: stakingPool.connect(patron1),
            asPatron2: stakingPool.connect(patron2),
            asOwner: stakingPool.connect(owner),
            asOwner2: stakingPool.connect(owner2),
            provider,
            duration,
            defaultRoleVersion,
            claimManagerMocked,
            start,
            end,
            hardCap,
            rewards
        };
    }

    async function defaultFixture(wallets: Wallet[], provider: MockProvider) {
        const { timestamp } = await provider.getBlock("latest");
        const start = timestamp + 10;
        return fixture(hardCap, start, wallets, provider);
    }

    async function initNoTravelFixture(wallets: Wallet[], provider: MockProvider) {
        const { timestamp } = await provider.getBlock("latest");
        const start = timestamp + 10;
        return fixture(hardCap, start, wallets, provider, true, false);
    }

    async function uninitializeFixture(wallets: Wallet[], provider: MockProvider) {
        const { timestamp } = await provider.getBlock("latest");
        const start = timestamp + 10;
        return fixture(hardCap, start, wallets, provider, false);
    }

    async function initialStakeAndTravelToExpiryFixture(wallets: Wallet[], provider: MockProvider) {
        const { timestamp } = await provider.getBlock("latest");
        const start = timestamp + 10;
        const setup = await fixture(hardCap, start, wallets, provider);
        const { asPatron1, duration } = setup;
        await stakeAndTravel(asPatron1, oneETH, duration, setup.provider);
        return setup;
    }

    it("Should revert if contribution limit is higher than hardCap", async function () {
        const { asOwner, end, rewards, start, owner, claimManagerMocked, defaultRoleVersion } = await loadFixture(uninitializeFixture,);
        const aboveContributionLimit = hardCap.add(1);
        await claimManagerMocked.mock.hasRole.withArgs(owner.address, ownerRoleDef, defaultRoleVersion).returns(true);
        await expect(asOwner.init(start, end, ratioInt, hardCap, aboveContributionLimit, [patronRoleDef], {
            value: rewards,
        }),
        ).to.be.revertedWith("StakingPool: Hardcap exceeds contribution limit");
    });

    it("Should revert if initial rewards are lower than max future rewards", async function () {
        const { owner, asOwner, start, end, hardCap, claimManagerMocked, defaultRoleVersion, rewards } = await loadFixture(uninitializeFixture,);
        await claimManagerMocked.mock.hasRole.withArgs(owner.address, ownerRoleDef, defaultRoleVersion).returns(true);
        const smallerRewards = rewards.sub(1);
        await expect(asOwner.init(start, end, ratioInt, hardCap, contributionLimit, [patronRoleDef], {
            value: smallerRewards,
        }),
        ).to.be.revertedWith("StakingPool: Rewards lower than expected");
    })

    it("Should allow to terminate staking pool before it reached the start", async function () {
        const { owner, asOwner, rewards } = await loadFixture(initNoTravelFixture);
        await expect(await asOwner.terminate()).to.changeEtherBalance(owner, rewards);
    })

    it("Should send the funds back to original initiator", async function () {
        const { owner, asOwner2, rewards } = await loadFixture(initNoTravelFixture);
        await expect(await asOwner2.terminate()).to.changeEtherBalance(owner, rewards)
    });

    describe("Staking", async () => {
        it("Should revert if patron does not have appropriate role", async function () {
            const { patron1, asPatron1, claimManagerMocked } = await loadFixture(defaultFixture);
            await claimManagerMocked.mock.hasRole.withArgs(patron1.address, patronRoleDef, defaultRoleVersion).returns(false);
            await expect(asPatron1.stake({ value: oneETH })).to.be.revertedWith("StakingPool: Not a patron")
        })

        it("Should revert if staking pool is not initialized", async function () {
            const { asPatron1 } = await loadFixture(uninitializeFixture);
            await expect(asPatron1.stake({ value: oneETH }),
            ).to.be.revertedWith("StakingPool is not initialized yet");
        });

        it("Should be possible to stake funds", async function () {
            const { stakingPool, patron1, asPatron1, provider } = await loadFixture(defaultFixture);
            const tx = await asPatron1.stake({ value: oneETH });
            const { blockNumber } = await tx.wait();
            const { timestamp } =  await provider.getBlock(blockNumber);
            await expect(tx).to.emit(stakingPool, "StakeAdded").withArgs(patron1.address, oneETH, timestamp);
            const [deposit, compounded ] = await asPatron1.total();
            expect(deposit).to.be.equal(compounded);
            expect(deposit).to.be.equal(oneETH);
        });

        it("One user should stake multiple times", async function () {
            const { asPatron1 } = await loadFixture(defaultFixture);
            await asPatron1.stake({ value: oneETH });
            await asPatron1.stake({ value: oneETH });
            const [deposit, compounded] = await asPatron1.total();
            expect(deposit).to.be.equal(compounded);
            expect(deposit).to.be.equal(oneETH.mul(2));
        });

        it("Should increase the balance of the staking pool", async function () {
            const { stakingPool, asPatron1 } = await loadFixture(defaultFixture);
            await expect(await asPatron1.stake({ value: oneETH })).to.changeEtherBalance(stakingPool, oneETH);
        });

        it("Should revert when staking pool reached the hard cap", async function () {
            const hardCap = contributionLimit;
            const { asPatron1, asPatron2, asOwner, end, rewards, start } = await loadFixture(
                async(wallets: Wallet[], provider: MockProvider) => {
                    const { timestamp } = await provider.getBlock("latest");
                    const start = timestamp + 10;
                    return fixture(hardCap, start, wallets, provider);
                });
                await asPatron1.stake({ value: contributionLimit });
                await expect(asPatron2.stake({ value: oneETH })).to.be.revertedWith("StakingPool: Pool is full");
        });

        it("Should revert if an owner tries to reinitialize already started Staking Pool", async function () {
            const { asOwner, start, end, rewards } = await loadFixture(defaultFixture);
            await expect(asOwner.init(start, end, ratioInt, hardCap, contributionLimit, [patronRoleDef], {
                value: rewards,
            })).to.be.revertedWith("StakingPool already initialized");
        });

        it("Should revert if stake is greater than contribution limit", async function () {
            const { asPatron1 } = await loadFixture(defaultFixture);
            const patronStake = utils.parseUnits("50001", "ether");
            await expect(asPatron1.stake({ value: patronStake })).to.be.revertedWith("Stake is greater than contribution limit");
        });

        it("Should revert if staking pool has not yet started", async function () {
            const { asPatron1 } = await loadFixture(async (wallets: Wallet[], provider: MockProvider) => {
                const { timestamp } = await provider.getBlock("latest");
                const start = timestamp + 100 // starts in future
                return fixture(hardCap, start, wallets, provider, true, false);
            });
            await expect(asPatron1.stake({ value: oneETH })).to.be.revertedWith("StakingPool: Pool has not started yet");
        });

        it("Should revert if staking pool has already expired", async function () {
            const { duration, provider, asPatron1 } = await loadFixture(defaultFixture);
            await timeTravel(provider, duration + 1);
            await expect(asPatron1.stake({ value: oneETH })).to.be.revertedWith("StakingPool: Pool has already expired");
        });

        it("Should not compound stake after reaching expiry date", async function () {
            const { asPatron1, duration, provider } = await loadFixture(defaultFixture);
            await stakeAndTravel(asPatron1, oneETH, duration + 1, provider);
            const [deposit, compounded] = await asPatron1.total();
            await timeTravel(provider, duration + 1);
            const [stakeAfterExpiry, compoundAfterExpiry] = await asPatron1.total();
            expect(stakeAfterExpiry).to.be.equal(deposit);
            expect(compoundAfterExpiry).to.be.equal(compounded);
        });  
  });

  describe("Unstaking", async () => {
    it("Should unstake funds", async function () {
        const { patron1, asPatron1 } = await loadFixture(defaultFixture);
        await asPatron1.stake({ value: oneETH});
        await expect(await asPatron1.unstakeAll()).to.changeEtherBalance(patron1, oneETH);
        const [deposit, compound] = await asPatron1.total();
        expect(deposit).to.be.equal(BigNumber.from(0));
        expect(compound).to.be.equal(BigNumber.from(0));
    });

    it("Should decrease the balance of the staking pool", async function () {
        const { stakingPool, asPatron1 } = await loadFixture(defaultFixture);
        await asPatron1.stake({ value: oneETH });
        await expect(await asPatron1.unstakeAll()).to.changeEtherBalance(stakingPool, oneETH.mul(-1));
    });

    it("Should revert when no funds have been staked by user", async function () {
        const { asPatron1, asPatron2 } = await loadFixture(defaultFixture);
        await asPatron1.stake({ value: oneETH });
        await expect(asPatron2.unstakeAll()).to.be.revertedWith("StakingPool: No funds to unstake");
    });

    it("Should allow partial withdrawal up to compounded value", async function () {
        const { asPatron1, provider, duration } = await loadFixture(defaultFixture);
        const initialStake = oneETH;
        await stakeAndTravel(asPatron1, initialStake, duration / 2, provider);
        let [deposit, compounded] = await asPatron1.total();
        const initialCompounded = compounded;
        expect(compounded.gt(deposit)).to.be.true;
        const withdrawalValue = initialStake.div(2);
        await asPatron1.unstake(withdrawalValue);
        [deposit, compounded] = await asPatron1.total();
        expect(deposit).to.be.equal(initialStake.sub(withdrawalValue));
        expect(compounded).to.be.equal(initialCompounded.sub(withdrawalValue));
        await asPatron1.unstake(withdrawalValue);
        [deposit, compounded] = await asPatron1.total();
        expect(deposit).to.be.equal(BigNumber.from(0));
        expect(compounded.gt(0)).to.be.true;
        await asPatron1.unstake(compounded);
        [deposit, compounded] = await asPatron1.total();
        expect(deposit).to.be.equal(BigNumber.from(0));
        expect(compounded).to.be.equal(BigNumber.from(0));
    });

    describe("Sweeping", async () => {
        
    })

  })
})