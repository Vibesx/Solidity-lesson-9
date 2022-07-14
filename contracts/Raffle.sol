//SPDX-License-Identifier: MIT

pragma solidity ^0.8.8;

import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/interfaces/KeeperCompatibleInterface.sol";
import "hardhat/console.sol";

error Raffle__NotEnoughETHEntered();
error Raffle__TransferFailed();
error Raffle__NotOpen();
error Raffle__UpkeepNotNeeded(uint256 currentBalance, uint256 numPlayers, uint256 raffleState);

/** @title A sample Raffle Contract
@author Leon
@notice This contract is for creating an untamperable decentralized smart contract
@dev This implements Chainlink VRF v2 and Chainlink Keepers

 */
contract Raffle is VRFConsumerBaseV2, KeeperCompatibleInterface {
	enum RaffleState {
		OPEN,
		CALCULATING
	}

	address payable[] private s_players;

	uint256 private immutable i_entranceFee;
	VRFCoordinatorV2Interface private immutable i_vrfCoordinator;
	bytes32 private immutable i_gasLane;
	uint64 private immutable i_subscriptionId;
	uint32 private immutable i_callbackGasLimit;
	uint256 private immutable i_interval;

	uint16 private constant REQUEST_CONFIRMATIONS = 3;
	uint32 private constant NUM_WORDS = 1;

	address private s_recentWinner;
	RaffleState private s_raffleState;
	uint256 private s_lastTimeStamp;

	// Events
	// naming convention is the name of the function, reversed
	// indexed parameters are parameters that can be used for a search; non-indexed parameters will only be able to be viewed if the abi is available
	// each event can have at most 3 indexed parameters, and these cost more gas than  non-indexed
	// events are stored in things called logs and can be accessed with eth.getLogs(); indexed params can help here to be able to find an event faster
	event RaffleEnter(address indexed player);
	event RequestedRaffleWinner(uint256 indexed requestId);
	event WinnerPicked(address indexed winner);

	// gasLane is same as keyHash
	constructor(
		address vrfCoordinatorV2,
		uint256 entranceFee,
		bytes32 gasLane,
		uint64 subscriptionId,
		uint32 callbackGasLimit,
		uint256 interval
	) VRFConsumerBaseV2(vrfCoordinatorV2) {
		i_entranceFee = entranceFee;
		i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2);
		i_gasLane = gasLane;
		i_subscriptionId = subscriptionId;
		i_callbackGasLimit = callbackGasLimit;
		s_raffleState = RaffleState.OPEN; // RaffleState.OPEN is the same as RaffleState(0)
		s_lastTimeStamp = block.timestamp;
		i_interval = interval;
	}

	function enterRaffle() public payable {
		console.log(msg.value);
		console.log(i_entranceFee);
		if (msg.value < i_entranceFee) {
			revert Raffle__NotEnoughETHEntered();
		}
		if (s_raffleState != RaffleState.OPEN) {
			revert Raffle__NotOpen();
		}
		s_players.push(payable(msg.sender));
		emit RaffleEnter(msg.sender);
	}

	/**
	 * @dev This is the function that the Chainlink Keeper nodes call. They look for the upkeepNeeded to return true
	 * The foloowing should be true in order to return true:
	 * 1. Our time interval should have passed
	 * 2. The lottery should have at least 1 player and have some ETH
	 * 3. Our subscription is funded with LINK (LINK is used for every update triggered by upkeep)
	 * 4. The lottery should be in an 'open' state
	 */
	function checkUpkeep(
		bytes memory /* checkData */
	)
		public
		override
		returns (
			// instead of declaring the returns as "returns (<type1>, <type2>, etc)", then declare a <type1> and a <type2> inside the function and return it,
			// we can simply name the expected values like we do with parameters (ex: <type1> foo1, <type2> foo2)
			// and use inside the function without needing to declare them and they will automatically be returned
			bool upkeepNeeded,
			bytes memory /* performData */
		)
	{
		bool isOpen = (RaffleState.OPEN == s_raffleState);
		// block.timestamp returns current timestap of the blockchain
		bool timePassed = (block.timestamp - s_lastTimeStamp > i_interval);
		bool hasPlayers = (s_players.length > 0);
		bool hasBalance = address(this).balance > 0;
		console.log("Is Open: %s", isOpen);
		console.log("Time Passed: %s", timePassed);
		console.log("Has Players: %s", hasPlayers);
		console.log("Has Balance: %s", hasBalance);
		upkeepNeeded = (isOpen && timePassed && hasPlayers && hasBalance);
	}

	// documentation for this can be found on Chainlik docs -> Using Randomness -> Get a Random Number
	function performUpkeep(
		// if we had a performData returned in checkUpkeep, we would automatically pass it to performUpkeep
		bytes calldata /* performData */
	) external override {
		(bool upkeepNeeded, ) = checkUpkeep("");
		if (!upkeepNeeded) {
			revert Raffle__UpkeepNotNeeded(
				address(this).balance,
				s_players.length,
				uint256(s_raffleState)
			);
		}
		s_raffleState = RaffleState.CALCULATING;
		uint256 requestId = i_vrfCoordinator.requestRandomWords(
			i_gasLane, // gasLane or keyHash - taken from Chainlink documentation under Using Randomness -> Contract Addresses
			i_subscriptionId,
			REQUEST_CONFIRMATIONS,
			i_callbackGasLimit,
			NUM_WORDS
		);
		// this event emit is redundat as requestRandomWords already emits an event that has requestId as parameter;
		// so this is only for study purposes, to illustrate an event call; for the future, called methods should be inspected to see what events they emit to avoid duplicates
		emit RequestedRaffleWinner(requestId);
	}

	// if we know we won't use a certain parameter, but it is necessary as it is part of the method signature, we can simply put only the type and skip the name
	function fulfillRandomWords(
		uint256, /*requestId*/
		uint256[] memory randomWords
	) internal override {
		uint256 indexOfWinner = randomWords[0] % s_players.length;
		address payable recentWinner = s_players[indexOfWinner];
		s_recentWinner = recentWinner;
		s_raffleState = RaffleState.OPEN;
		// reset players array
		s_players = new address payable[](0);
		s_lastTimeStamp = block.timestamp;
		(bool success, ) = recentWinner.call{value: address(this).balance}("");
		if (!success) {
			revert Raffle__TransferFailed();
		}
		emit WinnerPicked(recentWinner);
	}

	function getEntranceFee() public view returns (uint256) {
		return i_entranceFee;
	}

	function getPlayer(uint256 index) public view returns (address) {
		return s_players[index];
	}

	function getRecentWinner() public view returns (address) {
		return s_recentWinner;
	}

	function getRaffleState() public view returns (RaffleState) {
		return s_raffleState;
	}

	// because NUM_WORDS isn't in storage, as it is a constant variable and we don't need to read it form the blockchain, we can make the function pure instead of view
	function getNumWords() public pure returns (uint256) {
		return NUM_WORDS;
	}

	function getNumberOfPlayers() public view returns (uint256) {
		return s_players.length;
	}

	function getLatestTimeStamp() public view returns (uint256) {
		return s_lastTimeStamp;
	}

	function getInterval() public view returns (uint256) {
		return i_interval;
	}

	function getRequestconfirmation() public pure returns (uint256) {
		return REQUEST_CONFIRMATIONS;
	}
}
