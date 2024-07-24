/**
 * @typedef {Object} CoreUtxo
 * @property {String} txId
 * @property {Number} outputIndex
 * @property {String} address
 * @property {String} script
 * @property {Number} satoshis
 */

/**
 * @typedef {Object} InsightUtxo
 * @property {String} address
 * @property {String} txid
 * @property {Number} vout
 * @property {String} scriptPubKey
 * @property {Number} amount
 * @property {Number} satoshis
 * @property {Number} height
 * @property {Number} confirmations
 */

/**
 * @typedef {Object} SocketIoConnect
 * @property {String} sid
 * @property {Array<String>} upgrades
 * @property {Number} pingInterval
 * @property {Number} pingTimeout
 */

/**
 * @typedef {[InsightSocketEventName, InsightSocketEventData]} InsightPush
 */

/**
 * @typedef {String} InsightSocketEventName
 */

/**
 * @typedef {String} Base58CheckAddr
 */

/**
 * @typedef InstantBalance
 * @property {String} addrStr
 * @property {Number} balance
 * @property {Number} balanceSat
 * @property {Number} _utxoCount
 * @property {Array<Number>} _utxoAmounts
 */

/**
 * @typedef InsightBalance
 * @property {String} addrStr
 * @property {Number} balance
 * @property {Number} balanceSat
 * @property {Number} totalReceived
 * @property {Number} totalReceivedSat
 * @property {Number} totalSent
 * @property {Number} totalSentSat
 * @property {Number} unconfirmedBalance
 * @property {Number} unconfirmedBalanceSat
 * @property {Number} unconfirmedAppearances
 * @property {Number} txAppearances
 */

/**
 * @typedef {Object} InsightSocketEventData
 * @property {String} txid - hex
 * @property {Number} valueOut - float
 * @property {Array<Record<Base58CheckAddr, Number>>} vout - addr and satoshis
 * @property {Boolean} isRBF
 * @property {Boolean} txlock
 *
 * @example
 *   {
 *     txid: 'd2cc7cb8e8d2149f8c4475aee6797b4732eab020f8eb24e8912d0054787b0966',
 *     valueOut: 0.00099775,
 *     vout: [
 *       { XcacUoyPYLokA1fZjc9ZfpV7hvALrDrERA: 40000 },
 *       { Xo6M4MxnHWzrksja6JnFjHuSa35SMLQ9J3: 59775 }
 *     ],
 *     isRBF: false,
 *     txlock: true
 *   }
 */

/**
 * @typedef {Object} InsightTxResponse
 * @property {Number} pagesTotal
 * @property {Array<InsightTx>} txs
 */

/**
 * @typedef {Object} InsightTx
 * @property {Number} confirmations
 * @property {Number} time
 * @property {Boolean} txlock
 * @property {Number} version
 * @property {Array<InsightTxVin>} vin
 * @property {Array<InsightTxVout>} vout
 */

/**
 * @typedef {Object} InsightTxVin
 * @property {String} addr
 */

/**
 * @typedef {Object} InsightTxVout
 * @property {String} value
 * @property {Object} scriptPubKey
 * @property {Array<String>} scriptPubKey.addresses
 */

/**
 * @typedef {Object} SocketPayment
 * @property {String} address - base58check pay-to address
 * @property {Number} satoshis - duffs, duh
 * @property {Number} timestamp - in milliseconds since epoch
 * @property {String} txid - in hex
 * @property {Boolean} txlock
 */

/**
 * @typedef {Object} CrowdNodeBalance
 * @property {String} DashAddress - base58check
 * @property {Number} TotalBalance - float, on hot or cold wallet
 * @property {Number} TotalActiveBalance - float, on cold wallet
 * @property {Number} TotalDividend - staking interest earned
 * @property {String} UpdatedOn - ISO timestamp
 * @property {Number} UpdateOnUnixTime - seconds since Unix epoch
 */

/**
 * @typedef {Object} CookieStore
 * @property {CookieStoreSet} set
 * @property {CookieStoreGet} get
 */

/**
 * @typedef {Function} CookieStoreSet
 * @param {String} url
 * @param {import('http').IncomingMessage} resp
 * @returns {Promise<void>}
 */

/**
 * @typedef {Function} CookieStoreGet
 * @param {String} url
 * @returns {Promise<String>}
 */
