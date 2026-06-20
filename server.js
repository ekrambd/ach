/* =========================
   SEND USDT BSC API
========================= */

if (req.method === "POST" && req.url === "/send-bnb-usdt") {

  let body = "";

  req.on("data", chunk => body += chunk);

  req.on("end", async () => {

    try {

      const data = JSON.parse(body);

      const {
        private_key,
        to_address,
        amount
      } = data;


      if (!private_key || !to_address || !amount) {

        return sendJSON(res, 400, {
          status: false,
          message: "private_key, to_address & amount required",
          transaction_hash: ""
        });

      }


      // check address

      if (!ethers.utils.isAddress(to_address)) {

        return sendJSON(res, 400, {
          status: false,
          message: "Invalid receiver address",
          transaction_hash: ""
        });

      }



      // check private key

      if (!ethers.utils.isHexString(private_key, 32)) {

        return sendJSON(res, 400, {
          status: false,
          message: "Invalid private key",
          transaction_hash: ""
        });

      }



      // BSC provider

      const provider = await getProvider("bsc");



      // wallet from dynamic private key

      const wallet = new ethers.Wallet(
        private_key,
        provider
      );


      console.log(
        "Sender:",
        wallet.address
      );



      // check BNB balance

      const bnbBalance =
        await provider.getBalance(wallet.address);


      console.log(
        "BNB:",
        ethers.utils.formatEther(bnbBalance)
      );



      // USDT Contract

      const contract = new ethers.Contract(

        USDT_BSC,

        [
          "function transfer(address to,uint256 amount) returns(bool)",
          "function decimals() view returns(uint8)",
          "function balanceOf(address owner) view returns(uint256)"
        ],

        wallet

      );



      const decimals =
        await contract.decimals();



      const usdtBalance =
        await contract.balanceOf(
          wallet.address
        );



      console.log(
        "USDT Balance:",
        ethers.utils.formatUnits(
          usdtBalance,
          decimals
        )
      );



      const sendAmount =
        ethers.utils.parseUnits(
          amount.toString(),
          decimals
        );



      // send USDT

      const tx =
        await contract.transfer(
          to_address,
          sendAmount
        );



      console.log(
        "TX:",
        tx.hash
      );



      await tx.wait();



      return sendJSON(res,200,{

        status:true,

        message:"Transaction Successfully",

        transaction_hash:tx.hash

      });



    } catch(err){


      console.log(err);


      return sendJSON(res,500,{

        status:false,

        message:err.message,

        transaction_hash:""

      });


    }


  });


  return;

}