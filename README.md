# CorridorPay

An agent that helps Web3 teams pay community moderators and ambassadors in Africa in local stablecoins on Celo.
Built for the Celo "Agents Open for Business" hackathon (code written from 20 Nov 2026).

**Live demo:** https://samuelyaro002-stack.github.io/CorridorPay/ (payout receipts, wallet, identity)
**Tests:** `npm test`

Status: in development. Entry wallet `0x1613E23AD93b7dD91AB23812ce29Ba97547a2341`, attribution tag `celo_046f6be4dc48`.

## Register the ERC-8004 identity
```
npm install
cp .env.example .env   # add AGENT_PRIVATE_KEY locally; never commit it
npm run register       # dry run
npm run register:send
```

License: Apache-2.0

## Textile FX flow (Celo mainnet, chain 42220)

Notes from the Textile docs (fx-docs.textilecredit.com), used to design the payout flow:

- Keyless firm quotes work with a one-time `takerProof` (EIP-712 `TakerControl`, valid ~12h). `includeAttribution` is partner-key only, so we append our own attribution tag to `transactions.swap.data` ourselves.
- The swap pays the `taker` wallet. There is no recipient field, so a payout is: approve USDT, swap USDT to cNGN, then transfer cNGN to the contributor. Every one of those transactions carries the tag.
- Tokens: USDT `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e`, cNGN `0xF6829D7393dAe24509eb1E52eE8e572e2E271a4f`.
- Taker fee on Celo is 2 bps. Keyless limits: 60 requests per minute and 4 outstanding quotes per IP.

`npm run preview` prints a free indicative USDT to cNGN quote.

## Proof: first real payout (27 Nov 2026, Celo mainnet)

The builder owed a payment to a speaker from an earlier community event. CorridorPay paid it in cNGN:

| Step | Transaction |
|---|---|
| Approve USDT | [0x6a00…10e96](https://celoscan.io/tx/0x6a00b608c69a02d83c1a36ec25137d52bf25bb286c7051b66233ecdf5db10e96) |
| Swap 5 USDT to 7,190.344889 cNGN on Textile FX | [0xbfca…da252](https://celoscan.io/tx/0xbfca0f7e1328c207667619b1706d569e5f713c7a3af44216060debeaafada252) |
| Pay the speaker 7,190.344889 cNGN | [0x1ed1…a18](https://celoscan.io/tx/0x1ed1376e0833c48467e1ef492acbe9401cf0932b97526559f984d5707bd0ba18) |

All three carry the attribution tag `celo_046f6be4dc48`. The agent wallet was funded by the builder with their own USDT and CELO, so there is no sponsored gas. The payout is builder-funded; the recipient is outside the team. Receipt: `receipts/payouts.json`.

Note: the swap confirmed before the final transfer, because a balance read right after the swap lagged on the RPC node. The transfer was completed with `scripts/finish-payout.mjs`, which reads the amount from the swap's own logs. The main payout script now does the same.

## The desk: Self-verified agents, x402 fee, cNGN payout

`npm start` runs an HTTP desk on the entry wallet. A caller agent asks it to pay someone:

1. **Self Agent ID:** the request must be signed by a Self-registered agent (`SelfAgentVerifier`, mainnet, age 18+, OFAC, one agent per human). Unverified callers get 401 before they ever see a price.
2. **x402 fee:** the caller pays a small fee in USD₮ on Celo (0.02 by default). If the payout then fails, the desk returns a 5xx and x402 does not settle, so the caller is not charged for a payout that did not happen.
3. **Limits:** per payout (10 USDT) and per human per day (20 USDT). The daily limit is keyed to the human's nullifier, so registering more agents does not raise it.
4. **Payout:** Textile quote, approval, swap, then cNGN to the recipient. Every transaction is tagged.

The desk starts in dry-run mode (quotes only, nothing spent). Set `DESK_LIVE=1` to spend. The payout is funded from the desk wallet's own USD₮ float, which the x402 fee does not cover, so keep that float small.

Caller side (the registered Self agent, id 233):

```
npm run ask -- --desk https://YOUR-DESK --to 0xRecipient --usdt 4
```

Known limits: the in-memory daily allowance resets when the service restarts; the desk handles one payout at a time; and if x402 settlement fails after the payout, the desk bears that small loss.

### Sanctions check (OFAC)

Self records three OFAC results per human on-chain (`ofac[0..2]`). The SDK's built-in `requireOFAC()` only reads `ofac[0]`, which came back false for the builder's own ID while the other two passed. The desk therefore requires **both name-based checks (`ofac[1]` and `ofac[2]`)** instead (`src/ofac.mjs`, tested). A human failing either is refused. This is a deliberate, disclosed choice, not a bypass of screening.

## Proof: second payout, through the live desk (28 Nov 2026, Celo mainnet)

A Self-verified agent (ID 233) called the desk, paid the 0.02 USD₮ x402 fee, and the desk ran the payout. Builder-funded, no sponsored gas. $4 USD₮ became 5,760.669811 cNGN, sent to Emmanuel, PR group admin, whom the builder owed for PR work (he consented to be named and confirmed receipt). Hashes are in `receipts/payouts.json`; all three transactions are tagged `celo_046f6be4dc48`.

## Pay page: any team, any wallet (`docs/pay.html`)

A non-custodial page where anyone connects a wallet, enters a recipient and a USD₮ amount, and pays. The user's own wallet signs a free quote request, then approve, swap on Textile FX, and the cNGN transfer. Every transaction is sent through viem with our attribution tag appended, and the page checks the tags onchain and shows a receipt. The user pays their own gas; nothing passes through CorridorPay's servers except, if a browser blocks calling Textile directly, quote requests relayed by the desk (`src/relay.mjs`, an allow-listed pass-through that holds no keys).

- Source: `web/pay.mjs`. Build with `npm run build:web` (bundles into `docs/pay.js`, committed so GitHub Pages can serve it).
- Browser test with a simulated wallet and simulated Textile: `node scripts/e2e-pay.mjs` (checks three tagged transactions, relay fallback, a rejected swap, bad input). This does not touch the network or move money.
- Status: tested with the simulated wallet; live runs with real wallets are recorded in `receipts/payouts.json` with `"via": "web"`.
