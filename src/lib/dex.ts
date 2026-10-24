import { ensureToken, money, preferIcon, TOKENS, type WindowId } from "@/lib/market";

const REF = "https://indexer.ref.finance/list-token";
const BLOCKS = "https://api.nearblocks.io/v1/fts";
const PAIRS = "https://api.dexscreener.com/token-pairs/v1/near";
const TOKENS_API = "https://api.dexscreener.com/tokens/v1/near";

const ANCHORS = [
  "wrap.near",
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "usdt.tether-token.near",
  "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",
  "dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near",
  "token.rhealab.near",
  "eth.bridge.near",
  "853d955acef822db058eb8505911ed77f175b99e.factory.bridge.near",
];

const ADDRESS_SYMBOL: Record<string, string> = {
  "wrap.near": "NEAR",
  "2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near": "wBTC",
  "eth.bridge.near": "ETH",
  "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near": "AURORA",
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": "USDC",
  "usdt.tether-token.near": "USDT",
};

const LOCAL: Record<string, string> = {
  NEAR: "/tokens/near.svg",
  WNEAR: "/tokens/near.svg",
  USDC: "/tokens/usdc.png",
  ETH: "/tokens/eth.png",
  WBTC: "/tokens/wbtc.png",
  AURORA: "/tokens/aurora.jpg",
  RHEA: "/tokens/rhea.svg",
  SWEAT: "/tokens/sweat.svg",
  STNEAR: "/tokens/stnear.svg",
  BRRR: "/tokens/brrr.svg",
  HOT: "/tokens/hot.svg",
  LINEAR: "/tokens/linear.svg",
};

type DexPair = {
  dexId?: string;
  baseToken?: { address?: string; name?: string; symbol?: string };
  quoteToken?: { address?: string; symbol?: string };
  priceUsd?: string;
  txns?: Partial<Record<WindowId, { buys?: number; sells?: number }>>;
  volume?: Partial<Record<WindowId, number>>;
  priceChange?: Partial<Record<WindowId, number>>;
  liquidity?: { usd?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: { imageUrl?: string };
};

export let marketsSynced = false;

let iconBook: Map<string, string> | null = null;
let iconAt = 0;
let discover: string[] = [];

function safeIcon(icon: unknown) {
  if (typeof icon !== "string" || icon.length > 80_000) return "";
  if (icon.startsWith("https://") || icon.startsWith("/tokens/") || icon.startsWith("data:image/")) return icon;
  return "";
}

export function iconFor(address: string | undefined, symbol: string, dexImage?: string) {
  const listed = address ? safeIcon(iconBook?.get(address)) : "";
  if (listed) return listed;
  const local = LOCAL[symbol.toUpperCase()] ?? LOCAL[symbol] ?? "";
  if (local) return local;
  const dex = safeIcon(dexImage);
  if (dex) return dex;
  return address ? `https://cdn.dexscreener.com/tokens/near/${address}.png` : "";
}

export function applyIconBook(book?: Map<string, string>) {
  if (book) iconBook = book;
  let changed = false;
  for (const token of TOKENS) {
    const next = iconFor(token.address, token.symbol);
    const icon = preferIcon(token.icon, next || undefined);
    if (icon && icon !== token.icon) {
      token.icon = icon;
      changed = true;
    }
  }
  return changed;
}

async function refIcons() {
  const response = await fetch(REF);
  if (!response.ok) return new Map<string, string>();
  const body = (await response.json()) as Record<string, { icon?: string }>;
  const map = new Map<string, string>();
  for (const [address, meta] of Object.entries(body)) {
    const icon = safeIcon(meta?.icon);
    if (icon) map.set(address, icon);
  }
  return map;
}

async function nearIcons() {
  const map = new Map<string, string>();
  const ranked: string[] = [];
  const pages = await Promise.all(
    [1, 2].map(async (page) => {
      const response = await fetch(`${BLOCKS}?page=${page}&per_page=50`);
      if (!response.ok) return [] as { contract?: string; icon?: string }[];
      const body = (await response.json()) as { tokens?: { contract?: string; icon?: string }[] };
      return body.tokens ?? [];
    }),
  );
  for (const row of pages.flat()) {
    if (!row.contract) continue;
    ranked.push(row.contract);
    const icon = safeIcon(row.icon);
    if (icon && !map.has(row.contract)) map.set(row.contract, icon);
  }
  return { map, ranked };
}

export async function loadIconBook() {
  if (iconBook && Date.now() - iconAt < 10 * 60 * 1000) return iconBook;
  const [ref, blocks] = await Promise.all([refIcons().catch(() => new Map<string, string>()), nearIcons().catch(() => ({ map: new Map<string, string>(), ranked: [] as string[] }))]);
  const map = new Map(ref);
  for (const [address, icon] of blocks.map) if (!map.has(address)) map.set(address, icon);
  if (!map.get("wrap.near")) map.set("wrap.near", "/tokens/near.svg");
  iconBook = map;
  discover = blocks.ranked;
  iconAt = Date.now();
  return map;
}

async function getJson<T>(url: string): Promise<T | null> {
  const response = await fetch(url);
  if (!response.ok) return null;
  return (await response.json()) as T;
}

function num(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function windows(source: Partial<Record<WindowId, number>> | undefined): Record<WindowId, number> {
  return {
    m5: num(source?.m5),
    h1: num(source?.h1),
    h6: num(source?.h6),
    h24: num(source?.h24),
  };
}

export async function syncNearMarkets(book?: Map<string, string>, onPaint?: (marks: Record<string, number>) => void) {
  if (book) iconBook = book;
  const marks: Record<string, number> = {};
  const batches = await Promise.all(ANCHORS.map((address) => getJson<DexPair[]>(`${PAIRS}/${address}`).catch(() => null)));
  const pairs = batches.flatMap((rows) => (Array.isArray(rows) ? rows : []));
  const seen = new Set<string>();
  const best = new Map<string, DexPair>();
  const take = (pair: DexPair) => {
    const address = pair.baseToken?.address;
    if (!address || !pair.baseToken?.symbol) return;
    const vol = num(pair.volume?.h24);
    const prev = best.get(address);
    if (!prev || vol >= num(prev.volume?.h24)) best.set(address, pair);
    seen.add(address);
  };
  for (const pair of pairs) take(pair);
  paintDex(best, marks);
  marketsSynced = pairs.length > 0 || marketsSynced;
  onPaint?.({ ...marks });

  const extra: string[] = [];
  for (const address of discover) {
    if (seen.has(address) || extra.length >= 90) continue;
    if (address.includes(" ") || address.length > 120) continue;
    extra.push(address);
  }
  const chunks: string[] = [];
  for (let i = 0; i < extra.length; i += 30) chunks.push(extra.slice(i, i + 30).join(","));
  const extras = await Promise.all(chunks.map((chunk) => getJson<DexPair[]>(`${TOKENS_API}/${chunk}`).catch(() => null)));
  for (const rows of extras) for (const pair of Array.isArray(rows) ? rows : []) take(pair);
  if (extras.length) {
    paintDex(best, marks);
    onPaint?.({ ...marks });
  }
  marketsSynced = true;
  return marks;
}

function paintDex(best: Map<string, DexPair>, marks: Record<string, number>) {
  const ranked = [...best.entries()].sort((a, b) => num(b[1].volume?.h24) - num(a[1].volume?.h24));
  const owned = new Map<string, string>();
  for (const token of TOKENS) {
    if (token.address) owned.set(token.symbol, token.address);
  }
  for (const [address, pair] of ranked) {
    const base = pair.baseToken;
    if (!base?.symbol) continue;
    const price = num(pair.priceUsd);
    if (price <= 0) continue;
    const liq = num(pair.liquidity?.usd);
    const vol = windows(pair.volume);
    if (liq < 50 && vol.h24 < 1) continue;
    const symbol = ADDRESS_SYMBOL[address] ?? base.symbol.replace(/\s/g, "").replace(/^\$/, "");
    if (!symbol) continue;
    const holder = owned.get(symbol);
    if (holder && holder !== address) continue;
    const dexImage = safeIcon(pair.info?.imageUrl);
    const icon = iconFor(address, symbol, dexImage);
    const token = ensureToken({
      symbol,
      name: base.name || symbol,
      price,
      chain: "NEAR",
      icon: icon || undefined,
      address,
    });
    const change = windows(pair.priceChange);
    const tx = pair.txns?.h24;
    const buys = Math.max(0, Math.round(num(tx?.buys)));
    const sells = Math.max(0, Math.round(num(tx?.sells)));
    const mcapN = num(pair.marketCap) || num(pair.fdv);
    token.address = address;
    token.price = price;
    token.chain = "NEAR";
    token.icon = preferIcon(token.icon, icon || undefined);
    token.tag = base.name || token.tag;
    token.change = change.h24;
    token.windows = change;
    token.volBy = vol;
    token.volN = vol.h24;
    token.volume = vol.h24 > 0 ? money(vol.h24) : "—";
    token.liqN = liq;
    token.liquidity = liq > 0 ? money(liq) : "—";
    token.mcapN = mcapN;
    token.mcap = mcapN > 0 ? money(mcapN) : "—";
    token.fdv = num(pair.fdv) > 0 ? money(num(pair.fdv)) : token.mcap;
    token.txnsN = buys + sells;
    token.buys = buys;
    token.sells = sells;
    token.txns = token.txnsN > 0 ? token.txnsN.toLocaleString("en-US") : "—";
    token.ageH = pair.pairCreatedAt ? Math.max(0.05, (Date.now() - pair.pairCreatedAt) / 3_600_000) : token.ageH;
    token.listed = true;
    if (dexImage) token.verified = true;
    token.notes = [pair.dexId ? pair.dexId : "NEAR"];
    owned.set(symbol, address);
    marks[symbol] = price;
  }
}
