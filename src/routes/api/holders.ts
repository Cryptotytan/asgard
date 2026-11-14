import { createFileRoute } from "@tanstack/react-router";

type Row = { account: string; amount: number; share: number | null };

const GOPLUS: Record<string, string> = {
  Ethereum: "1",
  BNB: "56",
  Polygon: "137",
  Base: "8453",
  Arbitrum: "42161",
  Optimism: "10",
  Avalanche: "43114",
  Gnosis: "100",
  Scroll: "534352",
};

const cache = new Map<string, { at: number; body: string }>();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": status === 200 ? "public, max-age=30" : "no-store" },
  });
}

function shareOf(value: number) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return value <= 1 ? value * 100 : value;
}

async function rugcheck(address: string, limit: number): Promise<Row[]> {
  const response = await fetch(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(address)}/report`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  }).catch(() => null);
  if (!response?.ok) return [];
  const body = (await response.json()) as { topHolders?: { owner?: string; address?: string; uiAmount?: number; pct?: number }[] };
  return (body.topHolders ?? [])
    .slice(0, limit)
    .map((row) => ({
      account: row.owner || row.address || "",
      amount: Number(row.uiAmount) || 0,
      share: Number.isFinite(Number(row.pct)) ? Number(row.pct) : null,
    }))
    .filter((row) => row.account && row.amount > 0);
}

async function goplus(chain: string, address: string, limit: number): Promise<Row[]> {
  const id = GOPLUS[chain];
  if (!id) return [];
  const response = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${id}?contract_addresses=${address}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(12000),
  }).catch(() => null);
  if (!response?.ok) return [];
  const body = (await response.json()) as { result?: Record<string, { holders?: { address?: string; balance?: string; percent?: string }[] }> };
  const row = body.result?.[address] ?? body.result?.[address.toLowerCase()];
  return (row?.holders ?? [])
    .slice(0, limit)
    .map((holder) => ({
      account: holder.address || "",
      amount: Number(holder.balance) || 0,
      share: shareOf(Number(holder.percent)),
    }))
    .filter((holder) => holder.account && holder.amount > 0);
}

export const Route = createFileRoute("/api/holders")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const chain = url.searchParams.get("chain") ?? "";
        const address = (url.searchParams.get("address") ?? "").trim();
        const limit = Math.min(40, Math.max(1, Number(url.searchParams.get("limit") ?? 40) || 40));
        if (!address || address.length > 90) return json({ rows: [] }, 400);
        const key = `${chain}:${address}:${limit}`;
        const hit = cache.get(key);
        if (hit && Date.now() - hit.at < 60_000) {
          return new Response(hit.body, { headers: { "content-type": "application/json", "cache-control": "public, max-age=30" } });
        }
        const solana = chain === "Solana" || (!chain && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address));
        const rows = solana ? await rugcheck(address, limit) : address.startsWith("0x") ? await goplus(chain, address.toLowerCase(), limit) : [];
        const body = JSON.stringify({ rows });
        if (rows.length) cache.set(key, { at: Date.now(), body });
        return new Response(body, { headers: { "content-type": "application/json", "cache-control": rows.length ? "public, max-age=30" : "no-store" } });
      },
    },
  },
});
