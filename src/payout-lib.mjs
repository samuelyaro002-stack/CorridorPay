/** Pure helpers for the payout flow (no network, no keys), so they can be tested offline. */
import { getAddress, isAddress, parseUnits } from "viem";

export const CHAIN_ID = 42220;
export const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
export const CNGN = "0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f";
export const MAX_USDT_DEFAULT = 25;

export const TAKER_CONTROL = {
  domain: { name: "Textile Taker Control", version: "1", chainId: CHAIN_ID },
  types: {
    TakerControl: [
      { name: "taker", type: "address" },
      { name: "chainId", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "issuedAt", type: "uint256" },
    ],
  },
  primaryType: "TakerControl",
};

/** Validates payout inputs. Returns { recipient, sellAmount } or throws Error with a plain message. */
export function validatePayout({ to, usdt, max = MAX_USDT_DEFAULT, agent }) {
  if (!to || !isAddress(to)) throw new Error("Give the recipient with --to 0x... (a Celo wallet address).");
  const recipient = getAddress(to);
  if (agent && recipient === getAddress(agent)) throw new Error("Recipient is the agent wallet itself. A payout must go to someone else.");
  const amount = Number(usdt);
  if (!(amount > 0)) throw new Error("Give the amount with --usdt 5");
  if (amount > Number(max)) throw new Error(`--usdt ${amount} is above the safety cap of ${max}. Raise it with --max if you really mean it.`);
  return { recipient, sellAmount: parseUnits(String(amount), 6) };
}

/** Textile returns expiry as an ISO string or a unix number (seconds or ms). Normalise to ms. */
export function toMs(v) {
  const n = typeof v === "number" ? v : Date.parse(v);
  return n < 1e12 ? n * 1000 : n;
}

/** The quote must never cost more than the amount the operator approved. */
export function assertQuoteWithinBudget(quote, sellAmount) {
  if (BigInt(quote.takerPays) > sellAmount) throw new Error("takerPays is higher than the amount you asked to spend. Aborting.");
}

/** Tells the operator what a quote response means, without sending anything. */
export function interpretQuoteResponse(httpStatus, body) {
  if (httpStatus < 200 || httpStatus >= 300) return { ok: false, message: `Textile returned HTTP ${httpStatus}: ${JSON.stringify(body)}` };
  const rfq = body?.data;
  if (rfq?.status !== "quoted") {
    const retry = rfq?.retryAfterMs ? `Retry in ${rfq.retryAfterMs} ms.` : "Try again shortly.";
    return { ok: false, message: `No quote (${rfq?.status}${rfq?.reason ? ": " + rfq.reason : ""}). ${retry}` };
  }
  return { ok: true, rfq };
}
