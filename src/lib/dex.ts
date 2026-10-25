import { ensureToken, isCanonical, isMajorAsset, money, preferIcon, qualityScore, TOKENS, type WindowId } from "@/lib/market";
import { chainById, chainByLabel } from "@/lib/chains";
import { loadIntentAssets, type IntentAsset } from "@/lib/intents";
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
  SOL: "/chains/solana.png",
  BNB: "/chains/bnb.png",
  BTC: "/chains/bitcoin.png",
  AVAX: "/chains/avalanche.png",
  POL: "/chains/polygon.png",
  MATIC: "/chains/polygon.png",
  ARB: "/chains/arbitrum.png",
  OP: "/chains/optimism.png",
  SUI: "/chains/sui.png",
  APT: "/chains/aptos.png",
  DOGE: "/chains/doge.png",
  XRP: "/chains/xrp.png",
  LTC: "/chains/ltc.png",
  BCH: "/chains/bch.png",
  ZEC: "/chains/zec.png",
  ADA: "/chains/cardano.png",
  TRX: "/chains/tron.png",
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

const memeHits = new Set<string>();

export let marketsSynced = false;

function memeHost(address: string) {
  return /meme-cooking\.near|nearlytrade\.near|justhoot\.near|\.tkn\.near|tknx\.near|0xshitzu\.near/.test(address.toLowerCase());
}

function blockedMeme(address: string) {
  const id = address.toLowerCase();
  if (!id || id === "wrap.near" || id.endsWith("factory.bridge.near") || id.endsWith("omft.near")) return true;
  return isCanonical({ symbol: ADDRESS_SYMBOL[address] ?? ADDRESS_SYMBOL[id] ?? "", address });
}

function isNearMeme(address: string) {
  if (blockedMeme(address)) return false;
  return memeHits.has(address.toLowerCase()) || memeHost(address);
}

async function pullNearMemes(take: (pair: DexPair) => void, seen: Set<string>) {
  const queries = ["meme", "shitzu", "blackdragon", "nearmeme", "ref", "pump", "dog", "pepe"];
  const [top, latest, profiles, ...searches] = await Promise.all([
    getJson<{ chainId?: string; tokenAddress?: string; icon?: string }[]>("https://api.dexscreener.com/token-boosts/top/v1").catch(() => null),
    getJson<{ chainId?: string; tokenAddress?: string; icon?: string }[]>("https://api.dexscreener.com/token-boosts/latest/v1").catch(() => null),
    getJson<{ chainId?: string; tokenAddress?: string; icon?: string }[]>("https://api.dexscreener.com/token-profiles/latest/v1").catch(() => null),
    ...queries.map((q) => getJson<{ pairs?: DexPair[] }>(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`).catch(() => null)),
  ]);
  const icons = new Map<string, string>();
  const wanted: string[] = [];
  const pushAddress = (address: string, icon?: string) => {
    if (!address || blockedMeme(address) || seen.has(address)) return;
    memeHits.add(address.toLowerCase());
    if (icon) icons.set(address.toLowerCase(), icon);
    if (!wanted.some((item) => item.toLowerCase() === address.toLowerCase())) wanted.push(address);
  };
  for (const row of [top, latest, profiles].flatMap((rows) => rows ?? [])) {
    if (row.chainId !== "near" || !row.tokenAddress) continue;
    pushAddress(row.tokenAddress, row.icon);
  }
  for (const body of searches) {
    for (const pair of body?.pairs ?? []) {
      if (pair.chainId !== "near") continue;
      const address = pair.baseToken?.address;
      if (!address || blockedMeme(address)) continue;
      memeHits.add(address.toLowerCase());
      const icon = safeIcon(pair.info?.imageUrl);
      if (icon) pair.info = { ...pair.info, imageUrl: icon };
      take(pair);
    }
  }
  const chunks: string[] = [];
  for (let i = 0; i < wanted.length && i < 150; i += 30) chunks.push(wanted.slice(i, i + 30).join(","));
  const batches = await Promise.all(chunks.map((chunk) => getJson<DexPair[]>(`${TOKENS_API}/${chunk}`).catch(() => null)));
  for (const rows of batches) {
    for (const pair of Array.isArray(rows) ? rows : []) {
      const address = pair.baseToken?.address;
      if (!address || blockedMeme(address)) continue;
      memeHits.add(address.toLowerCase());
      if (!pair.info?.imageUrl) {
        const icon = icons.get(address.toLowerCase());
        if (icon) pair.info = { ...(pair.info ?? {}), imageUrl: icon };
      }
      take(pair);
    }
  }
}

let iconBook: Map<string, string> | null = null;
let tradableGate: Map<string, IntentAsset> | null = null;

async function tradableMap() {
  if (tradableGate && tradableGate.size) return tradableGate;
  const all = await loadIntentAssets();
  const map = new Map<string, IntentAsset>();
  for (const asset of all) {
    if (asset.blockchain === "near" && asset.contractAddress && Number(asset.price) > 0) map.set(asset.contractAddress.toLowerCase(), asset);
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
    if (token.chain !== "NEAR") continue;
    if (token.kind === "meme" && token.liqN > 0 && (token.volN > 0 || token.txnsN > 0)) continue;
    const address = token.address?.toLowerCase();
    if (!address || !allowed.has(address)) token.listed = false;
  }
  for (const asset of map.values()) {
    const address = asset.contractAddress ?? "";
    const key = address.toLowerCase();
    let token = TOKENS.find((item) => item.address?.toLowerCase() === key && item.chain === "NEAR");
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
    token.assetId = asset.assetId;
    token.decimals = asset.decimals;
    token.chain = "NEAR";
    token.price = Number(asset.price);
    token.listed = true;
    token.rails = ["NEAR"];
    token.verified = isCanonical({ symbol: token.symbol, address });
    token.notes = token.verified ? ["Widely used NEAR asset"] : ["Tradable on NEAR Intents"];
    if (asset.coingeckoId) geckoBySymbol.set(token.symbol, asset.coingeckoId);
  }
}

function publishForeign(assets: IntentAsset[]) {
  dropOtherChains();
  for (const asset of assets) {
    if (asset.blockchain === "near" || !(Number(asset.price) > 0)) continue;
    const meta = chainById(asset.blockchain);
    if (!meta) continue;
    const chain = meta.label;
    const base = asset.symbol.replace(/\s/g, "") || chain;
    let token = TOKENS.find((item) => item.assetId === asset.assetId);
    if (!token) {
      const taken = TOKENS.some((item) => item.symbol.toUpperCase() === base.toUpperCase());
      const symbol = taken ? `${base}.${chain}` : base;
      const icon = knownLogo(base) || undefined;
      token = ensureToken({
        symbol,
        name: `${base} on ${chain}`,
        price: Number(asset.price),
        chain,
        icon,
        address: asset.contractAddress ?? asset.assetId,
      });
      if (token.assetId && token.assetId !== asset.assetId) continue;
    }
    token.assetId = asset.assetId;
    token.decimals = asset.decimals;
    token.chain = chain;
    token.address = asset.contractAddress ?? token.address;
    token.price = Number(asset.price);
    token.listed = true;
    token.rails = [chain];
    token.verified = isMajorAsset(base, chain);
    token.notes = [`Crosschain on ${chain} via NEAR Intents`];
    if (asset.coingeckoId) geckoBySymbol.set(token.symbol, asset.coingeckoId);
    const icon = knownLogo(base) || undefined;
    if (icon) token.icon = preferIcon(token.icon, icon);
  }
}

async function warmLogos(assets: IntentAsset[]) {
  const ids = [...new Set(assets.map((asset) => asset.coingeckoId).filter((id): id is string => Boolean(id)))];
  const images = new Map<string, string>();
  let changed = false;
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80).join(",");
    const response = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(chunk)}&per_page=250&sparkline=false`).catch(() => null);
    if (!response?.ok) continue;
    const rows = (await response.json()) as { id?: string; image?: string; market_cap?: number; total_volume?: number; price_change_percentage_24h?: number }[];
    for (const row of rows) if (row.id && row.image) images.set(row.id, row.image);
    for (const row of rows) {
      if (!row.id) continue;
      for (const token of TOKENS) {
        if (geckoBySymbol.get(token.symbol) !== row.id) continue;
        if (!(token.volN > 0) && row.total_volume && row.total_volume > 0) {
          token.volN = row.total_volume;
          token.volume = money(row.total_volume);
          token.volBy = { m5: token.volBy?.m5 ?? 0, h1: token.volBy?.h1 ?? 0, h6: token.volBy?.h6 ?? 0, h24: row.total_volume };
        }
        if (!(token.mcapN > 0) && row.market_cap && row.market_cap > 0) {
          token.mcapN = row.market_cap;
          token.mcap = money(row.market_cap);
        }
        if (row.price_change_percentage_24h != null && !token.windows?.h24) {
          const change = row.price_change_percentage_24h;
          token.change = change;
          token.windows = { m5: token.windows?.m5 ?? 0, h1: token.windows?.h1 ?? 0, h6: token.windows?.h6 ?? 0, h24: change };
        }
        token.score = qualityScore(token) ?? token.score;
        changed = true;
      }
    }
  }
  for (const asset of assets) {
    const image = asset.coingeckoId ? images.get(asset.coingeckoId) : "";
    const token = TOKENS.find((item) => item.assetId === asset.assetId);
    if (!token || !image) continue;
    const next = preferIcon(token.icon, image);
    if (next !== token.icon) {
      token.icon = next;
      changed = true;
    }
  }
  if (changed) useDesk.setState((state) => ({ clock: state.clock + 1 }));
}
let iconAt = 0;
let discover: string[] = [];
const geckoBySymbol = new Map<string, string>();

export function geckoIdFor(symbol: string) {
  return geckoBySymbol.get(symbol) ?? geckoBySymbol.get(symbol.split(".")[0]) ?? "";
}

function safeIcon(icon: unknown) {
  if (typeof icon !== "string" || icon.length > 80_000) return "";
  if (icon.startsWith("https://") || icon.startsWith("/tokens/") || icon.startsWith("/chains/") || icon.startsWith("data:image/")) return icon;
  return "";
}

export function knownLogo(symbol: string) {
  return LOCAL[symbol.toUpperCase()] ?? LOCAL[symbol] ?? "";
}

export function iconFor(address: string | undefined, symbol: string, dexImage?: string) {
  const dex = safeIcon(dexImage);
  if (dex && !dex.includes("cdn.dexscreener.com/tokens/") && !dex.includes("dd.dexscreener.com/ds-data/tokens/")) return dex;
  const local = knownLogo(symbol.split(".")[0] ?? symbol) || knownLogo(symbol);
  if (local) return local;
  const listed = address ? safeIcon(iconBook?.get(address)) : "";
  if (listed) return listed;
  return "";
}

export function logoFallback(token: { chain?: string; address?: string }) {
  const slug = token.chain === "NEAR" ? "near" : DEX_LABEL_SLUG[token.chain ?? ""];
  const address = token.address ?? "";
  if (!slug || !address || address.includes(":") || address.includes(" ")) return "";
  const id = slug === "solana" || slug === "near" ? address : address.toLowerCase();
  return `https://dd.dexscreener.com/ds-data/tokens/${slug}/${id}.png`;
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
  await pullNearMemes(take, seen);
  paintDex(best, marks);
  if (gate) publishTradable(gate);
  onPaint?.({ ...marks });
  const assets = await loadIntentAssets().catch(() => null);
  if (assets) {
    publishForeign(assets);
    void warmLogos(assets);
    void refreshDexMarkets();
    void paintForeignStats().then(() => {
      useDesk.setState((state) => ({ clock: state.clock + 1 }));
      onPaint?.({ ...marks });
    });
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

const DEX_LABEL_SLUG: Record<string, string> = {
  Ethereum: "ethereum",
  Solana: "solana",
  Base: "base",
  Arbitrum: "arbitrum",
  Optimism: "optimism",
  BNB: "bsc",
  Polygon: "polygon",
  Avalanche: "avalanche",
  Gnosis: "gnosis",
  Aurora: "aurora",
  Scroll: "scroll",
  Berachain: "berachain",
  "X Layer": "xlayer",
  Tron: "tron",
  TON: "ton",
  Sui: "sui",
  Aptos: "aptos",
  Starknet: "starknet",
  Monad: "monad",
  Plasma: "plasma",
  Abstract: "abstract",
  NEAR: "near",
};

const SLUG_LABEL: Record<string, string> = Object.fromEntries(Object.entries(DEX_LABEL_SLUG).map(([label, slug]) => [slug, label]));

const DEX_SLUG = DEX_LABEL_SLUG;

function dropOtherChains() {
  for (const token of TOKENS) {
    if (!chainByLabel(token.chain)) token.listed = false;
  }
}

const boostRank = new Map<string, number>();

function boostKey(chain: string, address: string) {
  const keep = chain === "Solana" || chain === "NEAR" || chain === "TON" || chain === "Aptos" || chain === "Sui" || chain === "Fogo";
  return `${chain}:${keep ? address : address.toLowerCase()}`;
}

export function trendScore(token: { chain: string; address?: string; volN: number; txnsN: number; liqN: number }) {
  const boost = token.address ? (boostRank.get(boostKey(token.chain, token.address)) ?? 0) : 0;
  const vol = token.volN || 0;
  const tx = token.txnsN || 0;
  const liq = token.liqN || 0;
  if (vol <= 0 && tx <= 0 && liq <= 0 && boost <= 0) return 0;
  return boost * 1_000_000_000 + vol * Math.log10(tx + 10) + Math.sqrt(liq);
}

function paintIcon(token: { icon: string }, image?: string) {
  if (!image) return;
  const current = token.icon || "";
  const weak = !current || current.startsWith("data:") || current.includes("cdn.dexscreener.com/tokens/") || current.includes("dd.dexscreener.com/ds-data/tokens/");
  token.icon = weak ? image : preferIcon(current, image);
}

function addressKind(value: string) {
  const raw = value.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(raw)) return "evm" as const;
  if (/^[a-f0-9]{64}$/.test(raw) || /\.near$/i.test(raw) || (raw.includes(".") && /^[a-z0-9._-]+$/i.test(raw))) return "near" as const;
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(raw)) return "sol" as const;
  return null;
}

function symbolFor(base: string, chain: string, address: string) {
  const clean = base.replace(/\s/g, "").replace(/^\$/, "") || "TOKEN";
  const same = TOKENS.find((token) => token.chain === chain && sameAddr(token.address, address));
  if (same) return same.symbol;
  const taken = TOKENS.some((token) => token.symbol.toUpperCase() === clean.toUpperCase());
  return taken ? `${clean}.${chain}` : clean;
}

function ingestForeignPairs(pairs: DexPair[], icons: Map<string, string>, loose = false) {
  const best = new Map<string, DexPair>();
  for (const pair of pairs) {
    const slug = pair.chainId ?? "";
    const chain = SLUG_LABEL[slug];
    const address = pair.baseToken?.address;
    if (!chain || !address || chain === "NEAR") continue;
    const price = num(pair.priceUsd);
    const liq = num(pair.liquidity?.usd);
    const vol = num(pair.volume?.h24);
    if (!(price > 0) || (!loose && liq < 1000 && vol < 1000)) continue;
    const key = `${chain}:${slug === "solana" ? address : address.toLowerCase()}`;
    const prev = best.get(key);
    if (!prev || liq + vol >= num(prev.liquidity?.usd) + num(prev.volume?.h24)) best.set(key, pair);
  }
  for (const [key, pair] of best) {
    const chain = key.slice(0, key.indexOf(":"));
    const address = pair.baseToken?.address ?? "";
    const base = pair.baseToken?.symbol?.replace(/\s/g, "").replace(/^\$/, "") || "TOKEN";
    const symbol = symbolFor(base, chain, address);
    const slug = pair.chainId ?? "";
    const iconKey = `${slug}:${slug === "solana" ? address : address.toLowerCase()}`;
    const image = safeIcon(pair.info?.imageUrl) || safeIcon(icons.get(iconKey));
    const token = ensureToken({
      symbol,
      name: pair.baseToken?.name || base,
      price: num(pair.priceUsd),
      chain,
      icon: knownLogo(base) || image || undefined,
      address,
    });
    if (token.chain !== chain) continue;
    token.address = address;
    token.chain = chain;
    token.listed = true;
    token.price = num(pair.priceUsd);
    token.verified = isMajorAsset(base, chain);
    if (!token.assetId) {
      token.kind = token.verified ? "defi" : "meme";
      token.rails = [chain];
      token.notes = token.verified ? ["Widely traded"] : ["Live DexScreener market"];
    }
    if (image) paintIcon(token, image);
    applyLiveStats(token, pair, false);
  }
}

async function pullDexMarkets() {
  dropOtherChains();
  const [top, latest, profiles] = await Promise.all(
    [
      getJson<{ chainId?: string; tokenAddress?: string; icon?: string }[]>("https://api.dexscreener.com/token-boosts/top/v1"),
      getJson<{ chainId?: string; tokenAddress?: string; icon?: string }[]>("https://api.dexscreener.com/token-boosts/latest/v1"),
      getJson<{ chainId?: string; tokenAddress?: string; icon?: string }[]>("https://api.dexscreener.com/token-profiles/latest/v1"),
    ].map((task) => task.catch(() => null)),
  );
  const icons = new Map<string, string>();
  const bySlug = new Map<string, string[]>();
  if (top) {
    boostRank.clear();
    let place = 0;
    for (const row of top) {
      const chain = SLUG_LABEL[row.chainId ?? ""];
      if (!chain || !row.tokenAddress) continue;
      const key = boostKey(chain, row.tokenAddress);
      if (!boostRank.has(key)) boostRank.set(key, 400 - place);
      place += 1;
    }
  }
  for (const row of [top, latest, profiles].flatMap((rows) => rows ?? [])) {
    const slug = row.chainId ?? "";
    const address = row.tokenAddress ?? "";
    const chain = SLUG_LABEL[slug];
    if (!chain || !address) continue;
    const id = slug === "solana" || slug === "near" || slug === "sui" || slug === "aptos" || slug === "ton" ? address : address.toLowerCase();
    if (row.icon) icons.set(`${slug}:${id}`, row.icon);
    const list = bySlug.get(slug) ?? [];
    if (list.length < 30 && !list.some((item) => item.toLowerCase() === address.toLowerCase())) list.push(address);
    bySlug.set(slug, list);
  }
  const queries = ["bonk", "wif", "pepe", "brett", "mog", "popcat", "fartcoin", "pnut", "spx", "floki"];
  const searches = await Promise.all(queries.map((q) => getJson<{ pairs?: DexPair[] }>(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`).catch(() => null)));
  ingestForeignPairs(searches.flatMap((body) => body?.pairs ?? []), icons);
  await Promise.all(
    [...bySlug.entries()].map(async ([slug, addresses]) => {
      for (let index = 0; index < addresses.length; index += 30) {
        const chunk = addresses.slice(index, index + 30);
        const pairs = await getJson<DexPair[]>(`https://api.dexscreener.com/tokens/v1/${slug}/${chunk.join(",")}`).catch(() => null);
        if (Array.isArray(pairs)) ingestForeignPairs(pairs, icons);
      }
    }),
  );
  for (const token of TOKENS) {
    if (!token.listed || !token.address) continue;
    const slug = DEX_SLUG[token.chain];
    if (!slug) continue;
    const id = slug === "solana" || slug === "near" || slug === "sui" || slug === "aptos" || slug === "ton" ? token.address : token.address.toLowerCase();
    paintIcon(token, icons.get(`${slug}:${id}`));
  }
  useDesk.setState((state) => ({ clock: state.clock + 1 }));
}

let dexAt = 0;

export async function refreshDexMarkets() {
  if (Date.now() - dexAt < 45_000) return;
  dexAt = Date.now();
  await pullDexMarkets();
}

export async function searchTokens(query: string) {
  const clean = query.trim();
  if (clean.length < 2) return [];
  const kind = addressKind(clean);
  if (kind === "near") return searchNearTokens(clean);
  if (kind === "evm" || kind === "sol") {
    const body = await getJson<{ pairs?: DexPair[] }>(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(clean)}`).catch(() => null);
    const pairs = (body?.pairs ?? []).filter((pair) => {
      const address = pair.baseToken?.address ?? "";
      const match = kind === "evm" ? address.toLowerCase() === clean.toLowerCase() : address === clean;
      return match && Boolean(pair.chainId && SLUG_LABEL[pair.chainId]);
    });
    if (pairs.length) ingestForeignPairs(pairs, new Map(), true);
    useDesk.setState((state) => ({ clock: state.clock + 1 }));
    return TOKENS.filter((token) => token.listed && token.price > 0 && (kind === "evm" ? token.address?.toLowerCase() === clean.toLowerCase() : token.address === clean));
  }
  return searchNearTokens(clean);
}

const NATIVE_PAIR: Record<string, string> = {
  "Ethereum|ETH": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  "Base|ETH": "0x4200000000000000000000000000000000000006",
  "Arbitrum|ETH": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  "Optimism|ETH": "0x4200000000000000000000000000000000000006",
  "Scroll|ETH": "0x5300000000000000000000000000000000000004",
  "BNB|BNB": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  "Polygon|POL": "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
  "Polygon|MATIC": "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
  "Avalanche|AVAX": "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
  "Solana|SOL": "So11111111111111111111111111111111111111112",
};

async function paintForeignStats() {
  const groups = new Map<string, { symbol: string; address: string }[]>();
  for (const token of TOKENS) {
    if (!token.listed) continue;
    if (token.liqN > 0 && token.volN > 0 && token.txnsN > 0 && token.ageH > 0) continue;
    const slug = token.chain === "NEAR" ? "near" : DEX_SLUG[token.chain];
    if (!slug) continue;
    const base = token.symbol.split(".")[0].toUpperCase();
    const raw = token.address ?? "";
    const address = raw && !raw.includes(":") ? raw : NATIVE_PAIR[`${token.chain}|${base}`];
    if (!address) continue;
    const list = groups.get(slug) ?? [];
    list.push({ symbol: token.symbol, address });
    groups.set(slug, list);
  }
  await Promise.all(
    [...groups.entries()].map(async ([slug, rows]) => {
      for (let index = 0; index < rows.length; index += 30) {
        const chunk = rows.slice(index, index + 30);
        const pairs = await getJson<DexPair[]>(`https://api.dexscreener.com/tokens/v1/${slug}/${chunk.map((row) => row.address).join(",")}`).catch(() => null);
        if (!Array.isArray(pairs)) continue;
        applyBestPairs(chunk, pairs);
      }
    }),
  );
  const missing = TOKENS.filter((token) => token.listed && token.address && !token.address.includes(":") && !(token.liqN > 0 && token.txnsN > 0));
  for (let index = 0; index < missing.length; index += 30) {
    const chunk = missing.slice(index, index + 30).map((token) => ({ symbol: token.symbol, address: token.address as string }));
    const pairs = await getJson<DexPair[]>(`https://api.dexscreener.com/latest/dex/tokens/${chunk.map((row) => row.address).join(",")}`).catch(() => null);
    const list = pairs && Array.isArray((pairs as { pairs?: DexPair[] }).pairs) ? (pairs as { pairs?: DexPair[] }).pairs ?? [] : Array.isArray(pairs) ? pairs : [];
    if (list.length) applyBestPairs(chunk, list);
  }
}

function sameAddr(left?: string, right?: string) {
  if (!left || !right) return false;
  if (left.startsWith("0x") || left.startsWith("0X") || right.startsWith("0x") || right.startsWith("0X")) return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

function applyBestPairs(rows: { symbol: string; address: string }[], pairs: DexPair[]) {
  const best = new Map<string, { pair: DexPair; score: number; quote: boolean }>();
  for (const pair of pairs) {
    for (const row of rows) {
      const asBase = sameAddr(pair.baseToken?.address, row.address);
      const asQuote = !asBase && sameAddr(pair.quoteToken?.address, row.address);
      if (!asBase && !asQuote) continue;
      const score = num(pair.liquidity?.usd) + (asBase ? 1e12 : 0);
      const prev = best.get(row.symbol);
      if (!prev || score > prev.score) best.set(row.symbol, { pair, score, quote: asQuote });
    }
  }
  for (const [symbol, hit] of best) {
    const token = TOKENS.find((item) => item.symbol === symbol);
    if (token) applyLiveStats(token, hit.pair, hit.quote);
  }
}

function applyLiveStats(token: (typeof TOKENS)[number], pair: DexPair, asQuote = false) {
  const liq = num(pair.liquidity?.usd);
  const vol = windows(pair.volume);
  const change = windows(pair.priceChange);
  const tx = pair.txns?.h24;
  const buys = Math.max(0, Math.round(num(tx?.buys)));
  const sells = Math.max(0, Math.round(num(tx?.sells)));
  const mcapN = num(pair.marketCap) || num(pair.fdv);
  if (liq > 0) {
    token.liqN = liq;
    token.liquidity = money(liq);
  }
  if (vol.h24 > 0) {
    token.volBy = vol;
    token.volN = vol.h24;
    token.volume = money(vol.h24);
  }
  if (!asQuote) {
    token.windows = change;
    token.change = change.h24;
    if (mcapN > 0) {
      token.mcapN = mcapN;
      token.mcap = money(mcapN);
      token.fdv = num(pair.fdv) > 0 ? money(num(pair.fdv)) : token.mcap;
    }
  }
  token.txnsN = buys + sells;
  token.buys = buys;
  token.sells = sells;
  token.txns = token.txnsN > 0 ? token.txnsN.toLocaleString("en-US") : "—";
  if (pair.pairCreatedAt) token.ageH = Math.max(0.05, (Date.now() - pair.pairCreatedAt) / 3_600_000);
  token.score = qualityScore(token) ?? token.score;
  const image = safeIcon(pair.info?.imageUrl);
  if (image && !asQuote) token.icon = preferIcon(token.icon, image);
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
    const meme = isNearMeme(address);
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
    token.icon = dexImage || preferIcon(token.icon, icon || undefined);
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
    if (meme) token.kind = "meme";
    token.listed = canTrade(address) || (meme && liq > 0 && (vol.h24 > 0 || buys + sells > 0));
    token.verified = isCanonical({ symbol, address });
    token.score = qualityScore(token) ?? 0;
    token.notes = token.verified ? ["Widely used NEAR asset"] : meme ? ["NEAR meme"] : [pair.dexId || "NEAR market"];
    owned.set(symbol, address);
    marks[symbol] = price;
  }
}
