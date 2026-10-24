import { ensureToken, isCanonical, money, preferIcon, qualityScore, TOKENS, type WindowId } from "@/lib/market";
import { tradableNearAssets, type IntentAsset } from "@/lib/intents";
import { useDesk } from "@/lib/store";

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
  chainId?: string;
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
let tradableGate: Map<string, IntentAsset> | null = null;

async function tradableMap() {
  if (tradableGate) return tradableGate;
  const assets = await tradableNearAssets();
  const map = new Map<string, IntentAsset>();
  for (const asset of assets) {
    if (!asset.contractAddress) continue;
    map.set(asset.contractAddress.toLowerCase(), asset);
  }
  tradableGate = map;
  return map;
}

function canTrade(address: string) {
  return !tradableGate || tradableGate.has(address.toLowerCase());
}

function publishTradable(map: Map<string, IntentAsset>) {
  const allowed = new Set(map.keys());
  for (const token of TOKENS) {
    const address = token.address?.toLowerCase();
    if (!address || !allowed.has(address) || token.chain !== "NEAR") token.listed = false;
  }
  for (const asset of map.values()) {
    const address = asset.contractAddress ?? "";
    const key = address.toLowerCase();
    let token = TOKENS.find((item) => item.address?.toLowerCase() === key);
    const preferred = ADDRESS_SYMBOL[address] ?? ADDRESS_SYMBOL[key] ?? asset.symbol;
    if (!token) {
      const clash = TOKENS.some((item) => item.symbol.toUpperCase() === preferred.toUpperCase());
      const symbol = clash ? `${preferred}.${address.slice(0, 4)}` : preferred;
      token = ensureToken({
        symbol,
        name: preferred,
        price: Number(asset.price),
        chain: "NEAR",
        icon: iconFor(address, symbol) || undefined,
        address,
      });
      if (token.address && token.address.toLowerCase() !== key) continue;
    }
    token.address = address;
    token.chain = "NEAR";
    token.price = Number(asset.price);
    token.listed = true;
    token.verified = isCanonical({ symbol: token.symbol, address });
    token.notes = token.verified ? ["Widely used NEAR asset"] : ["Tradable on NEAR Intents"];
  }
}
let iconAt = 0;
let discover: string[] = [];

function safeIcon(icon: unknown) {
  if (typeof icon !== "string" || icon.length > 80_000) return "";
  if (icon.startsWith("https://") || icon.startsWith("/tokens/") || icon.startsWith("data:image/")) return icon;
  return "";
}

export function knownLogo(symbol: string) {
  return LOCAL[symbol.toUpperCase()] ?? LOCAL[symbol] ?? "";
}

export function iconFor(address: string | undefined, symbol: string, dexImage?: string) {
  const local = knownLogo(symbol);
  if (local) return local;
  const listed = address ? safeIcon(iconBook?.get(address)) : "";
  if (listed) return listed;
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
  const gate = await tradableMap().catch(() => null);
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
  if (gate) publishTradable(gate);
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
    if (gate) publishTradable(gate);
    onPaint?.({ ...marks });
  }
  marketsSynced = true;
  return marks;
}

export async function lookupNearToken(address: string) {
  const clean = address.trim();
  if (clean.length < 6) return null;
  await tradableMap().catch(() => null);
  const direct = await getJson<DexPair[]>(`${TOKENS_API}/${encodeURIComponent(clean)}`).catch(() => null);
  const pairs = Array.isArray(direct) ? direct : [];
  if (!pairs.length) {
    const extra = await getJson<DexPair[]>(`${PAIRS}/${encodeURIComponent(clean)}`).catch(() => null);
    if (Array.isArray(extra)) pairs.push(...extra);
  }
  const best = new Map<string, DexPair>();
  for (const pair of pairs) {
    const id = pair.baseToken?.address;
    if (!id) continue;
    const vol = num(pair.volume?.h24);
    const prev = best.get(id);
    if (!prev || vol >= num(prev.volume?.h24)) best.set(id, pair);
  }
  if (!best.size) return null;
  paintDex(best, {});
  useDesk.setState((state) => ({ clock: state.clock + 1 }));
  return TOKENS.find((token) => token.address?.toLowerCase() === clean.toLowerCase()) ?? TOKENS.find((token) => [...best.keys()].some((id) => token.address === id)) ?? null;
}

export async function searchNearTokens(query: string) {
  const clean = query.trim();
  if (clean.length < 2) return [];
  await tradableMap().catch(() => null);
  const contract = clean.length >= 8 && (clean.includes(".") || /^[0-9a-f]{20,}$/i.test(clean));
  if (contract) {
    const token = await lookupNearToken(clean);
    return token ? [token] : [];
  }
  const body = await getJson<{ pairs?: DexPair[] }>(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(clean)}`).catch(() => null);
  const pairs = (body?.pairs ?? []).filter((pair) => pair.chainId === "near");
  const best = new Map<string, DexPair>();
  for (const pair of pairs) {
    const id = pair.baseToken?.address;
    if (!id) continue;
    const vol = num(pair.volume?.h24);
    const prev = best.get(id);
    if (!prev || vol >= num(prev.volume?.h24)) best.set(id, pair);
  }
  if (!best.size) return [];
  paintDex(best, {});
  useDesk.setState((state) => ({ clock: state.clock + 1 }));
  const needle = clean.toLowerCase();
  return TOKENS.filter((token) => token.listed && `${token.symbol} ${token.name} ${token.address ?? ""}`.toLowerCase().includes(needle));
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
    if (liq <= 0 && vol.h24 <= 0) continue;
    const symbolName = ADDRESS_SYMBOL[address] ?? base.symbol.replace(/\s/g, "").replace(/^\$/, "");
    if (!symbolName) continue;
    const holder = owned.get(symbolName);
    const symbol = holder && holder !== address ? `${symbolName}.${address.slice(0, 6)}` : symbolName;
    const taken = owned.get(symbol);
    if (taken && taken !== address) continue;
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
    token.listed = canTrade(address);
    token.verified = isCanonical({ symbol, address });
    token.score = qualityScore(token) ?? 0;
    token.notes = token.verified ? ["Widely used NEAR asset"] : [pair.dexId || "NEAR market"];
    owned.set(symbol, address);
    marks[symbol] = price;
  }
}

const CHAIN_NET = { Ethereum: "eth", Aurora: "aurora" } as const;
const chainAt = new Map<string, number>();
const chainFlight = new Map<string, Promise<void>>();

type GeckoPool = {
  attributes?: {
    name?: string;
    base_token_price_usd?: string;
    market_cap_usd?: string | null;
    fdv_usd?: string | null;
    reserve_in_usd?: string;
    volume_usd?: { h24?: string };
    price_change_percentage?: { h24?: string };
  };
  relationships?: { base_token?: { data?: { id?: string } } };
};

type GeckoToken = {
  id?: string;
  type?: string;
  attributes?: { image_url?: string | null };
};

function chainSymbol(name: string) {
  const head = (name.split("/")[0] ?? "").trim().replace(/\s+\d+(?:\.\d+)?%$/, "");
  return head.replace(/\s/g, "").replace(/^\$/, "");
}

function chainAddress(id: string) {
  const cut = id.indexOf("_");
  return (cut >= 0 ? id.slice(cut + 1) : id).trim();
}

function chainImages(included: GeckoToken[] | undefined) {
  const map = new Map<string, string>();
  for (const item of included ?? []) {
    const image = item.attributes?.image_url;
    if (!item.id || !image || !image.startsWith("https://")) continue;
    map.set(item.id.toLowerCase(), image);
    const address = chainAddress(item.id).toLowerCase();
    if (address) map.set(address, image);
  }
  return map;
}

function placeChainToken(input: { symbol: string; name: string; price: number; chain: "Aurora" | "Ethereum"; address: string; icon: string; liq: number; vol: number; mcap: number; change: number }) {
  const address = input.address;
  let symbol = input.symbol;
  const same = TOKENS.find((token) => token.address?.toLowerCase() === address.toLowerCase());
  const clash = TOKENS.some((token) => token !== same && token.symbol.toUpperCase() === symbol.toUpperCase());
  if (clash) symbol = `${input.symbol}.${input.chain}`;
  const token = same ?? ensureToken({ symbol, name: input.name, price: input.price, chain: input.chain, icon: input.icon, address });
  if (token.address && token.address.toLowerCase() !== address.toLowerCase()) return;
  token.symbol = symbol;
  token.address = address;
  token.chain = input.chain;
  token.name = input.name || token.name;
  token.price = input.price;
  token.listed = false;
  token.icon = preferIcon(token.icon, input.icon);
  token.liqN = input.liq;
  token.liquidity = input.liq > 0 ? money(input.liq) : "—";
  token.volN = input.vol;
  token.volBy = { ...token.volBy, h24: input.vol };
  token.volume = input.vol > 0 ? money(input.vol) : "—";
  token.mcapN = input.mcap;
  token.mcap = input.mcap > 0 ? money(input.mcap) : "—";
  token.fdv = token.mcap;
  token.change = input.change;
  token.windows = { ...token.windows, h24: input.change };
  token.verified = false;
  token.score = qualityScore(token) ?? 0;
  token.notes = [`${input.chain} market`];
}

export function loadChainBook(chain: "Aurora" | "Ethereum") {
  for (const token of TOKENS) {
    if (token.chain === chain) token.listed = false;
  }
  return Promise.resolve();
}

async function fetchChainBook(chain: "Aurora" | "Ethereum") {
  const net = CHAIN_NET[chain];
  const response = await fetch(`https://api.geckoterminal.com/api/v2/networks/${net}/trending_pools?include=base_token`, { headers: { accept: "application/json" } });
  if (!response.ok) return;
  const body = (await response.json()) as { data?: GeckoPool[]; included?: GeckoToken[] };
  const images = chainImages(body.included);
  let wrote = 0;
  for (const pool of body.data ?? []) {
    const id = pool.relationships?.base_token?.data?.id ?? "";
    const address = chainAddress(id);
    const symbol = chainSymbol(pool.attributes?.name ?? "");
    const price = Number(pool.attributes?.base_token_price_usd);
    if (!address || !symbol || !Number.isFinite(price) || price <= 0) continue;
    placeChainToken({
      symbol,
      name: symbol,
      price,
      chain,
      address,
      icon: images.get(address.toLowerCase()) || images.get(id.toLowerCase()) || "",
      liq: Number(pool.attributes?.reserve_in_usd) || 0,
      vol: Number(pool.attributes?.volume_usd?.h24) || 0,
      mcap: Number(pool.attributes?.market_cap_usd) || Number(pool.attributes?.fdv_usd) || 0,
      change: Number(pool.attributes?.price_change_percentage?.h24) || 0,
    });
    wrote += 1;
  }
  if (!wrote) return;
  chainAt.set(chain, Date.now());
  useDesk.setState((state) => ({ clock: state.clock + 1 }));
}
