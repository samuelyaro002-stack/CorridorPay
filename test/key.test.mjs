import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeKey } from "../src/key.mjs";

const HEX = "ab".repeat(32);

test("accepts a key with or without 0x, quotes or stray spaces", () => {
  assert.equal(normalizeKey(`0x${HEX}`), `0x${HEX}`);
  assert.equal(normalizeKey(HEX), `0x${HEX}`);
  assert.equal(normalizeKey(`  "0x${HEX}" \n`), `0x${HEX}`);
  assert.equal(normalizeKey(`0X${HEX.toUpperCase()}`), `0x${HEX}`);
});

test("rejects bad keys with a message that never contains the value", () => {
  const cases = ["", "   ", "0x1234", `${HEX}ff`, "zz".repeat(32), "word ".repeat(12), "0x1613E23AD93b7dD91AB23812ce29Ba97547a2341"];
  for (const c of cases) {
    assert.throws(() => normalizeKey(c), (e) => { assert.ok(!e.message.includes(c.trim()) || c.trim() === "", e.message); return true; });
  }
  assert.throws(() => normalizeKey("0x1613E23AD93b7dD91AB23812ce29Ba97547a2341"), /40 characters|needs exactly 64/);
});
