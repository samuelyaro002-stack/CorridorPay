import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeskApp } from "../src/desk.mjs";
import { DeskPolicy } from "../src/policy.mjs";

test("public GET endpoints allow cross-origin reads; the payout route does not add CORS", async () => {
  const app = createDeskApp({ auth: (_q, r) => r.status(401).json({}), payment: (_q, _r, n) => n(), executor: {}, policy: new DeskPolicy(), deskWallet: "0x1613E23AD93b7dD91AB23812ce29Ba97547a2341", tag: "celo_test" });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ["/", "/health", "/api/receipts"]) {
      const r = await fetch(base + path);
      assert.equal(r.status, 200, path);
      assert.equal(r.headers.get("access-control-allow-origin"), "*", path);
    }
    const post = await fetch(`${base}/api/payout`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(post.headers.get("access-control-allow-origin"), null);
  } finally { server.close(); }
});
