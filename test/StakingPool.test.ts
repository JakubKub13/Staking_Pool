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

    


})