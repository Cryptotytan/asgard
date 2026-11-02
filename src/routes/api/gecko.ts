import { createFileRoute } from "@tanstack/react-router";

const ALLOWED = /^\/api\/v2\/networks\/[a-z0-9_]+\/[a-z0-9_./%-]+(\?[a-z0-9_.=&%-]*)?$/i;
const cache = new Map<string, { at: number; status: number; type: string; body: ArrayBuffer }>();

export const Route = createFileRoute("/api/gecko")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const path = new URL(request.url).searchParams.get("path") ?? "";
        if (!ALLOWED.test(path)) return new Response("Bad chart path", { status: 400 });
        const hit = cache.get(path);
        if (hit && Date.now() - hit.at < 20_000) {
          return new Response(hit.body.slice(0), { status: hit.status, headers: { "content-type": hit.type, "cache-control": "public, max-age=15" } });
        }
        const response = await fetch(`https://api.geckoterminal.com${path}`, {
          headers: { accept: "application/json;version=20230302" },
        }).catch(() => null);
        if (!response) return new Response("Chart source is unreachable", { status: 502 });
        const body = await response.arrayBuffer();
        const type = response.headers.get("content-type") || "application/json";
        if (response.ok) cache.set(path, { at: Date.now(), status: response.status, type, body });
        return new Response(body, {
          status: response.status,
          headers: { "content-type": type, "cache-control": response.ok ? "public, max-age=15" : "no-store" },
        });
      },
    },
  },
});
