export type Safety = {
  top10: number;
  insiders: number;
  snipers: number;
  bundlers: number;
  dev: number;
  lp: number;
  buyTax: number;
  sellTax: number;
  holders: string;
};

export type WindowId = "m5" | "h1" | "h6" | "h24";

export type Token = {
  symbol: string;
  name: string;
  tag: string;
  price: number;
  change: number;
  icon: string;
  chain: string;
  mcap: string;
  supply: string;
  fdv: string;
  liquidity: string;
  volume: string;
  txns: string;
  verified: boolean;
  score: number;
  notes: string[];
  safety: Safety;
  ageH: number;
  mcapN: number;
  liqN: number;
  volN: number;
  txnsN: number;
  buys: number;
  sells: number;
  holdersN: number;
  windows: Record<WindowId, number>;
  volBy: Record<WindowId, number>;
  address?: string;
  assetId?: string;
  decimals?: number;
  listed?: boolean;
  rails?: string[];
  kind: "major" | "defi" | "meme";
};

export type Venue = {
  id: string;
  name: string;
  kind: "Swap" | "Bridge";
  feeBps: number;
  impactBps: number;
  depthUsd: number;
  eta: string;
};

export type Quote = {
  venue: Venue;
  feeBps: number;
  impact: number;
  receive: number;
  score: number;
};

export type Candle = { o: number; h: number; l: number; c: number; t?: number };

export const WINDOWS: { id: WindowId; label: string }[] = [
  { id: "m5", label: "5M" },
  { id: "h1", label: "1H" },
  { id: "h6", label: "6H" },
  { id: "h24", label: "24H" },
];

export const CHAINS = ["NEAR", "Ethereum", "Solana", "Base", "Arbitrum", "Optimism", "BNB", "Polygon", "Avalanche", "Bitcoin", "Tron", "TON", "Sui", "Aptos", "Gnosis", "Aurora", "Scroll", "Berachain", "X Layer", "Monad", "Plasma", "Abstract", "Hyperliquid", "Starknet", "Stellar", "XRP", "Dogecoin", "Litecoin", "Bitcoin Cash", "Dash", "Zcash", "Cardano", "Aleo", "Movement", "Fogo", "ADI", "Hood", "QTC"] as const;

export const CHAIN_ICON: Record<string, string> = {
  NEAR: "/tokens/near.svg",
  Ethereum: "/tokens/eth.png",
  Solana: "/chains/solana.png",
  Base: "/chains/base.png",
  Arbitrum: "/chains/arbitrum.png",
  Optimism: "/chains/optimism.png",
  BNB: "/chains/bnb.png",
  Polygon: "/chains/polygon.png",
  Avalanche: "/chains/avalanche.png",
  Gnosis: "/chains/gnosis.png",
  Aurora: "/tokens/aurora.jpg",
  Scroll: "/chains/scroll.png",
  Berachain: "/chains/bera.png",
  "X Layer": "/chains/xlayer.jpg",
  Bitcoin: "/chains/bitcoin.png",
  Tron: "/chains/tron.png",
  TON: "/chains/ton.png",
  Sui: "/chains/sui.png",
  Aptos: "/chains/aptos.png",
  Dogecoin: "/chains/doge.png",
  XRP: "/chains/xrp.png",
  Litecoin: "/chains/ltc.png",
  "Bitcoin Cash": "/chains/bch.png",
  Dash: "/chains/dash.png",
  Zcash: "/chains/zec.png",
  Cardano: "/chains/cardano.png",
  Stellar: "/chains/stellar.png",
  Starknet: "/chains/starknet.png",
  Aleo: "/chains/aleo.png",
  Monad: "/chains/monad.png",
  Plasma: "/chains/plasma.png",
  ADI: "/chains/adi.png",
  Abstract: "/chains/abstract.png",
  Hyperliquid: "/chains/hyperliquid.png",
  Hood: "/chains/hyperliquid.png",
  Movement: "/chains/movement.png",
  Fogo: "/chains/fogo.png",
};

const clean: Safety = {
  top10: 18.4,
  insiders: 2.1,
  snipers: 0,
  bundlers: 0,
  dev: 0,
  lp: 98.2,
  buyTax: 0,
  sellTax: 0,
  holders: "128.4K",
};

type Draft = {
  symbol: string;
  name: string;
  tag: string;
  price: number;
  icon?: string;
  hue?: number;
  chain: string;
  ageH: number;
  mcapN: number;
  liqN: number;
  volN: number;
  txnsN: number;
  buyShare: number;
  holdersN: number;
  windows: Record<WindowId, number>;
  verified: boolean;
  score: number;
  notes: string[];
  safety: Safety;
  supply: string;
  fdvN: number;
  kind: "major" | "defi" | "meme";
};

function tilt(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 33 + key.charCodeAt(i)) >>> 0;
  return h;
}

export function glyph(symbol: string, hue: number) {
  const h = tilt(symbol);
  const fg = `hsl(${hue} 72% 58%)`;
  const bg = `hsl(${hue} 28% 14%)`;
  const shape = h % 5;
  const mark =
    shape === 0
      ? `<circle cx="32" cy="26" r="14" fill="${fg}"/>`
      : shape === 1
        ? `<rect x="16" y="12" width="32" height="32" rx="8" fill="${fg}"/>`
        : shape === 2
          ? `<polygon points="32,8 54,40 10,40" fill="${fg}"/>`
          : shape === 3
            ? `<circle cx="24" cy="26" r="10" fill="${fg}"/><circle cx="40" cy="26" r="10" fill="${fg}" opacity="0.75"/>`
            : `<rect x="14" y="16" width="36" height="8" rx="3" fill="${fg}"/><rect x="20" y="30" width="28" height="8" rx="3" fill="${fg}" opacity="0.7"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${bg}"/>${mark}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function money(n: number) {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const num = (value: number, digits: number) => Number(value.toFixed(digits)).toString();
  if (abs >= 1e9) return `${sign}$${num(abs / 1e9, 1)}B`;
  if (abs >= 1e6) return `${sign}$${num(abs / 1e6, abs >= 1e7 ? 1 : 2)}M`;
  if (abs >= 1e3) return `${sign}$${num(abs / 1e3, abs >= 1e5 ? 0 : 1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function compactCount(n: number) {
  if (n >= 1e6) return `${Number((n / 1e6).toFixed(1))}M`;
  if (n >= 1e3) return `${Number((n / 1e3).toFixed(1))}K`;
  return String(Math.round(n));
}

export function signedPct(n: number) {
  const digits = Math.abs(n) >= 100 ? 0 : 1;
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function ageLabel(hours: number) {
  if (!hours) return "—";
  if (hours < 24) return `${Math.max(1, Math.round(hours))}h`;
  const days = hours / 24;
  if (days < 60) return `${Math.round(days)}d`;
  if (days < 730) return `${Math.round(days / 30)}mo`;
  return `${Number((days / 365).toFixed(1))}y`;
}

function coin(d: Draft): Token {
  const buys = Math.round(d.txnsN * d.buyShare);
  return {
    symbol: d.symbol,
    name: d.name,
    tag: d.tag,
    price: d.price,
    change: d.windows.h24,
    icon: d.icon ?? glyph(d.symbol, d.hue ?? 150),
    chain: d.chain,
    mcap: money(d.mcapN),
    supply: d.supply,
    fdv: money(d.fdvN),
    liquidity: money(d.liqN),
    volume: money(d.volN),
    txns: compactCount(d.txnsN),
    verified: d.verified,
    score: d.score,
    notes: d.notes,
    safety: { ...d.safety, holders: compactCount(d.holdersN) },
    ageH: d.ageH,
    mcapN: d.mcapN,
    liqN: d.liqN,
    volN: d.volN,
    txnsN: d.txnsN,
    buys,
    sells: d.txnsN - buys,
    holdersN: d.holdersN,
    windows: d.windows,
    volBy: { m5: 0, h1: 0, h6: 0, h24: d.volN },
    kind: d.kind,
  };
}

const w = (m5: number, h1: number, h6: number, h24: number): Record<WindowId, number> => ({ m5, h1, h6, h24 });

export const TOKENS: Token[] = [
  ["NEAR", "NEAR", "wrap.near", "/tokens/near.svg", "major"],
  ["USDC", "USD Coin", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", "/tokens/usdc.png", "major"],
  ["USDT", "Tether", "usdt.tether-token.near", "", "major"],
  ["ETH", "Ether", "eth.bridge.near", "/tokens/eth.png", "major"],
  ["wBTC", "Wrapped Bitcoin", "2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near", "/tokens/wbtc.png", "major"],
  ["AURORA", "Aurora", "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near", "/tokens/aurora.jpg", "defi"],
  ["STNEAR", "Staked NEAR", "meta-pool.near", "/tokens/stnear.svg", "defi"],
  ["SWEAT", "Sweat Economy", "token.sweat", "/tokens/sweat.svg", "defi"],
  ["RHEA", "Rhea", "token.rhealab.near", "/tokens/rhea.svg", "defi"],
].map(([symbol, name, address, icon, kind]) => {
  const token = coin({
    symbol,
    name,
    tag: name,
    price: Number.NaN,
    icon: icon || undefined,
    chain: "NEAR",
    ageH: 0,
    mcapN: 0,
    liqN: 0,
    volN: 0,
    txnsN: 0,
    buyShare: 0.5,
    holdersN: 0,
    windows: w(0, 0, 0, 0),
    verified: false,
    score: 0,
    notes: ["NEAR market"],
    safety: { ...clean, top10: 0, insiders: 0, snipers: 0, bundlers: 0, dev: 0, lp: 0, holders: "—" },
    supply: "—",
    fdvN: 0,
    kind: kind as Token["kind"],
  });
  token.address = address;
  token.listed = false;
  return token;
});

const CANONICAL_SYMBOLS = new Set(["NEAR", "WNEAR", "USDC", "USDC.E", "USDT", "USDT.E", "ETH", "WETH", "WBTC", "BTC", "DAI", "FRAX", "AURORA", "STNEAR"]);
const CANONICAL_ADDR = new Set([
  "wrap.near",
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "usdt.tether-token.near",
  "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near",
  "dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near",
  "eth.bridge.near",
  "2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near",
  "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near",
  "meta-pool.near",
  "853d955acef822db058eb8505911ed77f175b99e.factory.bridge.near",
  "6b175474e89094c44da98b954eedeac495271d0f.factory.bridge.near",
]);

export function isCanonical(token: { symbol: string; address?: string }) {
  if (CANONICAL_SYMBOLS.has(token.symbol.toUpperCase())) return true;
  const address = token.address?.toLowerCase();
  return Boolean(address && CANONICAL_ADDR.has(address));
}

const MAJOR_HOME: Record<string, "*" | readonly string[]> = {
  ETH: ["Ethereum", "Base", "Arbitrum", "Optimism", "Scroll", "NEAR"],
  WETH: ["Ethereum", "Base", "Arbitrum", "Optimism", "Scroll"],
  SOL: ["Solana", "NEAR"],
  BTC: ["NEAR"],
  WBTC: ["Ethereum", "Arbitrum", "Base", "Polygon", "Optimism", "Avalanche", "BNB", "NEAR"],
  CBBTC: "*",
  BNB: ["BNB"],
  WBNB: ["BNB"],
  AVAX: ["Avalanche"],
  POL: ["Polygon"],
  MATIC: ["Polygon"],
  ARB: ["Arbitrum"],
  OP: ["Optimism"],
  USDC: "*",
  "USDC.E": "*",
  USDT: "*",
  "USDT.E": "*",
  DAI: "*",
  FRAX: "*",
  LINK: "*",
  UNI: ["Ethereum", "Arbitrum", "Base", "Polygon", "Optimism", "BNB", "Avalanche"],
  AAVE: ["Ethereum", "Arbitrum", "Base", "Polygon", "Optimism", "Avalanche"],
  STETH: ["Ethereum"],
  WSTETH: ["Ethereum"],
  BERA: ["Berachain"],
  OKB: ["X Layer"],
  GNO: ["Gnosis"],
  XDAI: ["Gnosis"],
  AURORA: ["Aurora", "NEAR"],
  NEAR: ["NEAR"],
};

export function isMajorAsset(symbol: string, chain: string) {
  const base = symbol.split(".")[0].toUpperCase();
  const home = MAJOR_HOME[base];
  if (!home) return false;
  return home === "*" || home.includes(chain);
}

export function sealMajors() {
  for (const token of TOKENS) {
    if (!token.verified && isMajorAsset(token.symbol, token.chain)) token.verified = true;
  }
}

export function qualityScore(token: { liqN: number; volN: number; txnsN: number; ageH: number; mcapN?: number }): number | null {
  const liqN = token.liqN || 0;
  const volN = token.volN || 0;
  const txnsN = token.txnsN || 0;
  const mcapN = token.mcapN || 0;
  if (!(liqN > 0) && !(volN > 0) && !(txnsN > 0) && !(mcapN > 0)) return null;
  const liq = liqN > 0 ? Math.min(35, Math.log10(liqN) * 7) : 0;
  const vol = volN > 0 ? Math.min(25, Math.log10(volN) * 5.5) : 0;
  const tx = txnsN > 0 ? Math.min(15, Math.log10(txnsN) * 6) : 0;
  const cap = mcapN > 0 ? Math.min(15, Math.log10(mcapN) * 1.6) : 0;
  const age = token.ageH > 0 ? Math.min(10, Math.log10(token.ageH + 1) * 3.2) : 0;
  return Math.max(1, Math.min(100, Math.round(liq + vol + tx + cap + age)));
}

for (const token of TOKENS) {
  token.mcapN = 0;
  token.liqN = 0;
  token.volN = 0;
  token.txnsN = 0;
  token.buys = 0;
  token.sells = 0;
  token.holdersN = 0;
  token.ageH = 0;
  token.mcap = "—";
  token.fdv = "—";
  token.liquidity = "—";
  token.volume = "—";
  token.txns = "—";
  token.supply = "—";
  token.change = 0;
  token.price = Number.NaN;
  token.windows = { m5: 0, h1: 0, h6: 0, h24: 0 };
  token.volBy = { m5: 0, h1: 0, h6: 0, h24: 0 };
  token.listed = false;
  token.score = qualityScore(token) ?? 0;
  token.verified = isCanonical(token);
  token.safety = { top10: 0, insiders: 0, snipers: 0, bundlers: 0, dev: 0, lp: 0, buyTax: 0, sellTax: 0, holders: "—" };
  token.notes = isCanonical(token) ? ["Widely used NEAR asset"] : ["NEAR market"];
}

export function isGeneratedIcon(icon: string | undefined) {
  return !icon || icon.startsWith("data:image/svg+xml;utf8,");
}

export function scoreLabel(token: { liqN: number; volN: number; txnsN: number; ageH: number; mcapN?: number }) {
  const score = qualityScore(token);
  return score == null ? "—" : `${score}/100`;
}

function iconRank(icon: string | undefined) {
  if (!icon || icon.startsWith("data:image/svg+xml;utf8,")) return 0;
  if (icon.includes("cdn.dexscreener.com/tokens/") || icon.includes("dd.dexscreener.com/ds-data/tokens/")) return 1;
  if (icon.startsWith("data:image/")) return 2;
  if (icon.startsWith("/tokens/") || icon.startsWith("/chains/")) return 3;
  if (icon.startsWith("https://")) return 5;
  return 0;
}

function sameTokenAddress(left?: string, right?: string) {
  if (!left || !right) return false;
  if (left.startsWith("0x") || left.startsWith("0X") || right.startsWith("0x") || right.startsWith("0X")) return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

export function preferIcon(current: string, incoming?: string) {
  if (!incoming || incoming.startsWith("javascript:") || incoming.startsWith("data:text")) return current;
  if (iconRank(incoming) > iconRank(current) && iconRank(incoming) > 0) return incoming;
  return current;
}

export function ensureToken(input: { symbol: string; name: string; price: number; chain?: string; icon?: string; address?: string }) {
  const chain = input.chain ?? "NEAR";
  const found =
    (input.address ? TOKENS.find((token) => token.chain === chain && sameTokenAddress(token.address, input.address)) : undefined) ??
    TOKENS.find((token) => token.chain === chain && token.symbol.toUpperCase() === input.symbol.toUpperCase());
  if (found) {
    if (input.address) found.address = input.address;
    if (input.icon) found.icon = preferIcon(found.icon, input.icon);
    if (Number.isFinite(input.price) && input.price > 0 && !Number.isFinite(found.price)) found.price = input.price;
    return found;
  }
  const token = coin({
    symbol: input.symbol,
    name: input.name,
    tag: input.name,
    price: input.price,
    icon: input.icon,
    chain: input.chain ?? "NEAR",
    ageH: 0,
    mcapN: 0,
    liqN: 0,
    volN: 0,
    txnsN: 0,
    buyShare: 0.5,
    holdersN: 0,
    windows: w(0, 0, 0, 0),
    verified: false,
    score: 0,
    notes: ["DexScreener"],
    safety: { ...clean, top10: 0, insiders: 0, snipers: 0, bundlers: 0, dev: 0, lp: 0, holders: "—" },
    supply: "—",
    fdvN: 0,
    kind: "defi",
  });
  token.address = input.address;
  token.mcap = "—";
  token.fdv = "—";
  token.liquidity = "—";
  token.volume = "—";
  token.txns = "—";
  token.score = 0;
  TOKENS.push(token);
  return token;
}

export const VENUES: Venue[] = [
  { id: "intents", name: "NEAR Intents", kind: "Bridge", feeBps: 0, impactBps: 0, depthUsd: 0, eta: "live" },
];

export const MARKETS = [
  { id: "NEAR-PERP", base: "NEAR", label: "NEAR-USD" },
  { id: "ETH-PERP", base: "ETH", label: "ETH-USD" },
] as const;

export function canPerp(symbol: string) {
  const token = TOKENS.find((item) => item.symbol === symbol);
  if (!token || !token.listed || !(token.price > 0) || token.kind === "meme") return false;
  const base = token.symbol.split(".")[0];
  return MARKETS.some((market) => market.base === token.symbol || market.base === base);
}

export const LEND_MARKETS: { symbol: string; token?: string; supplyApy: number; borrowApy: number }[] = [];

const LTV = 0.7;

export function tokenBySymbol(symbol: string) {
  return TOKENS.find((token) => token.symbol === symbol) ?? TOKENS.find((token) => token.symbol === "NEAR") ?? TOKENS[0];
}

export function tokenLabel(token: { symbol: string; chain: string }) {
  const suffix = `.${token.chain}`;
  return token.symbol.endsWith(suffix) ? token.symbol.slice(0, -suffix.length) : token.symbol;
}

export function displayName(token: { symbol: string; name: string; chain: string }) {
  const cut = (value: string) => {
    let next = value.trim();
    const tail = /\.(near|sweat|tkn|tknx|omft|meme-cooking|nearlytrade|justhoot)$/i;
    while (tail.test(next)) next = next.replace(tail, "");
    return next;
  };
  const symbol = cut(tokenLabel(token));
  let name = cut((token.name || symbol).replace(new RegExp(`\\s+on\\s+${token.chain}$`, "i"), ""));
  if (!name || name.length > 32) name = symbol;
  return name || symbol;
}

export function isHoneypot(token: Token) {
  return token.safety.sellTax >= 90;
}

export function rankQuotes(_from?: Token, _to?: Token, _amount?: number, _slippagePct?: number): Quote[] {
  void _from;
  void _to;
  void _amount;
  void _slippagePct;
  return [];
}

export function fmt(n: number, digits = 4) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const fraction = abs >= 1000 ? 2 : abs >= 1 ? Math.min(digits, 4) : 6;
  return n.toLocaleString("en-US", { maximumFractionDigits: fraction, minimumFractionDigits: abs >= 100 ? 2 : 0 });
}

export function qty(n: number) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs > 0 && abs < 0.005) return n < 0 ? ">-0.01" : "<0.01";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function usd(n: number) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function px(n: number) {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1) return usd(n);
  const digits = Math.abs(n) >= 0.01 ? 4 : Math.abs(n) >= 0.0001 ? 6 : 8;
  const text = n.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
  return `$${text}`;
}

export function candles(seed: string, last: number, count = 72): Candle[] {
  const out: Candle[] = [];
  let price = last * 0.86;
  let h = tilt(seed);
  for (let i = 0; i < count; i++) {
    h = (h * 1664525 + 1013904223) >>> 0;
    const move = ((h % 1000) / 1000 - 0.47) * last * 0.02;
    const open = price;
    const close = Math.max(last * 0.35, open + move);
    const wick = last * (0.003 + (h % 40) / 9000);
    out.push({ o: open, h: Math.max(open, close) + wick, l: Math.min(open, close) - wick * 0.75, c: close });
    price = close;
  }
  const scale = last / out[out.length - 1].c;
  return out.map((candle) => ({
    o: candle.o * scale,
    h: candle.h * scale,
    l: candle.l * scale,
    c: candle.c * scale,
  }));
}

export type Print = { age: string; side: "Buy" | "Sell"; amount: number; usd: number; price: number; trader: string };

export function tape(): Print[] {
  return [];
}

export function holderRows(): { wallet: string; pct: number; tag: string }[] {
  return [];
}

function bookUsd(book: Record<string, number>) {
  let total = 0;
  for (const token of TOKENS) {
    if (!Number.isFinite(token.price)) continue;
    total += (book[token.symbol] ?? 0) * token.price;
  }
  return total;
}

export function healthFactor(supplied: Record<string, number>, loans: Record<string, number>) {
  const collateral = bookUsd(supplied);
  const debt = bookUsd(loans);
  if (debt <= 0) return collateral > 0 ? 99 : 0;
  return (collateral * LTV) / debt;
}

export function borrowRoom(supplied: Record<string, number>, loans: Record<string, number>) {
  return Math.max(0, bookUsd(supplied) * LTV - bookUsd(loans));
}
