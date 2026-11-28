import test from "node:test";
import assert from "node:assert/strict";
import { ofacPassed, ofacGate } from "../src/ofac.mjs";

test("passes when both name-based checks are true, even if ofac[0] is false", () => {
  assert.equal(ofacPassed({ ofac: [false, true, true] }), true);
  assert.equal(ofacPassed({ ofac: [true, true, true] }), true);
});
test("fails when either name-based check is false or data is missing", () => {
  assert.equal(ofacPassed({ ofac: [true, false, true] }), false);
  assert.equal(ofacPassed({ ofac: [true, true, false] }), false);
  assert.equal(ofacPassed({ ofac: [false, false, false] }), false);
  assert.equal(ofacPassed(undefined), false);
  assert.equal(ofacPassed({}), false);
});
test("gate answers 401 on failure and calls next on success", () => {
  let status, body, nexted = false;
  const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
  ofacGate({ agent: { credentials: { ofac: [true, false, true] } } }, res, () => { nexted = true; });
  assert.equal(status, 401); assert.ok(body.error); assert.equal(nexted, false);
  ofacGate({ agent: { credentials: { ofac: [false, true, true] } } }, res, () => { nexted = true; });
  assert.equal(nexted, true);
});
