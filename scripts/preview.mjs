/**
 * Free, keyless indicative quote from Textile FX: USDT -> cNGN on Celo mainnet.
 * Sends nothing onchain and needs no wallet or key.
 *
 *   node scripts/preview.mjs        # 5 USDT
 *   node scripts/preview.mjs 2.5    # 2.5 USDT
 */
const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"; // 6 decimals
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
