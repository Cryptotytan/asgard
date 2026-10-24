import { TOKENS, type Token } from "@/lib/market";

export const LABELS = ["Smart", "Whale", "Friend", "Insider", "Dev", "KOL", "Sniper"] as const;
export type Label = (typeof LABELS)[number];
export type AlertOn = "all" | "buys" | "sells";
export type NotifyVia = "toast" | "telegram" | "off";

export type TrackedWallet = {
  id: string;
  address: string;
  name: string;
  alert: AlertOn;
  notify: NotifyVia;
  sound: string;
  minUsd: number;
  folder: string;
  labels: Label[];
  note: string;
  muted: boolean;
};

export type TrackerState = {
  wallets: TrackedWallet[];
  tokens: string[];
  folders: string[];
};

export const EMPTY_TRACKER: TrackerState = { wallets: [], tokens: [], folders: [] };

export function readTracker(accountId: string): TrackerState {
  if (typeof window === "undefined") return EMPTY_TRACKER;
  try {
    const raw = localStorage.getItem(`asgard-tracker:${accountId}`);
    if (!raw) return EMPTY_TRACKER;
    const parsed = JSON.parse(raw) as Partial<TrackerState>;
    return {
      wallets: Array.isArray(parsed.wallets) ? parsed.wallets.slice(0, 100) : [],
      tokens: Array.isArray(parsed.tokens) ? parsed.tokens.filter((item) => typeof item === "string").slice(0, 100) : [],
      folders: Array.isArray(parsed.folders) ? parsed.folders.filter((item) => typeof item === "string") : [],
    };
  } catch {
    return EMPTY_TRACKER;
  }
}

export function writeTracker(accountId: string, state: TrackerState) {
  localStorage.setItem(`asgard-tracker:${accountId}`, JSON.stringify(state));
}

export function nearProblem(address: string, kind: "named" | "implicit") {
  const value = address.trim().toLowerCase();
  if (!value) return "Enter a NEAR account";
  const implicit = /^[0-9a-f]{64}$/.test(value);
  const named = value.length >= 2 && value.length <= 64 && /^(([a-z\d]+[-_])*[a-z\d]+)(\.([a-z\d]+[-_])*[a-z\d]+)*$/.test(value);
  if (kind === "implicit" && !implicit) return "This doesn't look like an implicit NEAR account";
  if (kind === "named" && implicit) return "That is an implicit account. Switch the account type.";
  if (kind === "named" && (value.startsWith("0x") || !named || !value.includes("."))) return "This doesn't look like a NEAR account";
  return "";
}

function hash(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return h >>> 0;
}

function unit(seed: string, salt: number) {
  const x = Math.sin(hash(seed) * 0.00013 + salt * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function walletStats(wallet: TrackedWallet) {
  const pnl = (unit(wallet.address, 1) - 0.42) * 86;
  const win = 38 + unit(wallet.address, 2) * 62;
  const trades = 6 + Math.floor(unit(wallet.address, 3) * 70);
  const value = 8 + unit(wallet.address, 4) * 940;
  const agos = ["4m ago", "18m ago", "2h ago", "21h ago", "2d ago"];
  return { pnl, win, trades, value, ago: agos[Math.floor(unit(wallet.address, 5) * agos.length)] ?? "21h ago" };
}

export function holdingsOf(wallet: TrackedWallet) {
  const book = [...TOKENS].sort((a, b) => unit(wallet.address + a.symbol, 2) - unit(wallet.address + b.symbol, 2)).slice(0, 8);
  const raw = book.map((token, index) => {
    const usd = (1 - index * 0.11) * (4 + unit(wallet.address, index + 3) * 40);
    return { token, amount: usd / Math.max(token.price, 0.00001), usd, spam: usd < 0.08 };
  });
  const total = raw.reduce((sum, row) => sum + row.usd, 0) || 1;
  return raw.map((row) => ({ ...row, share: (row.usd / total) * 100 }));
}

export function seriesOf(wallet: TrackedWallet, points: number) {
  let value = 0;
  return Array.from({ length: points }, (_, index) => {
    value += (unit(wallet.address, index + 8) - 0.46) * 1.4;
    if (index > points * 0.72) value += 0.85;
    return value;
  });
}

export function heatOf(wallet: TrackedWallet) {
  return Array.from({ length: 7 * 18 }, (_, index) => unit(wallet.address, index + 40));
}

export type Fill = {
  id: string;
  walletId: string;
  side: "buy" | "sell";
  token: Token;
  amount: number;
  usd: number;
  price: number;
  ago: string;
};

const AGOS = ["1m ago", "4m ago", "12m ago", "1h ago", "3h ago", "21h ago", "1d ago"];

export function fillsOf(wallets: TrackedWallet[]): Fill[] {
  const rows: Fill[] = [];
  for (const wallet of wallets) {
    for (let index = 0; index < 4; index += 1) {
      const token = TOKENS[Math.floor(unit(wallet.address, index + 9) * Math.min(TOKENS.length, 18))] ?? TOKENS[0];
      const side = unit(wallet.address, index + 2) > 0.45 ? "buy" : "sell";
      const usd = 0.4 + unit(wallet.address, index + 5) * 18;
      rows.push({
        id: `${wallet.id}-${index}`,
        walletId: wallet.id,
        side,
        token,
        amount: usd / Math.max(token.price, 0.00001),
        usd,
        price: token.price * (0.97 + unit(wallet.address, index) * 0.06),
        ago: AGOS[Math.floor(unit(wallet.address, index + 6) * AGOS.length)] ?? "1h ago",
      });
    }
  }
  return rows.sort((a, b) => AGOS.indexOf(a.ago) - AGOS.indexOf(b.ago));
}

export type ChainHolding = { symbol: string; amount: number; usd: number; share: number };
export type ChainFill = { id: string; symbol: string; incoming: boolean; amount: number; ago: string };
export type ChainWallet = { value: number; holdings: ChainHolding[]; trades: number; ago: string; fills: ChainFill[] };

const chainCache = new Map<string, ChainWallet>();

function agoFrom(ns: string) {
  const ms = Number(BigInt(ns) / 1_000_000n);
  const delta = Math.max(0, Date.now() - ms);
  const min = Math.round(delta / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function peekChain(address: string) {
  return chainCache.get(address.trim().toLowerCase()) ?? null;
}

export function loadChain(address: string) {
  const key = address.trim().toLowerCase();
  const cached = chainCache.get(key);
  if (cached) return Promise.resolve(cached);
  return fetchChain(key).then((row) => {
    chainCache.set(key, row);
    return row;
  });
}

async function fetchChain(account: string): Promise<ChainWallet> {
  const [accountRes, inventoryRes, txRes] = await Promise.all([
    fetch(`https://api.nearblocks.io/v1/account/${account}`),
    fetch(`https://api.nearblocks.io/v1/account/${account}/inventory`),
    fetch(`https://api.nearblocks.io/v1/account/${account}/ft-txns?per_page=25`),
  ]);
  const accountBody = accountRes.ok ? ((await accountRes.json()) as { account?: { amount?: string } }) : {};
  const inventoryBody = inventoryRes.ok ? ((await inventoryRes.json()) as { inventory?: { fts?: { amount?: string; ft_meta?: { symbol?: string; decimals?: number } }[] } }) : {};
  const txBody = txRes.ok ? ((await txRes.json()) as { txns?: { transaction_hash?: string; delta_amount?: string; block_timestamp?: string; ft?: { symbol?: string; decimals?: number } }[] }) : {};
  const near = Number(accountBody.account?.amount ?? "0") / 1e24;
  const nearPrice = TOKENS.find((token) => token.symbol === "NEAR")?.price ?? 0;
  const holdings: ChainHolding[] = [];
  if (near > 0) holdings.push({ symbol: "NEAR", amount: near, usd: near * nearPrice, share: 0 });
  for (const row of inventoryBody.inventory?.fts ?? []) {
    const symbol = row.ft_meta?.symbol || "FT";
    const decimals = row.ft_meta?.decimals ?? 0;
    const amount = Number(row.amount ?? "0") / 10 ** decimals;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const known = TOKENS.find((token) => token.symbol.toLowerCase() === symbol.toLowerCase());
    holdings.push({ symbol, amount, usd: known ? amount * known.price : 0, share: 0 });
  }
  const total = holdings.reduce((sum, row) => sum + row.usd, 0);
  for (const row of holdings) row.share = total > 0 ? (row.usd / total) * 100 : 0;
  holdings.sort((a, b) => b.usd - a.usd || b.amount - a.amount);
  const fills: ChainFill[] = (txBody.txns ?? []).slice(0, 20).map((tx, index) => {
    const decimals = tx.ft?.decimals ?? 0;
    const raw = tx.delta_amount ?? "0";
    const amount = Number(raw.replace("-", "")) / 10 ** decimals;
    return {
      id: tx.transaction_hash ?? `${index}`,
      symbol: tx.ft?.symbol || "FT",
      incoming: !raw.startsWith("-"),
      amount: Number.isFinite(amount) ? amount : 0,
      ago: tx.block_timestamp ? agoFrom(tx.block_timestamp) : "—",
    };
  });
  return { value: total, holdings: holdings.slice(0, 12), trades: txBody.txns?.length ?? 0, ago: fills[0]?.ago ?? "—", fills };
}

