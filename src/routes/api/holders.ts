import { createFileRoute } from "@tanstack/react-router";

type Row = {
  account: string;
  amount: number;
  share: number | null;
  buyPx?: number;
  sellPx?: number;
  buyMc?: number;
  sellMc?: number;
  pnl?: number | null;
  funded?: string;
  label?: string;
};

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
  const body = (await response.json()) as {
    price?: number;
    token?: { supply?: number; decimals?: number };
    knownAccounts?: Record<string, { name?: string }>;
    topHolders?: { owner?: string; address?: string; uiAmount?: number; pct?: number }[];
  };
  const known = body.knownAccounts ?? {};
  const rows: Row[] = (body.topHolders ?? [])
    .slice(0, limit)
    .map((row): Row => {
      const account = row.owner || row.address || "";
      return {
        account,
        amount: Number(row.uiAmount) || 0,
        share: Number.isFinite(Number(row.pct)) ? Number(row.pct) : null,
        label: known[account]?.name || known[row.address || ""]?.name || undefined,
      };
    })
    .filter((row) => row.account && row.amount > 0);
  const price = Number(body.price) || 0;
  const supplyRaw = Number(body.token?.supply) || 0;
  const decimals = Number(body.token?.decimals) || 0;
  const supply = supplyRaw > 0 ? supplyRaw / 10 ** decimals : 0;
  const [book, funds] = await Promise.all([tradeBook(address, price), fundBook(rows)]);
  for (const row of rows) {
    const stat = book.get(row.account);
    if (stat) {
      row.buyPx = stat.buyPx || undefined;
      row.sellPx = stat.sellPx || undefined;
      row.pnl = stat.pnl;
      if (supply > 0 && stat.buyPx > 0) row.buyMc = stat.buyPx * supply;
      if (supply > 0 && stat.sellPx > 0) row.sellMc = stat.sellPx * supply;
    }
    const funded = funds.get(row.account);
    if (funded) row.funded = funded;
  }
  return rows;
}

async function tradeBook(mint: string, price: number) {
  const map = new Map<string, { buyN: number; buyUsd: number; buyPx: number; sellN: number; sellUsd: number; sellPx: number; pnl: number | null }>();
  const pools = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${encodeURIComponent(mint)}/pools?page=1`, {
    headers: { accept: "application/json;version=20230302" },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!pools?.ok) return map;
  const listed = (await pools.json()) as { data?: { id?: string; attributes?: { address?: string } }[] };
  const ids = (listed.data ?? [])
    .slice(0, 3)
    .map((pool) => pool.attributes?.address || pool.id?.split("_").pop() || "")
    .filter(Boolean);
  const books = await Promise.all(ids.map((pool) => poolTrades(pool, mint)));
  for (const trades of books) {
    for (const trade of trades) addTrade(map, trade, mint);
  }
  for (const row of map.values()) {
    if (!(row.buyPx > 0) || !(row.buyUsd > 0)) {
      row.pnl = null;
      continue;
    }
    const bought = row.buyUsd / row.buyPx;
    const sold = row.sellPx > 0 ? Math.min(bought, row.sellUsd / row.sellPx) : 0;
    const left = Math.max(0, bought - sold);
    row.pnl = row.sellUsd - sold * row.buyPx + (price > 0 ? left * (price - row.buyPx) : 0);
  }
  return map;
}

async function poolTrades(pool: string, mint: string) {
  const trades = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${encodeURIComponent(pool)}/trades`, {
    headers: { accept: "application/json;version=20230302" },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!trades?.ok) return [] as Record<string, string>[];
  const body = (await trades.json()) as { data?: { attributes?: Record<string, string> }[] };
  return (body.data ?? []).map((entry) => entry.attributes ?? {}).filter((trade) => trade.tx_from_address && (trade.to_token_address === mint || trade.from_token_address === mint));
}

function addTrade(
  map: Map<string, { buyN: number; buyUsd: number; buyPx: number; sellN: number; sellUsd: number; sellPx: number; pnl: number | null }>,
  trade: Record<string, string>,
  mint: string,
) {
  const wallet = String(trade.tx_from_address ?? "");
  if (!wallet) return;
  const buying = String(trade.to_token_address ?? "") === mint;
  const px = Number(buying ? trade.price_to_in_usd : trade.price_from_in_usd);
  const usd = Number(trade.volume_in_usd);
  if (!(px > 0) || !(usd > 0)) return;
  const hit = map.get(wallet) ?? { buyN: 0, buyUsd: 0, buyPx: 0, sellN: 0, sellUsd: 0, sellPx: 0, pnl: null };
  if (buying) {
    hit.buyN += 1;
    hit.buyUsd += usd;
    hit.buyPx = hit.buyN === 1 ? px : (hit.buyPx * (hit.buyN - 1) + px) / hit.buyN;
  } else {
    hit.sellN += 1;
    hit.sellUsd += usd;
    hit.sellPx = hit.sellN === 1 ? px : (hit.sellPx * (hit.sellN - 1) + px) / hit.sellN;
  }
  map.set(wallet, hit);
}

const SOL_RPCS = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];

async function solRpc(method: string, params: unknown[]) {
  for (const rpc of SOL_RPCS) {
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!response?.ok) continue;
    const body = (await response.json()) as { result?: unknown; error?: unknown };
    if (body.error || body.result == null) continue;
    return body.result;
  }
  return null;
}

const fundCache = new Map<string, string>();

async function funder(owner: string) {
  if (fundCache.has(owner)) return fundCache.get(owner) ?? "";
  let before = "";
  let oldest = "";
  let reachedStart = false;
  for (let page = 0; page < 4; page += 1) {
    const sigs = (await solRpc("getSignaturesForAddress", [owner, { limit: 1000, ...(before ? { before } : {}) }])) as { signature?: string }[] | null;
    if (!sigs?.length) break;
    oldest = sigs[sigs.length - 1]?.signature || oldest;
    if (sigs.length < 1000) {
      reachedStart = true;
      break;
    }
    before = oldest;
  }
  if (!oldest || !reachedStart) {
    fundCache.set(owner, "");
    return "";
  }
  const tx = (await solRpc("getTransaction", [oldest, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }])) as {
    transaction?: { message?: { instructions?: { parsed?: { type?: string; info?: { source?: string; destination?: string } } }[] } };
    meta?: { innerInstructions?: { instructions?: { parsed?: { type?: string; info?: { source?: string; destination?: string } } }[] }[] };
  } | null;
  const nested = (tx?.meta?.innerInstructions ?? []).flatMap((group) => group.instructions ?? []);
  const list = [...(tx?.transaction?.message?.instructions ?? []), ...nested];
  let who = "";
  for (const ix of list) {
    const info = ix.parsed?.info;
    if (ix.parsed?.type === "transfer" && info?.destination === owner && info.source && info.source !== owner) {
      who = info.source;
      break;
    }
  }
  fundCache.set(owner, who);
  return who;
}

async function fundBook(rows: Row[]) {
  const targets = rows.filter((row) => !row.label).slice(0, 20);
  const out = new Map<string, string>();
  let cursor = 0;
  const run = async () => {
    while (cursor < targets.length) {
      const row = targets[cursor];
      cursor += 1;
      const who = await funder(row.account).catch(() => "");
      if (who) out.set(row.account, who);
    }
  };
  await Promise.race([
    Promise.all([run(), run(), run(), run(), run(), run()]),
    new Promise((resolve) => setTimeout(resolve, 14000)),
  ]);
  return out;
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
