import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeskApp } from "../src/desk.mjs";
import { DeskPolicy } from "../src/policy.mjs";

function setup(relayFetch) {
  const app = createDeskApp({ auth: (_q, r) => r.status(401).json({}), payment: (_q, _r, n) => n(), executor: {}, policy: new DeskPolicy(), deskWallet: "0x1613E23AD93b7dD91AB23812ce29Ba97547a2341", tag: "celo_test", relayFetch });
  const server = app.listen(0);
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test("relay forwards allowed Textile paths with CORS and the claim header", async () => {
  const calls = [];
  const { server, base } = setup(async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ data: { status: "quoted" } }), { status: 200 }); });
  try {
    const pre = await fetch(`${base}/relay/rfq/request`, { method: "OPTIONS" });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), "*");
    const r = await fetch(`${base}/relay/rfq/request`, { method: "POST", headers: { "content-type": "application/json", "x-rfq-claim": "abc" }, body: JSON.stringify({ a: 1 }) });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), "*");
    assert.equal(calls[0].url, "https://api.textilecredit.com/v2/rfq/request");
    assert.equal(calls[0].init.headers["X-Rfq-Claim"], "abc");
    await fetch(`${base}/relay/rfq/rfq_123456/submit`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(calls[1].url, "https://api.textilecredit.com/v2/rfq/rfq_123456/submit");
  } finally { server.close(); }
});

test("relay refuses any other Textile path", async () => {
  let called = false;
  const { server, base } = setup(async () => { called = true; return new Response("{}"); });
  try {
    for (const p of ["admin/keys", "rfq/../keys", "rfq/abc/delete"]) {
      const r = await fetch(`${base}/relay/${p}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      assert.equal(r.status, 404, p);
    }
    assert.equal(called, false);
  } finally { server.close(); }
});
