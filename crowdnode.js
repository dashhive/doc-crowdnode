(function (_exports) {
  "use strict";

  /** @type {any} exports */
  let exports = _exports;

  let request = exports.urequest || require("./lib/request.js");

  let CrowdNode = {};
  exports.CrowdNode = CrowdNode;

  const SATOSHIS = 100000000;

  let Dash = exports.DashApi || require("./dashapi.js");
  let Dashcore = exports.dashcore || require("./dashcore-lit.js");
  let DashSight = exports.DashSight || require("dashsight");
  let Ws = exports.DashSocket || require("dashsight/ws");

  CrowdNode._initialized = false;
  CrowdNode._dashsocketBaseUrl = "";
  // TODO don't require these shims
  CrowdNode._insightApi = DashSight.create({
    dashsightBaseUrl: "",
    dashsocketBaseUrl: "",
    insightBaseUrl: "",
  });
  CrowdNode._dashApi = Dash.create({ insightApi: CrowdNode._insightApi });

  CrowdNode.main = {
    baseUrl: "https://app.crowdnode.io",

    // See https://knowledge.crowdnode.io/en/articles/5963880-blockchain-api-guide
    // TODO https://app.crowdnode.io/odata/apifundings/HotWallet
    hotwallet: "XjbaGWaGnvEtuQAUoBgDxJWe8ZNv45upG2",
  };

  CrowdNode.test = {
    baseUrl: "https://test.crowdnode.io",
    // See https://knowledge.crowdnode.io/en/articles/5963880-blockchain-api-guide
    // TODO https://test.crowdnode.io/odata/apifundings/HotWallet
    hotwallet: "yMY5bqWcknGy5xYBHSsh2xvHZiJsRucjuy",
  };

  CrowdNode._baseUrl = CrowdNode.main.baseUrl;

  CrowdNode.offset = 20000;
  CrowdNode.duffs = 100000000;
  CrowdNode.satoshis = 100000000;
  CrowdNode.depositMinimum = 100000;
  CrowdNode.stakeMinimum = toSatoshis(0.5);

  /**
   * @type {Record<String, Number>}
   */
  CrowdNode.requests = {
    acceptTerms: 65536,
    offset: 20000,
    signupForApi: 131072,
    toggleInstantPayout: 4096,
    withdrawMin: 1,
    withdrawMax: 1000,
  };

  /**
   * @type {Record<Number, String>}
   */
  CrowdNode._responses = {
    2: "PleaseAcceptTerms",
    4: "WelcomeToCrowdNodeBlockChainAPI",
    8: "DepositReceived",
    16: "WithdrawalQueued",
    32: "WithdrawalFailed", // Most likely too small amount requested for withdraw.
    64: "AutoWithdrawalEnabled",
    128: "AutoWithdrawalDisabled",
  };
  /**
   * @type {Record<String, Number>}
   */
  CrowdNode.responses = {
    PleaseAcceptTerms: 2,
    WelcomeToCrowdNodeBlockChainAPI: 4,
    DepositReceived: 8,
    WithdrawalQueued: 16,
    WithdrawalFailed: 32,
    AutoWithdrawalEnabled: 64,
    AutoWithdrawalDisabled: 128,
  };

  /**
   * @param {Object} opts
   * @param {String} opts.baseUrl
   * @param {String} opts.dashsightBaseUrl - typically ends with /insight-api
   * @param {String} opts.dashsocketBaseUrl - typically ends with /socket.io
   * @param {String} opts.insightBaseUrl - typically ends with /insight-api
   */
  CrowdNode.init = async function ({
    baseUrl,
    dashsightBaseUrl,
    dashsocketBaseUrl,
    insightBaseUrl,
  }) {
    // TODO use API
    // See https://github.com/dashhive/crowdnode.js/issues/3

    CrowdNode._baseUrl = baseUrl;

    if ("https://insight.dash.org" === insightBaseUrl) {
      insightBaseUrl = "https://insight.dash.org/insight-api";
      if (!dashsocketBaseUrl) {
        dashsocketBaseUrl = "https://insight.dash.org/socket.io";
      }
      if (!dashsightBaseUrl) {
        dashsightBaseUrl = "https://dashsight.dashincubator.dev/insight-api";
      }
    }
    CrowdNode._dashsocketBaseUrl = dashsocketBaseUrl;
    CrowdNode._insightApi = DashSight.create({
      dashsightBaseUrl: dashsightBaseUrl,
      dashsocketBaseUrl: dashsocketBaseUrl,
      insightBaseUrl: insightBaseUrl,
    });
    CrowdNode._dashApi = Dash.create({ insightApi: CrowdNode._insightApi });
    CrowdNode._initialized = true;
  };

  /**
   * @param {String} signupAddr
   * @param {String} hotwallet
   */
  CrowdNode.status = async function (signupAddr, hotwallet) {
    let maxPages = 10;
    let data = await CrowdNode._insightApi.getTxs(signupAddr, maxPages);
    let status = {
      signup: 0,
      accept: 0,
      deposit: 0,
    };

    data.txs.forEach(
      /** @param {InsightTx} tx */
      function (tx) {
        // all inputs (utxos) must come from hotwallet
        let fromHotwallet = tx.vin.every(function (vin) {
          return vin.addr === hotwallet;
        });
        if (!fromHotwallet) {
          return;
        }

        // must have one output matching the "welcome" value to the signupAddr
        tx.vout.forEach(function (vout) {
          if (vout.scriptPubKey.addresses[0] !== signupAddr) {
            return;
          }
          let sats = Math.round(parseFloat(vout.value) * SATOSHIS);
          let msg = sats - CrowdNode.offset;

          if (CrowdNode.responses.DepositReceived === msg) {
            status.deposit = tx.time;
            status.signup = status.signup || 1;
            status.accept = status.accept || 1;
            return;
          }

          if (CrowdNode.responses.WelcomeToCrowdNodeBlockChainAPI === msg) {
            status.signup = status.signup || 1;
            status.accept = tx.time || 1;
            return;
          }

          if (CrowdNode.responses.PleaseAcceptTerms === msg) {
            status.signup = tx.time;
            return;
          }
        });
      },
    );

    if (!status.signup) {
      return null;
    }
    return status;
  };

  /**
   * @param {String} wif
   * @param {String} hotwallet
   */
  CrowdNode.signup = async function (wif, hotwallet) {
    // Send Request Message
    let pk = new Dashcore.PrivateKey(wif);
    let msg = CrowdNode.offset + CrowdNode.requests.signupForApi;
    let changeAddr = (await pk.toPublicKey().toAddress()).toString();
    let tx = await CrowdNode._dashApi.createPayment(
      wif,
      hotwallet,
      msg,
      changeAddr,
    );
    await CrowdNode._insightApi.instantSend(tx.serialize());

    let reply = CrowdNode.offset + CrowdNode.responses.PleaseAcceptTerms;
    return await Ws.waitForVout(
      CrowdNode._dashsocketBaseUrl,
      changeAddr,
      reply,
    );
  };

  /**
   * @param {String} wif
   * @param {String} hotwallet
   */
  CrowdNode.accept = async function (wif, hotwallet) {
    // Send Request Message
    let pk = new Dashcore.PrivateKey(wif);
    let msg = CrowdNode.offset + CrowdNode.requests.acceptTerms;
    let changeAddr = (await pk.toPublicKey().toAddress()).toString();
    let tx = await CrowdNode._dashApi.createPayment(
      wif,
      hotwallet,
      msg,
      changeAddr,
    );
    await CrowdNode._insightApi.instantSend(tx.serialize());

    let reply =
      CrowdNode.offset + CrowdNode.responses.WelcomeToCrowdNodeBlockChainAPI;
    return await Ws.waitForVout(
      CrowdNode._dashsocketBaseUrl,
      changeAddr,
      reply,
    );
  };

  /**
   * @param {String} wif
   * @param {String} hotwallet
   * @param {Number} satoshis - base unit of 1/100000000 Dash
   */
  CrowdNode.deposit = async function (wif, hotwallet, satoshis) {
    // Send Request Message
    let pk = new Dashcore.PrivateKey(wif);
    let changeAddr = (await pk.toPublicKey().toAddress()).toString();

    // TODO reserve a balance
    let tx;
    if (satoshis) {
      if (satoshis < CrowdNode.depositMinimum) {
        throw new Error(
          `cannot deposit '${satoshis}': less than minimum of '${CrowdNode.depositMinimum}'`,
        );
      }
      tx = await CrowdNode._dashApi.createPayment(
        wif,
        hotwallet,
        satoshis,
        changeAddr,
      );
    } else {
      tx = await CrowdNode._dashApi.createBalanceTransfer(wif, hotwallet);
    }
    await CrowdNode._insightApi.instantSend(tx.serialize());

    let reply = CrowdNode.offset + CrowdNode.responses.DepositReceived;
    return await Ws.waitForVout(
      CrowdNode._dashsocketBaseUrl,
      changeAddr,
      reply,
    );
  };

  /**
   * @param {String} wif
   * @param {String} hotwallet
   * @param {Number} permil - 1/1000 (1/10 of a percent) 500 permille = 50.0 percent
   */
  CrowdNode.withdraw = async function (wif, hotwallet, permil) {
    let valid = permil > 0 && permil <= 1000;
    valid = valid && Math.round(permil) === permil;
    if (!valid) {
      throw new Error(`'permil' must be between 1 and 1000, not '${permil}'`);
    }

    // Send Request Message
    let pk = new Dashcore.PrivateKey(wif);
    let msg = CrowdNode.offset + permil;
    let changeAddr = (await pk.toPublicKey().toAddress()).toString();
    let tx = await CrowdNode._dashApi.createPayment(
      wif,
      hotwallet,
      msg,
      changeAddr,
    );
    await CrowdNode._insightApi.instantSend(tx.serialize());

    // Listen for Response
    let mempoolTx = {
      address: "",
      api: "",
      at: 0,
      txid: "",
      satoshis: 0,
      txlock: false,
    };
    return await Ws.listen(CrowdNode._dashsocketBaseUrl, findResponse);

    /**
     * @param {String} evname
     * @param {InsightSocketEventData} data
     */
    function findResponse(evname, data) {
      if (!["tx", "txlock"].includes(evname)) {
        return;
      }

      let now = Date.now();
      if (mempoolTx.at) {
        // don't wait longer than 3s for a txlock
        if (now - mempoolTx.at > 3000) {
          return mempoolTx;
        }
      }

      let result;
      // TODO should fetch tx and match hotwallet as vin
      data.vout.some(function (vout) {
        return Object.keys(vout).some(function (addr) {
          if (addr !== changeAddr) {
            return false;
          }

          let sats = vout[addr];
          let msg = sats - CrowdNode.offset;
          let api = CrowdNode._responses[msg];
          if (!api) {
            // the withdraw often happens before the queued message
            console.warn(`  => received '${sats}' (${evname})`);
            return false;
          }

          let newTx = {
            address: addr,
            api: api.toString(),
            at: now,
            txid: data.txid,
            satoshis: sats,
            txlock: data.txlock,
          };

          if ("txlock" !== evname) {
            // wait up to 3s for a txlock
            if (!mempoolTx) {
              mempoolTx = newTx;
            }
            return false;
          }

          result = newTx;
          return true;
        });
      });

      return result;
    }
  };

  CrowdNode._withdrawalWarned = false;

  /**
   * @param {String} wif
   * @param {String} hotwallet
   * @param {Number} permil
   * @ignore - this is deprecated, not to be used
   */
  CrowdNode.withdrawal = async function (wif, hotwallet, permil) {
    if (!CrowdNode._withdrawalWarned) {
      CrowdNode._withdrawalWarned = true;
      console.warn(
        `[Deprecation Notice] CrowdNode.withdrawal() is a misspelling of CrowdNode.withdraw()`,
      );
    }
    return await CrowdNode.withdraw(wif, hotwallet, permil);
  };

  // See ./bin/crowdnode-list-apis.sh
  CrowdNode.http = {};

  /**
   * @param {String} pub
   */
  CrowdNode.http.FundsOpen = async function (pub) {
    return `Open <${CrowdNode._baseUrl}/FundsOpen/${pub}> in your browser.`;
  };

  /**
   * @param {String} pub
   */
  CrowdNode.http.VotingOpen = async function (pub) {
    return `Open <${CrowdNode._baseUrl}/VotingOpen/${pub}> in your browser.`;
  };

  /**
   * @param {String} pub
   */
  CrowdNode.http.GetFunds = createApi(
    `/odata/apifundings/GetFunds(address='{1}')`,
  );

  /**
   * @param {String} pub
   * @param {String} secondsSinceEpoch
   */
  CrowdNode.http.GetFundsFrom = createApi(
    `/odata/apifundings/GetFundsFrom(address='{1}',fromUnixTime={2})`,
  );

  /**
   * @param {String} addr
   * @returns {Promise<CrowdNodeBalance>}
   * @ignore
   */
  CrowdNode.http._GetBalance = createApi(
    `/odata/apifundings/GetBalance(address='{1}')`,
  );

  /**
   * @param {String} addr
   * @returns {Promise<CrowdNodeBalance>}
   */
  CrowdNode.http.GetBalance = async function (addr) {
    let balanceInfo = await CrowdNode.http._GetBalance(addr);

    if (!("TotalBalance" in balanceInfo)) {
      return balanceInfo;
    }

    // Workaround for https://github.com/dashhive/crowdnode-cli/issues/19
    // (we could also `b = Math.round(Math.floor(b * SATOSHIS) / SATOSHIS)`)
    balanceInfo.TotalBalance = parseFloat(balanceInfo.TotalBalance.toFixed(8));
    balanceInfo.TotalActiveBalance = parseFloat(
      balanceInfo.TotalActiveBalance.toFixed(8),
    );
    balanceInfo.TotalDividend = parseFloat(
      balanceInfo.TotalDividend.toFixed(8),
    );

    return balanceInfo;
  };

  /**
   * @param {String} pub
   */
  CrowdNode.http.GetMessages = createApi(
    `/odata/apimessages/GetMessages(address='{1}')`,
  );

  /**
   * @param {String} pub
   */
  CrowdNode.http.IsAddressInUse = createApi(
    `/odata/apiaddresses/IsAddressInUse(address='{1}')`,
  );

  /**
   * Set Email Address: messagetype=1
   * @param {String} pub - pay to pubkey base58check address
   * @param {String} email
   * @param {String} signature
   */
  CrowdNode.http.SetEmail = createApi(
    `/odata/apimessages/SendMessage(address='{1}',message='{2}',signature='{3}',messagetype=1)`,
  );

  /**
   * Vote on Governance Objects: messagetype=2
   * @param {String} pub - pay to pubkey base58check address
   * @param {String} gobject-hash
   * @param {String} choice - Yes|No|Abstain|Delegate|DoNothing
   * @param {String} signature
   */
  CrowdNode.http.Vote = createApi(
    `/odata/apimessages/SendMessage(address='{1}',message='{2},{3}',signature={4}',messagetype=2)`,
  );

  /**
   * Set Referral: messagetype=3
   * @param {String} pub - pay to pubkey base58check address
   * @param {String} referralId
   * @param {String} signature
   */
  CrowdNode.http.SetReferral = createApi(
    `/odata/apimessages/SendMessage(address='{1}',message='{2}',signature='{3}',messagetype=3)`,
  );

  /**
   * @param {String} tmplUrl
   */
  function createApi(tmplUrl) {
    /**
     * @param {Array<String>} arguments - typically just 'pub', unless SendMessage
     */
    return async function () {
      /** @type Array<String> */
      //@ts-ignore - arguments
      let args = [].slice.call(arguments, 0);

      // ex:
      let url = `${CrowdNode._baseUrl}${tmplUrl}`;
      args.forEach(function (arg, i) {
        let n = i + 1;
        url = url.replace(new RegExp(`\\{${n}\\}`, "g"), arg);
      });

      let resp = await request({
        // TODO https://app.crowdnode.io/odata/apifundings/HotWallet
        method: "GET",
        url: url,
        json: true,
      });
      if (!resp.ok) {
        let err = new Error(
          `http error: ${resp.statusCode} ${resp.body.message}`,
        );
        //@ts-ignore
        err.response = resp.toJSON();
        throw err;
      }

      return resp.body;
    };
  }

  /**
   * @param {String|Number} dash
   */
  function toSatoshis(dash) {
    //@ts-ignore
    let dashF = parseFloat(dash);
    return Math.round(dashF * SATOSHIS);
  }

  if ("undefined" !== typeof module) {
    module.exports = CrowdNode;
  }
})(("undefined" !== typeof module && module.exports) || window);
