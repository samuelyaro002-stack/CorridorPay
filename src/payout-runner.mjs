/** Executes (or dry-runs) one payout: Textile quote, USDT approval, swap, then cNGN transfer. */
import { randomBytes } from "node:crypto";
import { verifyTx } from "@celo/attribution-tags";
import { formatUnits } from "viem";
import { CHAIN_ID, CNGN, TAKER_CONTROL, USDT, assertQuoteWithinBudget, cngnReceivedFromLogs, interpretQuoteResponse, toMs } from "./payout-lib.mjs";

const API = "https://api.textilecredit.com/v2";
const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createExecutor({ account, pub, wallet, code, fetchImpl = fetch }) {
  async function quote(sellAmount) {
    const proof = { ...TAKER_CONTROL, message: { taker: account.address, chainId: BigInt(CHAIN_ID), nonce: `0x${randomBytes(32).toString("hex")}`, issuedAt: BigInt(Date.now()) } };
    const signature = await account.signTypedData(proof);
    const res = await fetchImpl(`${API}/rfq/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chainId: CHAIN_ID, sellToken: USDT, buyToken: CNGN, sellAmount: sellAmount.toString(), taker: account.address, takerProof: { nonce: proof.message.nonce, issuedAt: Number(proof.message.issuedAt), signature } }),
      signal: AbortSignal.timeout(75_000),
    });
    const parsed = interpretQuoteResponse(res.status, await res.json().catch(() => ({})));
    if (!parsed.ok) throw new Error(parsed.message);
    return parsed.rfq;
  }

  async function run({ to, usdt, live }) {
    const sellAmount = BigInt(Math.round(usdt * 1e6));
    const bal = (token) => pub.readContract({ address: token, abi: ERC20, functionName: "balanceOf", args: [account.address] });
    const usdtBal = await bal(USDT);
    if (usdtBal < sellAmount) throw new Error("The desk float is too low for this payout.");
    const rfq = await quote(sellAmount);
    const q = rfq.quote;
    assertQuoteWithinBudget(q, sellAmount);
    const summary = { usdtSpent: formatUnits(BigInt(q.takerPays), 6), cngnQuoted: formatUnits(BigInt(q.buyAmount), 6), recipient: to };
    const claim = { "X-Rfq-Claim": rfq.claimToken, "Content-Type": "application/json" };

    if (!live) {
      await fetchImpl(`${API}/rfq/${rfq.rfqId}/cancel`, { method: "POST", headers: claim }).catch(() => {});
      return { mode: "dry-run", ...summary, note: "Quote released; nothing was spent." };
    }

    const cngn0 = await bal(CNGN);
    const tx = {};
    const wait = async (hash) => { const r = await pub.waitForTransactionReceipt({ hash }); if (r.status !== "success") throw new Error(`transaction reverted: ${hash}`); return r; };
    const allowance = await pub.readContract({ address: USDT, abi: ERC20, functionName: "allowance", args: [account.address, q.reactor] });
    if (allowance < BigInt(q.takerPays)) {
      if (allowance > 0n) await wait(await wallet.writeContract({ address: USDT, abi: ERC20, functionName: "approve", args: [q.reactor, 0n] }));
      const a = rfq.transactions.approval;
      tx.approval = await wallet.sendTransaction({ to: a.to, data: a.data, value: 0n });
      await wait(tx.approval);
    }
    if (Date.now() >= toMs(q.expiresAt)) throw new Error("The quote expired before the swap. Nothing was swapped.");
    const s = rfq.transactions.swap;
    tx.swap = await wallet.sendTransaction({ to: s.to, data: s.data, value: 0n });
    const swapReceipt = await wait(tx.swap);
    await fetchImpl(`${API}/rfq/${rfq.rfqId}/submit`, { method: "POST", headers: claim, body: JSON.stringify({ txHash: tx.swap }) }).catch(() => {});

    const received = cngnReceivedFromLogs(swapReceipt.logs, account.address);
    if (received <= 0n) throw new Error(`Swap confirmed but no cNGN found in its logs: ${tx.swap}`);
    for (let i = 0; i < 8 && (await bal(CNGN)) - cngn0 < received; i++) await sleep(4000);
    tx.payout = await wallet.writeContract({ address: CNGN, abi: ERC20, functionName: "transfer", args: [to, received] });
    await wait(tx.payout);

    const proofs = {};
    for (const [name, hash] of Object.entries(tx)) {
      const t = await verifyTx({ client: pub, hash }).catch(() => null);
      proofs[name] = { hash, tagged: !!t?.codes.includes(code), celoscan: `https://celoscan.io/tx/${hash}` };
    }
    return { mode: "live", ...summary, cngnPaid: formatUnits(received, 6), tx: proofs };
  }

  return { run };
}
