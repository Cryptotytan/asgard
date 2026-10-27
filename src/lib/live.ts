import { ensureToken, isCanonical, isMajorAsset, LEND_MARKETS, money, qualityScore, TOKENS, type Candle, type Print } from "@/lib/market";
import { iconFor, geckoIdFor, knownPool, loadIconBook, refreshDexMarkets, syncNearMarkets, applyIconBook, fillListedStats } from "@/lib/dex";
import { syncPerpMarkets } from "@/lib/perps";
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
  TON: "ton",
  Starknet: "starknet",
  Berachain: "berachain",
  Monad: "monad",
  Abstract: "abstract",
  Hyperliquid: "hyperliquid",
};

const GECKO_NET: Record<string, string> = {
  NEAR: "near",
  Ethereum: "eth",
  Solana: "solana",
  Base: "base",
  Arbitrum: "arbitrum",
  Optimism: "optimism",
  BNB: "bsc",
  Polygon: "polygon_pos",
  Avalanche: "avax",
  Gnosis: "gnosis",
  Scroll: "scroll",
  Aurora: "aurora",
  Berachain: "berachain",
  "X Layer": "x-layer",
  Tron: "tron",
  TON: "ton",
  Sui: "sui",
  Aptos: "aptos",
  Starknet: "starknet",
  Monad: "monad",
  Abstract: "abstract",
  Hyperliquid: "hyperevm",
  Plasma: "plasma",
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
  const token = TOKENS.find((item) => item.symbol === symbol);
  const prefix = token ? LLAMA_CHAIN[token.chain] : "";
  const raw = token?.address ?? "";
  const own = prefix && raw && !raw.includes(":") ? `${prefix}:${raw.startsWith("0x") ? raw.toLowerCase() : raw}` : "";
  const major = Boolean(token && (isCanonical(token) || isMajorAsset(base, token.chain)));
  if (own) push(own);
  if (!token || major) {
    push(COINGECKO[symbol] ?? "");
    push(COINGECKO[base] ?? "");
  }
  const gecko = geckoIdFor(symbol) || geckoIdFor(base);
  if (gecko) push(gecko.startsWith("coingecko:") ? gecko : `coingecko:${gecko}`);
  const contract = CONTRACTS[symbol] ?? CONTRACTS[base];
  if (contract && (!token || token.chain === "NEAR")) push(`near:${contract}`);
  return out;
}

function marketChartId(symbol: string) {
  if (COINGECKO[symbol]) return COINGECKO[symbol];
  const base = symbol.split(".")[0].toUpperCase();
  const token = TOKENS.find((item) => item.symbol === symbol);
  if (!token || symbol.includes(".")) return "";
  if ((isCanonical(token) || isMajorAsset(symbol, token.chain)) && COINGECKO[base]) return COINGECKO[base];
  return "";
}

function llamaId(symbol: string) {
  return marketChartId(symbol) || llamaCandidates(symbol)[0] || "";
}

function priceAgrees(close: number, expect: number) {
  if (!(expect > 0) || !(close > 0)) return true;
  const ratio = close / expect;
  return ratio > 0.55 && ratio < 1.8;
}

const PAGE = 500;
type Book = { points: Point[]; bars?: Candle[]; from: number; exhausted: boolean; id: string };
const books = new Map<string, Book>();
const tails = new Map<string, Promise<unknown>>();
const firstSeen = new Map<string, number>();

function historyPlan(frame: string) {
  if (frame === "1m") return { period: "1m", step: 60, search: 180 };
  if (frame === "5m") return { period: "5m", step: 300, search: 1_800 };
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

const llamaFlight = new Map<string, Promise<Point[] | null>>();

async function llamaSeries(id: string, start: number, period: string, search: number, span = PAGE) {
  const url = `${LLAMA}/chart/${id}?start=${Math.floor(start)}&span=${span}&period=${period}&searchWidth=${search}`;
  const pending = llamaFlight.get(url);
  if (pending) return pending;
  const job = (async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!response || response.status === 429 || response.status >= 500) return null;
    if (!response.ok) return [] as Point[];
    const body = (await response.json()) as { coins?: Record<string, { prices?: Point[] }> };
    const coin = body.coins?.[id] ?? Object.values(body.coins ?? {})[0];
    return coin?.prices ?? [];
  })().finally(() => llamaFlight.delete(url));
  llamaFlight.set(url, job);
  return job;
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
  const next = book.bars && book.bars.length > 1 ? book.bars : book.points.length > 1 ? toCandles(book.points) : [];
  if (next.length < 2) return next;
  candles.set(key, next);
  candleAt.set(key, Date.now());
  const split = key.lastIndexOf(":");
  remember(key.slice(0, split), next, bucket(key.slice(split + 1)));
  useDesk.setState((state) => ({ clock: state.clock + 1 }));
  return next;
}

const FRAME_SEC: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1H": 3600, "4H": 14400, "1D": 86400 };
const ALL_FRAMES = ["1m", "5m", "15m", "1H", "4H", "1D"];
const sources = new Map<string, { step: number; bars: Candle[] }[]>();

function bucket(frame: string) {
  return FRAME_SEC[frame] ?? 900;
}

function aggregateBars(bars: Candle[], step: number) {
  const buckets = new Map<number, Candle>();
  for (const bar of bars) {
    const t = bar.t ?? 0;
    if (!t || !(bar.c > 0)) continue;
    const key = Math.floor(t / step) * step;
    const have = buckets.get(key);
    if (!have) buckets.set(key, { t: key, o: bar.o, h: bar.h, l: bar.l, c: bar.c });
    else {
      have.h = Math.max(have.h, bar.h);
      have.l = Math.min(have.l, bar.l);
      have.c = bar.c;
    }
  }
  return [...buckets.values()].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
}

function remember(symbol: string, bars: Candle[], step: number) {
  if (!symbol || bars.length < 2 || step <= 0) return;
  const list = sources.get(symbol) ?? [];
  const index = list.findIndex((source) => source.step === step);
  if (index >= 0 && list[index].bars.length >= bars.length) return;
  if (index >= 0) list[index] = { step, bars };
  else list.push({ step, bars });
  sources.set(symbol, list);
  for (const frame of ALL_FRAMES) {
    const frameStep = bucket(frame);
    if (step > frameStep) continue;
    const agg = step === frameStep ? bars : aggregateBars(bars, frameStep);
    if (agg.length < 2) continue;
    const key = `${symbol}:${frame}`;
    const have = candles.get(key);
    if (have && have.length >= agg.length) continue;
    candles.set(key, agg);
  }
}

const warming = new Set<string>();

export function warmCharts(symbol: string) {
  if (warming.has(symbol)) return;
  warming.add(symbol);
  void (async () => {
    await loadCandles(symbol, "15m").catch(() => undefined);
    await loadCandles(symbol, "1m").catch(() => undefined);
    await loadCandles(symbol, "5m").catch(() => undefined);
    await loadCandles(symbol, "1H").catch(() => undefined);
  })().finally(() => {
    window.setTimeout(() => warming.delete(symbol), 60_000);
  });
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
  if (cached && cached.length > 1 && Date.now() - stamp < 180_000) return cached;
  const pending = historyFlight.get(key);
  if (pending) return pending;
  const job = enqueue(key, () => fetchCandles(symbol, frame, key)).finally(() => historyFlight.delete(key));
  historyFlight.set(key, job);
  return job;
}

function geckoFrame(frame: string) {
  if (frame === "1m") return { tf: "minute", aggregate: 1 };
  if (frame === "5m") return { tf: "minute", aggregate: 5 };
  if (frame === "15m") return { tf: "minute", aggregate: 15 };
  if (frame === "1H") return { tf: "hour", aggregate: 1 };
  if (frame === "4H") return { tf: "hour", aggregate: 4 };
  return { tf: "day", aggregate: 1 };
}

function readBars(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) return [];
  const bars: Candle[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const t = Number(row[0]);
    const o = Number(row[1]);
    const h = Number(row[2]);
    const l = Number(row[3]);
    const c = Number(row[4]);
    if (t > 0 && o > 0 && h > 0 && l > 0 && c > 0) bars.push({ t, o, h, l, c });
  }
  bars.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  return bars;
}

function mergeBars(left: Candle[] = [], right: Candle[] = []) {
  const map = new Map<number, Candle>();
  for (const bar of [...left, ...right]) if (bar.t && bar.c > 0) map.set(bar.t, bar);
  return [...map.values()].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
}

async function geckoGet(url: string) {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!response || response.status === 429 || response.status >= 500 || !response.ok) return null;
  return response.json() as Promise<Record<string, unknown>>;
}

const poolCache = new Map<string, string>();
const poolFlight = new Map<string, Promise<string>>();

async function geckoPool(network: string, address: string, expect = 0, remember = true) {
  const key = `${network}:${address}`;
  if (remember) {
    const cached = poolCache.get(key);
    if (cached) return cached;
    const pending = poolFlight.get(key);
    if (pending) return pending;
  }
  const job = (async () => {
    const body = await geckoGet(`https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${encodeURIComponent(address)}/pools?page=1`);
    const rows = (body as { data?: { attributes?: { address?: string; base_token_price_usd?: string; reserve_in_usd?: string; volume_usd?: { h24?: string } | string } }[] } | null)?.data ?? [];
    let best = "";
    let bestVol = -1;
    for (const row of rows) {
      const attrs = row.attributes ?? {};
      const pool = attrs.address ?? "";
      const px = Number(attrs.base_token_price_usd);
      if (!pool || !(px > 0) || !priceAgrees(px, expect)) continue;
      const vol = Number(typeof attrs.volume_usd === "object" ? attrs.volume_usd?.h24 : attrs.volume_usd) || Number(attrs.reserve_in_usd) || 0;
      if (vol >= bestVol) {
        bestVol = vol;
        best = pool;
      }
    }
    if (best && remember) poolCache.set(key, best);
    return best;
  })();
  if (remember) {
    poolFlight.set(key, job);
    void job.finally(() => poolFlight.delete(key));
  }
  return job;
}

async function geckoBars(network: string, pool: string, frame: string, before?: number, limit = 1000) {
  const plan = geckoFrame(frame);
  const query = new URLSearchParams({ aggregate: String(plan.aggregate), limit: String(limit), currency: "usd" });
  if (before && before > 0) query.set("before_timestamp", String(Math.floor(before)));
  const body = await geckoGet(`https://api.geckoterminal.com/api/v2/networks/${network}/pools/${encodeURIComponent(pool)}/ohlcv/${plan.tf}?${query}`);
  const rows = (body as { data?: { attributes?: { ohlcv_list?: unknown } } } | null)?.data?.attributes?.ohlcv_list;
  return readBars(rows);
}

async function loadGeckoBook(symbol: string, frame: string, book: Book) {
  const token = TOKENS.find((item) => item.symbol === symbol);
  const network = token ? GECKO_NET[token.chain] : "";
  const raw = token?.address ?? "";
  if (!network || !raw || raw.includes(":")) return false;
  const address = raw.startsWith("0x") ? raw.toLowerCase() : raw;
  const expect = token?.price ?? 0;
  const hinted = token ? knownPool(token.chain, raw) : "";
  let pool = book.id.startsWith("gecko:") ? book.id.split(":").slice(2).join(":") : hinted || (await geckoPool(network, address, expect));
  if (!pool) return false;
  let bars = await geckoBars(network, pool, frame, undefined, 40);
  const close = bars[bars.length - 1]?.c ?? 0;
  if (bars.length < 2 || !priceAgrees(close, expect)) {
    poolCache.delete(`${network}:${address}`);
    if (!hinted) return false;
    pool = await geckoPool(network, address, expect);
    if (!pool) return false;
    bars = await geckoBars(network, pool, frame, undefined, 40);
    if (bars.length < 2 || !priceAgrees(bars[bars.length - 1]?.c ?? 0, expect)) return false;
  }
  if (book.id && !book.id.startsWith("gecko:") && book.points.length > 1) return false;
  book.id = `gecko:${network}:${pool}`;
  book.bars = mergeBars(book.bars, bars);
  book.points = book.bars.map((bar) => ({ timestamp: bar.t ?? 0, price: bar.c }));
  book.from = book.bars[0]?.t ?? book.from;
  return book.bars.length > 1;
}

const deepening = new Set<string>();

async function deepen(symbol: string, frame: string, key: string) {
  if (deepening.has(key)) return;
  deepening.add(key);
  const book = books.get(key);
  if (!book?.id) return;
  const plan = historyPlan(frame);
  const now = Math.floor(Date.now() / 1000);
  if (book.id.startsWith("gecko:")) {
    const network = book.id.split(":")[1] ?? "";
    const pool = book.id.split(":").slice(2).join(":");
    const bars = network && pool ? await geckoBars(network, pool, frame) : [];
    if (bars.length > (book.bars?.length ?? 0)) {
      book.bars = mergeBars(book.bars, bars);
      book.points = book.bars.map((bar) => ({ timestamp: bar.t ?? 0, price: bar.c }));
      book.from = book.bars[0]?.t ?? book.from;
      publishBook(key, book);
    }
    return;
  }
  const start = Math.max(ORIGIN, now - PAGE * plan.step);
  const part = await llamaSeries(book.id, start, plan.period, plan.search);
  if (!part || part.length <= book.points.length) return;
  book.points = mergePoints([book.points, part]);
  book.from = start;
  publishBook(key, book);
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
    const market = marketChartId(symbol);
    const primary = market || llamaCandidates(symbol)[0] || "";
    const start = Math.max(ORIGIN, now - PAGE * plan.step);
    let shown = false;
    const show = () => {
      if ((book.bars && book.bars.length > 1) || book.points.length > 1) {
        shown = true;
        publishBook(key, book);
      }
    };
    await Promise.all([
      (async () => {
        if (!primary) return;
        const part = await llamaSeries(primary, start, plan.period, plan.search, 16);
        if (!part || part.length < 2 || book.id.startsWith("gecko:")) return;
        const last = part[part.length - 1]?.price ?? 0;
        const expect = TOKENS.find((item) => item.symbol === symbol)?.price ?? 0;
        if (!market && !priceAgrees(last, expect)) return;
        book.id = primary;
        book.from = start;
        book.points = mergePoints([book.points, part]);
        book.bars = undefined;
        show();
      })(),
      (async () => {
        if (market) return;
        const found = await loadGeckoBook(symbol, frame, book);
        if (found && !shown) show();
      })(),
    ]);
    if (!shown && primary) {
      for (const id of llamaCandidates(symbol).slice(1, 3)) {
        const part = await llamaSeries(id, start, plan.period, plan.search, 16);
        if (!part || part.length < 2) continue;
        book.id = id;
        book.from = start;
        book.points = mergePoints([book.points, part]);
        book.bars = undefined;
        show();
        break;
      }
    }
    if (shown) void deepen(symbol, frame, key);
    return candles.get(key) ?? [];
  }
  if (book.id.startsWith("gecko:")) {
    const pool = book.id.split(":").slice(2).join(":");
    const network = book.id.split(":")[1] ?? "";
    const bars = network && pool ? await geckoBars(network, pool, frame) : [];
    if (bars.length > 1) {
      book.bars = mergeBars(book.bars, bars);
      book.points = book.bars.map((bar) => ({ timestamp: bar.t ?? 0, price: bar.c }));
    }
    if (!book.bars || book.bars.length < 2) return candles.get(key) ?? [];
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
  if (book.id.startsWith("gecko:")) {
    const pool = book.id.split(":").slice(2).join(":");
    const network = book.id.split(":")[1] ?? "";
    const oldest = book.bars?.[0]?.t ?? book.from;
    const older = network && pool ? await geckoBars(network, pool, frame, oldest) : [];
    const before = book.bars?.length ?? 0;
    book.bars = mergeBars(older, book.bars);
    book.points = (book.bars ?? []).map((bar) => ({ timestamp: bar.t ?? 0, price: bar.c }));
    book.from = book.bars?.[0]?.t ?? book.from;
    if ((book.bars?.length ?? 0) <= before) book.exhausted = true;
    if ((book.bars?.length ?? 0) > 1) publishBook(key, book);
    return (book.bars?.length ?? 0) > before;
  }
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
export type HolderBand = { label: string; pct: number };

function contractOf(symbol: string, address?: string) {
  const token = TOKENS.find((item) => item.symbol === symbol);
  let raw = address || token?.address || CONTRACTS[symbol] || CONTRACTS[symbol.split(".")[0]] || "";
  if (raw.includes(":")) raw = raw.slice(raw.lastIndexOf(":") + 1);
  if (raw.startsWith("0x")) raw = raw.toLowerCase();
  if ((symbol === "NEAR" || token?.symbol === "NEAR") && (!raw || raw === "near")) raw = "wrap.near";
  return { token, raw };
}

async function evmHolders(address: string, decimals: number): Promise<HolderRow[]> {
  const [listRes, infoRes] = await Promise.all([
    fetch(`https://api.ethplorer.io/getTopTokenHolders/${address}?apiKey=freekey&limit=15`),
    decimals > 0 ? Promise.resolve(null) : fetch(`https://api.ethplorer.io/getTokenInfo/${address}?apiKey=freekey`),
  ]);
  if (!listRes.ok) return [];
  const list = (await listRes.json()) as { holders?: { address?: string; balance?: number; share?: number }[] };
  let places = decimals;
  if (!(places > 0) && infoRes && infoRes.ok) {
    const info = (await infoRes.json()) as { decimals?: string | number };
    places = Number(info.decimals) || 0;
  }
  return (list.holders ?? [])
    .map((row) => {
      const balance = Number(row.balance) || 0;
      const amount = places > 0 && balance > 1e12 ? balance / 10 ** places : balance;
      const share = Number(row.share);
      return { account: row.address || "—", amount, share: Number.isFinite(share) ? share : null };
    })
    .filter((row) => row.amount > 0 || (row.share ?? 0) > 0)
    .slice(0, 15);
}

export async function loadHolders(symbol: string, address?: string): Promise<{ rows: HolderRow[]; top10: number | null; count: number | null; bands: HolderBand[] }> {
  const { token, raw } = contractOf(symbol, address);
  const near = token?.chain === "NEAR" || (!token && Boolean(raw));
  const network = token ? GECKO_NET[token.chain] : "";
  const [holdersRes, supply, decimals, info] = await Promise.all([
    near && raw ? fetch(`https://api.nearblocks.io/v1/fts/${encodeURIComponent(raw)}/holders?page=1&per_page=15`).catch(() => null) : Promise.resolve(null),
    near && raw ? ftSupplyRaw(raw) : Promise.resolve("0"),
    near && raw ? ftDecimals(raw) : Promise.resolve(0),
    network && raw ? geckoGet(`https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${encodeURIComponent(raw)}/info`) : Promise.resolve(null),
  ]);
  const body = holdersRes && holdersRes.ok ? ((await holdersRes.json()) as { holders?: { account?: string; amount?: string }[] }) : {};
  const rows = (body.holders ?? [])
    .map((row) => {
      const rawAmount = (row.amount ?? "0").replace(/\D/g, "") || "0";
      return { account: row.account || "—", amount: humanRaw(rawAmount, decimals), share: sharePct(rawAmount, supply) };
    })
    .filter((row) => row.amount > 0)
    .slice(0, 15);
  if (rows.length === 0 && raw.startsWith("0x")) {
    const evm = await evmHolders(raw, token?.decimals ?? 0).catch(() => [] as HolderRow[]);
    if (evm.length) rows.push(...evm);
  }
  const holders = (info as { data?: { attributes?: { holders?: { count?: number; distribution_percentage?: Record<string, string> } } } } | null)?.data?.attributes?.holders;
  const dist = holders?.distribution_percentage ?? {};
  const bands = [
    ["Top 10", dist.top_10],
    ["11–20", dist["11_20"] ?? dist["11_30"]],
    ["21–40", dist["21_40"]],
    ["Rest", dist.rest],
  ]
    .map(([label, value]) => ({ label: label as string, pct: Number(value) }))
    .filter((band) => band.label && band.pct > 0);
  const top10 = rows.some((row) => row.share != null) ? rows.reduce((sum, row) => sum + (row.share ?? 0), 0) : bands.find((band) => band.label === "Top 10")?.pct ?? null;
  const count = Number(holders?.count);
  return { rows, top10, count: count > 0 ? count : null, bands };
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
      token: row.token,
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
  void fillListedStats()
    .catch(() => undefined)
    .finally(() => publish(marks));
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

function agoIso(stamp: string) {
  const ms = Date.parse(stamp);
  if (!Number.isFinite(ms)) return "—";
  const min = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function sameToken(left: string, right: string) {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const tail = (value: string) => value.slice(value.lastIndexOf(":") + 1);
  return tail(a) === tail(b);
}

async function poolPrints(symbol: string): Promise<Print[]> {
  const { token, raw } = contractOf(symbol);
  const network = token ? GECKO_NET[token.chain] : "";
  if (!network || !raw) return [];
  const hinted = token ? knownPool(token.chain, raw) : "";
  const matched = hinted || (await geckoPool(network, raw, token?.price ?? 0));
  const first = matched ? await printsFromPool(network, matched, raw) : [];
  if (first.length) return first;
  const loose = await geckoPool(network, raw, 0, false);
  if (!loose || loose === matched) return first;
  return printsFromPool(network, loose, raw);
}

async function printsFromPool(network: string, pool: string, raw: string): Promise<Print[]> {
  const body = await geckoGet(`https://api.geckoterminal.com/api/v2/networks/${network}/pools/${encodeURIComponent(pool)}/trades`);
  const rows = (body as { data?: { attributes?: Record<string, string> }[] } | null)?.data ?? [];
  const prints: Print[] = [];
  for (const row of rows) {
    const trade = row.attributes ?? {};
    const to = String(trade.to_token_address ?? "");
    const from = String(trade.from_token_address ?? "");
    const buying = Boolean(to) && sameToken(to, raw);
    const selling = Boolean(from) && sameToken(from, raw);
    if (!buying && !selling) continue;
    const amount = Number(buying ? trade.to_token_amount : trade.from_token_amount);
    const price = Number(buying ? trade.price_to_in_usd : trade.price_from_in_usd);
    const usd = Number(trade.volume_in_usd);
    if (!(amount > 0)) continue;
    prints.push({
      age: agoIso(String(trade.block_timestamp ?? "")),
      side: buying ? "Buy" : "Sell",
      amount,
      usd: Number.isFinite(usd) ? usd : 0,
      price: Number.isFinite(price) ? price : 0,
      trader: shortAccount(String(trade.tx_from_address ?? "—")),
    });
    if (prints.length >= 16) break;
  }
  return prints;
}

export async function loadPrints(symbol: string) {
  const { token, raw } = contractOf(symbol);
  const near = token?.chain === "NEAR";
  const [pool, response] = await Promise.all([
    poolPrints(symbol).catch(() => [] as Print[]),
    near && raw ? fetch(`https://api.nearblocks.io/v1/fts/${encodeURIComponent(raw)}/txns?page=1&per_page=16`).catch(() => null) : Promise.resolve(null),
  ]);
  const nearRows: Print[] = [];
  if (response && response.ok) {
    const body = (await response.json()) as {
      txns?: { delta_amount?: string; block_timestamp?: string; involved_account_id?: string; ft?: { decimals?: number } }[];
    };
    const price = token?.price ?? 0;
    for (const tx of (body.txns ?? []).slice(0, 16)) {
      const decimals = tx.ft?.decimals ?? 0;
      const delta = tx.delta_amount ?? "0";
      const amount = Number(delta.replace("-", "")) / 10 ** (Number.isFinite(decimals) ? decimals : 0);
      if (!(amount > 0)) continue;
      nearRows.push({
        age: tx.block_timestamp ? agoFrom(tx.block_timestamp) : "—",
        side: delta.startsWith("-") ? "Sell" : "Buy",
        amount,
        usd: amount * price,
        price,
        trader: shortAccount(tx.involved_account_id ?? raw),
      });
    }
  }
  const rows = (pool.length ? pool : nearRows).slice(0, 16);
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
  window.setInterval(() => {
    void refreshDexMarkets().catch(() => undefined);
    void syncPerpMarkets().catch(() => undefined);
  }, 30_000);
  void syncPerpMarkets().catch(() => undefined);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") run();
  });
  window.setTimeout(() => {
    void loadCandles("NEAR", "15m").catch(() => undefined);
    void loadCandles("NEAR", "5m").catch(() => undefined);
  }, 400);
}