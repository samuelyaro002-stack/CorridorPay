/**
 * CorridorPay payout: USDT -> cNGN on Textile FX, then send the cNGN to a contributor, on Celo mainnet.
 * Every transaction carries the hackathon attribution tag (added where the wallet client is built).
 *
 *   node scripts/payout.mjs --to 0xRecipient --usdt 5          # dry run: firm quote, then cancels it. Sends nothing.
 *   node scripts/payout.mjs --to 0xRecipient --usdt 5 --send   # real payout (approve, swap, transfer)
 *
 * Needs .env with AGENT_PRIVATE_KEY, EXPECTED_WALLET, BUILDER_CODE (see .env.example).
 */
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { verifyTx, withAttribution } from "@celo/attribution-tags";
import { createPublicClient, createWalletClient, formatUnits, getAddress, http, isAddress, parseUnits, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

const API = "https://api.textilecredit.com/v2";
const CHAIN_ID = 42220;
const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const CNGN = "0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f";
const MAX_USDT_DEFAULT = 25; // safety cap per payout; override with --max

const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
];

const stop = (m) => { console.error(`\nSTOP: ${m}`); process.exit(1); };
const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };
const send = process.argv.includes("--send");

try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch { /* no .env */ }

const key = process.env.AGENT_PRIVATE_KEY, code = process.env.BUILDER_CODE, expected = process.env.EXPECTED_WALLET;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) stop("AGENT_PRIVATE_KEY missing or invalid.");
if (!code || !/^[a-z0-9_]{1,32}$/.test(code)) stop("BUILDER_CODE missing or invalid.");
const account = privateKeyToAccount(key);
if (expected && account.address.toLowerCase() !== expected.toLowerCase()) stop(`Key controls ${account.address}, expected ${expected}.`);

const to = arg("to");
if (!to || !isAddress(to)) stop("Give the recipient with --to 0x... (a Celo wallet address).");
const recipient = getAddress(to);
if (recipient === account.address) stop("Recipient is the agent wallet itself. A payout must go to someone else.");
const usdt = Number(arg("usdt"));
const maxUsdt = Number(arg("max") ?? MAX_USDT_DEFAULT);
if (!(usdt > 0)) stop("Give the amount with --usdt 5");
if (usdt > maxUsdt) stop(`--usdt ${usdt} is above the safety cap of ${maxUsdt}. Raise it with --max if you really mean it.`);
const sellAmount = parseUnits(String(usdt), 6);

const pub = createPublicClient({ chain: celo, transport: http() });
const wallet = createWalletClient({ account, chain: celo, transport: http() }).extend(withAttribution(code));

const cngnDecimals = await pub.readContract({ address: CNGN, abi: ERC20, functionName: "decimals" });
const bal = async (token) => pub.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [account.address] });
const [usdtBal, cngnBal0, celoBal] = await Promise.all([bal(USDT), bal(CNGN), pub.getBalance({ address: account.address })]);
console.log(`Agent wallet:  ${account.address}`);
console.log(`Recipient:     ${recipient}`);
console.log(`Tag:           ${code}`);
console.log(`Balances:      ${formatUnits(usdtBal, 6)} USDT, ${formatUnits(cngnBal0, cngnDecimals)} cNGN, ${formatUnits(celoBal, 18)} CELO`);
if (usdtBal < sellAmount) stop(`Wallet holds ${formatUnits(usdtBal, 6)} USDT but the payout needs ${usdt}. Fund it first.`);
if (celoBal < 10n ** 16n) stop("Need at least 0.01 CELO for gas.");

// 1. firm quote (keyless: sign a takerProof with the agent wallet)
const issuedAt = Date.now();
const nonce = toHex(randomBytes(32));
const signature = await account.signTypedData({
  domain: { name: "Textile Taker Control", version: "1", chainId: CHAIN_ID },
  types: { TakerControl: [{ name: "taker", type: "address" }, { name: "chainId", type: "uint256" }, { name: "nonce", type: "bytes32" }, { name: "issuedAt", type: "uint256" }] },
  primaryType: "TakerControl",
  message: { taker: account.address, chainId: BigInt(CHAIN_ID), nonce, issuedAt: BigInt(issuedAt) },
});
const res = await fetch(`${API}/rfq/request`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chainId: CHAIN_ID, sellToken: USDT, buyToken: CNGN, sellAmount: sellAmount.toString(), taker: account.address, takerProof: { nonce, issuedAt, signature } }),
  signal: AbortSignal.timeout(75_000),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) stop(`Textile returned HTTP ${res.status}: ${JSON.stringify(body)}`);
const rfq = body.data;
if (rfq?.status !== "quoted") stop(`No quote (${rfq?.status}${rfq?.reason ? ": " + rfq.reason : ""}). ${rfq?.retryAfterMs ? `Retry in ${rfq.retryAfterMs} ms.` : "Try again shortly."}`);

const q = rfq.quote;
const toMs = (v) => { const n = typeof v === "number" ? v : Date.parse(v); return n < 1e12 ? n * 1000 : n; };
console.log(`\nQuote:         pay ${formatUnits(BigInt(q.takerPays), 6)} USDT -> receive ${formatUnits(BigInt(q.buyAmount), cngnDecimals)} cNGN (fee ${formatUnits(BigInt(q.feeAmount), 6)} USDT)`);
console.log(`Quote expires: ${new Date(toMs(q.expiresAt)).toISOString()}`);
if (BigInt(q.takerPays) > sellAmount) stop("takerPays is higher than the amount you asked to spend. Aborting.");

const claim = { "X-Rfq-Claim": rfq.claimToken, "Content-Type": "application/json" };
if (!send) {
  await fetch(`${API}/rfq/${rfq.rfqId}/cancel`, { method: "POST", headers: claim }).catch(() => {});
  console.log("\nDry run complete: quote released, nothing sent. Add --send to pay for real.");
  process.exit(0);
}

const wait = async (hash, label) => {
  console.log(`${label}: ${hash}`);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") stop(`${label} reverted: https://celoscan.io/tx/${hash}`);
  return r;
};
const receipt = { at: new Date().toISOString(), agent: account.address, recipient, tag: code, rfqId: rfq.rfqId, usdtSpent: formatUnits(BigInt(q.takerPays), 6), tx: {} };

// 2. approval (only if needed; USDT-style tokens need allowance reset to 0 first)
const reactor = q.reactor;
const allowance = await pub.readContract({ address: USDT, abi: ERC20, functionName: "allowance", args: [account.address, reactor] });
if (allowance < BigInt(q.takerPays)) {
  if (allowance > 0n) {
    const h0 = await wallet.writeContract({ address: USDT, abi: ERC20, functionName: "approve", args: [reactor, 0n] });
    await wait(h0, "Allowance reset");
  }
  const a = rfq.transactions.approval;
  const h1 = await wallet.sendTransaction({ to: a.to, data: a.data, value: 0n });
  receipt.tx.approval = h1;
  await wait(h1, "Approval");
}

// 3. swap (broadcast exactly as returned; our wallet client appends the tag)
if (Date.now() >= toMs(q.expiresAt)) stop("The quote expired while approving. Nothing was swapped. Run again for a new quote.");
const s = rfq.transactions.swap;
const h2 = await wallet.sendTransaction({ to: s.to, data: s.data, value: 0n });
receipt.tx.swap = h2;
await wait(h2, "Swap");
await fetch(`${API}/rfq/${rfq.rfqId}/submit`, { method: "POST", headers: claim, body: JSON.stringify({ txHash: h2 }) }).catch(() => {});

// 4. pay the contributor exactly what the swap delivered
const cngnBal1 = await bal(CNGN);
const received = cngnBal1 - cngnBal0;
if (received <= 0n) stop("Swap confirmed but no cNGN arrived. Check Celoscan before doing anything else.");
receipt.cngnPaid = formatUnits(received, cngnDecimals);
const h3 = await wallet.writeContract({ address: CNGN, abi: ERC20, functionName: "transfer", args: [recipient, received] });
receipt.tx.payout = h3;
await wait(h3, "Payout");

for (const [name, h] of Object.entries(receipt.tx)) {
  const t = await verifyTx({ client: pub, hash: h });
  receipt.tx[name] = { hash: h, tagged: !!t?.codes.includes(code), celoscan: `https://celoscan.io/tx/${h}` };
}
mkdirSync(new URL("../receipts/", import.meta.url), { recursive: true });
const file = new URL("../receipts/payouts.json", import.meta.url);
const all = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : [];
all.push(receipt);
writeFileSync(file, JSON.stringify(all, null, 2));
console.log(`\nDONE. Paid ${receipt.cngnPaid} cNGN to ${recipient}`);
for (const [n, v] of Object.entries(receipt.tx)) console.log(`  ${n.padEnd(8)} ${v.tagged ? "tagged" : "NOT TAGGED"}  ${v.celoscan}`);
console.log("Saved to receipts/payouts.json");
