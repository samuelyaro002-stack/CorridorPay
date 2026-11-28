/**
 * Optional relay for the browser payment page: forwards the few Textile FX quote calls the page
 * needs, in case a browser blocks calling Textile directly (CORS). It holds no keys and signs
 * nothing: the quote request carries the user's own signature, and swaps are signed in the user's wallet.
 */
const API = "https://api.textilecredit.com/v2";
const ALLOWED = [/^rfq\/preview$/, /^rfq\/request$/, /^rfq\/[A-Za-z0-9_-]{6,80}\/(cancel|submit)$/];

export function mountRelay(app, { fetchImpl = fetch, perMinute = 40 } = {}) {
  const hits = new Map();
  const limited = (ip) => {
    const now = Date.now();
    const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
    arr.push(now);
    hits.set(ip, arr);
    if (hits.size > 5000) hits.clear();
    return arr.length > perMinute;
  };
  app.use("/relay", (req, res, next) => {
    res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Rfq-Claim" });
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });
  app.post(/^\/relay\/(.+)$/, async (req, res) => {
    const path = req.params[0];
    if (!ALLOWED.some((re) => re.test(path))) return res.status(404).json({ error: "Not an allowed path." });
    if (limited(req.ip)) return res.status(429).json({ error: "Too many requests. Wait a minute." });
    try {
      const headers = { "Content-Type": "application/json" };
      if (req.get("x-rfq-claim")) headers["X-Rfq-Claim"] = req.get("x-rfq-claim");
      const r = await fetchImpl(`${API}/${path}`, { method: "POST", headers, body: JSON.stringify(req.body ?? {}), signal: AbortSignal.timeout(75_000) });
      res.status(r.status).type("application/json").send(await r.text());
    } catch (e) {
      res.status(502).json({ error: "Could not reach Textile FX." });
    }
  });
}
