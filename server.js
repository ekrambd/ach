const http = require("http");
const { ethers } = require("ethers");

/* =========================
   NETWORK CONFIG
========================= */
const NETWORK_CONFIG = {
  ethereum: {
    name: "homestead",
    chainId: 1,
    rpcs: [
      "https://ethereum-rpc.publicnode.com",
      "https://rpc.ankr.com/eth"
    ]
  },
  bsc: {
    name: "bsc",
    chainId: 56,
    rpcs: [
      "https://bsc-dataseed.binance.org",
      "https://rpc.ankr.com/bsc"
    ]
  },
  polygon: {
    name: "polygon",
    chainId: 137,
    rpcs: [
      "https://polygon-rpc.com",
      "https://rpc.ankr.com/polygon"
    ]
  }
};

/* =========================
   ERC20 ABI (CHECK TX)
========================= */
const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

/* =========================
   USDT BSC CONFIG (SEND)
========================= */
const USDT_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)"
];

const USDT_BSC = "0x55d398326f99059fF775485246999027B3197955";

/* =========================
   WALLET (IMPORTANT)
========================= */
const PRIVATE_KEY = "0x0c27d403335aac85b32e748227e91809abd71297bfdbb779b640ff68de3cf05c"; // ⚠️ move to .env in production

/* =========================
   CACHE
========================= */
const decimalsCache = {};

/* =========================
   HELPER
========================= */
function sendJSON(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/* =========================
   RPC PROVIDER
========================= */
async function getProvider(network) {
  const cfg = NETWORK_CONFIG[network];

  for (const rpc of cfg.rpcs) {
    try {
      const provider = new ethers.providers.StaticJsonRpcProvider(rpc, {
        chainId: cfg.chainId,
        name: cfg.name
      });

      await provider.getBlockNumber();
      return provider;
    } catch (err) {
      console.log(`RPC failed: ${rpc}`);
    }
  }

  throw new Error("All RPCs failed");
}

/* =========================
   SERVER
========================= */
const server = http.createServer(async (req, res) => {

  /* =========================
     1. CHECK TRANSACTION API
  ========================= */
  if (req.method === "POST" && req.url === "/check-tx") {

    let body = "";
    req.on("data", chunk => body += chunk);

    req.on("end", async () => {
      try {

        if (!body.trim()) {
          return sendJSON(res, 400, {
            status: false,
            message: "Empty body",
            data: {}
          });
        }

        let data;
        try {
          data = JSON.parse(body);
        } catch {
          return sendJSON(res, 400, {
            status: false,
            message: "Invalid JSON",
            data: {}
          });
        }

        const required = ["transaction_hash", "from_timestamp", "to_timestamp", "to_address"];

        for (const f of required) {
          if (!data[f]) {
            return sendJSON(res, 400, {
              status: false,
              message: `${f} is required`,
              data: {}
            });
          }
        }

        const { transaction_hash, from_timestamp, to_timestamp, to_address } = data;
        const network = (data.network || "ethereum").toLowerCase();

        if (!NETWORK_CONFIG[network]) {
          return sendJSON(res, 400, {
            status: false,
            message: "Invalid network",
            data: {}
          });
        }

        const provider = await getProvider(network);

        const tx = await provider.getTransaction(transaction_hash);

        if (!tx) {
          return sendJSON(res, 404, {
            status: false,
            message: "Transaction not found",
            data: {}
          });
        }

        // native transfer
        if (!tx.value.isZero()) {
          return sendJSON(res, 200, {
            status: true,
            message: "Direct native token transfer detected",
            data: {
              network,
              from: tx.from,
              to: tx.to,
              amount: ethers.utils.formatEther(tx.value),
              tx_hash: transaction_hash,
              timestamp: Math.floor(Date.now() / 1000),
              status: "success"
            }
          });
        }

        const receipt = await provider.getTransactionReceipt(transaction_hash);

        if (!receipt) {
          return sendJSON(res, 404, {
            status: false,
            message: "Receipt not found",
            data: {}
          });
        }

        const block = await provider.getBlock(receipt.blockNumber);
        const txTimestamp = block.timestamp;

        if (
          txTimestamp < Number(from_timestamp) ||
          txTimestamp > Number(to_timestamp)
        ) {
          return sendJSON(res, 200, {
            status: false,
            message: "Transaction timestamp out of range",
            data: {}
          });
        }

        const iface = new ethers.utils.Interface(ERC20_ABI);

        let found = false;
        let finalData = {};

        for (const log of receipt.logs) {
          try {
            const parsed = iface.parseLog(log);

            if (parsed.args.to.toLowerCase() !== to_address.toLowerCase()) continue;

            let decimals = decimalsCache[log.address];

            if (!decimals) {
              const token = new ethers.Contract(log.address, ERC20_ABI, provider);
              decimals = await token.decimals();
              decimalsCache[log.address] = decimals;
            }

            const amount = ethers.utils.formatUnits(parsed.args.value, decimals);

            finalData = {
              network,
              contract_address: log.address,
              from: parsed.args.from,
              to: parsed.args.to,
              amount,
              tx_hash: transaction_hash,
              timestamp: txTimestamp,
              status: "success"
            };

            found = true;
            break;

          } catch {}
        }

        if (!found) {
          return sendJSON(res, 404, {
            status: false,
            message: "No matching ERC20 transfer found",
            data: {}
          });
        }

        return sendJSON(res, 200, {
          status: true,
          message: "Transaction valid",
          data: finalData
        });

      } catch (err) {
        return sendJSON(res, 500, {
          status: false,
          message: err.message,
          data: {}
        });
      }
    });

    return;
  }

  /* =========================
     2. SEND USDT BSC API
  ========================= */
  if (req.method === "POST" && req.url === "/send-bnb-usdt") {

    let body = "";

    req.on("data", chunk => body += chunk);

    req.on("end", async () => {
      try {

        const data = JSON.parse(body);

        const { to_address, amount } = data;

        if (!to_address || !amount) {
          return sendJSON(res, 400, {
            status: false,
            message: "to_address & amount required",
            transaction_hash: ""
          });
        }

        const provider = await getProvider("bsc");

        const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

        const contract = new ethers.Contract(
          USDT_BSC,
          USDT_ABI,
          wallet
        );

        const value = ethers.utils.parseUnits(amount.toString(), 18);

        const tx = await contract.transfer(to_address, value);

        await tx.wait();

        return sendJSON(res, 200, {
          status: true,
          message: "Transaction Successfully",
          transaction_hash: tx.hash
        });

      } catch (err) {
        return sendJSON(res, 500, {
          status: false,
          message: "Something Went Wrong",
          transaction_hash: ""
        });
      }
    });

    return;
  }

  /* =========================
     DEFAULT
  ========================= */
  sendJSON(res, 404, {
    status: false,
    message: "Not Found",
    data: {}
  });
});

/* =========================
   START SERVER
========================= */
server.listen(3000, () => {
  console.log("🚀 Full API running on port 3000");
});