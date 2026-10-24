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
