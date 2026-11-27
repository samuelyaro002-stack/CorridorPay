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
