import { ensureToken, LEND_MARKETS, money, TOKENS, type Candle, type Print } from "@/lib/market";
import { iconFor, loadIconBook, syncNearMarkets, applyIconBook } from "@/lib/dex";
import { useDesk } from "@/lib/store";

const LLAMA = "https://coins.llama.fi";
const RHEA = "https://lendingsdk.rhea.finance/list_token_data";

const COINGECKO: Record<string, string> = {
  NEAR: "coingecko:near",
  ETH: "coingecko:ethereum",
  WBTC: "coingecko:wrapped-bitcoin",
  USDC: "coingecko:usd-coin",
  USDT: "coingecko:tether",
  AURORA: "coingecko:aurora-near",
  STNEAR: "coingecko:staked-near",
  SWEAT: "coingecko:sweatcoin",
  RHEA: "coingecko:rhea-2",
};

const ALIAS: Record<string, string> = {
  WNEAR: "NEAR",
  WBTC: "wBTC",
  USDT: "USDT",
  "USDT.E": "USDT.e",
  "USDC.E": "USDC.e",
  $META: "META",
};

const CONTRACTS: Record<string, string> = {
  NEAR: "wrap.near",
  USDC: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  ETH: "eth.bridge.near",
  wBTC: "2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near",
  AURORA: "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near",
  SWEAT: "token.sweat",
  STNEAR: "meta-pool.near",
  USDT: "usdt.tether-token.near",
  RHEA: "token.rhealab.near",
};

type Point = { timestamp: number; price: number };
type RheaRow = {
  symbol?: string;
  token?: string;
  price?: number | string;
  supply_apy?: string;
  borrow_apy?: string;
  available_liquidity_price?: string;
};

const candles = new Map<string, Candle[]>();
const prints = new Map<string, Print[]>();
let nearMcap = 0;
let nearMcapAt = 0;
const ORIGIN = 1_600_000_000;

export function liveCandles(symbol: string, frame = "5m"): Candle[] | undefined {
  return candles.get(`${symbol}:${frame}`);
}

export function livePrints(symbol: string): Print[] | undefined {
  return prints.get(symbol);
}

function canon(raw: string) {
  const upper = raw.replace(/\s/g, "").toUpperCase();
  return ALIAS[upper] ?? upper;
}

function toCandles(points: Point[]): Candle[] {
  return points.map((point, index) => {
    const prev = points[index - 1]?.price ?? point.price;
    return { t: point.timestamp, o: prev, h: Math.max(prev, point.price), l: Math.min(prev, point.price), c: point.price };
  });
}

async function rheaRows() {
  const response = await fetch(RHEA);
  if (!response.ok) return [] as RheaRow[];
  const body = (await response.json()) as { data?: RheaRow[] };
  return body.data ?? [];
}

async function nearCap() {
  if (nearMcap > 0 && Date.now() - nearMcapAt < 10 * 60 * 1000) return nearMcap;
  const response = await fetch("https://api.llama.fi/protocol/near-protocol");
  if (!response.ok) return nearMcap;
  const body = (await response.json()) as { mcap?: number };
  if (body.mcap && body.mcap > 0) {
    nearMcap = body.mcap;
    nearMcapAt = Date.now();
  }
  return nearMcap;
}

function llamaId(symbol: string) {
  if (COINGECKO[symbol]) return COINGECKO[symbol];
  const token = TOKENS.find((item) => item.symbol === symbol);
  if (token?.address) return `near:${token.address}`;
  const contract = CONTRACTS[symbol];
  return contract ? `near:${contract}` : "";
}

function historyPlan(frame: string) {
  if (frame === "1m" || frame === "5m") return { period: "5m", step: 300, chunks: 12 };
  if (frame === "15m") return { period: "15m", step: 900, chunks: 8 };
  if (frame === "1H") return { period: "1h", step: 3600, chunks: 10 };
  if (frame === "4H") return { period: "4h", step: 4 * 3600, chunks: 10 };
  return { period: "1d", step: 86400, chunks: 8 };
}

async function llamaSeries(id: string, start: number, span: number, period: string) {
  const response = await fetch(`${LLAMA}/chart/${id}?start=${Math.floor(start)}&span=${span}&period=${period}`);
  if (!response.ok) return [] as Point[];
  const body = (await response.json()) as { coins?: Record<string, { prices?: Point[] }> };
  const coin = body.coins?.[id] ?? Object.values(body.coins ?? {})[0];
  return coin?.prices ?? [];
}

function mergePoints(parts: Point[][]) {
  const map = new Map<number, number>();
  for (const part of parts) {
    for (const point of part) {
      if (point && point.price > 0 && point.timestamp > 0) map.set(point.timestamp, point.price);
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([timestamp, price]) => ({ timestamp, price }));
}

const historyFlight = new Map<string, Promise<Candle[]>>();

export async function loadCandles(symbol: string, frame = "5m") {
  const key = `${symbol}:${frame}`;
  const cached = candles.get(key);
  const stamp = candleAt.get(key) ?? 0;
  if (cached && cached.length > 1 && Date.now() - stamp < 20_000) return cached;
  const pending = historyFlight.get(key);
  if (pending) return pending;
  const job = fetchCandles(symbol, frame, key).finally(() => historyFlight.delete(key));
  historyFlight.set(key, job);
  return job;
}

async function fetchCandles(symbol: string, frame: string, key: string) {
  const id = llamaId(symbol);
  if (!id) return candles.get(key) ?? [];
  const plan = historyPlan(frame);
  const now = Math.floor(Date.now() / 1000);
  const count = Math.min(plan.chunks, Math.max(1, Math.ceil((now - ORIGIN) / (500 * plan.step))));
  const parts = await Promise.all(
    Array.from({ length: count }, (_, index) => {
      const start = now - (index + 1) * 500 * plan.step;
      return llamaSeries(id, Math.max(ORIGIN, start), 500, plan.period).catch(() => [] as Point[]);
    }),
  );
  const points = mergePoints(parts);
  if (points.length < 2) return candles.get(key) ?? [];
  const next = toCandles(points);
  candles.set(key, next);
  candleAt.set(key, Date.now());
  useDesk.setState((state) => ({ clock: state.clock + 1 }));
  return next;
}

export function watchCandles(symbol: string, frame: string) {
  let alive = true;
  const run = () => {
    if (alive) void loadCandles(symbol, frame).catch(() => undefined);
  };
  run();
  const timer = window.setInterval(run, 20_000);
  return () => {
    alive = false;
    window.clearInterval(timer);
  };
}

const candleAt = new Map<string, number>();

async function llamaSpot() {
  const ids = [...new Set(Object.values(COINGECKO))];
  const response = await fetch(`${LLAMA}/prices/current/${ids.join(",")}`);
  if (!response.ok) return {} as Record<string, number>;
  const body = (await response.json()) as { coins?: Record<string, { price?: number }> };
  const out: Record<string, number> = {};
  for (const [id, row] of Object.entries(body.coins ?? {})) {
    const symbol = Object.entries(COINGECKO).find((entry) => entry[1] === id)?.[0];
    const price = Number(row?.price);
    if (symbol && price > 0) out[symbol] = price;
  }
  return out;
}

function publish(marks: Record<string, number>) {
  useDesk.setState((state) => ({ marks: { ...state.marks, ...marks }, clock: state.clock + 1 }));
}

let marketFlight: Promise<void> | null = null;

async function refreshMarkets() {
  const marks: Record<string, number> = {};
  const iconsPromise = loadIconBook().catch(() => new Map<string, string>());
  const rheaPromise = rheaRows().catch(() => [] as RheaRow[]);
  const spotPromise = llamaSpot().catch(() => ({}) as Record<string, number>);
  const dexPromise = syncNearMarkets(undefined, (batch) => {
    Object.assign(marks, batch);
    publish(batch);
  }).catch(() => ({}) as Record<string, number>);

  const [rows, spots] = await Promise.all([rheaPromise, spotPromise]);
  const rheaBySymbol = new Map<string, RheaRow>();
  for (const row of rows) {
    const raw = row.symbol ?? "";
    if (!raw || raw.includes("$")) continue;
    rheaBySymbol.set(canon(raw), row);
  }
  for (const [symbol, row] of rheaBySymbol) {
    const price = Number(row.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const icon = iconFor(row.token, symbol) || undefined;
    const token = ensureToken({ symbol, name: symbol, price, chain: "NEAR", icon, address: row.token });
    const liq = Number(row.available_liquidity_price);
    if (Number.isFinite(liq) && liq > 0 && token.liqN <= 0) {
      token.liqN = liq;
      token.liquidity = money(liq);
    }
  }
  for (const token of TOKENS) {
    if (token.listed && Number.isFinite(token.price) && token.price > 0) continue;
    const price = spots[token.symbol] ?? spots[token.symbol.toUpperCase()] ?? Number(rheaBySymbol.get(token.symbol)?.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    token.price = price;
    marks[token.symbol] = price;
  }
  const capPromise = nearCap().catch(() => 0);
  const lend = [...rheaBySymbol.entries()]
    .map(([symbol, row]) => ({
      symbol,
      supplyApy: Number(row.supply_apy) || 0,
      borrowApy: Number(row.borrow_apy) || 0,
    }))
    .filter((market) => market.supplyApy > 0 || market.borrowApy > 0)
    .sort((a, b) => b.supplyApy - a.supplyApy);
  if (lend.length) LEND_MARKETS.splice(0, LEND_MARKETS.length, ...lend);
  publish(marks);
  const [dexMarks, icons, cap] = await Promise.all([dexPromise, iconsPromise, capPromise]);
  Object.assign(marks, dexMarks);
  if (applyIconBook(icons) || cap > 0) {
    if (cap > 0) {
      const near = TOKENS.find((token) => token.symbol === "NEAR");
      if (near) {
        near.mcapN = cap;
        near.mcap = money(cap);
        near.fdv = money(cap);
      }
    }
    publish(marks);
  }
}

export async function refreshLive() {
  if (marketFlight) return marketFlight;
  marketFlight = refreshMarkets().finally(() => {
    marketFlight = null;
  });
  return marketFlight;
}

function agoFrom(ns: string) {
  const ms = Number(BigInt(ns) / 1_000_000n);
  const delta = Math.max(0, Date.now() - ms);
  const min = Math.round(delta / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function shortAccount(id: string) {
  if (id.length <= 16) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export async function loadPrints(symbol: string) {
  const contract = CONTRACTS[symbol];
  if (!contract) {
    prints.set(symbol, []);
    return [];
  }
  const response = await fetch(`https://api.nearblocks.io/v1/account/${contract}/ft-txns?per_page=16`);
  if (!response.ok) return prints.get(symbol) ?? [];
  const body = (await response.json()) as {
    txns?: { delta_amount?: string; block_timestamp?: string; involved_account_id?: string; ft?: { decimals?: number; symbol?: string } }[];
  };
  const price = TOKENS.find((token) => token.symbol === symbol)?.price ?? 0;
  const rows: Print[] = (body.txns ?? []).slice(0, 16).map((tx) => {
    const decimals = tx.ft?.decimals ?? 0;
    const raw = tx.delta_amount ?? "0";
    const amount = Number(raw.replace("-", "")) / 10 ** decimals;
    const side = raw.startsWith("-") ? "Sell" : "Buy";
    return {
      age: tx.block_timestamp ? agoFrom(tx.block_timestamp) : "—",
      side,
      amount: Number.isFinite(amount) ? amount : 0,
      usd: Number.isFinite(amount) ? amount * price : 0,
      price,
      trader: shortAccount(tx.involved_account_id ?? contract),
    } satisfies Print;
  });
  prints.set(symbol, rows);
  useDesk.setState((state) => ({ clock: state.clock + 1 }));
  return rows;
}

let started = false;

export function startLiveFeed() {
  if (started || typeof window === "undefined") return;
  started = true;
  const run = () => {
    void refreshLive().catch(() => undefined);
  };
  run();
  window.setInterval(run, 12_000);
  window.setTimeout(() => {
    void loadCandles("NEAR", "1D").catch(() => undefined);
    void loadCandles("NEAR", "5m").catch(() => undefined);
  }, 400);
}