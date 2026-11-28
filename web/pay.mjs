/**
 * CorridorPay payment page. Non-custodial: the user's own wallet signs every step.
 *   quote (signed message) -> approve USD₮ -> swap on Textile FX -> send cNGN to the contributor.
 * Every transaction goes through viem with the hackathon attribution tag appended.
 */
import { createPublicClient, createWalletClient, custom, formatUnits, getAddress, isAddress } from "viem";
import { celo } from "viem/chains";
import { verifyTx, withAttribution } from "@celo/attribution-tags";
import { CHAIN_ID, CNGN, TAKER_CONTROL, USDT, assertQuoteWithinBudget, cngnReceivedFromLogs, interpretQuoteResponse, toMs, validatePayout } from "../src/payout-lib.mjs";

const TAG = "celo_046f6be4dc48";
const TEXTILE = "https://api.textilecredit.com/v2";
const RELAY = "https://corridorpay-desk.onrender.com/relay";
const ERC20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
  { type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ type: "bool" }] },
];
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const fmt = (n, d = 6) => { const x = Number(formatUnits(n, d)); return x.toLocaleString("en-US", { maximumFractionDigits: 4 }); };

let eth, account, pub, wallet, current = null, busy = false, base = TEXTILE, receipt = null;

/** Calls Textile directly; if the browser blocks that, uses the desk relay instead. */
async function textile(path, init) {
  try { return await fetch(base + path, init); }
  catch (e) {
    if (base !== TEXTILE) throw e;
    base = RELAY;
    return await fetch(base + path, init);
  }
}

function say(id, text, kind = "") { const el = $(id); el.textContent = text; el.className = `msg ${kind}`; el.hidden = !text; }
function friendly(e) {
  if (e?.code === 4001 || /user (rejected|denied)|rejected the request/i.test(e?.message ?? "")) return "You rejected the request in your wallet. Nothing was sent.";
  return (e?.shortMessage || e?.message || String(e)).split("\n")[0];
}

async function ensureCelo() {
  try { await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xa4ec" }] }); }
  catch (e) {
    if (e?.code === 4902 || /unrecognized chain/i.test(e?.message ?? "")) {
      await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0xa4ec", chainName: "Celo", nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 }, rpcUrls: ["https://forno.celo.org"], blockExplorerUrls: ["https://celoscan.io"] }] });
    } else throw e;
  }
}

async function refreshBalances() {
  if (!account) return;
  const [u, c, g] = await Promise.all([
    pub.readContract({ address: USDT, abi: ERC20, functionName: "balanceOf", args: [account] }),
    pub.readContract({ address: CNGN, abi: ERC20, functionName: "balanceOf", args: [account] }),
    pub.getBalance({ address: account }),
  ]);
  $("balUsdt").textContent = fmt(u);
  $("balCngn").textContent = fmt(c);
  $("balCelo").textContent = fmt(g, 18);
  return { usdt: u, celo: g };
}

async function connect() {
  say("walletMsg", "");
  eth = window.ethereum;
  if (!eth) return say("walletMsg", "No wallet found in this browser. Use a browser with a wallet extension (MetaMask, Rabby), or open this page inside your wallet app's built-in browser.", "err");
  try {
    const accounts = await eth.request({ method: "eth_requestAccounts" });
    await ensureCelo();
    account = getAddress(accounts[0]);
    pub = createPublicClient({ chain: celo, transport: custom(eth) });
    wallet = createWalletClient({ account, chain: celo, transport: custom(eth) }).extend(withAttribution(TAG));
    $("connect").hidden = true;
    $("walletBox").hidden = false;
    $("who").textContent = short(account);
    $("form").hidden = false;
    await refreshBalances();
    eth.on?.("accountsChanged", () => location.reload());
    eth.on?.("chainChanged", () => location.reload());
  } catch (e) { say("walletMsg", friendly(e), "err"); }
}

async function cancelQuote() {
  if (!current) return;
  const { rfq } = current;
  current = null;
  textile(`/rfq/${rfq.rfqId}/cancel`, { method: "POST", headers: { "X-Rfq-Claim": rfq.claimToken, "Content-Type": "application/json" } }).catch(() => {});
}

async function getQuote(ev) {
  ev?.preventDefault();
  if (busy) return;
  say("formMsg", ""); $("quote").hidden = true; $("progress").hidden = true; $("receipt").hidden = true;
  await cancelQuote();
  let v;
  try { v = validatePayout({ to: $("to").value.trim(), usdt: $("amount").value, agent: account }); }
  catch (e) { return say("formMsg", e.message.replace(/^Give the recipient with --to 0x\.\.\. \(a Celo wallet address\)\./, "Enter a valid Celo wallet address for the recipient.").replace("Give the amount with --usdt 5", "Enter an amount in USD₮, for example 4.").replace(/--usdt /, "").replace(/ Raise it with --max.*$/, ""), "err"); }
  busy = true; $("getQuote").disabled = true; say("formMsg", "Asking your wallet to sign a free message (no cost, no transaction)…");
  try {
    const bal = await refreshBalances();
    if (bal.usdt < v.sellAmount) throw new Error("Your wallet has less USD₮ than this payment.");
    const nonce = `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    const proof = { ...TAKER_CONTROL, message: { taker: account, chainId: BigInt(CHAIN_ID), nonce, issuedAt: BigInt(Date.now()) } };
    const signature = await wallet.signTypedData({ account, ...proof });
    say("formMsg", "Getting a firm price from Textile FX…");
    const res = await textile("/rfq/request", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chainId: CHAIN_ID, sellToken: USDT, buyToken: CNGN, sellAmount: v.sellAmount.toString(), taker: account, takerProof: { nonce, issuedAt: Number(proof.message.issuedAt), signature } }),
    });
    const parsed = interpretQuoteResponse(res.status, await res.json().catch(() => ({})));
    if (!parsed.ok) throw new Error(parsed.message);
    assertQuoteWithinBudget(parsed.rfq.quote, v.sellAmount);
    current = { rfq: parsed.rfq, recipient: v.recipient, sellAmount: v.sellAmount };
    const q = parsed.rfq.quote;
    $("qPay").textContent = `${fmt(BigInt(q.takerPays))} USD₮`;
    $("qGet").textContent = `${fmt(BigInt(q.buyAmount))} cNGN`;
    $("qTo").textContent = v.recipient;
    $("qRate").textContent = `1 USD₮ ≈ ${(Number(q.buyAmount) / Number(q.takerPays)).toLocaleString("en-US", { maximumFractionDigits: 2 })} cNGN`;
    $("quote").hidden = false; say("formMsg", "");
    startCountdown(toMs(q.expiresAt));
  } catch (e) { say("formMsg", friendly(e), "err"); }
  finally { busy = false; $("getQuote").disabled = false; }
}

let timer;
function startCountdown(expMs) {
  clearInterval(timer);
  const tick = () => {
    const left = Math.max(0, Math.round((expMs - Date.now()) / 1000));
    $("qLeft").textContent = left > 0 ? `Price held for ${left}s` : "Price expired. Get a new price.";
    $("pay").disabled = left <= 0 || busy;
    if (left <= 0) clearInterval(timer);
  };
  tick(); timer = setInterval(tick, 1000);
}

const STEPS = ["approve", "swap", "send"];
function step(name, state, hash, text) {
  const li = $(`s-${name}`); li.dataset.state = state;
  if (text) li.querySelector(".t").textContent = text;
  if (hash) { const a = li.querySelector("a"); a.href = `https://celoscan.io/tx/${hash}`; a.textContent = `${hash.slice(0, 10)}…`; a.hidden = false; }
}
const wait = async (hash) => { const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 }); if (r.status !== "success") throw new Error(`A transaction failed onchain: ${hash}`); return r; };

async function pay() {
  if (!current || busy) return;
  busy = true; $("pay").disabled = true; clearInterval(timer); $("progress").hidden = false; say("payMsg", "");
  STEPS.forEach((s) => { step(s, "todo"); $(`s-${s}`).querySelector("a").hidden = true; });
  const { rfq, recipient } = current; const q = rfq.quote; const tx = {}; let received = 0n;
  const claim = { "X-Rfq-Claim": rfq.claimToken, "Content-Type": "application/json" };
  try {
    await ensureCelo();
    step("approve", "active", null, "Approve USD₮ (confirm in your wallet)");
    const allowance = await pub.readContract({ address: USDT, abi: ERC20, functionName: "allowance", args: [account, q.reactor] });
    if (allowance < BigInt(q.takerPays)) {
      if (allowance > 0n) await wait(await wallet.writeContract({ address: USDT, abi: ERC20, functionName: "approve", args: [q.reactor, 0n] }));
      const a = rfq.transactions.approval;
      tx.approval = await wallet.sendTransaction({ account, to: a.to, data: a.data, value: 0n });
      step("approve", "active", tx.approval, "Approving…");
      await wait(tx.approval);
      step("approve", "done", tx.approval, "USD₮ approved");
    } else step("approve", "done", null, "Already approved");

    if (Date.now() >= toMs(q.expiresAt)) throw new Error("The price expired before the swap. Nothing was swapped. Get a new price and try again.");
    step("swap", "active", null, "Swap USD₮ to cNGN (confirm in your wallet)");
    const s = rfq.transactions.swap;
    tx.swap = await wallet.sendTransaction({ account, to: s.to, data: s.data, value: 0n });
    step("swap", "active", tx.swap, "Swapping…");
    const sr = await wait(tx.swap);
    textile(`/rfq/${rfq.rfqId}/submit`, { method: "POST", headers: claim, body: JSON.stringify({ txHash: tx.swap }) }).catch(() => {});
    received = cngnReceivedFromLogs(sr.logs, account);
    if (received <= 0n) throw new Error(`The swap confirmed but no cNGN showed in its logs: ${tx.swap}`);
    step("swap", "done", tx.swap, `Swapped: ${fmt(received)} cNGN received`);
    current.received = received; current.tx = tx;
    await send();
  } catch (e) {
    const failed = STEPS.find((s) => $(`s-${s}`).dataset.state === "active");
    if (failed) step(failed, "error");
    say("payMsg", friendly(e) + (tx.swap && failed === "send" ? "" : ""), "err");
    if (current?.received) $("retry").hidden = false;
    else $("pay").disabled = false;
  } finally { busy = false; }
}

async function send() {
  const { recipient, received, tx } = current;
  step("send", "active", null, `Send ${fmt(received)} cNGN to ${short(recipient)} (confirm in your wallet)`);
  tx.payout = await wallet.writeContract({ account, address: CNGN, abi: ERC20, functionName: "transfer", args: [recipient, received] });
  step("send", "active", tx.payout, "Sending…");
  await wait(tx.payout);
  step("send", "done", tx.payout, `Sent to ${short(recipient)}`);
  $("retry").hidden = true;
  await finish();
}

async function retrySend() {
  if (busy || !current?.received) return;
  busy = true; $("retry").hidden = true; say("payMsg", "");
  try { await send(); } catch (e) { step("send", "error"); say("payMsg", friendly(e) + " Your cNGN is safe in your wallet; you can retry.", "err"); $("retry").hidden = false; }
  finally { busy = false; }
}

async function finish() {
  const { recipient, sellAmount, received, tx, rfq } = current;
  const proofs = {};
  for (const [name, hash] of Object.entries(tx)) {
    const t = await verifyTx({ client: pub, hash }).catch(() => null);
    proofs[name] = { hash, tagged: !!t?.codes.includes(TAG), celoscan: `https://celoscan.io/tx/${hash}` };
  }
  receipt = { at: new Date().toISOString(), via: "web", payer: account, recipient, tag: TAG, usdtSpent: formatUnits(BigInt(rfq.quote.takerPays), 6), cngnPaid: formatUnits(received, 6), tx: proofs };
  try { const h = JSON.parse(localStorage.getItem("corridorpay.receipts") || "[]"); h.push(receipt); localStorage.setItem("corridorpay.receipts", JSON.stringify(h.slice(-20))); } catch {}
  const tagged = Object.values(proofs).every((p) => p.tagged);
  $("rSummary").textContent = `Paid ${fmt(received)} cNGN to ${recipient}. ${tagged ? "All transactions carry the CorridorPay attribution tag." : "A tag check did not pass for one transaction; see the receipt."}`;
  $("rJson").textContent = JSON.stringify(receipt, null, 2);
  $("receipt").hidden = false; current = null; $("quote").hidden = true;
  refreshBalances().catch(() => {});
}

$("connect").addEventListener("click", connect);
$("form").addEventListener("submit", getQuote);
$("pay").addEventListener("click", pay);
$("retry").addEventListener("click", retrySend);
$("copy").addEventListener("click", () => navigator.clipboard?.writeText($("rJson").textContent).then(() => { $("copy").textContent = "Copied"; }).catch(() => {}));
window.addEventListener("pagehide", () => { cancelQuote(); });
window.__corridorpay = { ready: true };
