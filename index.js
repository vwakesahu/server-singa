const express = require("express");
const { ethers } = require("ethers");
require("dotenv").config();
const cors = require("cors");
const { encrypted300Value } = require("./encrypted300value");
const app = express();
const PORT = process.env.PORT || 8080;

// Load environment variables
const EDU_CHAIN_PROVIDER_URL = process.env.EDU_CHAIN_PROVIDER_URL;
const EDU_CHAIN_PRIVATE_KEY = process.env.EDU_CHAIN_PRIVATE_KEY;
const EDU_CHAIN_CONTRACT_ADDRESS =
  "0x8152E8af87bC7C08689eac6BD5FFfB4E31cD9700";

const INCO_PROVIDER_URL = process.env.INCO_PROVIDER_URL;
const INCO_PRIVATE_KEY = process.env.INCO_PRIVATE_KEY;
const INCO_CONTRACT_ADDRESS = "0xa44EE954cdDBD4e04663Fb436ACd1fcDC9c1DcC1";

const incoDomainId = 8008135;
const eduDomainId = 84532;

const INCO_ABI = require("./incoContractABI.json"); // Load the contract ABI
const EDU_ABI = require("./eduAbi.json"); // Load the contract ABI

app.use(cors());
app.use(express.json({ limit: "2mb" })); // Set limit to handle large payloads

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Setup provider and wallet for Sepolia
const eduProvider = new ethers.providers.JsonRpcProvider(
  EDU_CHAIN_PROVIDER_URL
);
const eduWallet = new ethers.Wallet(
  EDU_CHAIN_PRIVATE_KEY,
  eduProvider
);
const eduContract = new ethers.Contract(
  EDU_CHAIN_CONTRACT_ADDRESS,
  EDU_ABI,
  eduWallet
);

// Setup provider and wallet for Inco
const incoProvider = new ethers.providers.JsonRpcProvider(INCO_PROVIDER_URL);
const incoWallet = new ethers.Wallet(INCO_PRIVATE_KEY, incoProvider);
const incoContract = new ethers.Contract(
  INCO_CONTRACT_ADDRESS,
  INCO_ABI,
  incoWallet
);

// Event listener function for Sepolia
async function listenToEventsOnEduForDispatchProxy() {
  console.log("Listening for Dispatch events on EDU Chain...");
  eduContract.on(
    "DispatchProxy",
    async (destination, recipient, actualMessage, event) => {
      console.log(`Dispatch event detected on Sepolia:
            Destination: ${destination}
            Recipient: ${recipient}
            Message: ${actualMessage}`);
      // Convert recipient bytes32 to address
      actualRecipient = "0x" + recipient.substring(26, 66);
      try {
        // Call handle function on Inco
        const senderBytes = await ethers.utils.hexZeroPad(
          ethers.utils.hexlify(EDU_CHAIN_CONTRACT_ADDRESS),
          32
        );
        await callHandleOnInco(
          eduDomainId,
          senderBytes,
          actualRecipient,
          actualMessage
        );
      } catch (error) {
        console.error("Error processing Dispatch event on Sepolia:", error);
      }
    }
  );
}

// Event listener function for Inco
async function listenToEventsInco() {
  console.log("Listening for Dispatch events on Inco...");

  incoContract.on(
    "DispatchProxy",
    async (destination, recipient, actualMessage, event) => {
      console.log(`Dispatch event detected on Inco:
            Destination: ${destination}
            Recipient: ${recipient}
            Message: ${actualMessage}`);
      // Convert recipient bytes32 to address
      actualRecipient = "0x" + recipient.substring(26, 66);
      try {
        // Call handle function on Inco
        const senderBytes = await ethers.utils.hexZeroPad(
          ethers.utils.hexlify(INCO_CONTRACT_ADDRESS),
          32
        );
        await callHandleOnEdu(
          incoDomainId,
          senderBytes,
          actualRecipient,
          actualMessage
        );
      } catch (error) {
        console.error("Error processing Dispatch event on Sepolia:", error);
      }
    }
  );
}

// Function to call handle on Sepolia
async function callHandleOnEdu(
  origin,
  sender,
  recipientAddress,
  message
) {
  try {
    const contractToCall = new ethers.Contract(
      EDU_CHAIN_CONTRACT_ADDRESS,
      EDU_ABI,
      eduWallet
    );
    const tx = await contractToCall.handle(84532, sender, message, {
      gasLimit: ethers.BigNumber.from(20000000), // Adjust gas limit as needed
    });
    await tx.wait();
  } catch (error) {
    console.error("Error calling handle function on edu :", error);
  }
}

// Function to call handle on Inco
async function callHandleOnInco(origin, sender, recipientAddress, message) {
  try {
    const contractToCall = new ethers.Contract(
      INCO_CONTRACT_ADDRESS,
      INCO_ABI,
      incoWallet
    );
    const tx = await contractToCall.handle(origin, sender, message, {
      gasLimit: ethers.BigNumber.from(20000000), // Adjust gas limit as needed
    });
    await tx.wait();

    console.log(`handle function called on Inco with tx: ${tx.hash}`);
  } catch (error) {
    console.error("Error calling handle function on Inco:", error);
  }
}

// Route to handle post request from frontend
app.post("/distribute-funds", async (req, res) => {
  console.log("hit");
  const { user, userAddress1, userAddresses2, userAddresses3, encryptedData } =
    req.body;
  console.log(user, userAddress1, userAddresses2, userAddresses3);
  if (
    !user ||
    !userAddress1 ||
    !userAddresses2 ||
    !userAddresses3 ||
    !encryptedData
  ) {
    return res.status(400).send("Invalid input");
  }

  try {
    await settleDispatchDistributionOfFunds(
      user,
      [userAddress1, userAddresses2, userAddresses3]
    );
    res.status(200).send("Funds distributed successfully");
  } catch (error) {
    console.error("Error in /distribute-funds route:", error);
    res.status(500).send("Error distributing funds");
  }
});

// Function to call distributeFunds on Inco
async function settleDispatchDistributionOfFunds(
  user,
  userAddresses,
  encryptedData
) {
  try {
    const contractToCall = new ethers.Contract(
      INCO_CONTRACT_ADDRESS,
      INCO_ABI,
      incoWallet
    );
    // Convert the values to BigNumber to ensure correct handling
    const maxBaseFee = ethers.BigNumber.from("3000000000");
    const maxPriorityFee = ethers.BigNumber.from("3000000000");
    const gasLimit = ethers.BigNumber.from("30000000"); // 30 million gas

    // Construct overrides with gasLimit, maxFeePerGas (optional if using EIP-1559)
    const overrides = {
      gasLimit: gasLimit, // 30 million gas
      maxFeePerGas: maxBaseFee.add(maxPriorityFee), // maxFeePerGas should be maxBaseFee + maxPriorityFee
    };
    const tx = await contractToCall.distributeFunds(
      user,
      userAddresses,
      overrides
    );

    await tx.wait();

    console.log(`distributeFunds function called on Inco with tx: ${tx.hash}`);
  } catch (error) {
    console.error("Error calling distributeFunds function on Inco:", error);
  }
}

// Event listener function for Inco
async function listenToDispatchWithdrawFunds() {
  console.log("Listening for WithdrawFunds events on Edu ...");

  eduContract.on("DispatchWithdrawFunds", async (user) => {
    console.log(`Dispatch event detected on Base Sepolia:
            user: ${user}`);
    try {
      await settleDispatchWithdrawOfFunds(user);
    } catch (error) {
      console.error("Error processing Dispatch event on Sepolia:", error);
    }
  });
}

// Function to call handle on Inco
async function settleDispatchWithdrawOfFunds(user) {
  try {
    const contractToCall = new ethers.Contract(
      INCO_CONTRACT_ADDRESS,
      INCO_ABI,
      incoWallet
    );
    const tx = await contractToCall.withdrawFunds(user);
    await tx.wait();

    console.log(`handle function called on Inco with tx: ${tx.hash}`);
  } catch (error) {
    console.error("Error calling handle function on Inco:", error);
  }
}

// Start the Express server
const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  // Start listening to events on both chains
  listenToEventsOnEduForDispatchProxy().catch(console.error);
  listenToEventsInco().catch(console.error);
  listenToDispatchWithdrawFunds().catch(console.error);
});

server.on("error", (error) => {
  console.error("Server error:", error);
});
