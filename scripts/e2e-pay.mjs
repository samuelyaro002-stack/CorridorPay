/**
 * Browser test of docs/pay.html with a simulated wallet and a simulated Textile FX. No network, no money.
 *   npm run build:web && node scripts/e2e-pay.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const USER = "0x1111111111111111111111111111111111111111";
const TO = "0x56F1dC253E1a30c606d37341E386CdAf654D27A3";
const REACTOR = "0x2222222222222222222222222222222222222222";
const USDT = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", CNGN = "0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f";
const RECEIVED = 5760669811n;

const srv = createServer(async (req, res) => {
  const f = req.url.split("?")[0] === "/" ? "/pay.html" : req.url.split("?")[0];
  try { const b = await readFile("docs" + f); res.writeHead(200, { "content-type": f.endsWith(".js") ? "text/javascript" : "text/html" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const url = `http://127.0.0.1:${srv.address().port}/`;

const walletMock = `(() => {
  const USER=${JSON.stringify(USER)}, REACTOR=${JSON.stringify(REACTOR)}, CNGN=${JSON.stringify(CNGN)}.toLowerCase(), RECEIVED=${RECEIVED}n;
  const T0="0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const pad=(a)=>"0x"+a.replace(/^0x/,"").toLowerCase().padStart(64,"0");
  const sent={}; let n=0; window.__sent=sent; window.__rejectSwapOnce = !!window.__rejectSwapOnce;
  const hex=(x)=>"0x"+BigInt(x).toString(16);
  const base=(h)=>({blockHash:"0x"+"ab".repeat(32),blockNumber:"0x10",transactionIndex:"0x0",transactionHash:h});
  window.ethereum = { on(){}, async request({method, params=[]}) {
    switch(method){
      case "eth_requestAccounts": case "eth_accounts": return [USER];
      case "eth_chainId": return "0xa4ec";
      case "wallet_switchEthereumChain": return null;
      case "eth_getBalance": return hex(1000000000000000000n);
      case "eth_blockNumber": return "0x10";
      case "eth_getBlockByNumber": return {...base("0x0"),number:"0x10",hash:"0x"+"ab".repeat(32),parentHash:"0x"+"00".repeat(32),timestamp:hex(Math.floor(Date.now()/1000)),transactions:[],gasUsed:"0x0",gasLimit:"0x1",baseFeePerGas:"0x1",miner:USER,nonce:"0x0",difficulty:"0x0",extraData:"0x",logsBloom:"0x"+"00".repeat(256),sha3Uncles:"0x"+"00".repeat(32),stateRoot:"0x"+"00".repeat(32),receiptsRoot:"0x"+"00".repeat(32),transactionsRoot:"0x"+"00".repeat(32),size:"0x1",totalDifficulty:"0x0",uncles:[],mixHash:"0x"+"00".repeat(32)};
      case "eth_call": {
        const {to,data}=params[0]; const sel=data.slice(0,10);
        if(sel==="0x70a08231") { const sw=Object.values(sent).some(t=>t.to.toLowerCase()===REACTOR.toLowerCase()); const out=Object.values(sent).some(t=>t.data.startsWith("0xa9059cbb")); return hex(to.toLowerCase()===CNGN ? (sw&&!out?RECEIVED:0n) : 10000000n).replace(/^0x/,"0x").padEnd(2,"0") && pad(hex(to.toLowerCase()===CNGN ? (sw&&!out?RECEIVED:0n) : 10000000n)); }
        if(sel==="0xdd62ed3e") return pad("0x0");
        return "0x";
      }
      case "eth_signTypedData_v4": return "0x"+"11".repeat(65);
      case "eth_sendTransaction": {
        const tx=params[0];
        if (tx.to.toLowerCase()===REACTOR.toLowerCase() && window.__rejectSwapOnce) { window.__rejectSwapOnce=false; const e=new Error("User rejected the request."); e.code=4001; throw e; }
        const h="0x"+(++n).toString(16).padStart(64,"0"); sent[h]={to:tx.to,data:tx.data||"0x",from:tx.from}; return h; }
      case "eth_getTransactionByHash": { const t=sent[params[0]]; if(!t) return null; return {...base(params[0]),hash:params[0],from:t.from,to:t.to,input:t.data,value:"0x0",gas:"0x5208",gasPrice:"0x1",nonce:"0x0",type:"0x0",v:"0x1b",r:"0x1",s:"0x1",chainId:"0xa4ec"}; }
      case "eth_getTransactionReceipt": { const t=sent[params[0]]; if(!t) return null;
        const logs = t.to.toLowerCase()===REACTOR.toLowerCase() ? [{...base(params[0]),address:CNGN,topics:[T0,pad(REACTOR),pad(USER)],data:pad(hex(RECEIVED)),logIndex:"0x0",removed:false}] : [];
        return {...base(params[0]),from:t.from,to:t.to,status:"0x1",gasUsed:"0x5208",cumulativeGasUsed:"0x5208",effectiveGasPrice:"0x1",contractAddress:null,logsBloom:"0x"+"00".repeat(256),type:"0x0",logs}; }
      default: return null;
    }
  }};
})();`;

const rfqBody = (expiresAt) => ({ data: { status: "quoted", rfqId: "rfq_abc123456", claimToken: "claim-xyz",
  quote: { takerPays: "4000000", buyAmount: RECEIVED.toString(), expiresAt, reactor: REACTOR },
  transactions: { approval: { to: USDT, data: "0x095ea7b3" + REACTOR.slice(2).padStart(64, "0") + "f".repeat(64) }, swap: { to: REACTOR, data: "0xdeadbeef" } } } });

const browser = await chromium.launch();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) failed++; };

async function scenario(name, { blockDirect = false, rejectSwap = false }, check) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 1 }); const page = await ctx.newPage();
  const calls = []; page.on("pageerror", (e) => calls.push("PAGEERROR " + e.message));
  await page.addInitScript(`window.__rejectSwapOnce=${rejectSwap};` + walletMock);
  await page.route("https://api.textilecredit.com/**", (r) => { calls.push("direct " + r.request().url()); return blockDirect ? r.abort() : r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rfqBody(Date.now() + 60000)) }); });
  await page.route("https://corridorpay-desk.onrender.com/relay/**", (r) => { calls.push("relay " + r.request().url()); return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(rfqBody(Date.now() + 60000)) }); });
  await page.goto(url);
  console.log(`\n== ${name}`);
  await check(page, calls);
  await ctx.close();
}
const quote = async (p) => { await p.click("#connect"); await p.waitForSelector("#form:not([hidden])"); await p.fill("#to", TO); await p.fill("#amount", "4"); await p.click("#getQuote"); await p.waitForSelector("#quote:not([hidden])", { timeout: 10000 }); };

await scenario("happy path", {}, async (p, calls) => {
  await quote(p);
  ok((await p.textContent("#qGet")).includes("5,760.6698"), "shows the cNGN the recipient gets");
  ok((await p.textContent("#qPay")).includes("4"), "shows the USD₮ the payer pays");
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + "-quote.png", fullPage: true });
  await p.click("#pay"); await p.waitForSelector("#receipt:not([hidden])", { timeout: 20000 });
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT + "-done.png", fullPage: true });
  const sent = await p.evaluate(() => Object.values(window.__sent));
  ok(sent.length === 3, `three transactions sent (got ${sent.length})`);
  ok(sent.every((t) => t.data.endsWith("80218021802180218021802180218021")), "every transaction ends with the ERC-8021 attribution marker");
  ok(sent.every((t) => t.data.toLowerCase().includes(Buffer.from("celo_046f6be4dc48").toString("hex"))), "every transaction contains the tag celo_046f6be4dc48");
  const tr = sent[2];
  ok(tr.to.toLowerCase() === CNGN.toLowerCase() && tr.data.startsWith("0xa9059cbb") && tr.data.toLowerCase().includes(TO.slice(2).toLowerCase()) && tr.data.toLowerCase().includes(RECEIVED.toString(16)), "last transaction sends exactly the swap's cNGN to the recipient");
  ok((await p.textContent("#rSummary")).includes("All transactions carry"), "receipt says all transactions are tagged");
  const r = JSON.parse(await p.textContent("#rJson"));
  ok(r.recipient === TO && r.via === "web" && Object.keys(r.tx).join() === "approval,swap,payout" && Object.values(r.tx).every((x) => x.tagged), "receipt JSON is complete");
  ok(!calls.some((c) => c.startsWith("PAGEERROR")), "no page errors");
});

await scenario("Textile blocked by CORS -> desk relay fallback", { blockDirect: true }, async (p, calls) => {
  await quote(p);
  ok(calls.some((c) => c.startsWith("relay ") && c.endsWith("/relay/rfq/request")), "quote came through the relay");
});

await scenario("user rejects the swap, then retries", { rejectSwap: true }, async (p) => {
  await quote(p); await p.click("#pay");
  await p.waitForSelector("#payMsg:not([hidden])", { timeout: 10000 });
  ok((await p.textContent("#payMsg")).includes("rejected"), "shows a plain 'you rejected it' message");
  ok(await p.isDisabled("#pay") === false, "payment can be retried");
  ok((await p.evaluate(() => Object.values(window.__sent).length)) === 1, "only the approval was sent; nothing was swapped");
});

await scenario("bad input is refused before anything is signed", {}, async (p) => {
  await p.click("#connect"); await p.waitForSelector("#form:not([hidden])");
  await p.fill("#to", "0x123"); await p.fill("#amount", "4"); await p.click("#getQuote");
  ok(!(await p.isHidden("#formMsg")), "bad address gives a message");
  await p.fill("#to", USER); await p.click("#getQuote");
  ok((await p.textContent("#formMsg")).toLowerCase().includes("itself") || !(await p.isHidden("#formMsg")), "paying yourself is refused");
  await p.fill("#to", TO); await p.fill("#amount", "99"); await p.click("#getQuote");
  ok((await p.textContent("#formMsg")).includes("safety cap"), "amount over the cap is refused");
});

await browser.close(); srv.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nAll browser checks passed");
process.exit(failed ? 1 : 0);
