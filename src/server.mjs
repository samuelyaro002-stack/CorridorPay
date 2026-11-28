/** Production wiring for the desk. Reads configuration from environment variables. */
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import { withAttribution } from "@celo/attribution-tags";
import { createDeskApp } from "./desk.mjs";
import { DeskPolicy } from "./policy.mjs";
import { createExecutor } from "./payout-runner.mjs";
import { USDT } from "./payout-lib.mjs";
import { normalizeKey } from "./key.mjs";
import { ofacGate } from "./ofac.mjs";

const env = (k, d) => process.env[k] ?? d;
const need = (k) => { const v = process.env[k]; if (!v) { console.error(`Missing ${k}`); process.exit(1); } return v; };

let key;
try { key = normalizeKey(need("AGENT_PRIVATE_KEY")); } catch (e) { console.error(`AGENT_PRIVATE_KEY problem: ${e.message}.`); process.exit(1); }
const code = need("BUILDER_CODE");
const account = privateKeyToAccount(key);
if (env("EXPECTED_WALLET") && account.address.toLowerCase() !== env("EXPECTED_WALLET").toLowerCase()) { console.error(`Key controls ${account.address}, expected ${env("EXPECTED_WALLET")}.`); process.exit(1); }

const pub = createPublicClient({ chain: celo, transport: http() });
const wallet = createWalletClient({ account, chain: celo, transport: http() }).extend(withAttribution(code));
const executor = createExecutor({ account, pub, wallet, code });
const policy = new DeskPolicy({ perPayoutMaxUsdt: Number(env("PER_PAYOUT_MAX_USDT", "10")), perHumanDailyMaxUsdt: Number(env("DAILY_MAX_USDT", "20")) });
const live = env("DESK_LIVE", "0") === "1"; // default: dry-run, nothing is spent

const verifier = SelfAgentVerifier.create().network("mainnet").requireAge(18).includeCredentials().sybilLimit(1).rateLimit({ perMinute: 30 }).build();

const facilitator = new HTTPFacilitatorClient({
  url: "https://api.x402.celo.org",
  createAuthHeaders: async () => { const h = { "X-API-Key": need("X402_API_KEY") }; return { verify: h, settle: h, supported: h }; },
});
const resourceServer = new x402ResourceServer(facilitator);
resourceServer.register("eip155:*", new ExactEvmScheme());
const routes = {
  "POST /api/payout": {
    accepts: [{
      scheme: "exact",
      network: "eip155:42220",
      payTo: account.address,
      price: { amount: env("FEE_ATOMIC", "20000"), asset: USDT, extra: { name: "Tether USD", version: "1" } }, // 0.02 USD₮
    }],
    description: "CorridorPay payout request (Self-verified agents only)",
  },
};

const app = createDeskApp({
  auth: [verifier.auth(), ofacGate], // Self ID check, then the name-based sanctions gate
  payment: paymentMiddleware(routes, resourceServer),
  executor, policy, deskWallet: account.address, tag: code, live,
});
const port = Number(env("PORT", "8787"));
app.listen(port, () => console.log(`CorridorPay desk on :${port} as ${account.address} (${live ? "LIVE" : "dry-run"})`));
