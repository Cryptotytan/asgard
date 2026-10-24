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

export type WindowId = "m5" | "h1" | "h4" | "h24";

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

export type Candle = { o: number; h: number; l: number; c: number };

export const WINDOWS: { id: WindowId; label: string }[] = [
  { id: "m5", label: "5M" },
  { id: "h1", label: "1H" },
  { id: "h4", label: "4H" },
  { id: "h24", label: "24H" },
];

export const CHAINS = ["NEAR", "Aurora", "Ethereum"] as const;

export const CHAIN_ICON: Record<string, string> = {
  NEAR: "/tokens/near.svg",
  Aurora: "/tokens/aurora.jpg",
  Ethereum: "/tokens/eth.png",
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

function glyph(symbol: string, hue: number) {
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
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
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
    kind: d.kind,
  };
}

const w = (m5: number, h1: number, h4: number, h24: number): Record<WindowId, number> => ({ m5, h1, h4, h24 });

export const TOKENS: Token[] = [
  coin({
    symbol: "NEAR",
    name: "NEAR",
    tag: "Near Protocol",
    price: 4.82,
    icon: "/tokens/near.svg",
    chain: "NEAR",
    ageH: 24 * 1500,
    mcapN: 5.9e9,
    liqN: 86.4e6,
    volN: 214e6,
    txnsN: 48200,
    buyShare: 0.54,
    holdersN: 1_800_000,
    windows: w(0.4, 1.1, -0.6, 1.84),
    verified: true,
    score: 99,
    notes: ["Named asset", "No tax", "Deep liquidity"],
    safety: { ...clean, top10: 22.4, holders: "1.8M" },
    supply: "1.22B",
    fdvN: 5.9e9,
    kind: "major",
  }),
  coin({
    symbol: "USDC",
    name: "USD Coin",
    tag: "Fiat-backed stable",
    price: 1,
    icon: "/tokens/usdc.png",
    chain: "NEAR",
    ageH: 24 * 1700,
    mcapN: 32.4e9,
    liqN: 410e6,
    volN: 6.1e9,
    txnsN: 902000,
    buyShare: 0.5,
    holdersN: 4_100_000,
    windows: w(0, 0.01, -0.01, 0.01),
    verified: true,
    score: 97,
    notes: ["Fiat-backed stable", "No mint surprise", "Deep liquidity"],
    safety: { ...clean, top10: 41.2, lp: 99, holders: "4.1M" },
    supply: "32.4B",
    fdvN: 32.4e9,
    kind: "major",
  }),
  coin({
    symbol: "ETH",
    name: "Ether",
    tag: "Canonical asset",
    price: 3320,
    icon: "/tokens/eth.png",
    chain: "Ethereum",
    ageH: 24 * 3200,
    mcapN: 399e9,
    liqN: 1.2e9,
    volN: 18.4e9,
    txnsN: 1_100_000,
    buyShare: 0.51,
    holdersN: 142_000_000,
    windows: w(0.2, -0.4, 0.8, 1.08),
    verified: true,
    score: 96,
    notes: ["Canonical asset", "No tax"],
    safety: { ...clean, top10: 28.6, holders: "142M" },
    supply: "120.4M",
    fdvN: 399e9,
    kind: "major",
  }),
  coin({
    symbol: "wBTC",
    name: "Wrapped Bitcoin",
    tag: "Custodied wrapper",
    price: 67400,
    icon: "/tokens/wbtc.png",
    chain: "Ethereum",
    ageH: 24 * 2200,
    mcapN: 10.8e9,
    liqN: 640e6,
    volN: 2.4e9,
    txnsN: 86100,
    buyShare: 0.48,
    holdersN: 612_000,
    windows: w(-0.3, 0.4, -0.9, -0.62),
    verified: true,
    score: 94,
    notes: ["Custodied wrapper", "Verified contract"],
    safety: { ...clean, top10: 36.1, lp: 96.4, holders: "612K" },
    supply: "160.2K",
    fdvN: 10.8e9,
    kind: "major",
  }),
  coin({
    symbol: "AURORA",
    name: "Aurora",
    tag: "EVM on NEAR",
    price: 0.12,
    icon: "/tokens/aurora.jpg",
    chain: "Aurora",
    ageH: 24 * 1100,
    mcapN: 68.2e6,
    liqN: 4.1e6,
    volN: 920_000,
    txnsN: 2110,
    buyShare: 0.46,
    holdersN: 96_000,
    windows: w(-0.4, -1.2, 0.6, -2.4),
    verified: true,
    score: 88,
    notes: ["EVM on NEAR", "Verified contract"],
    safety: { ...clean, top10: 44, insiders: 8.2, lp: 81, holders: "96K" },
    supply: "568M",
    fdvN: 72e6,
    kind: "defi",
  }),
  coin({
    symbol: "RHEA",
    name: "Rhea",
    tag: "NEAR DEX",
    price: 0.084,
    icon: "/tokens/rhea.svg",
    chain: "NEAR",
    ageH: 24 * 400,
    mcapN: 42.8e6,
    liqN: 6.4e6,
    volN: 1.8e6,
    txnsN: 6420,
    buyShare: 0.58,
    holdersN: 48_200,
    windows: w(1.2, 2.4, 3.1, 4.2),
    verified: true,
    score: 91,
    notes: ["NEAR DEX token", "Ownership renounced"],
    safety: { ...clean, top10: 31, insiders: 6.4, lp: 92, holders: "48.2K" },
    supply: "510M",
    fdvN: 48.1e6,
    kind: "defi",
  }),
  coin({
    symbol: "SWEAT",
    name: "Sweat",
    tag: "Sweat Economy",
    price: 0.0068,
    icon: "/tokens/sweat.svg",
    chain: "NEAR",
    ageH: 24 * 900,
    mcapN: 48e6,
    liqN: 3.4e6,
    volN: 2.2e6,
    txnsN: 18440,
    buyShare: 0.55,
    holdersN: 2_400_000,
    windows: w(0.8, -1.4, 2.2, 6.4),
    verified: true,
    score: 90,
    notes: ["Move-to-earn", "No tax", "Verified contract"],
    safety: { ...clean, top10: 29, lp: 94, holders: "2.4M" },
    supply: "7.1B",
    fdvN: 52e6,
    kind: "defi",
  }),
  coin({
    symbol: "STNEAR",
    name: "stNEAR",
    tag: "Staked NEAR",
    price: 5.41,
    icon: "/tokens/stnear.svg",
    chain: "NEAR",
    ageH: 24 * 1200,
    mcapN: 210e6,
    liqN: 22e6,
    volN: 4.6e6,
    txnsN: 3210,
    buyShare: 0.52,
    holdersN: 86_000,
    windows: w(0.3, 0.9, -0.2, 1.6),
    verified: true,
    score: 95,
    notes: ["Liquid staking", "No tax"],
    safety: { ...clean, top10: 26, lp: 97 },
    supply: "38.8M",
    fdvN: 210e6,
    kind: "defi",
  }),
  coin({
    symbol: "BRRR",
    name: "Burrow",
    tag: "Money market",
    price: 0.092,
    icon: "/tokens/brrr.svg",
    chain: "NEAR",
    ageH: 24 * 800,
    mcapN: 11e6,
    liqN: 1.6e6,
    volN: 640_000,
    txnsN: 1880,
    buyShare: 0.49,
    holdersN: 22_400,
    windows: w(-0.6, 1.1, 2.8, -1.4),
    verified: true,
    score: 89,
    notes: ["Lending market", "Verified contract"],
    safety: { ...clean, top10: 38, insiders: 7.1, lp: 88 },
    supply: "120M",
    fdvN: 14e6,
    kind: "defi",
  }),
  coin({
    symbol: "JUMBO",
    name: "Jumbo",
    tag: "Exchange token",
    price: 0.031,
    icon: "/tokens/jumbo.svg",
    chain: "NEAR",
    ageH: 24 * 1000,
    mcapN: 6.4e6,
    liqN: 890_000,
    volN: 410_000,
    txnsN: 960,
    buyShare: 0.47,
    holdersN: 31_000,
    windows: w(0.2, -0.8, 1.4, 3.6),
    verified: true,
    score: 84,
    notes: ["Legacy NEAR DEX", "No tax"],
    safety: { ...clean, top10: 42, lp: 76 },
    supply: "206M",
    fdvN: 8.1e6,
    kind: "defi",
  }),
  coin({
    symbol: "PEM",
    name: "Pembrock",
    tag: "Leverage yield",
    price: 0.0044,
    icon: "/tokens/pem.svg",
    chain: "NEAR",
    ageH: 24 * 700,
    mcapN: 3.2e6,
    liqN: 540_000,
    volN: 220_000,
    txnsN: 740,
    buyShare: 0.44,
    holdersN: 14_800,
    windows: w(-1.1, -2.4, 0.6, -4.8),
    verified: true,
    score: 80,
    notes: ["Yield protocol", "Verified contract"],
    safety: { ...clean, top10: 48, insiders: 9, lp: 71 },
    supply: "727M",
    fdvN: 4.4e6,
    kind: "defi",
  }),
  coin({
    symbol: "PARAS",
    name: "Paras",
    tag: "NFT marketplace",
    price: 0.018,
    icon: "/tokens/paras.svg",
    chain: "NEAR",
    ageH: 24 * 1300,
    mcapN: 2.8e6,
    liqN: 410_000,
    volN: 96_000,
    txnsN: 420,
    buyShare: 0.51,
    holdersN: 19_200,
    windows: w(0.4, 1.8, -0.7, 2.1),
    verified: true,
    score: 86,
    notes: ["NFT market", "No tax"],
    safety: { ...clean, top10: 35, lp: 84 },
    supply: "156M",
    fdvN: 3.1e6,
    kind: "defi",
  }),
  coin({
    symbol: "OCT",
    name: "Octopus",
    tag: "App-chain network",
    price: 0.11,
    icon: "/tokens/oct.svg",
    chain: "NEAR",
    ageH: 24 * 1400,
    mcapN: 9.6e6,
    liqN: 1.1e6,
    volN: 380_000,
    txnsN: 510,
    buyShare: 0.5,
    holdersN: 27_600,
    windows: w(-0.2, 0.6, 1.1, -3.2),
    verified: true,
    score: 87,
    notes: ["App chains", "Verified contract"],
    safety: { ...clean, top10: 40, lp: 82 },
    supply: "87M",
    fdvN: 12e6,
    kind: "defi",
  }),
  coin({
    symbol: "HOT",
    name: "HOT",
    tag: "Here wallet",
    price: 0.0012,
    icon: "/tokens/hot.svg",
    chain: "NEAR",
    ageH: 24 * 600,
    mcapN: 18e6,
    liqN: 2.8e6,
    volN: 3.4e6,
    txnsN: 22100,
    buyShare: 0.57,
    holdersN: 410_000,
    windows: w(2.1, 4.4, -1.6, 8.8),
    verified: true,
    score: 92,
    notes: ["Wallet token", "No tax", "Deep enough book"],
    safety: { ...clean, top10: 27, lp: 93 },
    supply: "15B",
    fdvN: 21e6,
    kind: "defi",
  }),
  coin({
    symbol: "LINEAR",
    name: "LiNEAR",
    tag: "Liquid staking",
    price: 0.74,
    icon: "/tokens/linear.svg",
    chain: "NEAR",
    ageH: 24 * 1000,
    mcapN: 22e6,
    liqN: 5.5e6,
    volN: 1.1e6,
    txnsN: 1640,
    buyShare: 0.53,
    holdersN: 41_000,
    windows: w(0.2, 0.5, 0.4, 1.2),
    verified: true,
    score: 93,
    notes: ["Liquid staking", "No tax"],
    safety: { ...clean, top10: 24, lp: 96 },
    supply: "29.7M",
    fdvN: 22e6,
    kind: "defi",
  }),
  coin({
    symbol: "BLACK",
    name: "Black Dragon",
    tag: "NEAR meme",
    price: 0.00021,
    icon: "/tokens/black.svg",
    chain: "NEAR",
    ageH: 24 * 40,
    mcapN: 1.4e6,
    liqN: 320_000,
    volN: 860_000,
    txnsN: 9400,
    buyShare: 0.61,
    holdersN: 12_400,
    windows: w(4.2, 8.1, -6.4, 22.5),
    verified: true,
    score: 76,
    notes: ["Established meme", "LP locked", "No tax"],
    safety: { ...clean, top10: 33, insiders: 4.2, lp: 90, snipers: 0.4 },
    supply: "6.6B",
    fdvN: 1.8e6,
    kind: "meme",
  }),
  coin({
    symbol: "SHIBA",
    name: "Shiba Near",
    tag: "Sharded pup",
    price: 0.0000048,
    icon: "/tokens/shiba.svg",
    chain: "NEAR",
    ageH: 24 * 9,
    mcapN: 640_000,
    liqN: 84_000,
    volN: 510_000,
    txnsN: 7200,
    buyShare: 0.63,
    holdersN: 5400,
    windows: w(6.1, -4.2, 18, 41),
    verified: true,
    score: 71,
    notes: ["Meme", "LP locked", "Ownership renounced"],
    safety: { ...clean, top10: 29, lp: 88, snipers: 1.2, bundlers: 0.4 },
    supply: "133B",
    fdvN: 920_000,
    kind: "meme",
  }),
  coin({
    symbol: "PULSAR",
    name: "Pulsar",
    tag: "Pulse cat",
    price: 0.0000086,
    icon: "/tokens/pulsar.svg",
    chain: "NEAR",
    ageH: 0.12,
    mcapN: 86_000,
    liqN: 18_000,
    volN: 240_000,
    txnsN: 1680,
    buyShare: 0.72,
    holdersN: 940,
    windows: w(48, 126, 80, 214),
    verified: false,
    score: 58,
    notes: ["Mint authority still live", "Pool is under a day old", "No sell tax yet"],
    safety: { top10: 46, insiders: 12, snipers: 8.4, bundlers: 3.1, dev: 6.2, lp: 40, buyTax: 0, sellTax: 0, holders: "940" },
    supply: "10B",
    fdvN: 140_000,
    kind: "meme",
  }),
  coin({
    symbol: "DUST",
    name: "Dust",
    tag: "Dust bunny",
    price: 0.0000014,
    icon: "/tokens/dust.svg",
    chain: "NEAR",
    ageH: 0.45,
    mcapN: 42_000,
    liqN: 11_000,
    volN: 96_000,
    txnsN: 880,
    buyShare: 0.66,
    holdersN: 410,
    windows: w(22, 64, 40, 91),
    verified: false,
    score: 49,
    notes: ["Fresh pool", "Dev still holds supply", "Liquidity only partly locked"],
    safety: { top10: 58, insiders: 18, snipers: 11, bundlers: 4, dev: 14, lp: 22, buyTax: 0, sellTax: 0, holders: "410" },
    supply: "30B",
    fdvN: 88_000,
    kind: "meme",
  }),
  coin({
    symbol: "NEKO",
    name: "Neko",
    tag: "Near cat",
    price: 0.000034,
    icon: "/tokens/neko.svg",
    chain: "NEAR",
    ageH: 3,
    mcapN: 210_000,
    liqN: 46_000,
    volN: 380_000,
    txnsN: 4100,
    buyShare: 0.69,
    holdersN: 2100,
    windows: w(11, 28, -8, 76),
    verified: false,
    score: 62,
    notes: ["No tax", "Ownership not renounced", "Snipers in the first block"],
    safety: { top10: 41, insiders: 9, snipers: 6.6, bundlers: 2.2, dev: 4.1, lp: 55, buyTax: 0, sellTax: 0, holders: "2.1K" },
    supply: "6.2B",
    fdvN: 340_000,
    kind: "meme",
  }),
  coin({
    symbol: "GLOW",
    name: "Glow",
    tag: "Aurora glow",
    price: 0.000092,
    icon: "/tokens/glow.svg",
    chain: "Aurora",
    ageH: 8,
    mcapN: 510_000,
    liqN: 72_000,
    volN: 640_000,
    txnsN: 5300,
    buyShare: 0.6,
    holdersN: 3200,
    windows: w(-6.4, 14, 22, 55),
    verified: false,
    score: 64,
    notes: ["Aurora meme", "LP lock is short", "No tax"],
    safety: { top10: 37, insiders: 8, snipers: 4.4, bundlers: 1.6, dev: 3.3, lp: 48, buyTax: 0, sellTax: 0, holders: "3.2K" },
    supply: "5.5B",
    fdvN: 690_000,
    kind: "meme",
  }),
  coin({
    symbol: "BANAN",
    name: "Bananear",
    tag: "Yellow ape",
    price: 0.00012,
    icon: "/tokens/banan.svg",
    chain: "NEAR",
    ageH: 20,
    mcapN: 890_000,
    liqN: 120_000,
    volN: 1.1e6,
    txnsN: 8600,
    buyShare: 0.58,
    holdersN: 6100,
    windows: w(3.3, -9.1, 12, 33),
    verified: true,
    score: 73,
    notes: ["Meme", "LP locked", "No tax"],
    safety: { ...clean, top10: 34, snipers: 1.1, lp: 86 },
    supply: "7.4B",
    fdvN: 1.2e6,
    kind: "meme",
  }),
  coin({
    symbol: "MOCHI",
    name: "Mochi",
    tag: "Rice cake",
    price: 0.000055,
    icon: "/tokens/mochi.svg",
    chain: "NEAR",
    ageH: 36,
    mcapN: 430_000,
    liqN: 66_000,
    volN: 290_000,
    txnsN: 2400,
    buyShare: 0.52,
    holdersN: 2800,
    windows: w(-2.2, 4.1, -7, 12.4),
    verified: false,
    score: 55,
    notes: ["Buy tax 2%", "Dev wallet active", "Liquidity unlocked"],
    safety: { top10: 52, insiders: 16, snipers: 5, bundlers: 2.8, dev: 9.4, lp: 18, buyTax: 2, sellTax: 2, holders: "2.8K" },
    supply: "7.8B",
    fdvN: 610_000,
    kind: "meme",
  }),
  coin({
    symbol: "YAK",
    name: "Yak",
    tag: "Highland yak",
    price: 0.00027,
    icon: "/tokens/yak.svg",
    chain: "NEAR",
    ageH: 24 * 4,
    mcapN: 1.1e6,
    liqN: 180_000,
    volN: 720_000,
    txnsN: 6100,
    buyShare: 0.56,
    holdersN: 7400,
    windows: w(1.4, 5.5, 9.2, -8.6),
    verified: true,
    score: 78,
    notes: ["Meme", "LP locked", "Ownership renounced"],
    safety: { ...clean, top10: 30, lp: 91 },
    supply: "4.1B",
    fdvN: 1.3e6,
    kind: "meme",
  }),
  coin({
    symbol: "LONK",
    name: "Lonk",
    tag: "Lonk inu",
    price: 0.000019,
    icon: "/tokens/lonk.svg",
    chain: "NEAR",
    ageH: 24 * 6,
    mcapN: 760_000,
    liqN: 140_000,
    volN: 1.4e6,
    txnsN: 11200,
    buyShare: 0.64,
    holdersN: 9800,
    windows: w(8.8, 15, -4, 67),
    verified: true,
    score: 74,
    notes: ["Meme", "No tax", "LP locked"],
    safety: { ...clean, top10: 28, snipers: 0.8, lp: 87 },
    supply: "40B",
    fdvN: 980_000,
    kind: "meme",
  }),
  coin({
    symbol: "SHARD",
    name: "Shard",
    tag: "Shard pup",
    price: 0.0000077,
    icon: "/tokens/shard.svg",
    chain: "NEAR",
    ageH: 24 * 2,
    mcapN: 155_000,
    liqN: 28_000,
    volN: 190_000,
    txnsN: 2100,
    buyShare: 0.57,
    holdersN: 1600,
    windows: w(-4, 9, 21, 18),
    verified: false,
    score: 51,
    notes: ["Dev holds 11%", "Short LP lock", "No tax"],
    safety: { top10: 49, insiders: 14, snipers: 7.2, bundlers: 3.4, dev: 11, lp: 30, buyTax: 0, sellTax: 0, holders: "1.6K" },
    supply: "20B",
    fdvN: 240_000,
    kind: "meme",
  }),
  coin({
    symbol: "FIN",
    name: "Fin",
    tag: "Aurora fin",
    price: 0.00041,
    icon: "/tokens/fin.svg",
    chain: "Aurora",
    ageH: 24 * 3,
    mcapN: 320_000,
    liqN: 54_000,
    volN: 410_000,
    txnsN: 3600,
    buyShare: 0.48,
    holdersN: 2400,
    windows: w(-8.2, -14, 6, -22),
    verified: false,
    score: 44,
    notes: ["Sell tax 4%", "Ownership not renounced", "Snipers clustered"],
    safety: { top10: 61, insiders: 22, snipers: 9.1, bundlers: 5.5, dev: 8.8, lp: 26, buyTax: 1, sellTax: 4, holders: "2.4K" },
    supply: "780M",
    fdvN: 480_000,
    kind: "meme",
  }),
  coin({
    symbol: "HONEY",
    name: "Honeycomb",
    tag: "Sticky tax",
    price: 0.000063,
    icon: "/tokens/honey.svg",
    chain: "NEAR",
    ageH: 24 * 12,
    mcapN: 240_000,
    liqN: 38_000,
    volN: 150_000,
    txnsN: 1900,
    buyShare: 0.41,
    holdersN: 3100,
    windows: w(-3.3, -6, -11, -19),
    verified: false,
    score: 36,
    notes: ["Sell tax 8%", "Mint authority still live", "Insiders overweight"],
    safety: { top10: 68, insiders: 31, snipers: 6, bundlers: 4.2, dev: 16, lp: 20, buyTax: 2, sellTax: 8, holders: "3.1K" },
    supply: "3.8B",
    fdvN: 410_000,
    kind: "meme",
  }),
  coin({
    symbol: "STRAY",
    name: "Stray",
    tag: "Unlocked mint",
    price: 0.00042,
    icon: "/tokens/stray.svg",
    chain: "NEAR",
    ageH: 24 * 18,
    mcapN: 2.1e6,
    liqN: 38_000,
    volN: 410_000,
    txnsN: 1904,
    buyShare: 0.39,
    holdersN: 6200,
    windows: w(-4.4, -9.2, -12, -18.6),
    verified: false,
    score: 34,
    notes: ["Mint authority still live", "Sell tax 8%", "Liquidity under $40k"],
    safety: { top10: 79, insiders: 41, snipers: 12.4, bundlers: 6.1, dev: 18.4, lp: 12, buyTax: 0, sellTax: 8, holders: "6.2K" },
    supply: "5.0B",
    fdvN: 8.4e6,
    kind: "meme",
  }),
  coin({
    symbol: "VOID",
    name: "Void",
    tag: "Sell trap",
    price: 0.000018,
    icon: "/tokens/void.svg",
    chain: "NEAR",
    ageH: 24 * 60,
    mcapN: 410_000,
    liqN: 9_000,
    volN: 88_000,
    txnsN: 640,
    buyShare: 0.81,
    holdersN: 1100,
    windows: w(-6, -18, -28, -36.5),
    verified: false,
    score: 12,
    notes: ["Honeypot pattern on sells", "Ownership not renounced", "Single-sided liquidity"],
    safety: { top10: 91, insiders: 75.4, snipers: 22, bundlers: 14, dev: 33, lp: 0, buyTax: 0, sellTax: 99, holders: "1.1K" },
    supply: "22B",
    fdvN: 4.1e6,
    kind: "meme",
  }),
  coin({
    symbol: "MIRAGE",
    name: "Mirage",
    tag: "Cannot sell",
    price: 0.0000022,
    icon: "/tokens/mirage.svg",
    chain: "Aurora",
    ageH: 24 * 2.2,
    mcapN: 64_000,
    liqN: 6_500,
    volN: 44_000,
    txnsN: 520,
    buyShare: 0.92,
    holdersN: 380,
    windows: w(12, 40, -8, 150),
    verified: false,
    score: 9,
    notes: ["Honeypot pattern on sells", "Buys succeed, sells revert", "Dev holds the pool"],
    safety: { top10: 94, insiders: 81, snipers: 18, bundlers: 11, dev: 44, lp: 0, buyTax: 0, sellTax: 99, holders: "380" },
    supply: "29B",
    fdvN: 180_000,
    kind: "meme",
  }),
];

export const VENUES: Venue[] = [
  { id: "rhea-clmm", name: "Rhea CLMM", kind: "Swap", feeBps: 8, impactBps: 4, depthUsd: 4_200_000, eta: "2s" },
  { id: "rhea-amm", name: "Rhea AMM", kind: "Swap", feeBps: 30, impactBps: 9, depthUsd: 1_800_000, eta: "2s" },
  { id: "intents", name: "NEAR Intents", kind: "Bridge", feeBps: 12, impactBps: 3, depthUsd: 8_500_000, eta: "4s" },
  { id: "hex", name: "HEX", kind: "Bridge", feeBps: 18, impactBps: 7, depthUsd: 2_400_000, eta: "6s" },
  { id: "aurora", name: "Aurora Swap", kind: "Swap", feeBps: 25, impactBps: 11, depthUsd: 960_000, eta: "5s" },
  { id: "hot", name: "HOT", kind: "Bridge", feeBps: 15, impactBps: 6, depthUsd: 3_100_000, eta: "5s" },
];

export const MARKETS = [
  { id: "NEAR-PERP", base: "NEAR", label: "NEAR-USD" },
  { id: "ETH-PERP", base: "ETH", label: "ETH-USD" },
] as const;

export function canPerp(symbol: string) {
  return MARKETS.some((market) => market.base === symbol);
}

export const LEND_MARKETS = [
  { symbol: "USDC", supplyApy: 8.4, borrowApy: 6.1 },
  { symbol: "NEAR", supplyApy: 5.2, borrowApy: 7.8 },
  { symbol: "ETH", supplyApy: 2.1, borrowApy: 3.4 },
] as const;

const LTV = 0.7;

export function tokenBySymbol(symbol: string) {
  return TOKENS.find((token) => token.symbol === symbol) ?? TOKENS.find((token) => token.symbol === "NEAR") ?? TOKENS[0];
}

export function isHoneypot(token: Token) {
  return token.safety.sellTax >= 90 || token.score < 15;
}

export function rankQuotes(from: Token, to: Token, amount: number, slippagePct = 1): Quote[] {
  if (amount <= 0 || from.symbol === to.symbol) return [];
  const usdNotional = amount * from.price;
  const local = Math.max(1_000, Math.min(from.liqN, to.liqN));
  const raw = VENUES.map((venue) => {
    const noise = tilt(`${venue.id}:${from.symbol}:${to.symbol}`);
    const feeBps = venue.feeBps + (noise % 5);
    const pool = Math.min(venue.depthUsd, local);
    const impact = venue.impactBps / 100 + (usdNotional / pool) * (12 + (noise % 8));
    const mid = (amount * from.price) / to.price;
    const receive = mid * (1 - feeBps / 10_000) * (1 - Math.min(impact, 40) / 100);
    return { venue, feeBps, impact, receive, score: feeBps / 100 + impact };
  });
  return raw
    .filter((quote) => quote.receive > 0 && quote.impact <= slippagePct && quote.impact < 40)
    .sort((a, b) => a.feeBps - b.feeBps || a.impact - b.impact || b.receive - a.receive);
}

export function fmt(n: number, digits = 4) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const fraction = abs >= 1000 ? 2 : abs >= 1 ? Math.min(digits, 4) : 6;
  return n.toLocaleString("en-US", { maximumFractionDigits: fraction, minimumFractionDigits: abs >= 100 ? 2 : 0 });
}

export function usd(n: number) {
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

export function tape(symbol: string, price: number): Print[] {
  let h = tilt(symbol + "tape");
  return Array.from({ length: 12 }, (_, index) => {
    h = (h * 1664525 + 1013904223) >>> 0;
    const amount = (h % 8000) / (price > 100 ? 100 : 10);
    const pxn = price * (1 + ((h % 80) - 40) / 20000);
    const id = (h >>> 0).toString(16).padStart(8, "0");
    return {
      age: `${index * 2}s`,
      side: h % 3 === 0 ? "Sell" : "Buy",
      amount,
      usd: amount * pxn,
      price: pxn,
      trader: `${id.slice(0, 4)}…${id.slice(4, 8)}`,
    };
  });
}

export function holderRows(symbol: string) {
  let h = tilt(symbol + "holders");
  let left = 100;
  return Array.from({ length: 8 }, (_, index) => {
    h = (h * 1664525 + 1013904223) >>> 0;
    const pct = index === 7 ? Math.max(0.4, left) : Math.min(left - 0.4, 4 + (h % 220) / 10);
    left = Math.max(0, left - pct);
    const id = (h >>> 0).toString(16).padStart(8, "0");
    const tag = index === 0 ? "Pool" : index === 1 ? "Dev" : "Holder";
    return { wallet: `${id.slice(0, 4)}…${id.slice(4, 8)}.near`, pct, tag };
  });
}

function bookUsd(book: Record<string, number>) {
  let total = 0;
  for (const token of TOKENS) total += (book[token.symbol] ?? 0) * token.price;
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
