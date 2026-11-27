/**
 * Free, keyless indicative quote from Textile FX: USDT -> cNGN on Celo mainnet.
 * Sends nothing onchain and needs no wallet or key.
 *
 *   node scripts/preview.mjs              # 5 USDT -> cNGN
 *   node scripts/preview.mjs 2.5          # 2.5 USDT -> cNGN
 *   node scripts/preview.mjs 4 usdc       # 4 USDC -> cNGN (is there a direct USDC corridor?)
 */
const TOKENS = {
  usdt: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", // 6 decimals
  usdc: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", // 6 decimals
};
const USDT = TOKENS[(process.argv[3] ?? "usdt").toLowerCase()];
if (!USDT) { console.error("Second argument must be usdt or usdc"); process.exit(1); }
const CNGN = "0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f";
const amount = Number(process.argv[2] ?? 5);
if (!(amount > 0)) { console.error("Give a positive USDT amount, e.g. 5"); process.exit(1); }

const body = { chainId: 42220, sellToken: USDT, buyToken: CNGN, sellAmount: String(Math.round(amount * 1e6)) };
const res = await fetch("https://api.textilecredit.com/v2/rfq/preview", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(30_000),
});
console.log(`HTTP ${res.status}`);
console.log(JSON.stringify(await res.json().catch(() => ({})), null, 2));
