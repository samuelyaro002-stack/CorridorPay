import assert from "node:assert/strict";
import { test } from "node:test";
import { DeskPolicy } from "../src/policy.mjs";
import { createDeskApp } from "../src/desk.mjs";

const DESK = "0x1613E23AD93b7dD91AB23812ce29Ba97547a2341";
const TO = "0x902909eB559A46e4A90F7292A028b32D50D6afD8";

test("policy: per-payout cap, daily cap per human, and rolling window", () => {
  let t = 1_000_000;
  const p = new DeskPolicy({ perPayoutMaxUsdt: 10, perHumanDailyMaxUsdt: 15, now: () => t });
  assert.equal(p.check("h1", 11).status, 403);
  assert.equal(p.check("h1", 0).status, 400);
  assert.equal(p.check(undefined, 1).status, 403);
  assert.ok(p.check("h1", 10).ok);
  p.record("h1", 10);
  assert.equal(p.check("h1", 6).status, 429);
  assert.ok(p.check("h1", 5).ok);
  assert.ok(p.check("h2", 10).ok, "another human has their own allowance");
  t += 25 * 60 * 60 * 1000;
  assert.ok(p.check("h1", 10).ok, "allowance resets after 24 hours");
});

async function withDesk({ verified = true, live = false, fail = false } = {}, fn) {
  const calls = [];
  const executor = { run: async (a) => { calls.push(a); if (fail) throw new Error("boom"); return a.live ? { mode: "live", cngnPaid: "5760.0", tx: {} } : { mode: "dry-run", cngnQuoted: "5760.0" }; } };
  const auth = (req, res, next) => {
    if (!verified) return res.status(401).json({ error: "not a verified agent" });
    req.agent = { address: "0x8896c0d3b1c1529866710Cf9AF2b1F629f31549C", agentId: 233n, nullifier: 42n };
    next();
  };
  let paid = 0;
  const payment = (_req, _res, next) => { paid++; next(); };
  const app = createDeskApp({ auth, payment, executor, policy: new DeskPolicy({ perPayoutMaxUsdt: 10, perHumanDailyMaxUsdt: 12 }), deskWallet: DESK, tag: "celo_test", live });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(`${base}/api/payout`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try { await fn({ base, post, calls, paid: () => paid }); } finally { server.close(); }
}

test("unverified agents are rejected before payment or payout", async () => {
  await withDesk({ verified: false }, async ({ post, calls, paid }) => {
    const r = await post({ to: TO, usdt: 4 });
    assert.equal(r.status, 401);
    assert.equal(paid(), 0);
    assert.equal(calls.length, 0);
  });
});

test("verified agent gets a dry-run quote by default and nothing is recorded as spent", async () => {
  await withDesk({}, async ({ post, calls }) => {
    const r = await post({ to: TO, usdt: 4 });
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.mode, "dry-run");
    assert.equal(j.caller.agentId, "233");
    assert.equal(calls[0].live, false);
    // dry runs do not use up the daily allowance
    assert.equal((await post({ to: TO, usdt: 10 })).status, 200);
    assert.equal((await post({ to: TO, usdt: 10 })).status, 200);
  });
});

test("live payouts count against the human's daily limit", async () => {
  await withDesk({ live: true }, async ({ post }) => {
    assert.equal((await post({ to: TO, usdt: 10 })).status, 200);
    assert.equal((await post({ to: TO, usdt: 5 })).status, 429);
  });
});

test("bad input is refused: self-payment, bad address, over per-payout cap", async () => {
  await withDesk({}, async ({ post, calls }) => {
    assert.equal((await post({ to: DESK, usdt: 4 })).status, 400);
    assert.equal((await post({ to: "nope", usdt: 4 })).status, 400);
    assert.equal((await post({ to: TO, usdt: 11 })).status, 400);
    assert.equal(calls.length, 0);
  });
});

test("an executor failure returns 502 so x402 will not settle the fee", async () => {
  await withDesk({ fail: true }, async ({ post }) => {
    const r = await post({ to: TO, usdt: 4 });
    assert.equal(r.status, 502);
  });
});

test("public info endpoint describes the policy and mode", async () => {
  await withDesk({}, async ({ base }) => {
    const j = await (await fetch(base)).json();
    assert.match(j.mode, /dry-run/);
    assert.equal(j.wallet, DESK);
    assert.equal(j.policy.perPayoutMaxUsdt, 10);
  });
});
