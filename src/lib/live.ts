import { ensureToken, isCanonical, LEND_MARKETS, money, qualityScore, TOKENS, type Candle, type Print } from "@/lib/market";
import { iconFor, geckoIdFor, loadIconBook, syncNearMarkets, applyIconBook } from "@/lib/dex";
import { useDesk } from "@/lib/store";

const LLAMA = "https://coins.llama.fi";
const RHEA = "https://lendingsdk.rhea.finance/list_token_data";

const COINGECKO: Record<string, string> = {
  NEAR: "coingecko:near",
  WNEAR: "coingecko:near",
  ETH: "coingecko:ethereum",
  WETH: "coingecko:weth",
  BTC: "coingecko:bitcoin",
  WBTC: "coingecko:wrapped-bitcoin",
  USDC: "coingecko:usd-coin",
  USDT: "coingecko:tether",
  SOL: "coingecko:solana",
  BNB: "coingecko:binancecoin",
  AVAX: "coingecko:avalanche-2",
  POL: "coingecko:polygon-ecosystem-token",
  MATIC: "coingecko:matic-network",
  ARB: "coingecko:arbitrum",
  OP: "coingecko:optimism",
  DOGE: "coingecko:dogecoin",
  XRP: "coingecko:ripple",
  ADA: "coingecko:cardano",
  LTC: "coingecko:litecoin",
  BCH: "coingecko:bitcoin-cash",
  TRX: "coingecko:tron",
  SUI: "coingecko:sui",
  APT: "coingecko:aptos",
  LINK: "coingecko:chainlink",
  UNI: "coingecko:uniswap",
  AAVE: "coingecko:aave",
  DAI: "coingecko:dai",
  AURORA: "coingecko:aurora-near",
  STNEAR: "coingecko:staked-near",
  SWEAT: "coingecko:sweatcoin",
  RHEA: "coingecko:rhea-2",
};

const LLAMA_CHAIN: Record<string, string> = {
  NEAR: "near",
  Ethereum: "ethereum",
  BNB: "bsc",
  Polygon: "polygon",
  Avalanche: "avax",
  Arbitrum: "arbitrum",
  Optimism: "optimism",
  Base: "base",
  Gnosis: "gnosis",
  Scroll: "scroll",
  Aurora: "aurora",
  Solana: "solana",
  Tron: "tron",
  Sui: "sui",
  Aptos: "aptos",
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
const candleAt = new Map<string, number>();
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

function llamaCandidates(symbol: string) {
  const out: string[] = [];
  const push = (id: string) => {
    if (id && !out.includes(id)) out.push(id);
  };
  const base = symbol.split(".")[0].toUpperCase();
  push(COINGECKO[symbol] ?? "");
  push(COINGECKO[base] ?? "");
  const gecko = geckoIdFor(symbol) || geckoIdFor(base);
  if (gecko) push(gecko.startsWith("coingecko:") ? gecko : `coingecko:${gecko}`);
  const token = TOKENS.find((item) => item.symbol === symbol);
  const prefix = token ? LLAMA_CHAIN[token.chain] : "";
  const raw = token?.address ?? "";
  if (prefix && raw && !raw.includes(":")) push(`${prefix}:${raw.startsWith("0x") ? raw.toLowerCase() : raw}`);
  const contract = CONTRACTS[symbol] ?? CONTRACTS[base];
  if (contract) push(`near:${contract}`);
  return out;
}

function llamaId(symbol: string) {
  return llamaCandidates(symbol)[0] ?? "";
}

const PAGE = 500;
type Book = { points: Point[]; from: number; exhausted: boolean; id: string };
const books = new Map<string, Book>();
const tails = new Map<string, Promise<unknown>>();
const firstSeen = new Map<string, number>();

function historyPlan(frame: string) {
  // DefiLlama has no regular 1-minute book. 1m rides the finest real series, which is 5m.
  if (frame === "1m" || frame === "5m") return { period: "5m", step: 300, search: 1_800 };
  if (frame === "15m") return { period: "15m", step: 900, search: 3_600 };
  if (frame === "1H") return { period: "1h", step: 3600, search: 7_200 };
  if (frame === "4H") return { period: "4h", step: 4 * 3600, search: 86_400 };
  return { period: "1d", step: 86400, search: 172_800 };
}

function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(task, task);
  tails.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function llamaSeries(id: string, start: number, period: string, search: number) {
  const response = await fetch(
    `${LLAMA}/chart/${id}?start=${Math.floor(start)}&span=${PAGE}&period=${period}&searchWidth=${search}`,
  );
  if (response.status === 429 || response.status >= 500) return null;
  if (!response.ok) return [] as Point[];
  const body = (await response.json()) as { coins?: Record<string, { prices?: Point[] }> };
  const coin = body.coins?.[id] ?? Object.values(body.coins ?? {})[0];
  return coin?.prices ?? [];
}

async function earliest(id: string) {
  const cached = firstSeen.get(id);
  if (cached != null) return cached;
  try {
    const response = await fetch(`${LLAMA}/prices/first/${id}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { coins?: Record<string, { timestamp?: number }> };
    const row = body.coins?.[id] ?? Object.values(body.coins ?? {})[0];
    const ts = Number(row?.timestamp);
    const value = Number.isFinite(ts) && ts > 0 ? ts : 0;
    firstSeen.set(id, value);
    return value;
  } catch {
    return null;
  }
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

function publishBook(key: string, book: Book) {
  const next = book.points.length > 1 ? toCandles(book.points) : [];
  candles.set(key, next);
  candleAt.set(key, Date.now());
  useDesk.setState((state) => ({ clock: state.clock + 1 }));
  return next;
}

export function candleMeta(symbol: string, frame = "5m") {
  const book = books.get(`${symbol}:${frame}`);
  return { bars: book?.points.length ?? 0, from: book?.from ?? 0, exhausted: Boolean(book?.exhausted) };
}

const historyFlight = new Map<string, Promise<Candle[]>>();
const olderFlight = new Map<string, Promise<boolean>>();

export async function loadCandles(symbol: string, frame = "5m") {
  const key = `${symbol}:${frame}`;
  const cached = candles.get(key);
  const stamp = candleAt.get(key) ?? 0;
  if (cached && cached.length > 1 && Date.now() - stamp < 20_000) return cached;
  const pending = historyFlight.get(key);
  if (pending) return pending;
  const job = enqueue(key, () => fetchCandles(symbol, frame, key)).finally(() => historyFlight.delete(key));
  historyFlight.set(key, job);
  return job;
}

async function fetchCandles(symbol: string, frame: string, key: string) {
  const plan = historyPlan(frame);
  const now = Math.floor(Date.now() / 1000);
  let book = books.get(key);
  if (!book) {
    book = { points: [], from: now, exhausted: false, id: "" };
    books.set(key, book);
  }
  if (!book.id) {
    for (const id of llamaCandidates(symbol)) {
      const start = Math.max(ORIGIN, now - PAGE * plan.step);
      const part = await llamaSeries(id, start, plan.period, plan.search);
      if (!part || part.length < 2) continue;
      book.id = id;
      book.from = start;
      book.points = mergePoints([book.points, part]);
      break;
    }
    if (!book.id || book.points.length < 2) return candles.get(key) ?? [];
    return publishBook(key, book);
  }
  const start = Math.max(ORIGIN, now - PAGE * plan.step);
  const part = await llamaSeries(book.id, start, plan.period, plan.search);
  if (!part || !part.length) return candles.get(key) ?? [];
  book.points = mergePoints([book.points, part]);
  if (book.points.length < 2) return candles.get(key) ?? [];
  return publishBook(key, book);
}

export function loadOlderCandles(symbol: string, frame = "5m") {
  const key = `${symbol}:${frame}`;
  if (books.get(key)?.exhausted) return Promise.resolve(false);
  const pending = olderFlight.get(key);
  if (pending) return pending;
  const job = enqueue(key, () => olderCandles(symbol, frame, key)).finally(() => olderFlight.delete(key));
  olderFlight.set(key, job);
  return job;
}

async function olderCandles(symbol: string, frame: string, key: string) {
  if (!books.get(key)) await fetchCandles(symbol, frame, key);
  const book = books.get(key);
  if (!book || book.exhausted) return false;
  const id = book.id || llamaId(symbol);
  if (!id) return false;
  const plan = historyPlan(frame);
  const born = await earliest(id);
  if (born == null) return false;
  if (born <= 0) {
    book.exhausted = true;
    if (book.points.length > 1) publishBook(key, book);
    return false;
  }
  let added = 0;
  let filled = 0;
  for (let n = 0; n < 4; n++) {
    if (book.from <= born + plan.step || book.from <= ORIGIN + plan.step) {
      book.exhausted = true;
      break;
    }
    const start = Math.max(ORIGIN, book.from - PAGE * plan.step);
    if (start >= book.from) {
      book.exhausted = true;
      break;
    }
    const part = await llamaSeries(id, start, plan.period, plan.search);
    if (part == null) break;
    const before = book.points.length;
    book.points = mergePoints([book.points, part]);
    const grew = book.points.length - before;
    added += grew;
    book.from = start;
    if (grew > 0) filled += 1;
    if (start <= born || start <= ORIGIN) book.exhausted = true;
    if (filled >= 2 || book.exhausted) break;
  }
  if (book.points.length > 1) publishBook(key, book);
  else useDesk.setState((state) => ({ clock: state.clock + 1 }));
  return added > 0;
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

export type HolderRow = { account: string; amount: number; share: number | null };

export async function loadHolders(symbol: string, address?: string): Promise<{ rows: HolderRow[]; top10: number | null }> {
  const contract = address || CONTRACTS[symbol] || "";
  if (!contract) return { rows: [], top10: null };
  const [holdersRes, supply, decimals] = await Promise.all([
    fetch(`https://api.nearblocks.io/v1/fts/${encodeURIComponent(contract)}/holders?page=1&per_page=10`).catch(() => null),
    ftSupplyRaw(contract),
    ftDecimals(contract),
  ]);
  const body = holdersRes && holdersRes.ok ? ((await holdersRes.json()) as { holders?: { account?: string; amount?: string }[] }) : {};
  const rows = (body.holders ?? [])
    .map((row) => {
      const raw = (row.amount ?? "0").replace(/\D/g, "") || "0";
      return { account: row.account || "—", amount: humanRaw(raw, decimals), share: sharePct(raw, supply) };
    })
    .filter((row) => row.amount > 0);
  const top10 = rows.some((row) => row.share != null) ? rows.reduce((sum, row) => sum + (row.share ?? 0), 0) : null;
  return { rows, top10 };
}

async function ftView(contract: string, method: string) {
  const response = await fetch("https://rpc.mainnet.near.org", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: method,
      method: "query",
      params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: "e30=" },
    }),
  });
  if (!response.ok) throw new Error("rpc");
  const body = (await response.json()) as { result?: { result?: number[] } };
  const bytes = body.result?.result ?? [];
  if (!bytes.length) throw new Error("empty");
  return new TextDecoder().decode(new Uint8Array(bytes));
}

async function ftSupplyRaw(contract: string) {
  try {
    const text = (await ftView(contract, "ft_total_supply")).replace(/"/g, "").trim();
    return /^\d+$/.test(text) ? text : "0";
  } catch {
    return "0";
  }
}

async function ftDecimals(contract: string) {
  try {
    const meta = JSON.parse(await ftView(contract, "ft_metadata")) as { decimals?: number };
    return Number.isFinite(meta.decimals) ? Number(meta.decimals) : 0;
  } catch {
    return 0;
  }
}

function sharePct(amount: string, supply: string) {
  try {
    const a = BigInt(amount);
    const s = BigInt(supply);
    if (a <= 0n || s <= 0n) return null;
    return Number((a * 10000n) / s) / 100;
  } catch {
    return null;
  }
}

function humanRaw(raw: string, decimals: number) {
  if (!/^\d+$/.test(raw)) return 0;
  if (decimals <= 0) return Number(raw);
  const whole = raw.length > decimals ? raw.slice(0, raw.length - decimals) : "0";
  const frac = raw.padStart(decimals + 1, "0").slice(-decimals).slice(0, 6).replace(/0+$/, "");
  const value = Number(frac ? `${whole}.${frac}` : whole);
  return Number.isFinite(value) ? value : 0;
}

let marketFlight: Promise<void> | null = null;
let flightAt = 0;

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
  const [dexMarks, icons, cap] = await Promise.all([dexPromise, iconsPromise, capPromise]);
  Object.assign(marks, dexMarks);
  if (cap > 0) {
    const near = TOKENS.find((token) => token.symbol === "NEAR");
    if (near) {
      near.mcapN = cap;
      near.mcap = money(cap);
      near.fdv = money(cap);
    }
  }
  applyIconBook(icons);
  for (const token of TOKENS) {
    token.verified = isCanonical(token);
    token.score = qualityScore(token) ?? 0;
  }
  publish(marks);
}

export async function refreshLive() {
  if (marketFlight && Date.now() - flightAt < 12_000) return marketFlight;
  flightAt = Date.now();
  const job = refreshMarkets().finally(() => {
    if (marketFlight === job) marketFlight = null;
  });
  marketFlight = job;
  return job;
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
  window.setInterval(run, 10_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") run();
  });
  window.setTimeout(() => {
    void loadCandles("NEAR", "1D").catch(() => undefined);
    void loadCandles("NEAR", "5m").catch(() => undefined);
  }, 400);
}