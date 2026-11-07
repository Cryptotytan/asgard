import { createFileRoute } from "@tanstack/react-router";

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

export const Route = createFileRoute("/api/net")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const payload = (await request.json().catch(() => null)) as { url?: string; method?: string; headers?: Record<string, string>; body?: string } | null;
        let target: URL;
        try {
          target = new URL(payload?.url ?? "");
        } catch {
          return new Response("Bad quote url", { status: 400 });
        }
        if (target.protocol !== "https:" || !HOSTS.has(target.host)) return new Response("Quote desk is not allowed", { status: 400 });
        const method = payload?.method === "POST" ? "POST" : "GET";
        const headers = new Headers({ accept: "application/json" });
        for (const [key, value] of Object.entries(payload?.headers ?? {})) {
          if (!/^[a-z0-9-]+$/i.test(key) || key.toLowerCase() === "host") continue;
          if (typeof value === "string" && value.length < 400) headers.set(key, value);
        }
        const response = await fetch(target, {
          method,
          headers,
          body: method === "POST" ? payload?.body : undefined,
          signal: AbortSignal.timeout(12_000),
        }).catch(() => null);
        if (!response) return new Response("The quote desk did not answer.", { status: 502 });
        const body = await response.arrayBuffer();
        return new Response(body, {
          status: response.status,
          headers: { "content-type": response.headers.get("content-type") || "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
