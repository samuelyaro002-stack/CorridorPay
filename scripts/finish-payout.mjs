/**
 * Finishes a payout whose swap already confirmed but whose final transfer did not run.
 * It reads the swap's own logs to find exactly how much cNGN the swap delivered, then sends that
 * amount to the contributor. Sends nothing without --send.
 *
 *   node scripts/finish-payout.mjs --swap 0xSWAPHASH --approval 0xAPPROVALHASH --to 0xRecipient
 *   node scripts/finish-payout.mjs --swap 0x... --approval 0x... --to 0x... --send
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { verifyTx, withAttribution } from "@celo/attribution-tags";
import { createPublicClient, createWalletClient, formatUnits, getAddress, http, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { CNGN, USDT, cngnReceivedFromLogs } from "../src/payout-lib.mjs";

const stop = (m) => { console.error(`\nSTOP: ${m}`); process.exit(1); };
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };
const send = process.argv.includes("--send");
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch { /* no .env */ }
const key = process.env.AGENT_PRIVATE_KEY, code = process.env.BUILDER_CODE, expected = process.env.EXPECTED_WALLET;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) stop("AGENT_PRIVATE_KEY missing or invalid.");
if (!code) stop("BUILDER_CODE missing.");
const account = privateKeyToAccount(key);
if (expected && account.address.toLowerCase() !== expected.toLowerCase()) stop(`Key controls ${account.address}, expected ${expected}.`);
const swap = arg("swap"), approval = arg("approval"), to = arg("to");
if (!/^0x[0-9a-fA-F]{64}$/.test(swap ?? "")) stop("Give the swap hash with --swap 0x...");
if (!to || !isAddress(to)) stop("Give the recipient with --to 0x...");
const recipient = getAddress(to);
if (recipient === account.address) stop("Recipient is the agent wallet itself.");

const pub = createPublicClient({ chain: celo, transport: http() });
const wallet = createWalletClient({ account, chain: celo, transport: http() }).extend(withAttribution(code));
const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
];

const r = await pub.getTransactionReceipt({ hash: swap }).catch((e) => stop(`Could not read the swap receipt: ${e.shortMessage ?? e.message}`));
if (r.status !== "success") stop("That swap transaction did not succeed.");
if (r.from.toLowerCase() !== account.address.toLowerCase()) stop("That swap was not sent by the agent wallet.");
const amount = cngnReceivedFromLogs(r.logs, account.address);
const dec = await pub.readContract({ address: CNGN, abi: ERC20, functionName: "decimals" });
console.log(`Swap ${swap}`);
console.log(`cNGN delivered by the swap (from its logs): ${formatUnits(amount, dec)}`);
if (amount <= 0n) stop("The swap's logs show no cNGN delivered to the agent wallet. Open the swap on Celoscan and send me what it shows.");

let bal = 0n;
for (let i = 0; i < 8; i++) {
  bal = await pub.readContract({ address: CNGN, abi: ERC20, functionName: "balanceOf", args: [account.address] });
  if (bal >= amount) break;
  await new Promise((res) => setTimeout(res, 4000));
}
console.log(`Agent wallet cNGN balance now: ${formatUnits(bal, dec)}`);
if (bal < amount) stop("The wallet balance is lower than what the swap delivered. Check Celoscan before sending anything.");
console.log(`Recipient: ${recipient}`);
if (!send) { console.log("\nChecks passed. Add --send to pay the recipient."); process.exit(0); }

const h = await wallet.writeContract({ address: CNGN, abi: ERC20, functionName: "transfer", args: [recipient, amount] });
console.log(`Payout: ${h}`);
const pr = await pub.waitForTransactionReceipt({ hash: h });
if (pr.status !== "success") stop(`Payout reverted: https://celoscan.io/tx/${h}`);

const tx = {};
for (const [name, hash] of [["approval", approval], ["swap", swap], ["payout", h]]) {
  if (!hash) continue;
  const t = await verifyTx({ client: pub, hash }).catch(() => null);
  tx[name] = { hash, tagged: !!t?.codes.includes(code), celoscan: `https://celoscan.io/tx/${hash}` };
}
const receipt = { at: new Date().toISOString(), agent: account.address, recipient, tag: code, usdtSpent: "5", cngnPaid: formatUnits(amount, dec), note: "Swap confirmed first; final transfer completed by finish-payout.mjs after a balance read lagged.", tx };
mkdirSync(new URL("../receipts/", import.meta.url), { recursive: true });
const file = new URL("../receipts/payouts.json", import.meta.url);
const all = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
all.push(receipt);
writeFileSync(file, JSON.stringify(all, null, 2));
console.log(`\nDONE. Paid ${receipt.cngnPaid} cNGN to ${recipient}`);
for (const [n, v] of Object.entries(tx)) console.log(`  ${n.padEnd(8)} ${v.tagged ? "tagged" : "NOT TAGGED"}  ${v.celoscan}`);
