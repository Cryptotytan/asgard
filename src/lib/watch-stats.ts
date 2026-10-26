import { TOKENS, money, type Token } from "@/lib/market";

type Pair = {
  baseToken?: { symbol?: string };
  priceUsd?: string;
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  marketCap?: number;
  fdv?: number;
  txns?: { h24?: { buys?: number; sells?: number } };
};

export async function refreshWatch(symbols: string[], onPaint: () => void) {
  const tokens = symbols
    .map((symbol) => TOKENS.find((token) => token.symbol.toUpperCase() === symbol.toUpperCase()))
    .filter((token): token is Token => Boolean(token));
  await Promise.all(tokens.map(async (token) => {
    const changed = await fillToken(token);
    if (changed) onPaint();
  }));
}

async function fillToken(token: Token) {
  let changed = false;
  const pair = await dexPair(token.symbol);
  if (pair) changed = paintDex(token, pair) || changed;
  if (!(token.volN > 0) || !(token.txnsN > 0) || token.change === 0) {
    const book = await binance(token.symbol);
    if (book) changed = paintBinance(token, book) || changed;
  }
  if (!(token.mcapN > 0)) {
    const cap = await geckoCap(token.symbol);
    if (cap > 0) {
      token.mcapN = cap;
      token.mcap = money(cap);
      changed = true;
    }
  }
  return changed;
}

function paintDex(token: Token, pair: Pair) {
  let changed = false;
  const liq = Number(pair.liquidity?.usd) || 0;
  const vol = Number(pair.volume?.h24) || 0;
  const cap = Number(pair.marketCap) || Number(pair.fdv) || 0;
  const buys = Number(pair.txns?.h24?.buys) || 0;
  const sells = Number(pair.txns?.h24?.sells) || 0;
  const change = Number(pair.priceChange?.h24);
  const price = Number(pair.priceUsd);
  if (liq > 0) {
    token.liqN = liq;
    token.liquidity = money(liq);
    changed = true;
  }
  if (vol > 0) {
    token.volN = vol;
    token.volume = money(vol);
    token.volBy = { ...token.volBy, h24: vol };
    changed = true;
  }
  if (cap > 0) {
    token.mcapN = cap;
    token.mcap = money(cap);
    changed = true;
  }
  if (buys + sells > 0) {
    token.txnsN = buys + sells;
    token.buys = buys;
    token.sells = sells;
    token.txns = token.txnsN.toLocaleString("en-US");
    changed = true;
  }
  if (Number.isFinite(change)) {
    token.change = change;
    token.windows = { ...token.windows, h24: change };
    changed = true;
  }
  if (price > 0) token.price = price;
  return changed;
}

function paintBinance(token: Token, row: { quoteVolume?: string; priceChangePercent?: string; count?: number; lastPrice?: string }) {
  let changed = false;
  const vol = Number(row.quoteVolume) || 0;
  const change = Number(row.priceChangePercent);
  const count = Number(row.count) || 0;
  const price = Number(row.lastPrice) || 0;
  if (!(token.volN > 0) && vol > 0) {
    token.volN = vol;
    token.volume = money(vol);
    token.volBy = { ...token.volBy, h24: vol };
    changed = true;
  }
  if (token.change === 0 && Number.isFinite(change)) {
    token.change = change;
    token.windows = { ...token.windows, h24: change };
    changed = true;
  }
  if (!(token.txnsN > 0) && count > 0) {
    token.txnsN = count;
    token.txns = count.toLocaleString("en-US");
    changed = true;
  }
  if (price > 0 && !(token.price > 0)) token.price = price;
  return changed;
}

async function dexPair(symbol: string) {
  const response = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(symbol)}`).catch(() => null);
  if (!response?.ok) return null;
  const body = (await response.json()) as { pairs?: Pair[] };
  const rows = (body.pairs ?? []).filter((pair) => pair.baseToken?.symbol?.toUpperCase() === symbol.toUpperCase());
  rows.sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0));
  return rows[0] ?? null;
}

async function binance(symbol: string) {
  const response = await fetch(`https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}USDT`).catch(() => null);
  if (!response?.ok) return null;
  return (await response.json()) as { quoteVolume?: string; priceChangePercent?: string; count?: number; lastPrice?: string };
}

async function geckoCap(symbol: string) {
  const search = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(symbol)}`).catch(() => null);
  if (!search?.ok) return 0;
  const found = (await search.json()) as { coins?: { id?: string; symbol?: string }[] };
  const id = found.coins?.find((coin) => coin.symbol?.toUpperCase() === symbol.toUpperCase())?.id;
  if (!id) return 0;
  const market = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(id)}`).catch(() => null);
  if (!market?.ok) return 0;
  const rows = (await market.json()) as { market_cap?: number }[];
  return Number(rows[0]?.market_cap) || 0;
}
