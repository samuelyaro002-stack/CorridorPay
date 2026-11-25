# CorridorPay

An agent that helps Web3 teams pay community moderators and ambassadors in Africa in local stablecoins on Celo.
Built for the Celo "Agents Open for Business" hackathon (code written from 20 Nov 2026).

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
