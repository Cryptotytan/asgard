const HOSTS = new Set([
  "1click.chaindefuser.com",
  "li.quest",
  "deswap.debridge.finance",
  "lite-api.jup.ag",
  "quote-api.jup.ag",
  "api.jup.ag",
  "smartrouter.ref.finance",
  "router.intear.tech",
  "api.dexscreener.com",
  "indexer.ref.finance",
  "api.nearblocks.io",
  "api.coingecko.com",
  "aggregator-api.kyberswap.com",
  "apiv5.paraswap.io",
]);

export async function net(url: string, init?: RequestInit): Promise<Response> {
  const target = new URL(url);
  if (!HOSTS.has(target.host)) throw new Error("That quote desk is not available.");
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    headers[key] = value;
  });
  const body = typeof init?.body === "string" ? init.body : undefined;
  return fetch("/api/net", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, method: (init?.method ?? "GET").toUpperCase(), headers, body }),
    signal: init?.signal ?? AbortSignal.timeout(14_000),
  });
}
