import { ensureToken, LEND_MARKETS, money, TOKENS, type Candle, type Print, type WindowId } from "@/lib/market";
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
  price?: number | string;
  supply_apy?: string;
  borrow_apy?: string;
  available_liquidity_price?: string;
};

const candles = new Map<string, Candle[]>();
const prints = new Map<string, Print[]>();
let nearMcap = 0;
let nearMcapAt = 0;

export function liveCandles(symbol: string): Candle[] | undefined {
  return candles.get(symbol);
}

export function livePrints(symbol: string): Print[] | undefined {
  return prints.get(symbol);
}

function pct(now: number, then: number | undefined) {
  if (!then) return 0;
  return ((now - then) / then) * 100;
}

function at(points: Point[], msAgo: number) {
  const cutoff = (points.at(-1)?.timestamp ?? 0) - msAgo / 1000;
  let pick = points[0];
  for (const point of points) {
    if (point.timestamp <= cutoff) pick = point;
  }
  return pick?.price;
}

function toCandles(points: Point[]): Candle[] {
  return points.map((point, index) => {
    const prev = points[index - 1]?.price ?? point.price;
    return { o: prev, h: Math.max(prev, point.price), l: Math.min(prev, point.price), c: point.price };
  });
}

async function llamaChart(ids: string[], span: number, period: string, start: number) {
  if (!ids.length) return {} as Record<string, Point[]>;
  const response = await fetch(`${LLAMA}/chart/${ids.join(",")}?start=${start}&span=${span}&period=${period}`);
  if (!response.ok) return {};
  const body = (await response.json()) as { coins?: Record<string, { prices?: Point[] }> };
  const out: Record<string, Point[]> = {};
  for (const [id, row] of Object.entries(body.coins ?? {})) out[id] = row.prices ?? [];
  return out;
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

function applyWindows(token: (typeof TOKENS)[number], series: Point[] | undefined, recent: Point[] | undefined, price: number) {
  const points = recent && recent.length > 1 ? recent : series;
  if (points && points.length > 1) candles.set(token.symbol, toCandles(points));
  if (!series || series.length < 2) return;
  const last = series.at(-1)!.price || price;
  token.windows = {
    m5: pct(recent?.at(-1)?.price ?? last, recent?.at(-2)?.price),
    h1: pct(last, at(series, 60 * 60 * 1000)),
    h4: pct(last, at(series, 4 * 60 * 60 * 1000)),
    h24: pct(last, series[0]?.price),
  } satisfies Record<WindowId, number>;
  token.change = token.windows.h24;
}

function canon(raw: string) {
  const upper = raw.replace(/\s/g, "").toUpperCase();
  return ALIAS[upper] ?? upper;
}

function paint(token: (typeof TOKENS)[number], price: number, liqUsd?: number) {
  token.price = price;
  if (liqUsd != null && liqUsd > 0) {
    token.liqN = liqUsd;
    token.liquidity = money(liqUsd);
  }
  token.notes = ["DefiLlama price", liqUsd ? "Rhea available liquidity" : "Rhea has no pool for this symbol"];
}

export async function refreshLive() {
  const now = Math.floor(Date.now() / 1000);
  const ids = [...new Set(Object.values(COINGECKO))];
  const [day, hour, rows, cap] = await Promise.all([
    llamaChart(ids, 48, "30m", now - 24 * 3600),
    llamaChart(ids, 12, "5m", now - 3600),
    rheaRows().catch(() => [] as RheaRow[]),
    nearCap().catch(() => 0),
  ]);
  const marks: Record<string, number> = {};
  const rheaBySymbol = new Map<string, RheaRow>();
  for (const row of rows) {
    const raw = row.symbol ?? "";
    if (!raw || raw.includes("$")) continue;
    rheaBySymbol.set(canon(raw), row);
  }
  for (const [symbol, row] of rheaBySymbol) {
    const price = Number(row.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!TOKENS.some((token) => token.symbol === symbol) && Number(row.available_liquidity_price) > 10_000) {
      ensureToken({ symbol, name: symbol, price, chain: "NEAR" });
    }
  }
  for (const token of TOKENS) {
    const id = COINGECKO[token.symbol] ?? COINGECKO[token.symbol.toUpperCase()];
    const series = id ? day[id] : undefined;
    const recent = id ? hour[id] : undefined;
    const row = rheaBySymbol.get(token.symbol) ?? rheaBySymbol.get(token.symbol.toUpperCase());
    let price = series?.at(-1)?.price ?? recent?.at(-1)?.price ?? Number(row?.price);
    if (price == null || !Number.isFinite(price) || price <= 0) continue;
    const liq = Number(row?.available_liquidity_price);
    paint(token, price, Number.isFinite(liq) ? liq : undefined);
    applyWindows(token, series, recent, price);
    if (token.symbol === "NEAR" && cap > 0) {
      token.mcapN = cap;
      token.mcap = money(cap);
      token.fdv = money(cap);
    }
    marks[token.symbol] = price;
  }
  const lend = [...rheaBySymbol.entries()]
    .map(([symbol, row]) => ({
      symbol,
      supplyApy: Number(row.supply_apy) || 0,
      borrowApy: Number(row.borrow_apy) || 0,
    }))
    .filter((market) => market.supplyApy > 0 || market.borrowApy > 0)
    .sort((a, b) => b.supplyApy - a.supplyApy);
  if (lend.length) {
    LEND_MARKETS.splice(0, LEND_MARKETS.length, ...lend.slice(0, 8));
  }
  if (Object.keys(marks).length) {
    useDesk.setState((state) => ({ marks: { ...state.marks, ...marks }, clock: state.clock + 1 }));
  }
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
  window.setInterval(run, 30_000);
}