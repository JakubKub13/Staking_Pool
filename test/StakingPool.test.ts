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
        const claimManagerMocked = await deployContract(patron1, claimManagerABI);
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


})