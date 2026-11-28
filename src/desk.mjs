/**
 * The CorridorPay desk: an HTTP service that pays contributors in cNGN on behalf of
 * Self-verified agents. Order on POST /api/payout:
 *   1. Self Agent ID check (unverified agents never even see a price),
 *   2. x402 payment of the service fee,
 *   3. policy limits (per payout, and per human per day),
 *   4. the payout itself.
 * Everything that touches the network is injected, so the logic is testable offline.
 */
import express from "express";
import { validatePayout } from "./payout-lib.mjs";
import { mountRelay } from "./relay.mjs";

export function createDeskApp({ auth, payment, executor, policy, deskWallet, tag, live = false, recent = [], relayFetch = fetch }) {
  const app = express();
  app.disable("x-powered-by");
  // The public status endpoints are read-only, so the demo page on GitHub Pages may read them.
  app.use((req, res, next) => { if (req.method === "GET") res.set("Access-Control-Allow-Origin", "*"); next(); });
  app.use(express.json({ limit: "4kb", verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); } }));

  mountRelay(app, { fetchImpl: relayFetch });

  const info = () => ({
    name: "CorridorPay desk",
    what: "Pays contributors in cNGN (via Textile FX) for Self-verified agents. USD₮ to cNGN on Celo mainnet.",
    mode: live ? "live" : "dry-run (quotes only, nothing is spent)",
    wallet: deskWallet,
    attributionTag: tag,
    policy: policy.describe(),
    how: {
      endpoint: "POST /api/payout",
      body: { to: "0x… recipient wallet on Celo", usdt: "amount in USDT, e.g. 4" },
      identity: "Sign the request with a Self Agent ID (x-self-agent-address, x-self-agent-signature, x-self-agent-timestamp). Unverified agents get 401/403.",
      payment: "x402 service fee in USD₮ on Celo (eip155:42220).",
    },
  });
  app.get("/", (_req, res) => res.json(info()));
  app.get("/health", (_req, res) => res.json({ ok: true, mode: live ? "live" : "dry-run" }));
  app.get("/api/receipts", (_req, res) => res.json(recent.slice(-20)));

  let busy = false;
  app.post("/api/payout", auth, payment, async (req, res) => {
    const agent = req.agent;
    if (!agent) return res.status(401).json({ error: "Self Agent ID verification is required." });
    const humanId = agent.nullifier?.toString();
    let parsed;
    try {
      parsed = validatePayout({ to: req.body?.to, usdt: req.body?.usdt, max: policy.perPayoutMaxUsdt, agent: deskWallet });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const usdt = Number(req.body.usdt);
    const verdict = policy.check(humanId, usdt);
    if (!verdict.ok) return res.status(verdict.status).json({ error: verdict.error });
    if (busy) return res.status(429).json({ error: "The desk is finishing another payout. Try again in a minute." });
    busy = true;
    try {
      const result = await executor.run({ to: parsed.recipient, usdt, live });
      if (result.mode === "live") {
        policy.record(humanId, usdt);
        recent.push({ at: new Date().toISOString(), caller: { agentId: String(agent.agentId), address: agent.address }, ...result });
      }
      res.json({ ok: true, caller: { agentId: String(agent.agentId), address: agent.address }, ...result });
    } catch (e) {
      // 5xx means x402 does not settle, so the caller is not charged for a payout that did not happen.
      res.status(502).json({ error: `Payout failed: ${e.message}` });
    } finally {
      busy = false;
    }
  });

  return app;
}
