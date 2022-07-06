// named 99 because we always want it to be the last one that runs

const { ethers, network } = require("hardhat");
const fs = require("fs");

const FRONTEND_ADDRESSES_FILE =
	"../nextjs-smartcontract-lottery-fcc/constants/contractAddresses.json";
const FRONTEND_ABI_FILE = "../nextjs-smartcontract-lottery-fcc/constants/abi.json";

module.exports = async function () {
	if (process.env.UPDATE_FRONTEND) {
		console.log("Updating frontend...");
		updateContractAddresses();
		updateAbi();
	}
};

async function updateContractAddresses() {
	const raffle = await ethers.getContract("Raffle");
	const chainId = network.config.chainId.toString();
	const contractAddresses = JSON.parse(fs.readFileSync(FRONTEND_ADDRESSES_FILE, "utf8"));
	if (chainId in contractAddresses) {
		if (!contractAddresses[chainId].includes(raffle.address)) {
			contractAddresses[chainId].push(raffle.address);
		}
	} else {
		contractAddresses[chainId] = [raffle.address];
	}
	fs.writeFileSync(FRONTEND_ADDRESSES_FILE, JSON.stringify(contractAddresses));
}

async function updateAbi() {
	const raffle = await ethers.getContract("Raffle");
	// ethers.utils.FormatTypes.json formats it to abi
	fs.writeFileSync(FRONTEND_ABI_FILE, raffle.interface.format(ethers.utils.FormatTypes.json));
}

module.exports.tags = ["add", "frontend"];
