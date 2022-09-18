import { expect, use } from "chai";
import { StakingPool } from "../ethers"; // artifacts ?
import { Wallet, utils, BigNumber } from "ethers";
import { claimManagerABI } from "./utils/claimManager_abi";
import { deployMockContract } from "@ethereum-waffle/mock-contract";
import { deployContract, loadFixture, MockProvider, solidity } from "ethereum-waffle";
import  StakingPoolContract from "../artifacts/contracts/StakingPool.sol/StakingPool.json";

use(solidity);