// Read-only: prints what Self recorded on-chain for your agent. Spends nothing.
//   npm run check-self
import { readFileSync } from "node:fs";
import { SelfAgent } from "@selfxyz/agent-sdk";

const key = (process.env.SELF_AGENT_KEY || readFileSync(".self/agent.key", "utf8")).trim();
const agent = new SelfAgent({ privateKey: key.startsWith("0x") ? key : `0x${key}`, network: "mainnet" });
const reg = await agent.isRegistered();
const c = await agent.getCredentials();
console.log("registered:", reg);
console.log("olderThan:", String(c.olderThan));
console.log("ofac [0,1,2]:", JSON.stringify(c.ofac));
console.log("nationality:", c.nationality || "(not disclosed)");
