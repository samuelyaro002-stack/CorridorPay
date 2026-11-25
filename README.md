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
