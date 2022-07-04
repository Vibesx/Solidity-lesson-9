const { run } = require("hardhat");

async function verify(contractAddress, args) {
    console.log("Verifying contract...");
    // this can fail if the contract is already verified so we add a try/catch
    try {
        // verify is the main task, second verify is a kind of subtask; there are multiple subtasks we can add here, more info on the github page of the etherscan plugin
        await run("verify:verify", {
            address: contractAddress,
            constructorArguments: args,
        });
    } catch (e) {
        if (e.message.toLowerCase().includes("already verified")) {
            console.log("Already Verified!");
        } else {
            console.log(e);
        }
    }
}

module.exports = { verify };
