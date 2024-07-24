#!/usr/bin/env node
"use strict";
/*jshint maxcomplexity:25 */

require("dotenv").config({ path: ".env" });
require("dotenv").config({ path: ".env.secret" });

let HOME = process.env.HOME || "";

//@ts-ignore
let pkg = require("../package.json");

let Fs = require("fs").promises;
let Path = require("path");

let Cipher = require("./_cipher.js");
let CrowdNode = require("../crowdnode.js");
let Dash = require("../dashapi.js");
let Dashsight = require("dashsight");
let Prompt = require("./_prompt.js");
let Qr = require("./_qr-node.js");
let Ws = require("dashsight/ws");

let Dashcore = require("../dashcore-lit.js");

const DONE = "✅";
const TODO = "ℹ️";
const NO_SHADOW = "NONE";
const SATOSHIS = 100000000;

let shownDefault = false;
let qrWidth = 2 + 33 + 2;
// Sign Up Fees:
//   0.00236608 // required for signup
//   0.00002000 // TX fee estimate
//   0.00238608 // minimum recommended DASH
// Target:
//   0.01000000
let signupOnly = CrowdNode.requests.signupForApi + CrowdNode.requests.offset;
let acceptOnly = CrowdNode.requests.acceptTerms + CrowdNode.requests.offset;
let signupFees = signupOnly + acceptOnly;
let feeEstimate = 500;
let signupTotal = signupFees + 2 * feeEstimate;

//let paths = {};
let configdir = `.config/crowdnode`;
let keysDir = Path.join(HOME, `${configdir}/keys`);
let keysDirRel = `~/${configdir}/keys`;
let shadowPath = Path.join(HOME, `${configdir}/shadow`);
let defaultWifPath = Path.join(HOME, `${configdir}/default`);

function debug() {
  //@ts-ignore
  console.error.apply(console, arguments);
}

function showVersion() {
  console.info(`${pkg.name} v${pkg.version} - ${pkg.description}`);
  console.info();
}

function showHelp() {
  showVersion();

  console.info("Quick Start:");
  // technically this also has [--no-reserve]
  console.info("    crowdnode stake [addr-or-import-key | --create-new]");

  console.info("");
  console.info("Usage:");
  console.info("    crowdnode help");
  console.info("    crowdnode version");
  console.info("");
  console.info("    crowdnode status [keyfile-or-addr]");
  console.info("    crowdnode signup [keyfile-or-addr]");
  console.info("    crowdnode accept [keyfile-or-addr]");
  console.info(
    "    crowdnode deposit [keyfile-or-addr] [dash-amount] [--no-reserve]",
  );
  console.info(
    "    crowdnode withdraw [keyfile-or-addr] <percent> # 1.0-100.0 (steps by 0.1)",
  );
  console.info("");

  console.info("Helpful Extras:");
  console.info("    crowdnode balance [keyfile-or-addr]"); // addr
  console.info("    crowdnode load [keyfile-or-addr] [dash-amount]"); // addr
  console.info(
    "    crowdnode transfer <from-keyfile-or-addr> <to-keyfile-or-addr> [dash-amount]",
  ); // custom
  console.info("");

  console.info("Key Management & Encryption:");
  console.info("    crowdnode init");
  console.info("    crowdnode generate [--plain-text] [./privkey.wif]");
  console.info("    crowdnode encrypt"); // TODO allow encrypting one-by-one?
  console.info("    crowdnode list");
  console.info("    crowdnode use <addr>");
  console.info("    crowdnode import <keyfile>");
  //console.info("    crowdnode import <(dash-cli dumpprivkey <addr>)"); // TODO
  //console.info("    crowdnode export <addr> <keyfile>"); // TODO
  console.info("    crowdnode passphrase # set or change passphrase");
  console.info("    crowdnode decrypt"); // TODO allow decrypting one-by-one?
  console.info("    crowdnode delete <addr>");
  console.info("");

  console.info("CrowdNode HTTP RPC:");
  console.info("    crowdnode http FundsOpen <addr>");
  console.info("    crowdnode http VotingOpen <addr>");
  console.info("    crowdnode http GetFunds <addr>");
  console.info("    crowdnode http GetFundsFrom <addr> <seconds-since-epoch>");
  console.info("    crowdnode http GetBalance <addr>");
  console.info("    crowdnode http GetMessages <addr>");
  console.info("    crowdnode http IsAddressInUse <addr>");
  // TODO create signature rather than requiring it
  console.info("    crowdnode http SetEmail ./privkey.wif <email> <signature>");
  console.info("    crowdnode http Vote ./privkey.wif <gobject-hash> ");
  console.info("        <Yes|No|Abstain|Delegate|DoNothing> <signature>");
  console.info(
    "    crowdnode http SetReferral ./privkey.wif <referral-id> <signature>",
  );
  console.info("");
  console.info("Official CrowdNode Resources");
  console.info("");
  console.info("Homepage:");
  console.info("    https://crowdnode.io/");
  console.info("");
  console.info("Terms of Service:");
  console.info("    https://crowdnode.io/terms/");
  console.info("");
  console.info("BlockChain API Guide:");
  console.info(
    "    https://knowledge.crowdnode.io/en/articles/5963880-blockchain-api-guide",
  );
  console.info("");
}

let cmds = {};

let dashsightBaseUrl =
  process.env.DASHSIGHT_BASE_URL ||
  "https://dashsight.dashincubator.dev/insight-api";
let dashsocketBaseUrl =
  process.env.DASHSOCKET_BASE_URL || "https://insight.dash.org/socket.io";
let insightBaseUrl =
  process.env.INSIGHT_BASE_URL || "https://insight.dash.org/insight-api";

async function main() {
  /*jshint maxcomplexity:40 */
  /*jshint maxstatements:500 */

  // Usage:
  //    crowdnode <subcommand> [flags] <privkey> [options]
  // Example:
  //    crowdnode withdraw ./Xxxxpubaddr.wif 100.0

  let args = process.argv.slice(2);

  // flags
  let forceGenerate = removeItem(args, "--create-new");
  let forceConfirm = removeItem(args, "--unconfirmed");
  let plainText = removeItem(args, "--plain-text");
  let noReserve = removeItem(args, "--no-reserve");

  let subcommand = args.shift();

  if (!subcommand || ["--help", "-h", "help"].includes(subcommand)) {
    showHelp();
    process.exit(0);
    return;
  }

  if (["--version", "-V", "version"].includes(subcommand)) {
    showVersion();
    process.exit(0);
    return;
  }

  //
  //
  // find addr by name or by file or by string
  await Fs.mkdir(keysDir, {
    recursive: true,
  });

  let defaultAddr = await Fs.readFile(defaultWifPath, "utf8").catch(
    emptyStringOnErrEnoent,
  );
  defaultAddr = defaultAddr.trim();

  let dashsightApi = Dashsight.create({
    dashsightBaseUrl: dashsightBaseUrl,
    dashsocketBaseUrl: dashsocketBaseUrl,
    insightBaseUrl: insightBaseUrl,
  });
  let dashApi = Dash.create({ insightApi: dashsightApi });

  if ("stake" === subcommand) {
    await stakeDash(
      {
        dashApi,
        insightApi: dashsightApi,
        defaultAddr,
        forceGenerate,
        noReserve,
      },
      args,
    );
    process.exit(0);
    return;
  }

  if ("list" === subcommand) {
    await listKeys({ dashApi, defaultAddr }, args);
    process.exit(0);
    return;
  }

  if ("init" === subcommand) {
    await initKeystore({ defaultAddr });
    process.exit(0);
    return;
  }

  if ("generate" === subcommand) {
    await generateKey({ defaultKey: defaultAddr, plainText }, args);
    process.exit(0);
    return;
  }

  if ("passphrase" === subcommand) {
    await setPassphrase({}, args);
    process.exit(0);
    return;
  }

  if ("import" === subcommand) {
    let keypath = args.shift() || "";
    await importKey({ keypath });
    process.exit(0);
    return;
  }

  if ("encrypt" === subcommand) {
    let addr = args.shift() || "";
    if (!addr) {
      await encryptAll(null);
      process.exit(0);
      return;
    }

    let keypath = await findWif(addr);
    if (!keypath) {
      console.error(`no managed key matches '${addr}'`);
      process.exit(1);
      return;
    }
    let key = await maybeReadKeyFileRaw(keypath);
    if (!key) {
      throw new Error("impossible error");
    }
    await encryptAll([key]);
    process.exit(0);
    return;
  }

  if ("decrypt" === subcommand) {
    let addr = args.shift() || "";
    if (!addr) {
      await decryptAll(null);
      await Fs.writeFile(shadowPath, NO_SHADOW, "utf8").catch(
        emptyStringOnErrEnoent,
      );
      process.exit(0);
      return;
    }
    let keypath = await findWif(addr);
    if (!keypath) {
      console.error(`no managed key matches '${addr}'`);
      process.exit(1);
      return;
    }
    let key = await maybeReadKeyFileRaw(keypath);
    if (!key) {
      throw new Error("impossible error");
    }
    await decryptAll([key]);
    process.exit(0);
    return;
  }

  // use or select or default... ?
  if ("use" === subcommand) {
    await setDefault(null, args);
    process.exit(0);
    return;
  }

  // helper for debugging
  if ("transfer" === subcommand) {
    await transferBalance(
      {
        dashApi,
        defaultAddr,
        forceConfirm,
        insightApi: dashsightApi,
      },
      args,
    );
    process.exit(0);
    return;
  }

  let rpc = "";
  if ("http" === subcommand) {
    rpc = args.shift() || "";
    if (!rpc) {
      showHelp();
      process.exit(1);
      return;
    }

    let [addr] = await mustGetAddr({ defaultAddr }, args);

    await initCrowdNode();
    // ex: http <rpc>(<pub>, ...)
    args.unshift(addr);
    let hasRpc = rpc in CrowdNode.http;
    if (!hasRpc) {
      console.error(`Unrecognized rpc command ${rpc}`);
      console.error();
      showHelp();
      process.exit(1);
    }
    //@ts-ignore - TODO use `switch` or make Record Type
    let result = await CrowdNode.http[rpc].apply(null, args);
    console.info(``);
    console.info(`${rpc} ${addr}:`);
    if ("string" === typeof result) {
      console.info(result);
    } else {
      console.info(JSON.stringify(result, null, 2));
    }
    process.exit(0);
    return;
  }

  if ("load" === subcommand) {
    await loadAddr({ defaultAddr, insightBaseUrl }, args);
    process.exit(0);
    return;
  }

  // keeping rm for backwards compat
  if ("rm" === subcommand || "delete" === subcommand) {
    await initCrowdNode();
    let [addr, filepath] = await mustGetAddr({ defaultAddr }, args);
    await removeKey({ addr, dashApi, filepath, insightBaseUrl }, args);
    process.exit(0);
    return;
  }

  if ("balance" === subcommand) {
    if (args.length) {
      await getBalance({ dashApi, defaultAddr }, args);
      process.exit(0);
      return;
    }

    await getAllBalances({ dashApi, defaultAddr }, args);
    process.exit(0);
    return;
  }

  if ("status" === subcommand) {
    await getStatus({ dashApi, defaultAddr, insightBaseUrl }, args);
    process.exit(0);
    return;
  }

  if ("signup" === subcommand) {
    await sendSignup({ dashApi, defaultAddr, insightBaseUrl }, args);
    process.exit(0);
    return;
  }

  if ("accept" === subcommand) {
    await acceptTerms({ dashApi, defaultAddr, insightBaseUrl }, args);
    process.exit(0);
    return;
  }

  if ("deposit" === subcommand) {
    await depositDash({ dashApi, defaultAddr, noReserve }, args);
    process.exit(0);
    return;
  }

  // The misspelling 'withdrawal' is kept as part of compatibility < v1.7
  if ("withdrawal" === subcommand) {
    console.warn(
      `[Deprecation Notice] 'crowdnode withdrawal' is a misspelling of 'crowdnode withdraw'`,
    );
    subcommand = "withdraw";
  }

  if ("withdraw" === subcommand) {
    await withdrawDash({ dashApi, defaultAddr, insightBaseUrl }, args);
    process.exit(0);
    return;
  }

  console.error(`Unrecognized subcommand ${subcommand}`);
  console.error();
  showHelp();
  process.exit(1);
}

/**
 * @param {Object} opts
 * @param {any} opts.dashApi - TODO
 * @param {String} opts.defaultAddr
 * @param {Boolean} opts.forceGenerate
 * @param {String} opts.insightBaseUrl
 * @param {any} opts.insightApi
 * @param {Boolean} opts.noReserve
 * @param {Array<String>} args
 */
async function stakeDash(
  { dashApi, defaultAddr, forceGenerate, insightApi, noReserve },
  args,
) {
  let err = await Fs.access(args[0]).catch(Object);
  let addr;
  if (!err) {
    let keypath = args.shift() || "";
    addr = await importKey({ keypath });
  } else if (forceGenerate) {
    addr = await generateKey({ defaultKey: defaultAddr }, []);
  } else {
    addr = await initKeystore({ defaultAddr });
  }

  if (!addr) {
    let [_addr] = await mustGetAddr({ defaultAddr }, args);
    addr = _addr;
  }

  let extra = feeEstimate;
  console.info("Checking CrowdNode account... ");
  await CrowdNode.init({
    baseUrl: "https://app.crowdnode.io",
    dashsightBaseUrl,
    dashsocketBaseUrl,
    insightBaseUrl,
  });
  let hotwallet = CrowdNode.main.hotwallet;
  let state = await getCrowdNodeStatus({ addr, hotwallet });

  if (!state.status?.accept) {
    if (!state.status?.signup) {
      let signUpDeposit = signupOnly + feeEstimate;
      console.info(
        `    ${TODO} SignUpForApi deposit is ${signupOnly} (+ tx fee)`,
      );
      extra += signUpDeposit;
    } else {
      console.info(`    ${DONE} SignUpForApi complete`);
    }
    let acceptDeposit = acceptOnly + feeEstimate;
    console.info(`    ${TODO} AcceptTerms deposit is ${acceptOnly} (+ tx fee)`);
    extra += acceptDeposit;
  }

  let desiredDashAmount = args.shift() || "0.5";
  let effectiveSats = toDuff(desiredDashAmount);
  effectiveSats += extra;

  let balanceInfo = await dashApi.getInstantBalance(addr);
  effectiveSats -= balanceInfo.balanceSat;

  if (effectiveSats > 0) {
    effectiveSats = roundDuff(effectiveSats, 3);
    let effectiveDash = toDash(effectiveSats);
    await plainLoadAddr({
      addr,
      effectiveDash,
      effectiveSats,
    });
  }

  if (!state.status?.accept) {
    if (!state.status?.signup) {
      await sendSignup({ dashApi, defaultAddr: addr, insightBaseUrl }, [addr]);
    }
    await acceptTerms({ dashApi, defaultAddr: addr, insightBaseUrl }, [addr]);
  }

  await depositDash(
    { dashApi, defaultAddr: addr, noReserve },
    [addr].concat(args),
  );

  await checkBalance({ addr, dashApi });
}

/**
 * @param {Object} opts
 * @param {String} opts.defaultAddr
 */
async function initKeystore({ defaultAddr }) {
  // if we have no keys, make one
  let wifnames = await listManagedKeynames();
  if (!wifnames.length) {
    return await generateKey({ defaultKey: defaultAddr }, []);
  }
  // if we have no passphrase, ask about it
  await initPassphrase();
  return defaultAddr || wifnames[0];
}

async function initCrowdNode() {
  if (CrowdNode._initialized) {
    return;
  }
  process.stdout.write("Checking CrowdNode API... ");
  await CrowdNode.init({
    baseUrl: "https://app.crowdnode.io",
    dashsightBaseUrl,
    dashsocketBaseUrl,
    insightBaseUrl,
  });
  console.info(`(hotwallet ${CrowdNode.main.hotwallet})`);
}

/**
 * @param {String} addr - Base58Check pubKeyHash address
 * @param {Number} duffs - 1/100000000 of a DASH
 */
function showQr(addr, duffs = 0) {
  let dashAmount = toDash(duffs);
  let dashUri = `dash://${addr}`;
  if (duffs) {
    dashUri += `?amount=${dashAmount}`;
  }

  let dashQr = Qr.ascii(dashUri, { indent: 4, size: "mini" });
  let addrPad = Math.max(0, Math.ceil((qrWidth - dashUri.length) / 2));

  console.info(dashQr);
  console.info();
  console.info(" ".repeat(addrPad) + dashUri);
}

/**
 * @param {Array<any>} arr
 * @param {any} item
 */
function removeItem(arr, item) {
  let index = arr.indexOf(item);
  if (index >= 0) {
    return arr.splice(index, 1)[0];
  }
  return null;
}

/**
 * @param {Object} opts
 * @param {String} opts.addr
 * @param {String} opts.hotwallet
 */
async function getCrowdNodeStatus({ addr, hotwallet }) {
  let state = {
    signup: TODO,
    accept: TODO,
    deposit: TODO,
    status: {
      signup: 0,
      accept: 0,
      deposit: 0,
    },
  };

  //@ts-ignore - TODO why warnings?
  let status = await CrowdNode.status(addr, hotwallet);
  if (status) {
    state.status = status;
  }
  if (state.status?.signup) {
    state.signup = DONE;
  }
  if (state.status?.accept) {
    state.accept = DONE;
  }
  if (state.status?.deposit) {
    state.deposit = DONE;
  }
  return state;
}

/**
 * @param {Object} opts
 * @param {String} opts.addr
 * @param {any} opts.dashApi - TODO
 */
async function checkBalance({ addr, dashApi }) {
  // deposit if balance is over 100,000 (0.00100000)
  console.info("Checking balance... ");
  let balanceInfo = await dashApi.getInstantBalance(addr);
  let balanceDASH = toDASH(balanceInfo.balanceSat);

  let crowdNodeBalance = await CrowdNode.http.GetBalance(addr);
  if (!crowdNodeBalance.TotalBalance) {
    crowdNodeBalance.TotalBalance = 0;
    crowdNodeBalance.TotalDividend = 0;
  }

  let crowdNodeDuffNum = toDuff(crowdNodeBalance.TotalBalance);
  let crowdNodeDASH = toDASH(crowdNodeDuffNum);

  let crowdNodeDivNum = toDuff(crowdNodeBalance.TotalDividend);
  let crowdNodeDASHDiv = toDASH(crowdNodeDivNum);

  console.info(`Key:       ${balanceDASH}`);
  console.info(`CrowdNode: ${crowdNodeDASH}`);
  console.info(`Dividends: ${crowdNodeDASHDiv}`);
  console.info();
  /*
  let balanceInfo = await insightApi.getBalance(pub);
  if (balanceInfo.unconfirmedBalanceSat || balanceInfo.unconfirmedAppearances) {
    if (!forceConfirm) {
      console.error(
        `Error: This address has pending transactions. Please try again in 1-2 minutes or use --unconfirmed.`,
      );
      console.error(balanceInfo);
      if ("status" !== subcommand) {
        process.exit(1);
        return;
      }
    }
  }
  */
  return balanceInfo;
}

/**
 * @param {Object} opts
 * @param {String} opts.defaultAddr
 * @param {Array<String>} args
 * @returns {Promise<[String, String]>}
 */
async function mustGetAddr({ defaultAddr }, args) {
  let name = args.shift() ?? "";
  if (34 === name.length) {
    // looks like addr already
    // TODO make function for addr-lookin' check
    return [name, name];
  }

  let addr = await maybeReadKeyPaths(name, { wif: false });
  if (addr) {
    if (34 === addr.length) {
      return [addr, name];
    }
    //let pk = new Dashcore.PrivateKey(wif);
    //let addr = (await pk.toAddress()).toString();
    return [addr, name];
  }

  let isNum = !isNaN(parseFloat(name));
  if (isNum) {
    args.unshift(name);
    name = "";
  }

  if (name) {
    console.error();
    console.error(`could not read '${name}' in ./ or match in ${keysDirRel}/.`);
    console.error();
    process.exit(1);
    return ["", name];
  }

  addr = await mustGetDefaultWif(defaultAddr, { wif: false });

  // TODO we don't need defaultAddr, right? because it could be old?
  return [addr, addr];
}

/**
 * @param {Object} opts
 * @param {String} opts.defaultAddr
 * @param {Array<String>} args
 */
async function mustGetWif({ defaultAddr }, args) {
  let name = args.shift() ?? "";

  let wif = await maybeReadKeyPaths(name, { wif: true });
  if (wif) {
    return wif;
  }

  let isNum = !isNaN(parseFloat(name));
  if (isNum) {
    args.unshift(name);
    name = "";
  }

  if (name) {
    console.error();
    console.error(
      `'${name}' does not match a staking key in ./ or ${keysDirRel}/`,
    );
    console.error();
    process.exit(1);
    return "";
  }

  wif = await mustGetDefaultWif(defaultAddr);

  return wif;
}

/**
 * @param {String} name
 * @param {Object} opts
 * @param {Boolean} opts.wif
 * @returns {Promise<String>} - wif
 */
async function maybeReadKeyPaths(name, opts) {
  let privKey = "";

  // prefix match in .../keys/
  let wifname = await findWif(name);
  if (!wifname) {
    return "";
  }

  if (false === opts.wif) {
    return wifname.slice(0, -".wif".length);
  }

  let filepath = Path.join(keysDir, wifname);
  privKey = await maybeReadKeyFile(filepath);
  if (!privKey) {
    // local in ./
    privKey = await maybeReadKeyFile(name);
  }

  return privKey;
}

/**
 * @param {String} defaultAddr
 * @param {Object} [opts]
 * @param {Boolean} opts.wif
 */
async function mustGetDefaultWif(defaultAddr, opts) {
  let defaultWif = "";
  if (defaultAddr) {
    let keyfile = Path.join(keysDir, `${defaultAddr}.wif`);
    let raw = await maybeReadKeyFileRaw(keyfile, opts);
    // misnomering wif here a bit
    defaultWif = raw?.wif || raw?.addr || "";
  }
  if (defaultWif && !shownDefault) {
    shownDefault = true;
    debug(`Selected default staking key ${defaultAddr}`);
    return defaultWif;
  }

  console.error();
  console.error(`Error: no default staking key selected.`);
  console.error();
  console.error(`Select a different address:`);
  console.error(`    crowdnode list`);
  console.error(`    crowdnode use <addr>`);
  console.error(``);
  console.error(`Or create a new staking key:`);
  console.error(`    crowdnode generate`);
  console.error();
  process.exit(1);
  return "";
}

// Subcommands

/**
 * @param {Object} psuedoState
 * @param {String} psuedoState.defaultKey - addr name of default key
 * @param {Boolean} [psuedoState.plainText] - don't encrypt
 * @param {Array<String>} args
 */
async function generateKey({ defaultKey, plainText }, args) {
  let name = args.shift();
  //@ts-ignore - TODO submit JSDoc PR for Dashcore
  let pk = new Dashcore.PrivateKey();

  let addr = (await pk.toAddress()).toString();
  let plainWif = await pk.toWIF();

  let wif = plainWif;
  if (!plainText) {
    wif = await maybeEncrypt(plainWif);
  }

  let filename = `~/${configdir}/keys/${addr}.wif`;
  let filepath = Path.join(`${keysDir}/${addr}.wif`);
  let note = "";
  if (name) {
    filename = name;
    filepath = name;
    note = `\n(for pubkey address ${addr})`;
    let err = await Fs.access(filepath).catch(Object);
    if (!err) {
      // TODO
      console.info(`'${filepath}' already exists (will not overwrite)`);
      process.exit(0);
      return;
    }
  }

  await Fs.writeFile(filepath, wif, "utf8");
  if (!name && !defaultKey) {
    await Fs.writeFile(defaultWifPath, addr, "utf8");
  }

  console.info(``);
  console.info(`Generated ${filename} ${note}`);
  console.info(``);
  return addr;
}

async function initPassphrase() {
  let needsInit = false;
  let shadow = await Fs.readFile(shadowPath, "utf8").catch(
    emptyStringOnErrEnoent,
  );
  if (!shadow) {
    needsInit = true;
  }
  if (needsInit) {
    await cmds.getPassphrase({}, []);
  }
}

/**
 * @param {Object} state
 * @param {Boolean} [state._askPreviousPassphrase] - don't ask for passphrase again
 * @param {Array<String>} args
 */
async function setPassphrase({ _askPreviousPassphrase }, args) {
  let result = {
    passphrase: "",
    changed: false,
  };
  let date = getFsDateString();

  // get the old passphrase
  if (false !== _askPreviousPassphrase) {
    // TODO should contain the shadow?
    await cmds.getPassphrase({ _rotatePassphrase: true }, []);
  }

  // get the new passphrase
  let newPassphrase = await promptPassphrase();
  let curShadow = await Fs.readFile(shadowPath, "utf8").catch(
    emptyStringOnErrEnoent,
  );

  let newShadow = await Cipher.shadowPassphrase(newPassphrase);
  await Fs.writeFile(shadowPath, newShadow, "utf8");

  let rawKeys = await readAllKeys();
  let encAddrs = rawKeys
    .map(function (raw) {
      if (raw.encrypted) {
        return raw.addr;
      }
    })
    .filter(Boolean);

  // backup all currently encrypted files
  //@ts-ignore
  if (encAddrs.length) {
    let filepath = Path.join(HOME, `${configdir}/keys.${date}.bak`);
    console.info(``);
    console.info(`Backing up previous (encrypted) keys:`);
    encAddrs.unshift(`SHADOW:${curShadow}`);
    await Fs.writeFile(filepath, encAddrs.join("\n") + "\n", "utf8");
    console.info(`  ~/${configdir}/keys.${date}.bak`);
    console.info(``);
  }
  cmds._setPassphrase(newPassphrase);

  await encryptAll(rawKeys, { rotateKey: true });

  result.passphrase = newPassphrase;
  result.changed = true;
  return result;
}

async function promptPassphrase() {
  let newPassphrase;
  for (;;) {
    newPassphrase = await Prompt.prompt("Enter (new) passphrase: ", {
      mask: true,
    });
    newPassphrase = newPassphrase.trim();

    let _newPassphrase = await Prompt.prompt("Enter passphrase again: ", {
      mask: true,
    });
    _newPassphrase = _newPassphrase.trim();

    let match = Cipher.secureCompare(newPassphrase, _newPassphrase);
    if (match) {
      break;
    }

    console.error("passphrases do not match");
  }
  return newPassphrase;
}

/**
 * Import and Encrypt
 * @param {Object} opts
 * @param {String} opts.keypath
 */
async function importKey({ keypath }) {
  let key = await maybeReadKeyFileRaw(keypath);
  if (!key?.wif) {
    console.error(`no key found for '${keypath}'`);
    process.exit(1);
    return;
  }

  let encWif = await maybeEncrypt(key.wif);
  let icon = "💾";
  if (encWif.includes(":")) {
    icon = "🔐";
  }
  let date = getFsDateString();

  await safeSave(
    Path.join(keysDir, `${key.addr}.wif`),
    encWif,
    Path.join(keysDir, `${key.addr}.${date}.bak`),
  );

  console.info(`${icon} Imported ${keysDirRel}/${key.addr}.wif`);
  console.info(``);

  return key.addr;
}

/**
 * @param {Object} opts
 * @param {Boolean} [opts._rotatePassphrase]
 * @param {Boolean} [opts._force]
 * @param {Array<String>} args
 */
cmds.getPassphrase = async function ({ _rotatePassphrase, _force }, args) {
  let result = {
    passphrase: "",
    changed: false,
  };
  /*
  if (!_rotatePassphrase) {
    let cachedphrase = cmds._getPassphrase();
    if (cachedphrase) {
      return cachedphrase;
    }
  }
  */

  // Three possible states:
  //   1. no shadow file yet (ask to set one)
  //   2. empty shadow file (initialized, but not set - don't ask to set one)
  //   3. encrypted shadow file (initialized, requires passphrase)
  let needsInit = false;
  let shadow = await Fs.readFile(shadowPath, "utf8").catch(
    emptyStringOnErrEnoent,
  );
  if (!shadow) {
    needsInit = true;
  } else if (NO_SHADOW === shadow && _force) {
    needsInit = true;
  }

  // State 1: not initialized, what does the user want?
  if (needsInit) {
    for (;;) {
      let no;
      if (!_force) {
        no = await Prompt.prompt(
          "Would you like to encrypt your keys with a passphrase? [Y/n]: ",
        );
      }

      // Set a passphrase and create shadow file
      if (!no || ["yes", "y"].includes(no.toLowerCase())) {
        result = await setPassphrase({ _askPreviousPassphrase: false }, args);
        cmds._setPassphrase(result.passphrase);
        return result;
      }

      // ask user again
      if (!["no", "n"].includes(no.toLowerCase())) {
        continue;
      }

      // No passphrase, create a NONE shadow file
      await Fs.writeFile(shadowPath, NO_SHADOW, "utf8");
      return result;
    }
  }

  // State 2: shadow already initialized to empty
  // (user doesn't want a passphrase)
  if (!shadow) {
    cmds._setPassphrase("");
    return result;
  }

  // State 3: passphrase & shadow already in use
  for (;;) {
    let prompt = `Enter passphrase: `;
    if (_rotatePassphrase) {
      prompt = `Enter (current) passphrase: `;
    }
    result.passphrase = await Prompt.prompt(prompt, {
      mask: true,
    });
    result.passphrase = result.passphrase.trim();
    if (!result.passphrase || "q" === result.passphrase) {
      console.error("cancel: no passphrase");
      process.exit(1);
      return result;
    }

    let match = await Cipher.checkPassphrase(result.passphrase, shadow);
    if (match) {
      cmds._setPassphrase(result.passphrase);
      console.info(``);
      return result;
    }

    console.error("incorrect passphrase");
  }

  throw new Error("SANITY FAIL: unreachable return");
};

cmds._getPassphrase = function () {
  return "";
};

/**
 * @param {String} passphrase
 */
cmds._setPassphrase = function (passphrase) {
  // Look Ma! A private variable!
  cmds._getPassphrase = function () {
    return passphrase;
  };
};

/**
 * Encrypt ALL-the-things!
 * @param {Object} [opts]
 * @param {Boolean} opts.rotateKey
 * @param {Array<RawKey>?} rawKeys
 */
async function encryptAll(rawKeys, opts) {
  if (!rawKeys) {
    rawKeys = await readAllKeys();
  }
  let date = getFsDateString();

  let passphrase = cmds._getPassphrase();
  if (!passphrase) {
    let result = await cmds.getPassphrase({ _force: true }, []);
    if (result.changed) {
      // encryptAll was already called on rotation
      return;
    }
    passphrase = result.passphrase;
  }

  console.info(`Encrypting...`);
  console.info(``);
  await rawKeys.reduce(async function (promise, key) {
    await promise;

    if (key.encrypted && !opts?.rotateKey) {
      console.info(`🙈 ${key.addr} [already encrypted]`);
      return;
    }
    let encWif = await maybeEncrypt(key.wif, { force: true });
    await safeSave(
      Path.join(keysDir, `${key.addr}.wif`),
      encWif,
      Path.join(keysDir, `${key.addr}.${date}.bak`),
    );
    console.info(`🔑 ${key.addr}`);
  }, Promise.resolve());
  console.info(``);
  console.info(`Done 🔐`);
  console.info(``);
}

/**
 * Decrypt ALL-the-things!
 * @param {Array<RawKey>?} rawKeys
 */
async function decryptAll(rawKeys) {
  if (!rawKeys) {
    rawKeys = await readAllKeys();
  }
  let date = getFsDateString();

  console.info(``);
  console.info(`Decrypting...`);
  console.info(``);
  await rawKeys.reduce(async function (promise, key) {
    await promise;

    if (!key.encrypted) {
      console.info(`📖 ${key.addr} [already decrypted]`);
      return;
    }
    await safeSave(
      Path.join(keysDir, `${key.addr}.wif`),
      key.wif,
      Path.join(keysDir, `${key.addr}.${date}.bak`),
    );
    console.info(`🔓 ${key.addr}`);
  }, Promise.resolve());
  console.info(``);
  console.info(`Done ${DONE}`);
  console.info(``);
}

function getFsDateString() {
  // YYYY-MM-DD_hh-mm_ss
  let date = new Date()
    .toISOString()
    .replace(/:/g, ".")
    .replace(/T/, "_")
    .replace(/\.\d{3}.*/, "");
  return date;
}

/**
 * @param {String} filepath
 * @param {String} wif
 * @param {String} bakpath
 */
async function safeSave(filepath, wif, bakpath) {
  let tmpPath = `${bakpath}.tmp`;
  await Fs.writeFile(tmpPath, wif, "utf8");
  let err = await Fs.access(filepath).catch(Object);
  if (!err) {
    await Fs.rename(filepath, bakpath);
  }
  await Fs.rename(tmpPath, filepath);
  if (!err) {
    await Fs.unlink(bakpath);
  }
}

/**
 * @typedef {Object} RawKey
 * @property {String} addr
 * @property {Boolean} encrypted
 * @property {String} wif
 */

/**
 * @throws
 */
async function readAllKeys() {
  let wifnames = await listManagedKeynames();

  /** @type Array<RawKey> */
  let keys = [];
  await wifnames.reduce(async function (promise, wifname) {
    await promise;

    let keypath = Path.join(keysDir, wifname);
    let key = await maybeReadKeyFileRaw(keypath);
    if (!key?.wif) {
      return;
    }

    if (`${key.addr}.wif` !== wifname) {
      throw new Error(
        `computed pubkey '${key.addr}' of WIF does not match filename '${keypath}'`,
      );
    }

    keys.push(key);
  }, Promise.resolve());

  return keys;
}

/**
 * @param {String} filepath
 * @param {Object} [opts]
 * @param {Boolean} opts.wif
 * @returns {Promise<String>}
 */
async function maybeReadKeyFile(filepath, opts) {
  let key = await maybeReadKeyFileRaw(filepath, opts);
  if (false === opts?.wif) {
    return key?.addr || "";
  }
  return key?.wif || "";
}

/**
 * @param {String} filepath
 * @param {Object} [opts]
 * @param {Boolean} opts.wif
 * @returns {Promise<RawKey?>}
 */
async function maybeReadKeyFileRaw(filepath, opts) {
  let privKey = await Fs.readFile(filepath, "utf8").catch(
    emptyStringOnErrEnoent,
  );
  privKey = privKey.trim();
  if (!privKey) {
    return null;
  }

  let encrypted = false;
  if (privKey.includes(":")) {
    encrypted = true;
    try {
      if (false !== opts?.wif) {
        privKey = await decrypt(privKey);
      }
    } catch (err) {
      //@ts-ignore
      console.error(err.message);
      console.error(`passphrase does not match for key ${filepath}`);
      process.exit(1);
    }
  }
  if (false === opts?.wif) {
    return {
      addr: Path.basename(filepath, ".wif"),
      encrypted: encrypted,
      wif: "",
    };
  }

  let pk = new Dashcore.PrivateKey(privKey);
  let pub = (await pk.toAddress()).toString();

  return {
    addr: pub,
    encrypted: encrypted,
    wif: privKey,
  };
}

/**
 * @param {String} encWif
 */
async function decrypt(encWif) {
  let passphrase = cmds._getPassphrase();
  if (!passphrase) {
    let result = await cmds.getPassphrase({}, []);
    passphrase = result.passphrase;
    // we don't return just in case they're setting a passphrase to
    // decrypt a previously encrypted file (i.e. for recovery from elsewhere)
  }
  let key128 = await Cipher.deriveKey(passphrase);
  let cipher = Cipher.create(key128);

  return cipher.decrypt(encWif);
}

// tuple example {Promise<[String, Boolean]>}
/**
 * @param {Object} [opts]
 * @param {Boolean} [opts.force]
 * @param {String} plainWif
 */
async function maybeEncrypt(plainWif, opts) {
  let passphrase = cmds._getPassphrase();
  if (!passphrase) {
    let result = await cmds.getPassphrase({}, []);
    passphrase = result.passphrase;
  }
  if (!passphrase) {
    if (opts?.force) {
      throw new Error(`no passphrase with which to encrypt file`);
    }
    return plainWif;
  }

  let key128 = await Cipher.deriveKey(passphrase);
  let cipher = Cipher.create(key128);
  return cipher.encrypt(plainWif);
}

/**
 * @param {Null} _
 * @param {Array<String>} args
 */
async function setDefault(_, args) {
  let addr = args.shift() || "";

  let keyname = await findWif(addr);
  if (!keyname) {
    console.error(`no key matches '${addr}'`);
    process.exit(1);
    return;
  }

  let filepath = Path.join(keysDir, keyname);
  let wif = await maybeReadKeyFile(filepath);
  let pk = new Dashcore.PrivateKey(wif);
  let pub = (await pk.toAddress()).toString();

  console.info("set", defaultWifPath, pub);
  await Fs.writeFile(defaultWifPath, pub, "utf8");
}

// TODO option to specify config dir

/**
 * @param {Object} opts
 * @param {any} opts.dashApi - TODO
 * @param {String} opts.defaultAddr
 * @param {Array<String>} args
 */
async function listKeys({ dashApi, defaultAddr }, args) {
  let wifnames = await listManagedKeynames();

  if (wifnames) {
    // to print 'default staking key' message
    await mustGetAddr({ defaultAddr }, args);
  }

  /**
   * @type Array<{ node: String, error: Error }>
   */
  let warns = [];
  // console.error because console.debug goes to stdout, not stderr
  debug(``);
  debug(`Staking keys: (in ${keysDirRel}/)`);
  debug(``);

  await wifnames.reduce(async function (promise, wifname) {
    await promise;

    let wifpath = Path.join(keysDir, wifname);
    let addr = await maybeReadKeyFile(wifpath, { wif: false }).catch(function (
      err,
    ) {
      warns.push({ node: wifname, error: err });
      return "";
    });
    if (!addr) {
      return;
    }

    console.info(`${addr}`);
  }, Promise.resolve());
  debug(``);

  if (warns.length) {
    console.warn(`Warnings:`);
    warns.forEach(function (warn) {
      console.warn(`${warn.node}: ${warn.error.message}`);
    });
    console.warn(``);
  }
}

/**
 * @param {Object} opts
 * @param {any} opts.dashApi - TODO
 * @param {String} opts.defaultAddr
 * @param {Array<String>} args
 */
async function getAllBalances({ dashApi, defaultAddr }, args) {
  let wifnames = await listManagedKeynames();
  let totals = {
    key: 0,
    stake: 0,
    dividend: 0,
    keyDash: "",
    stakeDash: "",
    dividendDash: "",
  };

  if (wifnames.length) {
    // to print 'default staking key' message
    await mustGetAddr({ defaultAddr }, args);
  }

  /**
   * @type Array<{ node: String, error: Error }>
   */
  let warns = [];
  // console.error because console.debug goes to stdout, not stderr
  debug(``);
  debug(`Staking keys: (in ${keysDirRel}/)`);
  debug(``);
  console.info(
    `|                                    |   🔑 Holdings |   🪧  Stakings |   💸 Earnings |`,
  );
  console.info(
    `| ---------------------------------: | ------------: | ------------: | ------------: |`,
  );
  if (!wifnames.length) {
    console.info(`    (none)`);
  }
  await wifnames.reduce(async function (promise, wifname) {
    await promise;

    let wifpath = Path.join(keysDir, wifname);
    let addr = await maybeReadKeyFile(wifpath, { wif: false }).catch(function (
      err,
    ) {
      warns.push({ node: wifname, error: err });
      return "";
    });
    if (!addr) {
      return;
    }

    /*
    let pk = new Dashcore.PrivateKey(wif);
    let pub = (await pk.toAddress()).toString();
    if (`${pub}.wif` !== wifname) {
      // sanity check
      warns.push({
        node: wifname,
        error: new Error(
          `computed pubkey '${pub}' of WIF does not match filename '${wifname}'`,
        ),
      });
      return;
    }
    */

    process.stdout.write(`| ${addr} |`);

    let balanceInfo = await dashApi.getInstantBalance(addr);
    let balanceDASH = toDASH(balanceInfo.balanceSat);

    let crowdNodeBalance = await CrowdNode.http.GetBalance(addr);
    if (!crowdNodeBalance.TotalBalance) {
      crowdNodeBalance.TotalBalance = 0;
      crowdNodeBalance.TotalDividend = 0;
    }
    let crowdNodeDuffNum = toDuff(crowdNodeBalance.TotalBalance.toString());
    let crowdNodeDASH = toDASH(crowdNodeDuffNum);

    let crowdNodeDivNum = toDuff(crowdNodeBalance.TotalDividend.toString());
    let crowdNodeDivDASH = toDASH(crowdNodeDivNum);
    process.stdout.write(
      ` ${balanceDASH} | ${crowdNodeDASH} | ${crowdNodeDivDASH} |`,
    );

    totals.key += balanceInfo.balanceSat;
    totals.dividend += crowdNodeBalance.TotalDividend;
    totals.stake += crowdNodeBalance.TotalBalance;

    console.info();
  }, Promise.resolve());
  console.info(
    `|                                    |               |               |               |`,
  );
  let total = `|                             Totals`;
  totals.keyDash = toDASH(totals.key);
  totals.stakeDash = toDASH(toDuff(totals.stake.toString()));
  totals.dividendDash = toDASH(toDuff(totals.dividend.toString()));
  console.info(
    `${total} | ${totals.keyDash} | ${totals.stakeDash} | ${totals.dividendDash} |`,
  );
  debug(``);

  if (warns.length) {
    console.warn(`Warnings:`);
    warns.forEach(function (warn) {
      console.warn(`${warn.node}: ${warn.error.message}`);
    });
    console.warn(``);
  }
}

/**
 * @param {String} name - ex: Xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.wif.enc
 */
function isNamedLikeKey(name) {
  // TODO distinguish with .enc extension?
  let hasGoodLength = 34 + 4 === name.length || 34 + 4 + 4 === name.length;
  let knownExt = name.endsWith(".wif") || name.endsWith(".wif.enc");
  let isTmp = name.startsWith(".") || name.startsWith("_");
  return hasGoodLength && knownExt && !isTmp;
}

/**
 * @param {Object} opts
 * @param {any} opts.dashApi - TODO
 * @param {String} opts.addr
 * @param {String} opts.filepath
 * @param {String} opts.insightBaseUrl
 * @param {Array<String>} args
 */
async function removeKey({ addr, dashApi, filepath, insightBaseUrl }, args) {
  let balanceInfo = await dashApi.getInstantBalance(addr);

  let balanceDash = toDash(balanceInfo.balanceSat);
  if (balanceInfo.balanceSat) {
    console.error(``);
    console.error(`Error: ${addr}`);
    console.error(
      `    still has a balance of ${balanceInfo.balanceSat} (Đ${balanceDash})`,
    );
    console.error(`    (transfer to another address before deleting)`);
    console.error(``);
    process.exit(1);
    return;
  }

  await initCrowdNode();
  let crowdNodeBalance = await CrowdNode.http.GetBalance(addr);
  if (!crowdNodeBalance) {
    // may be janky if not registered
    crowdNodeBalance = {};
  }
  if (!crowdNodeBalance.TotalBalance) {
    crowdNodeBalance.TotalBalance = 0;
  }
  let crowdNodeDash = toDash(crowdNodeBalance.TotalBalance);
  if (crowdNodeBalance.TotalBalance) {
    console.error(``);
    console.error(`Error: ${addr}`);
    console.error(
      `    still staking ${crowdNodeBalance.TotalBalance} (Đ${crowdNodeDash}) on CrowdNode`,
    );
    console.error(
      `    (withdraw 100.0 and transfer to another address before deleting)`,
    );
    console.error(``);
    process.exit(1);
    return;
  }

  let wifname = await findWif(addr);
  let fullpath = Path.join(keysDir, wifname);
  let wif = await maybeReadKeyPaths(filepath, { wif: true });

  await Fs.unlink(fullpath).catch(function (err) {
    console.error(`could not remove ${filepath}: ${err.message}`);
    process.exit(1);
  });

  let wifnames = await listManagedKeynames();
  console.info(``);
  console.info(`No balances found. Removing ${filepath}.`);
  console.info(``);
  console.info(`Backup (just in case):`);
  console.info(`    ${wif}`);
  console.info(``);
  if (!wifnames.length) {
    console.info(`No keys left.`);
    console.info(``);
  } else {
    let newAddr = wifnames[0];
    debug(`Selected ${newAddr} as new default staking key.`);
    await Fs.writeFile(defaultWifPath, addr.replace(".wif", ""), "utf8");
    console.info(``);
  }
}

/**
 * @param {String} pre
 */
async function findWif(pre) {
  if (!pre) {
    return "";
  }

  let names = await listManagedKeynames();
  names = names.filter(function (name) {
    return name.startsWith(pre);
  });

  if (!names.length) {
    return "";
  }

  if (names.length > 1) {
    console.error(`'${pre}' is ambiguous:`, names.join(", "));
    process.exit(1);
    return "";
  }

  return names[0];
}

async function listManagedKeynames() {
  let nodes = await Fs.readdir(keysDir);

  return nodes.filter(isNamedLikeKey);
}

/**
 * @param {Object} opts
 * @param {String} opts.defaultAddr
 * @param {String} opts.insightBaseUrl
 * @param {Array<String>} args
 */
async function loadAddr({ defaultAddr, insightBaseUrl }, args) {
  let [addr] = await mustGetAddr({ defaultAddr }, args);

  let desiredDashAmount = parseFloat(args.shift() || "0");
  let desiredSatoshis = Math.round(desiredDashAmount * SATOSHIS);

  let effectiveSats = desiredSatoshis;
  let effectiveDash = "";
  if (!effectiveSats) {
    effectiveSats = CrowdNode.stakeMinimum + signupTotal + feeEstimate;
    effectiveSats = roundDuff(effectiveSats, 3);
    effectiveDash = toDash(effectiveSats);
  }

  await plainLoadAddr({ addr, effectiveDash, effectiveSats, insightBaseUrl });

  return;
}

/**
 * 1000 to Round to the nearest mDash
 * ex: 0.50238108 => 0.50300000
 * @param {Number} effectiveSats
 * @param {Number} numDigits
 */
function roundDuff(effectiveSats, numDigits) {
  let n = Math.pow(10, numDigits);
  let effectiveDash = toDash(effectiveSats);
  effectiveSats = toDuff(
    (Math.ceil(parseFloat(effectiveDash) * n) / n).toString(),
  );
  return effectiveSats;
}

/**
 * @param {Object} opts
 * @param {String} opts.addr
 * @param {String} opts.effectiveDash
 * @param {Number} opts.effectiveSats
 * @param {String} opts.insightBaseUrl
 */
async function plainLoadAddr({ addr, effectiveDash, effectiveSats }) {
  console.info(``);
  showQr(addr, effectiveSats);
  console.info(``);
  console.info(
    `Send Đ${effectiveDash} to your staking key via the QR above, or its address:`,
  );
  console.info(`${addr}`);
  console.info(
    `(this key will be used to fund and control your CrowdNode account)`,
  );
  console.info(``);
  console.info(`(waiting...)`);
  console.info(``);
  let payment = await Ws.waitForVout(dashsocketBaseUrl, addr, 0);
  console.info(`Received ${payment.satoshis}`);
}

/**
 * @param {Object} opts
 * @param {String} opts.defaultAddr
 * @param {any} opts.dashApi - TODO
 * @param {Array<String>} args
 */
async function getBalance({ dashApi, defaultAddr }, args) {
  let [addr] = await mustGetAddr({ defaultAddr }, args);
  await checkBalance({ addr, dashApi });
  //let balanceInfo = await checkBalance({ addr, dashApi });
  //console.info(balanceInfo);
  return;
}

/**
 * @param {Object} opts
 * @param {any} opts.dashApi - TODO
 * @param {String} opts.defaultAddr
 * @param {Boolean} opts.forceConfirm
 * @param {String} opts.insightBaseUrl
 * @param {any} opts.insightApi
 * @param {Array<String>} args
 */
// ex: node ./bin/crowdnode.js transfer Xxxxx 'pub' 0.01
async function transferBalance(
  { dashApi, defaultAddr, forceConfirm, insightApi },
  args,
) {
  /** @type Array<String> */
  let getAddrArgs = [];

  // There are two cases in which we could have only 2 arguments,
  // and the first argument could be an address inside or outside
  // of the wallet.
  //
  // Ex:
  //   crowdnode transfer {source} {dest}
  //   crowdnode transfer {source} {dest} {dash-amount}
  //   crowdnode transfer {dest} {dash-amount}
  //   crowdnode transfer {dest}
  //
  // To disambiguate, we check if the second argument is a dash-amount.
  if (3 === args.length) {
    getAddrArgs = args;
  } else if (2 === args.length) {
    let maybeDashAmount = parseFloat(args[1]);
    let isAddr = isNaN(maybeDashAmount);
    if (isAddr) {
      getAddrArgs = args;
    }
  }
  let wif = await mustGetWif({ defaultAddr }, getAddrArgs);

  let keyname = args.shift() || "";
  let newAddr = await wifFileToAddr(keyname);
  let dashAmount = parseFloat(args.shift() || "0");
  let satoshis = Math.round(dashAmount * SATOSHIS);
  let tx;
  if (satoshis) {
    tx = await dashApi.createPayment(wif, newAddr, satoshis);
  } else {
    tx = await dashApi.createBalanceTransfer(wif, newAddr);
  }
  if (satoshis) {
    let dashAmountStr = toDash(satoshis);
    console.info(
      `Transferring ${satoshis} (Đ${dashAmountStr}) to ${newAddr}...`,
    );
  } else {
    console.info(`Transferring balance to ${newAddr}...`);
  }
  await insightApi.instantSend(tx);
  console.info(`Queued...`);
  setTimeout(function () {
    // TODO take a cleaner approach
    // (waitForVout needs a reasonable timeout)
    console.error(`Error: Transfer did not complete.`);
    if (forceConfirm) {
      console.error(`(using --unconfirmed may lead to rejected double spends)`);
    }
    process.exit(1);
  }, 30 * 1000);
  await Ws.waitForVout(dashsocketBaseUrl, newAddr, 0);
  console.info(`Accepted!`);
  return;
}

/**
 * @param {Object} opts
 * @param {any} opts.dashApi - TODO
 * @param {String} opts.defaultAddr
 * @param {String} opts.insightBaseUrl
 * @param {Array<String>} args
 */
async function getStatus({ dashApi, defaultAddr, insightBaseUrl }, args) {
  let [addr] = await mustGetAddr({ defaultAddr }, args);
  await initCrowdNode();
  let hotwallet = CrowdNode.main.hotwallet;
  let state = await getCrowdNodeStatus({ addr, hotwallet });

  console.info();
  console.info(`API Actions Complete for ${addr}:`);
  console.info(`    ${state.signup} SignUpForApi`);
  console.info(`    ${state.accept} AcceptTerms`);
  console.info(`    ${state.deposit} DepositReceived`);
  console.info();
  let crowdNodeBalance = await CrowdNode.http.GetBalance(addr);
  // may be unregistered / undefined
  /*
   * {
   *   '@odata.context': 'https://app.crowdnode.io/odata/$metadata#Edm.String',
   *   value: 'Address not found.'
   * }
   */
  if (!crowdNodeBalance.TotalBalance) {
    crowdNodeBalance.TotalBalance = 0;
  }
  let crowdNodeDuff = toDuff(crowdNodeBalance.TotalBalance);
  console.info(
    `CrowdNode Stake: ${crowdNodeDuff} (Đ${crowdNodeBalance.TotalBalance})`,
  );
  console.info();
  return;
}

/**
 * @param {Object} opts
 * @param {any} opts.dashApi - TODO
 * @param {String} opts.defaultAddr
 * @param {String} opts.insightBaseUrl
 * @param {Array<String>} args
 */
async function sendSignup({ dashApi, defaultAddr, insightBaseUrl }, args) {
  let [addr, name] = await mustGetAddr({ defaultAddr }, args);
  await initCrowdNode();
  let hotwallet = CrowdNode.main.hotwallet;
  let state = await getCrowdNodeStatus({ addr, hotwallet });
  let balanceInfo = await dashApi.getInstantBalance(addr);

  if (state.status?.signup) {
    console.info(`${addr} is already signed up. Here's the account status:`);
    console.info(`    ${state.signup} SignUpForApi`);
    console.info(`    ${state.accept} AcceptTerms`);
    console.info(`    ${state.deposit} DepositReceived`);
    return;
  }

  let hasEnough = balanceInfo.balanceSat > signupOnly + feeEstimate;
  if (!hasEnough) {
    await collectSignupFees(addr);
  }

  let wif = await maybeReadKeyPaths(name, { wif: true });

  console.info("Requesting account...");
  await CrowdNode.signup(wif, hotwallet);
  state.signup = DONE;
  console.info(`    ${state.signup} SignUpForApi`);
  return;
}

/**
 * @param {Object} opts
 * @param {any} opts.dashApi - TODO
 * @param {String} opts.defaultAddr
 * @param {String} opts.insightBaseUrl
 * @param {Array<String>} args
 */
async function acceptTerms({ dashApi, defaultAddr, insightBaseUrl }, args) {
  let [addr, name] = await mustGetAddr({ defaultAddr }, args);

  await initCrowdNode();
  let hotwallet = CrowdNode.main.hotwallet;
  let state = await getCrowdNodeStatus({ addr, hotwallet });
  let balanceInfo = await dashApi.getInstantBalance(addr);

  if (!state.status?.signup) {
    console.info(`${addr} is not signed up yet. Here's the account status:`);
    console.info(`    ${state.signup} SignUpForApi`);
    console.info(`    ${state.accept} AcceptTerms`);
    process.exit(1);
    return;
  }

  if (state.status?.accept) {
    console.info(`${addr} is already signed up. Here's the account status:`);
    console.info(`    ${state.signup} SignUpForApi`);
    console.info(`    ${state.accept} AcceptTerms`);
    console.info(`    ${state.deposit} DepositReceived`);
    return;
  }
  let hasEnough = balanceInfo.balanceSat > acceptOnly + feeEstimate;
  if (!hasEnough) {
    await collectSignupFees(addr);
  }

  let wif = await maybeReadKeyPaths(name, { wif: true });

  console.info("Accepting terms...");
  await CrowdNode.accept(wif, hotwallet);
  state.accept = DONE;
  console.info(`    ${state.accept} AcceptTerms`);
  return;
}

/**
 * @param {Object} opts
 * @param {any} opts.dashApi - TODO
 * @param {String} opts.defaultAddr
 * @param {String} opts.insightBaseUrl
 * @param {Boolean} opts.noReserve
 * @param {Array<String>} args
 */
async function depositDash({ dashApi, defaultAddr, noReserve }, args) {
  let [addr, name] = await mustGetAddr({ defaultAddr }, args);
  await initCrowdNode();
  let hotwallet = CrowdNode.main.hotwallet;
  let state = await getCrowdNodeStatus({ addr, hotwallet });
  let balanceInfo = await dashApi.getInstantBalance(addr);

  if (!state.status?.accept) {
    console.error(`no account for address ${addr}`);
    process.exit(1);
    return;
  }

  // this would allow for at least 2 withdraws costing (21000 + 1000)
  let reserve = 50000;
  let reserveDash = toDash(reserve);
  if (!noReserve) {
    console.info(
      `reserving ${reserve} (Đ${reserveDash}) for withdraws (--no-reserve to disable)`,
    );
  } else {
    reserve = 0;
  }

  // TODO if unconfirmed, check utxos instead

  // deposit what the user asks, or all that we have,
  // or all that the user deposits - but at least 2x the reserve
  let desiredDashAmount = parseFloat(args.shift() || "0");
  let desiredSatoshis = Math.round(desiredDashAmount * SATOSHIS);
  let effectiveSats = desiredSatoshis;
  if (!effectiveSats) {
    effectiveSats = balanceInfo.balanceSat - reserve;
  }
  let needed = Math.max(reserve * 2, effectiveSats + reserve);

  if (balanceInfo.balanceSat < needed) {
    let ask = 0;
    if (desiredSatoshis) {
      ask = desiredSatoshis + reserve + -balanceInfo.balanceSat;
    }
    await collectDeposit(addr, ask);
    balanceInfo = await dashApi.getInstantBalance(addr);
    if (balanceInfo.balanceSat < needed) {
      let balanceDash = toDash(balanceInfo.balanceSat);
      console.error(
        `Balance is still too small: ${balanceInfo.balanceSat} (Đ${balanceDash})`,
      );
      process.exit(1);
      return;
    }
  }
  if (!desiredSatoshis) {
    effectiveSats = balanceInfo.balanceSat - reserve;
  }

  let effectiveDash = toDash(effectiveSats);
  console.info(`Initiating deposit of ${effectiveSats} (Đ${effectiveDash})...`);

  let wif = await maybeReadKeyPaths(name, { wif: true });

  await CrowdNode.deposit(wif, hotwallet, effectiveSats);
  state.deposit = DONE;
  console.info(`    ${state.deposit} DepositReceived`);
  return;
}

/**
 * @param {Object} opts
 * @param {any} opts.dashApi - TODO
 * @param {String} opts.defaultAddr
 * @param {String} opts.insightBaseUrl
 * @param {Array<String>} args
 */
async function withdrawDash({ dashApi, defaultAddr, insightBaseUrl }, args) {
  let [addr] = await mustGetAddr({ defaultAddr }, args);
  await initCrowdNode();
  let hotwallet = CrowdNode.main.hotwallet;
  let state = await getCrowdNodeStatus({ addr, hotwallet });

  if (!state.status?.accept) {
    console.error(`no account for address ${addr}`);
    process.exit(1);
    return;
  }

  let percentStr = args.shift() || "100.0";
  // pass: .1 0.1, 1, 1.0, 10, 10.0, 100, 100.0
  // fail: 1000, 10.00
  if (!/^1?\d?\d?(\.\d)?$/.test(percentStr)) {
    console.error("Error: withdraw percent must be between 0.1 and 100.0");
    process.exit(1);
  }
  let percent = parseFloat(percentStr);

  let permil = Math.round(percent * 10);
  if (permil <= 0 || permil > 1000) {
    console.error("Error: withdraw percent must be between 0.1 and 100.0");
    process.exit(1);
  }

  let realPercentStr = (permil / 10).toFixed(1);
  console.info(`Initiating withdraw of ${realPercentStr}%...`);

  let wifname = await findWif(addr);
  let filepath = Path.join(keysDir, wifname);
  let wif = await maybeReadKeyFile(filepath);
  let paid = await CrowdNode.withdraw(wif, hotwallet, permil);
  //let paidFloat = (paid.satoshis / SATOSHIS).toFixed(8);
  //let paidInt = paid.satoshis.toString().padStart(9, "0");
  console.info(`API Response: ${paid.api}`);
  return;
}

// Helpers

/**
 * Convert prefix, addr, keyname, or filepath to pub addr
 * @param {String} name
 * @throws
 */
async function wifFileToAddr(name) {
  if (34 === name.length) {
    // actually payment addr
    return name;
  }

  let privKey = "";

  let wifname = await findWif(name);
  if (wifname) {
    let filepath = Path.join(keysDir, wifname);
    privKey = await maybeReadKeyFile(filepath);
  }
  if (!privKey) {
    privKey = await maybeReadKeyFile(name);
  }
  if (!privKey) {
    throw new Error("bad file path or address");
  }

  let pk = new Dashcore.PrivateKey(privKey);
  let pub = (await pk.toPublicKey().toAddress()).toString();
  return pub;
}

/**
 * @param {String} addr
 */
async function collectSignupFees(addr) {
  console.info(``);
  showQr(addr);

  let signupTotalDash = toDash(signupTotal);
  let signupMsg = `Please send >= ${signupTotal} (Đ${signupTotalDash}) to Sign Up to CrowdNode`;
  let msgPad = Math.ceil((qrWidth - signupMsg.length) / 2);
  let subMsg = "(plus whatever you'd like to deposit)";
  let subMsgPad = Math.ceil((qrWidth - subMsg.length) / 2);

  console.info();
  console.info(" ".repeat(msgPad) + signupMsg);
  console.info(" ".repeat(subMsgPad) + subMsg);
  console.info();

  console.info("");
  console.info("(waiting...)");
  console.info("");
  let payment = await Ws.waitForVout(dashsocketBaseUrl, addr, 0);
  console.info(`Received ${payment.satoshis}`);
}

/**
 * @param {String} insightBaseUrl
 * @param {String} addr
 * @param {Number} satoshis
 */
async function collectDeposit(addr, satoshis) {
  console.info(``);
  showQr(addr, satoshis);

  let depositMsg = `Please send what you wish to deposit to ${addr}`;
  if (satoshis) {
    let dashAmount = toDash(satoshis);
    depositMsg = `Please deposit ${satoshis} (Đ${dashAmount}) to ${addr}`;
  }

  let msgPad = Math.ceil((qrWidth - depositMsg.length) / 2);
  msgPad = Math.max(0, msgPad);

  console.info();
  console.info(" ".repeat(msgPad) + depositMsg);
  console.info();

  console.info("");
  console.info("(waiting...)");
  console.info("");
  let payment = await Ws.waitForVout(dashsocketBaseUrl, addr, 0);
  console.info(`Received ${payment.satoshis}`);
}

/**
 * @param {Error & { code: String }} err
 * @throws
 */
function emptyStringOnErrEnoent(err) {
  if ("ENOENT" !== err.code) {
    throw err;
  }
  return "";
}

/**
 * @param {Number} duffs - ex: 00000000
 */
function toDash(duffs) {
  return (duffs / SATOSHIS).toFixed(8);
}

/**
 * @param {Number} duffs - ex: 00000000
 */
function toDASH(duffs) {
  let dash = (duffs / SATOSHIS).toFixed(8);
  return `Đ` + dash.padStart(12, " ");
}

/**
 * @param {String} dash - ex: 0.00000000
 */
function toDuff(dash) {
  return Math.round(parseFloat(dash) * SATOSHIS);
}

// Run

main().catch(function (err) {
  console.error("Fail:");
  console.error(err.stack || err);
  process.exit(1);
});
