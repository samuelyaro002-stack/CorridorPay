import assert from "node:assert/strict";
import { test } from "node:test";
import { selfSignedFetch } from "../src/self-fetch.mjs";

test("a Request is turned into (url, options) for SelfAgent.fetch, body as a string", async () => {
  const seen = [];
  const agent = { fetch: async (url, options) => { seen.push({ url, options }); return new Response("ok"); } };
  const f = selfSignedFetch(agent);
  const req = new Request("https://desk.example/api/payout", { method: "POST", headers: { "content-type": "application/json", "payment-signature": "abc" }, body: JSON.stringify({ to: "0x1", usdt: "4" }) });
  await f(req);
  assert.equal(seen[0].url, "https://desk.example/api/payout");
  assert.equal(seen[0].options.method, "POST");
  assert.equal(seen[0].options.body, '{"to":"0x1","usdt":"4"}');
  assert.equal(seen[0].options.headers["payment-signature"], "abc");
  assert.equal(seen[0].options.headers["content-type"], "application/json");
});

test("GET requests carry no body, and each call goes through the agent so it is signed again", async () => {
  let calls = 0;
  const agent = { fetch: async (_url, options) => { calls++; assert.equal(options.body, undefined); return new Response("ok"); } };
  const f = selfSignedFetch(agent);
  await f("https://desk.example/health");
  await f("https://desk.example/health", { method: "GET" });
  assert.equal(calls, 2);
});
