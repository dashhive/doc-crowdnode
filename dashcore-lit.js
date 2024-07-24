(function (exports) {
  "use strict";

  let Dashcore = {};
  //@ts-ignore
  exports.dashcore = Dashcore;

  //@ts-ignore
  let Base58Check = exports.Base58Check || require("@dashincubator/base58check").Base58Check;
  //@ts-ignore
  let DashTx = exports.DashTx || require("dashtx");
  //@ts-ignore
  let Crypto = exports.crypto || require("./shims/crypto-node.js");
  //@ts-ignore
  let RIPEMD160 = exports.RIPEMD160 || require("@dashincubator/ripemd160");
  //@ts-ignore
  let Secp256k1 = exports.Secp256k1 || require("@dashincubator/secp256k1");

  let b58c = Base58Check.create({
    pubKeyHashVersion: "4c",
    privateKeyVersion: "cc",
  });

  let dashTx = DashTx.create({
    version: 3,
    /**
     * @param {String} addr
     * @returns {String}
     */
    addrToPubKeyHash: function (addr) {
      let b58c = Base58Check.create({
        pubKeyHashVersion: "4c",
        privateKeyVersion: "cc",
      });

      // XXX bad idea?
      // using .decode to avoid the async of .verify
      let parts = b58c.decode(addr);
      return parts.pubKeyHash;
    },
  });

  function Transaction() {
    //@ts-ignore
    return Dashcore.Transaction.create.apply(null, arguments);
  }
  Dashcore.Transaction = Transaction;

  // 193 + DashTx.OUTPUT_SIZE;
  Transaction.DUST_AMOUNT = 5460;

  Transaction.create = function () {
    let changeAddr = "";
    let fee = 0;
    let txInfo = {
      /** @type {Array<CoreUtxo>} */
      inputs: [],
      locktime: 0,
      /** @type {Array<import('dashtx').TxOutput>} */
      outputs: [],
      version: 3,
    };
    /** @type {import('dashtx').TxInfoSigned} */
    let txSigned;

    let coreTx = {};

    /**
     * @param {Array<CoreUtxo>} utxos
     */
    coreTx.from = function (utxos) {
      if (!Array.isArray(utxos)) {
        utxos = [utxos];
      }
      txInfo.inputs = txInfo.inputs.concat(utxos);
      return coreTx;
    };

    /**
     * @param {Array<import('dashtx').TxOutput>} payments
     * @param {Number} satoshis - base unit of DASH (a.k.a. "duffs")
     */
    coreTx.to = function (payments, satoshis) {
      if (!Array.isArray(payments)) {
        payments = [
          {
            address: payments,
            satoshis: satoshis,
          },
        ];
      }
      txInfo.outputs = txInfo.outputs.concat(payments);
      return coreTx;
    };

    /**
     * @param {Number} targetFee
     */
    coreTx.fee = function (targetFee) {
      fee = targetFee;

      return coreTx;
    };

    /**
     * @param {String} address
     */
    coreTx.change = function (address) {
      changeAddr = address;

      return coreTx;
    };

    /**
     * @param {Array<String|Uint8Array|ArrayBuffer|Buffer>} keys
     */
    coreTx.sign = async function (keys) {
      if (!Array.isArray(keys)) {
        keys = [keys];
      }

      let _txInfo = Object.assign({}, txInfo);
      let changeOutput = await coreTx._calculateFee();
      if (changeOutput) {
        _txInfo.outputs.push(changeOutput);
      }
      // @ts-ignore
      let _keys = await coreTx._mapKeysToUtxos(_txInfo, keys);
      console.log(_keys.length, _txInfo.inputs.length);
      txSigned = await dashTx.hashAndSignAll(_txInfo, _keys);
    };

    coreTx._calculateFee = async function () {
      let sats = txInfo.inputs.reduce(function (total, utxo) {
        return total + utxo.satoshis;
      }, 0);
      let paid = txInfo.outputs.reduce(function (total, payment) {
        return total + payment.satoshis;
      }, 0);

      let [minFee, maxFee] = DashTx.estimates(txInfo);
      let feeSpread = maxFee - minFee;
      let halfSpread = Math.ceil(feeSpread / 2);
      if (!fee) {
        fee = maxFee;
      }
      if (fee < minFee) {
        throw new Error(
          `your fees are too powerful: increase fee to at least ${minFee} (absolute possible minimum) + ${halfSpread} (to account for possible byte padding) + ${DashTx.OUTPUT_SIZE} (if you expect change back)`,
        );
      }

      let myMaxFee = Math.max(fee, maxFee);
      let change = sats + -paid + -myMaxFee;
      if (change <= Transaction.DUST_AMOUNT) {
        change = 0;
      }

      let changeFee = 0;
      /** @type {import('dashtx').TxOutput?} */
      let changeOutput = null;
      if (change) {
        if (!changeAddr) {
          let bigFee = fee + change;
          throw new Error(
            `you must provide 'change(addr)' to collect '${change}' sats or increase 'fee' to '${bigFee}'`,
          );
        }
        changeFee = DashTx.OUTPUT_SIZE;
        change -= changeFee;
        changeOutput = {
          address: changeAddr,
          satoshis: change,
        };
      }

      let total = paid + myMaxFee;
      if (total > sats) {
        let debt = sats - total;
        throw new Error(
          `your spending is too powerful: ${debt} = ${sats} (inputs) + -${paid} (outputs) + -${myMaxFee} (fee) + -${changeFee} (change fee)`,
        );
      }

      return changeOutput;
    };

    /**
     * @param {import('dashtx').TxInfo} _txInfo
     * @param {Array<String|Uint8Array|ArrayBuffer|Buffer>} keys
     */
    coreTx._mapKeysToUtxos = async function (_txInfo, keys) {
      /** @type {Array<Uint8Array>} */
      let utxoKeys = [];
      /** @type {Object.<String, Uint8Array>} */
      let keysMap = {};
      for (let key of keys) {
        let privInst = PrivateKeyFactory.create(key);
        let privBuf = privInst._toUint8Array();
        let pubInst = await privInst.toPublicKey();
        let addrInst = await pubInst.toAddress();
        console.log("DEBUG", addrInst._address, addrInst._pubKeyHash);
        keysMap[addrInst._address] = privBuf;
        keysMap[addrInst._pubKeyHash] = privBuf;
      }
      for (let input of _txInfo.inputs) {
        let index = input.address || input.pubKeyHash || "";
        let privBuf = keysMap[index];
        if (!privBuf) {
          let outStr = JSON.stringify(input);
          throw new Error(`missing private key for input: ${outStr}`);
        }
        utxoKeys.push(privBuf);
      }

      return utxoKeys;
    };

    coreTx.toString = function () {
      // TODO produce raw tx if not signed
      return txSigned.transaction;
    };

    coreTx.serialize = function () {
      // TODO run checks on fees and change and stuff
      return txSigned.transaction;
    };

    return coreTx;
  };

  /**
   * @typedef Address
   * @prop {String} _address
   * @prop {String} _pubKeyHash
   * @prop {ToString} toString
   */

  /**
   * @typedef PrivateKey
   * @prop {ToAddress} toAddress
   * @prop {ToPublicKey} toPublicKey
   * @prop {ToUint8Array} _toUint8Array
   */

  /**
   * @typedef {String|Uint8Array|ArrayBuffer|Buffer|PrivateKey} PrivateKeyish
   */

  /**
   * @typedef PublicKey
   * @prop {ToAddress} toAddress
   * @prop {ToUint8Array} _toUint8Array
   */

  /**
   * @callback ToAddress
   * @returns {Promise<Address>} - Payment Address (Public) instance object
   */

  /**
   * @callback ToPublicKey
   * @returns {PublicKey}
   */

  /**
   * @callback ToString
   * @returns {String} - payAddr (Public)
   */

  /**
   * @callback ToUint8Array
   * @returns {Uint8Array} - key bytes
   */

  /**
   * @callback ToWIF
   * @returns {Promise<String>} - wif (Private)
   */

  /**
   * @param {String|Uint8Array|ArrayBuffer|Buffer} wifHexOrBuf
   * @returns {PrivateKey}
   */
  function PrivateKeyFactory(wifHexOrBuf) {
    return PrivateKeyFactory.create(wifHexOrBuf);
  }
  Dashcore.PrivateKey = PrivateKeyFactory;

  /**
   * @param {String|Uint8Array|ArrayBuffer|Buffer} wifHexOrBuf
   * @returns {PrivateKey}
   */
  PrivateKeyFactory.create = function (wifHexOrBuf) {
    let pk = {};
    /** @type {Uint8Array} */
    let privBuf;
    if (!wifHexOrBuf) {
      privBuf = Secp256k1.utils.randomPrivateKey();
    }
    privBuf = PrivateKeyFactory.from(wifHexOrBuf);

    /** @type ToWIF */
    pk.toWIF = async function () {
      let wif = await privateKeyToWif(privBuf);
      return wif;
    };

    /** @type ToAddress */
    pk.toAddress = async function () {
      return await pk.toPublicKey().toAddress();
    };

    pk.toPublicKey = function () {
      let pubBuf = DashTx.utils.toPublicKey(privBuf);
      let pub = PublicKeyFactory.create(pubBuf);
      return pub;
    };

    pk._toUint8Array = function () {
      return privBuf;
    };

    return pk;
  };

  /**
   * @param {any} pk
   * @returns {pk is PrivateKey}
   */
  PrivateKeyFactory.isPrivateKey = function (pk) {
    return "function" === typeof pk._toUint8Array;
  };

  /**
   * @param {PrivateKeyish} wifHexOrBuf
   * @returns {Uint8Array}
   */
  PrivateKeyFactory.from = function (wifHexOrBuf) {
    let isPrivateKeyInst = PrivateKeyFactory.isPrivateKey(wifHexOrBuf);
    if (isPrivateKeyInst) {
      //@ts-ignore
      return wifHexOrBuf._toUint8Array();
    }

    if ("string" === typeof wifHexOrBuf) {
      if (64 === wifHexOrBuf.length) {
        return DashTx.utils.hexToU8(wifHexOrBuf);
      }
      if (52 === wifHexOrBuf.length) {
        return wifToPrivateKey(wifHexOrBuf);
      }
      throw new Error(
        "cannot create private key from non-hex, non-wif strings",
      );
    }

    //@ts-ignore
    if (wifHexOrBuf?.buffer) {
      //@ts-ignore
      return new Uint8Array(wifHexOrBuf.buffer);
    }
    //@ts-ignore
    if (wifHexOrBuf.byteLength) {
      //@ts-ignore
      return new Uint8Array(wifHexOrBuf);
    }
    throw new Error(
      "cannot create private key from non-string, non-buffer type",
    );
  };

  /**
   * @param {String|Uint8Array|ArrayBuffer|Buffer} hexOrBuf
   * @returns {PublicKey}
   */
  function PublicKeyFactory(hexOrBuf) {
    return PublicKeyFactory.create(hexOrBuf);
  }
  Dashcore.PublicKey = PublicKeyFactory;

  /**
   * @param {String|Uint8Array|ArrayBuffer|Buffer} hexOrBuf
   * @returns {PublicKey}
   */
  PublicKeyFactory.create = function (hexOrBuf) {
    let pubBuf = PublicKeyFactory.from(hexOrBuf);

    let pub = {};
    pub._pubKeyHash = "";
    pub._address = "";
    pub._buffer = pubBuf;

    /** @type ToAddress */
    pub.toAddress = async function () {
      pub._pubKeyHash = await hashPublicKey(pubBuf);
      pub._address = await pubKeyHashToAddr(pub._pubKeyHash);
      return {
        _pubKeyHash: pub._pubKeyHash,
        _address: pub._address,
        toString: function () {
          return pub._address;
        },
      };
    };
    pub._toUint8Array = function () {
      return pub._buffer;
    };

    return pub;
  };

  /**
   * @param {String|Uint8Array|ArrayBuffer|Buffer} hexOrBuf
   * @returns {Uint8Array}
   */
  PublicKeyFactory.from = function (hexOrBuf) {
    if ("string" === typeof hexOrBuf) {
      if (64 === hexOrBuf.length) {
        return DashTx.utils.hexToU8(hexOrBuf);
      }
      throw new Error("cannot create public key from non-hex strings");
    }

    //@ts-ignore
    if (hexOrBuf?.buffer) {
      //@ts-ignore
      return new Uint8Array(hexOrBuf.buffer);
    }
    if (hexOrBuf.byteLength) {
      return new Uint8Array(hexOrBuf);
    }
    throw new Error(
      "cannot create public key from non-string, non-buffer type",
    );
  };

  /**
   * @param {Uint8Array} pubBuf
   * @return {Promise<String>} - hex sha256 ripemd160 pubKeyHash
   */
  async function hashPublicKey(pubBuf) {
    let sha = await Crypto.subtle.digest("SHA-256", pubBuf);
    let shaU8 = new Uint8Array(sha);
    let ripemd = RIPEMD160.create();
    let hash = ripemd.update(shaU8);
    let pkh = hash.digest();
    // extra .toString() for tsc
    return pkh.toString();
  }

  /**
   * @param {Uint8Array} privBuf - Private Key as Uint8Array
   * @returns {Promise<String>} wif - Base58Check-encoded private key
   */
  async function privateKeyToWif(privBuf) {
    let privHex = DashTx.utils.u8ToHex(privBuf);
    let decoded = {
      privateKey: privHex,
    };

    let wif = await b58c.encode(decoded);
    return wif;
  }

  /**
   * @param {String} pubKeyHash - pkh hex
   * @returns {Promise<String>} addr - Base58Check-encoded payment address
   */
  async function pubKeyHashToAddr(pubKeyHash) {
    let addr = await b58c.encode({
      version: "4c",
      pubKeyHash: pubKeyHash,
    });
    return addr;
  }

  /**
   * @param {String} wif
   * @returns {Uint8Array}
   */
  function wifToPrivateKey(wif) {
    //let parts = await b58c.verify(wif);
    // TODO verifySync
    let parts = b58c.decode(wif);
    let privBuf = Buffer.from(parts.privateKey, "hex");
    return privBuf;
  }

  if ("undefined" !== typeof module) {
    module.exports = Dashcore;
  }
})(("undefined" !== typeof module && module.exports) || window);
