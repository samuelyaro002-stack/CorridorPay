/**
 * Adapts a SelfAgent to the fetch signature the x402 wrapper uses.
 * The x402 wrapper calls fetch(Request); SelfAgent.fetch wants (url, { method, headers, body: string }).
 * Every call, including the paid retry, is signed again so its timestamp is fresh.
 */
export function selfSignedFetch(agent) {
  return async function selfFetch(input, init) {
    const req = input instanceof Request ? input : new Request(input, init);
    const hasBody = !["GET", "HEAD"].includes(req.method);
    const body = hasBody ? await req.clone().text() : undefined;
    return agent.fetch(req.url, { method: req.method, headers: Object.fromEntries(req.headers.entries()), body: body || undefined });
  };
}
