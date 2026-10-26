import { coinIcon, knownLogo } from "@/lib/dex";
import { logoOf } from "@/lib/logo-book";
import { ensureToken, MARKETS, money, TOKENS, type PerpMarket } from "@/lib/market";
import { useDesk } from "@/lib/store";

type FuturesRow = {
  symbol?: string;
  display_symbol_name?: string;
  status?: string;
  mark_price?: number;
  "24h_open"?: number;
  "24h_close"?: number;
  "24h_amount"?: number;
};

const SEED = ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "TRX", "AVAX", "NEAR", "SUI", "DOT", "LTC", "APT", "HBAR", "LINK", "UNI", "AAVE", "CRV", "PENDLE", "ENA", "ETHFI", "HYPE", "ASTER", "ARB", "OP", "POL", "MNT", "MON", "XPL", "BERA", "S", "INJ", "TIA", "SEI", "JUP", "RAY", "CAKE", "WLD", "ZRO", "MERL", "ORDER", "ONDO", "TAO", "BIO", "LIT", "EDGE", "XMR", "ZEC", "FET", "VIRTUAL", "PUMP", "BASED", "TRUMP", "WIF", "PENGU", "FARTCOIN", "USELESS", "M", "SPX", "1000PEPE", "1000BONK", "WOO", "SPX500", "NAS100", "XAU", "XAG", "CL", "EURUSD", "USDJPY", "NVDA", "TSLA", "GOOGL", "PEPE"];

function marketOf(base: string, name = base): PerpMarket {
  return { id: `PERP_${base}_USDC`, base, label: `${base}-USD`, name, chain: "NEAR" };
}

function publish(market: PerpMarket, price = Number.NaN, change = 0, volume = 0) {
  const icon = logoOf(market.base) || knownLogo(market.base) || coinIcon(market.base) || undefined;
  let token = TOKENS.find((item) => item.chain === "NEAR" && item.symbol.split(".")[0].toUpperCase() === market.base);
  if (!token) {
    const bareFree = !TOKENS.some((item) => item.symbol.toUpperCase() === market.base);
    const symbol = bareFree ? market.base : `${market.base}.NEAR`;
    token = ensureToken({ symbol, name: market.name, price, chain: "NEAR", icon });
    if (token.notes.length === 1 && token.notes[0] === "DexScreener") token.notes = ["NEAR perp"];
  }
  const booked = logoOf(token.symbol);
  if (booked) token.icon = booked;
  if (!(token.price > 0) && price > 0) token.price = price;
  if (price > 0 && token.notes.includes("NEAR perp")) {
    if (!token.windows.h24) {
      token.change = change;
      token.windows = { ...token.windows, h24: change };
    }
    if (!(token.volN > 0) && volume > 0) {
      token.volN = volume;
      token.volume = money(volume);
    }
  }
}

let seeded = false;

export function seedPerpMarkets() {
  if (seeded) return;
  seeded = true;
  MARKETS.splice(0, MARKETS.length, ...SEED.map((base) => marketOf(base)));
  for (const market of MARKETS) publish(market);
}

export async function syncPerpMarkets() {
  seedPerpMarkets();
  const response = await fetch("https://api.orderly.org/v1/public/futures").catch(() => null);
  if (!response?.ok) return;
  const body = (await response.json()) as { data?: { rows?: FuturesRow[] } };
  const next: PerpMarket[] = [];
  for (const row of body.data?.rows ?? []) {
    const symbol = row.symbol ?? "";
    if (!/^PERP_[A-Z0-9]+_USDC$/.test(symbol) || (row.status && row.status !== "ACTIVE")) continue;
    const base = symbol.slice("PERP_".length, -"_USDC".length);
    const name = (row.display_symbol_name || base).replace(/\s*\(.*\)\s*$/, "") || base;
    const market = marketOf(base, name === base ? base : name);
    const open = Number(row["24h_open"]);
    const close = Number(row["24h_close"]);
    const change = open > 0 && close > 0 ? ((close - open) / open) * 100 : 0;
    next.push(market);
    publish(market, Number(row.mark_price), change, Number(row["24h_amount"]) || 0);
  }
  if (next.length) MARKETS.splice(0, MARKETS.length, ...next.sort((a, b) => a.base.localeCompare(b.base)));
  useDesk.setState((state) => ({ clock: state.clock + 1 }));
}

seedPerpMarkets();
