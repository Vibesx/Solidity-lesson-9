const { assert, expect } = require("chai");
const { getNamedAccounts, deployments, ethers, network } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");

!developmentChains.includes(network.name)
	? describe.skip
	: describe("Raffle Unit Tests", async function () {
			let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval;
			const chainId = network.config.chainId;

			beforeEach(async function () {
				deployer = (await getNamedAccounts()).deployer;
				await deployments.fixture(["all"]);
				raffle = await ethers.getContract("Raffle", deployer);
				vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer);
				raffleEntranceFee = await raffle.getEntranceFee();
				interval = await raffle.getInterval();
			});

			describe("contructor", function () {
				it("initializes the rafle correctly", async function () {
					// Ideally we make our tests have just 1 assert per "it"
					const raffleState = await raffle.getRaffleState();
					// although raffleState is an enum, it gets returned as uint256 and turned into a BigNumber (0 or 1) in javascript, so we need to stringify it
					assert.equal(raffleState.toString(), "0"); // 0 is OPEN 1 is CALCULATING
					assert.equal(interval.toString(), networkConfig[chainId]["interval"]);
				});
			});

			describe("enterRaffle", function () {
				it("reverts when you don't pay enough", async function () {
					await expect(raffle.enterRaffle()).to.be.revertedWith(
						"Raffle__NotEnoughETHEntered"
					);
				});
				it("records players when they enter", async function () {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					const playerFromContract = await raffle.getPlayer(0);
					assert.equal(playerFromContract, deployer);
				});
				it("emits event on enter", async function () {
					await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
						raffle,
						"RaffleEnter"
					);
				});
				it("doesn't allow entrance when raffle is calculating", async function () {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
					// equivalent to following: await network.provider.request({method: "evm_mine", params: []}); previous is faster
					await network.provider.send("evm_mine", []);
					// We pretend to be a chainlink Keeper
					await raffle.performUpkeep([]);
					await expect(
						raffle.enterRaffle({ value: raffleEntranceFee })
					).to.be.revertedWith("Raffle__NotOpen");
				});
			});
			describe("checkUpKeep", function () {
				it("returns false if people haven't sent any ETH", async function () {
					await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
					await network.provider.send("evm_mine", []);
					// callStatic simulates calling a transaction
					const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
					assert(!upkeepNeeded);
				});
				it("returns false if raffle isn't open", async function () {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
					await network.provider.send("evm_mine", []);
					// another way to pass a blank object is "0x"; so [] == "0x"
					await raffle.performUpkeep([]);
					const raffleState = await raffle.getRaffleState();
					const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x");
					assert.equal(raffleState.toString(), "1");
					assert.equal(upkeepNeeded, false);
				});
				it("returns false if enough time hasn't passed", async () => {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send("evm_increaseTime", [interval.toNumber() - 1]);
					await network.provider.request({ method: "evm_mine", params: [] });
					const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x");
					assert(!upkeepNeeded);
				});
				it("returns true if enough time has passed, has players, eth, and is open", async () => {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
					await network.provider.request({ method: "evm_mine", params: [] });
					const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x");
					assert(upkeepNeeded);
				});
			});
			describe("performUpkeep", function () {
				it("can only run if checkupkeep is true", async function () {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
					await network.provider.request({ method: "evm_mine", params: [] });
					const tx = await raffle.performUpkeep("0x");
					// if tx doesn't work or it causes an error, assert will fail
					assert(tx);
				});
				it("reverts when checkupkeep is false", async function () {
					// expect revert with error that has parameters; we can check just for the error and ignore params, or we can do as below
					await expect(raffle.performUpkeep([])).to.be.revertedWith(
						`Raffle__UpkeepNotNeeded(${await raffle.provider.getBalance(
							raffle.address
						)}, ${await raffle.getNumberOfPlayers()}, ${await raffle.getRaffleState()})`
					);
				});
				it("updates the raffle state, emits and event and calls the vrf cooridnator", async function () {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
					await network.provider.request({ method: "evm_mine", params: [] });
					const txResponse = await raffle.performUpkeep([]);
					const txReceipt = await txResponse.wait(1);
					// we will take the second event (index 1), as calling performUpkeep also calls requestRandomWords, which emits another event before ours, so that takes up index 0
					const requestId = txReceipt.events[1].args.requestId;
					const raffleState = await raffle.getRaffleState();
					assert(requestId.toNumber() > 0);
					assert(raffleState.toString() == "1");
				});
			});
			describe("fulfillRandomWords", function () {
				beforeEach(async function () {
					await raffle.enterRaffle({ value: raffleEntranceFee });
					await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
					await network.provider.request({ method: "evm_mine", params: [] });
				});
				it("can only be called after performUpkeep", async function () {
					// here we expect to revert on requestId's that don't exist (0 and 1); if we check VRFCoordinatorV2Mock.fulfillRandomWords we can see the revert
					await expect(
						vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
					).to.be.revertedWith("nonexistent request");
					await expect(
						vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
					).to.be.revertedWith("nonexistent request");
				});
				it("picks a winner, resets the lottery and sends money", async function () {
					const additionalEntrants = 3;
					const startingAccountIndex = 1; // we will take these additional entrants from hardhat, and there, first index is taken by deployer
					const accounts = await ethers.getSigners();
					for (
						let i = startingAccountIndex;
						i < startingAccountIndex + additionalEntrants;
						i++
					) {
						const accountConnectedRaffle = raffle.connect(accounts[i]);
						await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee });
					}
					const startingTimeStamp = await raffle.getLatestTimeStamp();

					await new Promise(async (resolve, reject) => {
						// once WinnerPicked event gets emitted, call function from 2nd param
						raffle.once("WinnerPicked", async () => {
							console.log("Found the event!");
							try {
								const recentWinner = await raffle.getRecentWinner();
								console.log(`Winner is: ${recentWinner}`);
								console.log(accounts[1].address);
								console.log(accounts[2].address);
								console.log(accounts[3].address);
								console.log(accounts[0].address);
								const raffleState = await raffle.getRaffleState();
								const endingTimeStamp = await raffle.getLatestTimeStamp();
								const numPlayers = await raffle.getNumberOfPlayers();
								const winnerEndingBalance = await accounts[1].getBalance();
								assert.equal(numPlayers.toString(), "0");
								assert.equal(raffleState.toString(), "0");
								assert(endingTimeStamp > startingTimeStamp);
								assert.equal(
									winnerEndingBalance.toString(),
									winnerStartingBalance.add(
										raffleEntranceFee
											.mul(additionalEntrants)
											.add(raffleEntranceFee)
											.toString()
									)
								);
							} catch (e) {
								reject(e);
							}
							resolve();
						});
						// the next code is executed inside the Promise as if it were executed outside, the event wouldn't know about the emitted event, hence the Pormise would never get resolved
						// we fire a transaction which will emit an event containing requestId, which we will use in fulfillRandomWords
						const tx = await raffle.performUpkeep([]);
						const txReceipt = await tx.wait(1);
						const winnerStartingBalance = await accounts[1].getBalance();
						await vrfCoordinatorV2Mock.fulfillRandomWords(
							txReceipt.events[1].args.requestId,
							raffle.address
						);
					});
				});
			});
	  });
