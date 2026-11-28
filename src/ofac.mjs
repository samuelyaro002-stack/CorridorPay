// Sanctions gate. Self records three OFAC results per human on-chain: ofac[0..2].
// The SDK's built-in requireOFAC() only looks at ofac[0] (which can be false for some ID types
// even when the name-based checks pass). The desk instead requires BOTH name-based checks,
// ofac[1] and ofac[2]. A human who fails either is refused.
export function ofacPassed(credentials) {
  const o = credentials?.ofac;
  return Array.isArray(o) && o[1] === true && o[2] === true;
}

export function ofacGate(req, res, next) {
  if (!ofacPassed(req.agent?.credentials)) {
    return res.status(401).json({ error: "Agent's human did not pass the name-based OFAC checks" });
  }
  next();
}
