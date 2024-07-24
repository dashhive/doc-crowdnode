(function (exports) {
  "use strict";

  let Dash = {};
  //@ts-ignore
  exports.DashApi = Dash;

  const SATOSHIS = 100000000;
  const FEE = 1000;

  //@ts-ignore
  let Dashcore = exports.dashcore || require("./dashcore-lit.js");
  let Transaction = Dashcore.Transaction;
  let PrivateKey = Dashcore.PrivateKey;

  Dash.create = function ({
    //@ts-ignore TODO
    insightApi,
  }) {
    let dashApi = {};

    /**
     * Instant Balance is accurate with Instant Send
     * @param {String} address
     * @returns {Promise<InstantBalance>}
     */
    dashApi.getInstantBalance = async function (address) {
      let body = await insightApi.getUtxos(address);
      let utxos = await getUtxos(body);
      let balance = utxos.reduce(function (total, utxo) {
        return total + utxo.satoshis;
      }, 0);
      // because 0.1 + 0.2 = 0.30000000000000004,
      // but we would only want 0.30000000
      let floatBalance = parseFloat((balance / SATOSHIS).toFixed(8));

      return {
        addrStr: address,
        balance: floatBalance,
        balanceSat: balance,
        _utxoCount: utxos.length,
        _utxoAmounts: utxos.map(function (utxo) {
          return utxo.satoshis;
        }),
      };
    };

    /**
     * Full Send!
     * @param {String} privKey
     * @param {String} pub
     */
    dashApi.createBalanceTransfer = async function (privKey, pub) {
      let pk = new PrivateKey(privKey);
      let changeAddr = (await pk.toPublicKey().toAddress()).toString();

      let body = await insightApi.getUtxos(changeAddr);
      let utxos = await getUtxos(body);
      let balance = utxos.reduce(function (total, utxo) {
        return total + utxo.satoshis;
      }, 0);

      //@ts-ignore - no input required, actually
      let tmpTx = new Transaction()
        //@ts-ignore - allows single value or array
        .from(utxos);
      tmpTx.to(pub, balance - 1000);
      await tmpTx.sign(pk);

      // TODO getsmartfeeestimate??
      // fee = 1duff/byte (2 chars hex is 1 byte)
      //       +10 to be safe (the tmpTx may be a few bytes off)
      let fee = 10 + tmpTx.toString().length / 2;

      //@ts-ignore - no input required, actually
      let tx = new Transaction()
        //@ts-ignore - allows single value or array
        .from(utxos);
      tx.to(pub, balance - fee);
      tx.fee(fee);
      await tx.sign(pk);

      return tx;
    };

    /**
     * Send with change back
     * @param {String} privKey
     * @param {String} payAddr
     * @param {Number} satoshis - base unit of DASH (a.k.a. "duffs")
     * @param {String} [changeAddr]
     */
    dashApi.createPayment = async function (
      privKey,
      payAddr,
      satoshis,
      changeAddr,
    ) {
      let pk = new PrivateKey(privKey);
      let utxoAddr = (await pk.toPublicKey().toAddress()).toString();
      if (!changeAddr) {
        changeAddr = utxoAddr;
      }

      // TODO make more accurate?
      let feePreEstimate = 1000;
      let utxos = await getOptimalUtxos(utxoAddr, satoshis + feePreEstimate);
      let balance = getBalance(utxos);

      if (!utxos.length) {
        throw new Error(`not enough funds available in utxos for ${utxoAddr}`);
      }

      // (estimate) don't send dust back as change
      if (balance - satoshis <= Transaction.DUST_AMOUNT + FEE) {
        satoshis = balance;
      }

      //@ts-ignore - no input required, actually
      let tmpTx = new Transaction()
        //@ts-ignore - allows single value or array
        .from(utxos);
      tmpTx.to(payAddr, satoshis);
      //@ts-ignore - the JSDoc is wrong in dashcore-lib/lib/transaction/transaction.js
      tmpTx.change(changeAddr);
      await tmpTx.sign(pk);

      // TODO getsmartfeeestimate??
      // fee = 1duff/byte (2 chars hex is 1 byte)
      //       +10 to be safe (the tmpTx may be a few bytes off - probably only 4 -
      //       due to how small numbers are encoded)
      let fee = 10 + tmpTx.toString().length / 2;

      // (adjusted) don't send dust back as change
      if (balance + -satoshis + -fee <= Transaction.DUST_AMOUNT) {
        satoshis = balance - fee;
      }

      //@ts-ignore - no input required, actually
      let tx = new Transaction()
        //@ts-ignore - allows single value or array
        .from(utxos);
      tx.to(payAddr, satoshis);
      tx.fee(fee);
      //@ts-ignore - see above
      tx.change(changeAddr);
      await tx.sign(pk);

      return tx;
    };

    // TODO make more optimal
    /**
     * @param {String} utxoAddr
     * @param {Number} totalSatoshis - including fee estimate
     */
    async function getOptimalUtxos(utxoAddr, totalSatoshis) {
      // get smallest coin larger than transaction
      // if that would create dust, donate it as tx fee
      let body = await insightApi.getUtxos(utxoAddr);
      let utxos = await getUtxos(body);
      let balance = getBalance(utxos);

      if (balance < totalSatoshis) {
        return [];
      }

      // from largest to smallest
      utxos.sort(function (a, b) {
        return b.satoshis - a.satoshis;
      });

      /** @type Array<CoreUtxo> */
      let included = [];
      let total = 0;

      // try to get just one
      utxos.every(function (utxo) {
        if (utxo.satoshis > totalSatoshis) {
          included[0] = utxo;
          total = utxo.satoshis;
          return true;
        }
        return false;
      });
      if (total) {
        return included;
      }

      // try to use as few coins as possible
      utxos.some(function (utxo) {
        included.push(utxo);
        total += utxo.satoshis;
        return total >= totalSatoshis;
      });
      return included;
    }

    /**
     * @param {Array<CoreUtxo>} utxos
     */
    function getBalance(utxos) {
      return utxos.reduce(function (total, utxo) {
        return total + utxo.satoshis;
      }, 0);
    }

    /**
     * @param {Array<InsightUtxo>} body
     * @returns {Promise<Array<CoreUtxo>>}
     */
    async function getUtxos(body) {
      /** @type Array<CoreUtxo> */
      let utxos = [];

      await body.reduce(async function (promise, utxo) {
        await promise;

        let data = await insightApi.getTx(utxo.txid);

        // TODO the ideal would be the smallest amount that is greater than the required amount

        let utxoIndex = -1;

        /**
         * @template {InsightTxVout} T
         * @param {T} vout
         * @param {Number} index
         * @returns {Boolean}
         */
        function findAndSetUtxoIndex(vout, index) {
          if (!vout.scriptPubKey?.addresses?.includes(utxo.address)) {
            return false;
          }

          let satoshis = Math.round(parseFloat(vout.value) * SATOSHIS);
          if (utxo.satoshis !== satoshis) {
            return false;
          }

          utxoIndex = index;
          return true;
        }

        data.vout.some(findAndSetUtxoIndex);

        // TODO test without txid
        utxos.push({
          txId: utxo.txid,
          outputIndex: utxoIndex,
          address: utxo.address,
          script: utxo.scriptPubKey,
          satoshis: utxo.satoshis,
        });
      }, Promise.resolve());

      return utxos;
    }

    return dashApi;
  };

  if ("undefined" !== typeof module) {
    module.exports = Dash;
  }
})(("undefined" !== typeof module && module.exports) || window);
