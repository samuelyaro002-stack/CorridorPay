import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { createWalletClient, custom } from "viem";
import { celo } from "viem/chains";
import { toDataSuffix, withAttribution, fromDataSuffix } from "@celo/attribution-tags";
import { CHAIN_ID, TAKER_CONTROL, assertQuoteWithinBudget, interpretQuoteResponse, toMs, validatePayout } from "../src/payout-lib.mjs";

const AGENT = "0x1613E23AD93b7dD91AB23812ce29Ba97547a2341";
const FRIEND = "0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A";

test("validatePayout accepts a normal payout and converts USDT to 6-decimal units", () => {
  const r = validatePayout({ to: FRIEND, usdt: "5", agent: AGENT });
  assert.equal(r.recipient, FRIEND);
  assert.equal(r.sellAmount, 5_000_000n);
});

test("validatePayout refuses a missing or malformed recipient", () => {
  assert.throws(() => validatePayout({ usdt: 5, agent: AGENT }), /--to/);
  assert.throws(() => validatePayout({ to: "0x123", usdt: 5, agent: AGENT }), /--to/);
});

test("validatePayout refuses paying the agent wallet itself", () => {
  assert.throws(() => validatePayout({ to: AGENT.toLowerCase(), usdt: 5, agent: AGENT }), /agent wallet itself/);
});

test("validatePayout enforces the safety cap and a positive amount", () => {
  assert.throws(() => validatePayout({ to: FRIEND, usdt: 500, agent: AGENT }), /safety cap/);
  assert.equal(validatePayout({ to: FRIEND, usdt: 500, max: 1000, agent: AGENT }).sellAmount, 500_000_000n);
  assert.throws(() => validatePayout({ to: FRIEND, usdt: 0, agent: AGENT }), /--usdt/);
  assert.throws(() => validatePayout({ to: FRIEND, usdt: "abc", agent: AGENT }), /--usdt/);
});

test("quote budget guard blocks a quote that costs more than approved", () => {
  assert.doesNotThrow(() => assertQuoteWithinBudget({ takerPays: "5000000" }, 5_000_000n));
  assert.throws(() => assertQuoteWithinBudget({ takerPays: "5000001" }, 5_000_000n), /higher than/);
});

test("toMs handles ISO strings, seconds and milliseconds", () => {
  const iso = "2026-11-27T12:00:00.000Z";
  assert.equal(toMs(iso), Date.parse(iso));
  assert.equal(toMs(1_795_000_000), 1_795_000_000_000);
  assert.equal(toMs(1_795_000_000_000), 1_795_000_000_000);
});

test("interpretQuoteResponse separates quotes, no-quote results and HTTP errors", () => {
  assert.equal(interpretQuoteResponse(200, { data: { status: "quoted", rfqId: "rfq_1" } }).ok, true);
  const nq = interpretQuoteResponse(200, { data: { status: "no_quote", reason: "no_makers_online", retryAfterMs: 2000 } });
  assert.equal(nq.ok, false);
  assert.match(nq.message, /no_makers_online/);
  assert.match(nq.message, /2000/);
  const err = interpretQuoteResponse(401, { error: { code: "unauthorized" } });
  assert.equal(err.ok, false);
  assert.match(err.message, /401/);
});

test("the Taker Control signature verifies as the agent wallet", async () => {
  const account = privateKeyToAccount("0x" + "1".repeat(64));
  const message = { taker: account.address, chainId: BigInt(CHAIN_ID), nonce: "0x" + "ab".repeat(32), issuedAt: 1_795_000_000_000n };
  const signature = await account.signTypedData({ ...TAKER_CONTROL, message });
  const signer = await recoverTypedDataAddress({ ...TAKER_CONTROL, message, signature });
  assert.equal(signer, account.address);
});

test("the wallet client appends the attribution tag to a raw transaction", async () => {
  const code = "celo_046f6be4dc48";
  let raw;
  const transport = custom({
    request: async ({ method, params }) => {
      if (method === "eth_sendRawTransaction") { raw = params[0]; return "0x" + "00".repeat(32); }
      if (method === "eth_chainId") return "0xa4ec";
      if (method === "eth_getTransactionCount") return "0x0";
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas") return "0x1";
      if (method === "eth_getBlockByNumber") return { baseFeePerGas: "0x1", number: "0x1", timestamp: "0x1" };
      return "0x0";
    },
  });
  const wallet = createWalletClient({ account: privateKeyToAccount("0x" + "1".repeat(64)), chain: celo, transport }).extend(withAttribution(code));
  await wallet.sendTransaction({ to: FRIEND, data: "0xdeadbeef", value: 0n });
  assert.ok(raw, "a transaction was built");
  assert.ok(raw.includes(toDataSuffix(code).slice(2)), "raw transaction carries the tag suffix");
  assert.ok(fromDataSuffix);
});

import { encodeAbiParameters, pad } from "viem";
import { cngnReceivedFromLogs } from "../src/payout-lib.mjs";
import { CNGN as CNGN_ADDR } from "../src/payout-lib.mjs";

test("cngnReceivedFromLogs sums cNGN transfers to the agent and ignores others", () => {
  const agent = "0x1613E23AD93b7dD91AB23812ce29Ba97547a2341";
  const other = "0x0000000000000000000000000000000000000001";
  const topic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const mk = (address, to, v) => ({ address, topics: [topic, pad(other), pad(to)], data: encodeAbiParameters([{ type: "uint256" }], [v]), blockNumber: 1n, transactionHash: "0x" + "00".repeat(32), transactionIndex: 0, blockHash: "0x" + "00".repeat(32), logIndex: 0, removed: false });
  const logs = [mk(CNGN_ADDR, agent, 7_190_344_889n), mk(CNGN_ADDR, other, 5n), mk("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", agent, 9n)];
  assert.equal(cngnReceivedFromLogs(logs, agent), 7_190_344_889n);
});
