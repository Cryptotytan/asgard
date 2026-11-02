import { createFileRoute } from "@tanstack/react-router";

const ID = /^[a-z0-9._-]{2,64}$/;

export const Route = createFileRoute("/api/ref-path")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const amountIn = url.searchParams.get("amountIn") ?? "";
        const tokenIn = url.searchParams.get("tokenIn") ?? "";
        const tokenOut = url.searchParams.get("tokenOut") ?? "";
        if (!/^\d{1,80}$/.test(amountIn) || !ID.test(tokenIn) || !ID.test(tokenOut)) {
          return new Response("Bad route query", { status: 400 });
        }
        const upstream = `https://smartrouter.ref.finance/findPath?amountIn=${amountIn}&tokenIn=${encodeURIComponent(tokenIn)}&tokenOut=${encodeURIComponent(tokenOut)}&pathDeep=3&slippage=0.05`;
        const response = await fetch(upstream, { headers: { accept: "application/json" } }).catch(() => null);
        if (!response) return new Response("Ref router is unreachable", { status: 502 });
        const body = await response.arrayBuffer();
        return new Response(body, {
          status: response.status,
          headers: { "content-type": response.headers.get("content-type") || "application/json", "cache-control": "no-store" },
        });
      },
    },
  },
});
