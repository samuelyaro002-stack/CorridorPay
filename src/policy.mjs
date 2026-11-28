/**
 * Spend policy for the desk. Limits are keyed to the HUMAN behind a Self-verified agent
 * (their nullifier), so one person cannot multiply their allowance by registering more agents.
 */
export class DeskPolicy {
  constructor({ perPayoutMaxUsdt = 10, perHumanDailyMaxUsdt = 20, now = () => Date.now() } = {}) {
    this.perPayoutMaxUsdt = perPayoutMaxUsdt;
    this.perHumanDailyMaxUsdt = perHumanDailyMaxUsdt;
    this.now = now;
    this.spent = new Map(); // humanId -> [{ at, usdt }]
  }

  #windowSpent(humanId) {
    const cutoff = this.now() - 24 * 60 * 60 * 1000;
    const kept = (this.spent.get(humanId) ?? []).filter((e) => e.at > cutoff);
    this.spent.set(humanId, kept);
    return kept.reduce((s, e) => s + e.usdt, 0);
  }

  /** Decide whether this human may request a payout of `usdt` now. */
  check(humanId, usdt) {
    if (!humanId) return { ok: false, status: 403, error: "No verified human behind this agent." };
    if (!(usdt > 0)) return { ok: false, status: 400, error: "Amount must be positive." };
    if (usdt > this.perPayoutMaxUsdt) return { ok: false, status: 403, error: `Above the per-payout limit of ${this.perPayoutMaxUsdt} USDT.` };
    const used = this.#windowSpent(humanId);
    const remaining = this.perHumanDailyMaxUsdt - used;
    if (usdt > remaining + 1e-9) return { ok: false, status: 429, error: `Daily limit reached: ${Math.max(0, remaining).toFixed(2)} USDT left in the last 24 hours.` };
    return { ok: true, remainingToday: remaining - usdt };
  }

  /** Record a payout that really moved money. */
  record(humanId, usdt) {
    const list = this.spent.get(humanId) ?? [];
    list.push({ at: this.now(), usdt });
    this.spent.set(humanId, list);
  }

  describe() {
    return { perPayoutMaxUsdt: this.perPayoutMaxUsdt, perHumanDailyMaxUsdt: this.perHumanDailyMaxUsdt, keyedTo: "the human behind the Self Agent ID (nullifier)" };
  }
}
