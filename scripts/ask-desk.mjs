/**
 * Acts as the Self-registered "treasury agent": asks a CorridorPay desk to pay someone.
 * The request is signed with the agent's Self Agent ID, and the desk's small x402 fee is paid in USDT.
 *
 *   node scripts/ask-desk.mjs --desk http://localhost:8787 --to 0xRecipient --usdt 4
 *
 * The agent key comes from .self/agent.key (written by `self-agent register export --out-key`) or SELF_AGENT_KEY.
 * Needs a little USDT (about 0.05) in the agent's wallet for the x402 fee. No gas needed.
 */
import { existsSync, readFileSync } from "node:fs";
import { SelfAgent } from "@selfxyz/agent-sdk";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { selfSignedFetch } from "../src/self-fetch.mjs";

const stop = (m) => { console.error(`\nSTOP: ${m}`); process.exit(1); };
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };

const desk = arg("desk"), to = arg("to"), usdt = arg("usdt");
if (!desk || !/^https?:\/\//.test(desk)) stop("Give the desk URL with --desk https://...");
if (!to || !usdt) stop("Give --to 0xRecipient and --usdt 4");

let key = process.env.SELF_AGENT_KEY;
const keyFile = new URL("../.self/agent.key", import.meta.url);
if (!key && existsSync(keyFile)) key = readFileSync(keyFile, "utf8").trim();
if (!key) stop("No agent key. Export it with `npx.cmd self-agent register export --session .self/session.json --unsafe --out-key .self/agent.key`.");
if (!key.startsWith("0x")) key = `0x${key}`;
if (!/^0x[0-9a-fA-F]{64}$/.test(key)) stop("The agent key file does not look like a private key.");

const account = privateKeyToAccount(key);
const agent = new SelfAgent({ privateKey: key, network: "mainnet" });
console.log(`Self agent:  ${account.address}`);
console.log(`Registered:  ${await agent.isRegistered().catch(() => "unknown")}`);

const USDT = getAddress("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e");
const client = new x402Client();
client.setSpendControls({
  allowedAssets: [{ network: "eip155:42220", asset: USDT, maxAmountPerPayment: "100000" }], // never pay more than 0.10 USDT fee
  maxAmountPerPayment: "$0.10",
});
client.register("eip155:*", new ExactEvmScheme(account));
const payFetch = wrapFetchWithPayment(selfSignedFetch(agent), client);

const res = await payFetch(`${desk.replace(/\/$/, "")}/api/payout`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ to, usdt }),
});
console.log(`\nHTTP ${res.status}`);
console.log(JSON.stringify(await res.json().catch(() => ({})), null, 2));
