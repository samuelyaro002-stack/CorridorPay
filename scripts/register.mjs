/**
 * Registers CorridorPay's ERC-8004 identity on Celo mainnet.
 *
 *   npm run register        dry run: checks everything, sends nothing
 *   npm run register:send   broadcasts the registration
 *
 * The wallet that sends this transaction OWNS the identity, so it must be the wallet on your
 * hackathon entry. The attribution tag is attached where the wallet client is built.
 */
import { readFileSync } from "node:fs";
import { verifyTx, withAttribution } from "@celo/attribution-tags";
import { createPublicClient, createWalletClient, formatEther, http, parseEventLogs } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

const REGISTRY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const ABI = [
  { type: "function", name: "register", stateMutability: "nonpayable", inputs: [{ name: "agentURI", type: "string" }], outputs: [{ name: "agentId", type: "uint256" }] },
  { type: "event", name: "Registered", inputs: [{ name: "agentId", type: "uint256", indexed: true }, { name: "agentURI", type: "string" }, { name: "owner", type: "address", indexed: true }] },
];

const stop = (m) => { console.error(`\nSTOP: ${m}`); process.exit(1); };
const send = process.argv.includes("--send");

// minimal .env loader (no extra dependency)
try {
  for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch { /* no .env file: rely on real environment variables */ }

const key = process.env.AGENT_PRIVATE_KEY;
const code = process.env.BUILDER_CODE;
const expected = process.env.EXPECTED_WALLET;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) stop("AGENT_PRIVATE_KEY missing or not a 0x + 64 hex key.");
if (!code || !/^[a-z0-9_]{1,32}$/.test(code)) stop("BUILDER_CODE missing or invalid.");

const account = privateKeyToAccount(key);
if (expected && account.address.toLowerCase() !== expected.toLowerCase()) {
  stop(`This key controls ${account.address}, not the expected wallet ${expected}. Wrong key.`);
}

const card = JSON.parse(readFileSync(new URL("../agent.json", import.meta.url), "utf8"));
const agentURI = process.env.AGENT_URI
  || `data:application/json;base64,${Buffer.from(JSON.stringify(card)).toString("base64")}`;

console.log(`Wallet (will own the identity): ${account.address}`);
console.log(`Attribution tag:                ${code}`);
console.log(`Agent URI:                      ${agentURI.length > 90 ? agentURI.slice(0, 90) + "…" : agentURI}`);

const pub = createPublicClient({ chain: celo, transport: http() });
const bal = await pub.getBalance({ address: account.address });
console.log(`Balance:                        ${formatEther(bal)} CELO`);
if (bal < 10n ** 16n) stop("need at least 0.01 CELO for gas.");

const { request } = await pub.simulateContract({ account, address: REGISTRY, abi: ABI, functionName: "register", args: [agentURI] });
console.log("Simulation:                     OK");

if (!send) {
  console.log("\nDry run complete. Run `npm run register:send` to broadcast.");
  process.exit(0);
}

const wallet = createWalletClient({ account, chain: celo, transport: http() }).extend(withAttribution(code));
const hash = await wallet.writeContract(request);
console.log(`\nSent: ${hash}\nWaiting for confirmation...`);
const receipt = await pub.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") stop(`reverted: https://celoscan.io/tx/${hash}`);

const [ev] = parseEventLogs({ abi: ABI, eventName: "Registered", logs: receipt.logs });
console.log(`\nREGISTERED. Agent ID: ${ev?.args.agentId}`);
console.log(`Celoscan: https://celoscan.io/tx/${hash}`);
const tagged = await verifyTx({ client: pub, hash });
console.log(`Tag onchain: ${tagged ? tagged.codes.join(",") : "NOT FOUND"} ${tagged?.codes.includes(code) ? "(matches)" : "(CHECK THIS)"}`);
