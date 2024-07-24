# [CrowdNode Node.js SDK](https://github.com/dashhive/crowdnode.js)

CrowdNode allows you to become a partial MNO - staking Dash to earn interest,
participate in voting, etc.

The CrowdNode Node.js SDK enables you to build Web-based flows and
cross-platform CLI tools to privately manage staking using CrowdNode's KYC-free
Blockchain API.

# Install

## Node.js

You must have [node.js](https://webinstall.dev/node) installed:

### Mac & Linux

```bash
curl https://webinstall.dev/node | bash
export PATH="${HOME}/.local/opt/node:$PATH"
```

### Windows

```pwsh
curl.exe -A MS https://webinstall.dev/node | powershell
PATH %USERPROFILE%\.local\opt\node;%PATH%
```

## CrowdNode SDK

```bash
npm install --save crowdnode@v1
```

## CrowdNode Browser SDK

```html
<script src="https://unpkg.com/dashtx@0.9/dashtx.js"></script>
<script src="https://unpkg.com/dashkeys@1.x/dashkeys.js"></script>
<script src="https://unpkg.com/dashsight@1.x/dashsight.js"></script>
<script src="https://unpkg.com/dashsight@1.x/dashsocket.js"></script>
<script src="https://unpkg.com/crowdnode@1.x/dashapi.js"></script>
<script src="https://unpkg.com/crowdnode@1.x/crowdnode.js"></script>
```

```js
(async function () {
  let dashsight = window.DashSight.create({
    baseUrl: "https://insight.dash.org",
  });

  // ...

  await window.DashSocket.listen(
    "https://insight.dash.org",
    function finder(evname, data) {
      console.log(evname, data);
    },
    { debug: true },
  );
})();
```

# API

The SDK also provides Type Hinting via JSDoc (compatible with TypeScript / tsc
without any transpiling).

## IMPORTANT

The CLI is denominated in **Dash** and **Percent** because those are the units
most customers are familiar with and can easily calculate in their heads without
making "careless" mistakes.

HOWEVER, the SDK and CrowdNode API are denominated in **Duffs** (Satoshis) and
**Permil** (Permille) because those are the whole units that are easiest to
compute.

## QuickStart

The CrowdNode SDK uses Dashcore to create raw transactions and broadcasts them
as Instant Send via the Dash Insight API. It uses Dash Insight WebSockets to
listen for responses from the CrowdNode hotwallet.

A simple CrowdNode application may look like this:

```js
"use strict";

let Fs = require("fs").promises;
let CrowdNode = require("crowdnode");

async function main() {
  let keyfile = process.argv[2];

  // a wallet pre-loaded with about Đ0.01
  let wif = await Fs.readFile(keyfile, "utf8");
  wif = wif.trim();

  // Initializes API info, such as hotwallets
  await CrowdNode.init({ insightBaseUrl: "https://insight.dash.org/" });

  let hotwallet = CrowdNode.main.hotwallet;
  await CrowdNode.signup(wif, hotwallet);
  await CrowdNode.accept(wif, hotwallet);
  await CrowdNode.deposit(wif, hotwallet);

  console.info("Congrats! You're staking!");
}

main().catch(function (err) {
  console.error("Fail:");
  console.error(err.stack || err);
  process.exit(1);
});
```

There are also a number of utility functions which are not exposed as public
APIs, but which you could learn from in [crowdnode-cli](/bin/crowdnode.js).

## Constants

```js
CrowdNode.offset = 20000;
CrowdNode.satoshis = 100000000;
CrowdNode.depositMinimum = 100000;

CrowdNode.requests = {
  acceptTerms: 65536,
  offset: 20000,
  signupForApi: 131072,
  toggleInstantPayout: 4096,
  withdrawMin: 1,
  withdrawMax: 1000,
};

CrowdNode.responses = {
  PleaseAcceptTerms: 2,
  WelcomeToCrowdNodeBlockChainAPI: 4,
  DepositReceived: 8,
  WithdrawalQueued: 16,
  WithdrawalFailed: 32,
  AutoWithdrawalEnabled: 64,
  AutoWithdrawalDisabled: 128,
};
```

## Usage

### Manage Stake

```js
await CrowdNode.init({ insightBaseUrl: "https://insight.dash.org" });

CrowdNode.main.baseUrl; // "https://app.crowdnode.io"
CrowdNode.main.hotwallet; // "XjbaGWaGnvEtuQAUoBgDxJWe8ZNv45upG2"

await CrowdNode.status(pubAddress, hotwallet);
/*
 * {
 *   signup: 0, // seconds since unix epoch
 *   accept: 0,
 *   deposit: 0,
 * }
 */

await CrowdNode.signup(wif, hotwallet);
/** @type SocketPayment
 * {
 *   "address": "Xj00000000000000000000000000000000",
 *   "satoshis": 20002, // PleaseAcceptTerms
 *   "timestamp": 1655634136000,
 *   "txid": "xxxx...",
 *   "txlock": true
 * }
 */

await CrowdNode.accept(wif, hotwallet);
/** @type SocketPayment
 * {
 *   "address": "Xj00000000000000000000000000000000",
 *   "satoshis": 20004, // WelcomeToCrowdNodeBlockChainAPI
 *   "timestamp": 1655634138000,
 *   "txid": "xxxx...",
 *   "txlock": true
 * }
 */

// satoshis (a.k.a. duffs) is the base unit of DASH
await CrowdNode.deposit(wif, hotwallet, (satoshis = 0));
/** @type SocketPayment
 * {
 *   "address": "Xj00000000000000000000000000000000",
 *   "satoshis": 20008, // DepositReceived
 *   "timestamp": 1655634142000,
 *   "txid": "xxxx...",
 *   "txlock": true
 * }
 */

// permil is 1/10 percent, 500 permil = 50.0 percent
await CrowdNode.withdraw(wif, hotwallet, permil);
/** @type SocketPayment
 * {
 *   "address": "Xj00000000000000000000000000000000",
 *   "satoshis": 20016, // WithdrawalQueued
 *   "timestamp": 1657634142000,
 *   "txid": "xxxx...",
 *   "txlock": true
 * }
 */
```

### HTTP RPC

```js
await CrowdNode.http.GetBalance(pubAddr);
/** @type CrowdNodeBalance
 * {
 *   "DashAddress": "Xj00000000000000000000000000000000",
 *   "TotalBalance": 0.01292824,
 *   "TotalActiveBalance": 0,
 *   "TotalDividend": 0,
 *   "UpdatedOn": "2022-06-19T08:06:19.11",
 *   "UpdateOnUnixTime": 1655625979
 * }
 */

await CrowdNode.http.GetFunds(pubAddr);
await CrowdNode.http.GetFundsFrom(pubAddr, secondsSinceEpoch);
/*
 *  [
 *    {
 *      "FundingType": 1,
 *      "Amount": 0.00810218,
 *      "Time": 1655553336,
 *      "TimeReceived": 1655553336,
 *      "TxId": "e5a...",
 *      "Status": 32,
 *      "Comment": null,
 *      "TimeUTC": "2022-06-18T11:55:36",
 *      "Id": 3641556,
 *      "UpdatedOn": "2022-06-18T12:04:15.1233333"
 *    }
 *  ]
 */

await CrowdNode.http.IsAddressInUse(pubAddr);
/**
 * {
 *   "inUse": true,
 *   "DashAddress": "Xj00000000000000000000000000000000"
 * }
 */
```

### Messages (Voting, etc)

```js
await CrowdNode.http.GetMessages(pubAddr);
/**
 * []
 */

await CrowdNode.http.SetEmail(wif, email, sig);
await CrowdNode.http.Vote(wif, gobjectHash, vote, sig);
await CrowdNode.http.SetReferral(wif, referralId, sig);
```

```js
await CrowdNode.http.FundsOpen(pub);
/* ${baseUrl}/FundsOpen/${pub} */

await CrowdNode.http.VotingOpen(pub);
/* ${baseUrl}/VotingOpen/${pub} */
```

## Glossary

| Term          | Description                                                   |
| ------------- | ------------------------------------------------------------- |
| addr          | your Dash address (Base58Check-encoded Pay-to-PubKey Address) |
| satoshis      | the base unit of DASH (a.k.a. "Duffs") Đ/100000000            |
| permil        | 1/1000, 1‰, or 0.1% - between 1 and 1000 (0.1% to 100.0%)     |
| ./privkey.wif | the file path to your staking key in WIF (Base58Check) format |

# CLI Documentation

See <https://github.com/dashhive/crowdnode-cli>.

# Official CrowdNode Docs

<https://knowledge.crowdnode.io/en/articles/5963880-blockchain-api-guide>
