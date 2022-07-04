const { assert, expect } = require("chai");
const { getNamedAccounts, deployments, ethers, network } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");

// Steps to take to test on testnet
// 1. Get our SubId for Chainlink VRF >>> from vrf.chain.link -> Create Subscription (needs enough Rinkeby ETG on Metamask account)
// 2. Deploy our contract using the SubId
// 3. Register the contract with Chainlink VRF & it's subId
// 4. Register the contract with Chainlink Keepers
// 5. Run staging tests

developmentChains.includes(network.name)
	? describe.skip
	: describe("Raffle Unit Tests", async function () {
			let raffle, raffleEntranceFee, deployer;

			beforeEach(async function () {
				deployer = (await getNamedAccounts()).deployer;
				raffle = await ethers.getContract("Raffle", deployer);
				raffleEntranceFee = await raffle.getEntranceFee();
			});

			describe("fulfillRandomWords", function () {
				it("works with live Chainlink Keepers and Chainlink VRF, we get a random winner", async function () {
					// enter the raffle
					const startingTimeStamp = await raffle.getLatestTimeStamp();
					const accounts = await ethers.getSigners();

					// because we use await, Promise needs to be resolved before code can continue
					await new Promise(async (resolve, reject) => {
						raffle.once("WinnerPicked", async () => {
							console.log("WinnerPicked event fired!");
							try {
								// add our asserts here
								const recentWinner = await raffle.getRecentWinner();
								const raffleState = await raffle.getRaffleState();
								// TODO: figure this out: apparently we can't use deployer here and we have to get the account from ethers.getSigner()[0]; no idea why yet. Maybe scope?
								const winnerEndingBalance = await accounts[0].getBalance();
								const endingTimeStamp = await raffle.getLatestTimeStamp();

								await expect(raffle.getPlayer(0)).to.be.reverted;
								assert.equal(recentWinner.toString(), accounts[0].address);
								assert.equal(raffleState, 0);
								assert.equal(
									winnerEndingBalance.toString(),
									winnerStartingBalance.add(raffleEntranceFee).toString()
								);
								assert(endingTimeStamp > startingTimeStamp);
								resolve();
							} catch (error) {
								console.log(error);
								reject(e);
							}
						});
						// Then entering the raffle
						console.log("Entering raffle");
						const tx = await raffle.enterRaffle({ value: raffleEntranceFee });
						await tx.wait(1);
						console.log("Entered raffle!");
						const winnerStartingBalance = await accounts[0].getBalance();

						// and this code WON'T complete until our listener has finished listening!
					});

					// setup listener before we enter the raffle, just in case the blockchain moves REALLY fast
				});
			});
	  });
