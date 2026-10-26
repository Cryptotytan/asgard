import { TOKENS, type Token } from "@/lib/market";

export const LABELS = ["Smart", "Whale", "Friend", "Insider", "Dev", "KOL", "Sniper"] as const;
export type Label = (typeof LABELS)[number];
export type AlertOn = "all" | "buys" | "sells";
export type NotifyVia = "toast" | "off";

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
      wallets: Array.isArray(parsed.wallets)
        ? parsed.wallets.slice(0, 100).map((wallet) => {
            const notify = String(wallet.notify) === "off" ? "off" : "toast";
            return { ...wallet, notify } satisfies TrackedWallet;
          })
        : [],
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
export type ChainFill = { id: string; symbol: string; incoming: boolean; amount: number; ago: string; kind: string; detail: string; time: number };
export type ChainWallet = { value: number; usdt: number; holdings: ChainHolding[]; trades: number; ago: string; fills: ChainFill[] };

const chainCache = new Map<string, ChainWallet>();
const inflight = new Map<string, Promise<ChainWallet>>();
const listeners = new Set<() => void>();

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

function remember(key: string, row: ChainWallet) {
  chainCache.set(key, row);
  try {
    sessionStorage.setItem(`asgard-chain:${key}`, JSON.stringify(row));
  } catch {
    /* private mode */
  }
  for (const listener of listeners) listener();
}

export function subscribeChain(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function peekChain(address: string) {
  const key = address.trim().toLowerCase();
  const cached = chainCache.get(key);
  if (cached) return cached;
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`asgard-chain:${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChainWallet;
    if (!parsed || !Array.isArray(parsed.holdings)) return null;
    chainCache.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function loadChain(address: string) {
  const key = address.trim().toLowerCase();
  const cached = peekChain(key);
  if (cached) {
    void refreshChain(key);
    return Promise.resolve(cached);
  }
  return refreshChain(key);
}

export function refreshChain(address: string) {
  const key = address.trim().toLowerCase();
  const pending = inflight.get(key);
  if (pending) return pending;
  const job = fetchChain(key).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

function tokenPrice(symbol: string, contract?: string) {
  const base = symbol.split(".")[0]?.toUpperCase() ?? symbol.toUpperCase();
  if (base === "USDT" || base === "USDC" || base === "DAI" || base === "USN") return 1;
  const byAddress = contract
    ? TOKENS.find((token) => token.chain === "NEAR" && token.address?.toLowerCase() === contract.toLowerCase() && token.price > 0)
    : undefined;
  if (byAddress) return byAddress.price;
  const bySymbol =
    TOKENS.find((token) => token.chain === "NEAR" && token.symbol.toLowerCase() === symbol.toLowerCase() && token.price > 0) ??
    TOKENS.find((token) => token.symbol.split(".")[0]?.toUpperCase() === base && token.price > 0);
  return bySymbol?.price ?? 0;
}

function priced(holdings: ChainHolding[]) {
  const value = holdings.reduce((sum, row) => sum + row.usd, 0);
  const unit = tokenPrice("USDT") || 1;
  for (const row of holdings) row.share = value > 0 ? (row.usd / value) * 100 : 0;
  holdings.sort((a, b) => b.usd - a.usd || b.amount - a.amount);
  return { value, usdt: value / unit };
}

async function fetchChain(account: string): Promise<ChainWallet> {
  const accountJob = fetch(`https://api.nearblocks.io/v1/account/${account}`);
  const inventoryJob = fetch(`https://api.nearblocks.io/v1/account/${account}/inventory`);
  const txJob = fetch(`https://api.nearblocks.io/v1/account/${account}/txns?per_page=25`);
  const ftJob = fetch(`https://api.nearblocks.io/v1/account/${account}/ft-txns?per_page=25`);
  const nftJob = fetch(`https://api.nearblocks.io/v1/account/${account}/nft-txns?per_page=25`);
  const [accountRes, inventoryRes] = await Promise.all([accountJob, inventoryJob]);
  const accountBody = accountRes.ok ? ((await accountRes.json()) as { account?: { amount?: string }[] | { amount?: string } }) : {};
  const inventoryBody = inventoryRes.ok
    ? ((await inventoryRes.json()) as { inventory?: { fts?: { contract?: string; amount?: string; ft_meta?: { symbol?: string; decimals?: number; price?: number | string | null } }[] } })
    : {};
  const accountRow = Array.isArray(accountBody.account) ? accountBody.account[0] : accountBody.account;
  const near = Number(accountRow?.amount ?? "0") / 1e24;
  const holdings: ChainHolding[] = [];
  if (near > 0) holdings.push({ symbol: "NEAR", amount: near, usd: near * tokenPrice("NEAR"), share: 0 });
  for (const row of inventoryBody.inventory?.fts ?? []) {
    const symbol = row.ft_meta?.symbol || "FT";
    const decimals = row.ft_meta?.decimals ?? 0;
    const amount = Number(row.amount ?? "0") / 10 ** decimals;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const metaPrice = Number(row.ft_meta?.price);
    const price = tokenPrice(symbol, row.contract) || (Number.isFinite(metaPrice) && metaPrice > 0 ? metaPrice : 0);
    const known = TOKENS.find((token) => token.chain === "NEAR" && row.contract && token.address?.toLowerCase() === row.contract.toLowerCase());
    holdings.push({ symbol: known?.symbol || symbol, amount, usd: price > 0 ? amount * price : 0, share: 0 });
  }
  const money = priced(holdings);
  const previous = chainCache.get(account);
  const partial: ChainWallet = {
    ...money,
    holdings,
    trades: previous?.trades ?? 0,
    ago: previous?.ago ?? "…",
    fills: previous?.fills ?? [],
  };
  remember(account, partial);
  const [txRes, ftRes, nftRes] = await Promise.all([txJob, ftJob, nftJob]);
  const txBody = txRes.ok ? ((await txRes.json()) as { txns?: ReceiptTxn[] }) : {};
  const ftBody = ftRes.ok ? ((await ftRes.json()) as { txns?: FtTxn[] }) : {};
  const nftBody = nftRes.ok ? ((await nftRes.json()) as { txns?: NftTxn[] }) : {};
  const fills = mergeActivity(txBody.txns ?? [], ftBody.txns ?? [], nftBody.txns ?? []);
  const next: ChainWallet = { ...partial, holdings, trades: fills.length, ago: fills[0]?.ago ?? "—", fills };
  remember(account, next);
  return next;
}

type ReceiptTxn = { transaction_hash?: string; block_timestamp?: string; receiver_account_id?: string; predecessor_account_id?: string; actions?: { action?: string; method?: string }[] };
type FtTxn = { transaction_hash?: string; delta_amount?: string; block_timestamp?: string; ft?: { symbol?: string; decimals?: number }; cause?: string };
type NftTxn = { transaction_hash?: string; block_timestamp?: string; nft?: { token_id?: string }; token_id?: string; delta_amount?: string };

function actionKind(action?: string, method?: string) {
  if (action === "FUNCTION_CALL") return method || "Function call";
  if (action === "TRANSFER") return "NEAR transfer";
  if (action === "STAKE") return "Stake";
  if (action === "ADD_KEY") return "Add key";
  if (action === "DELETE_KEY") return "Delete key";
  if (action === "DEPLOY_CONTRACT") return "Deploy";
  if (action === "CREATE_ACCOUNT") return "Create account";
  return (action || "Transaction").replaceAll("_", " ").toLowerCase();
}

function stamp(ns?: string) {
  if (!ns) return 0;
  const ms = Number(BigInt(ns) / 1_000_000n);
  return Number.isFinite(ms) ? ms : 0;
}

function mergeActivity(txns: ReceiptTxn[], fts: FtTxn[], nfts: NftTxn[]): ChainFill[] {
  const rows: ChainFill[] = [];
  for (const tx of txns) {
    const action = tx.actions?.[0];
    const kind = actionKind(action?.action, action?.method);
    const time = stamp(tx.block_timestamp);
    rows.push({
      id: tx.transaction_hash || `${time}-${kind}`,
      symbol: action?.action === "TRANSFER" ? "NEAR" : action?.method || tx.receiver_account_id || "NEAR",
      incoming: false,
      amount: 0,
      ago: time ? agoFrom(tx.block_timestamp || "0") : "—",
      kind,
      detail: tx.receiver_account_id || tx.predecessor_account_id || "",
      time,
    });
  }
  for (const tx of fts) {
    const decimals = tx.ft?.decimals ?? 0;
    const raw = tx.delta_amount ?? "0";
    const amount = Number(raw.replace("-", "")) / 10 ** decimals;
    const incoming = !raw.startsWith("-");
    const time = stamp(tx.block_timestamp);
    rows.push({
      id: `${tx.transaction_hash ?? time}-ft-${tx.ft?.symbol ?? ""}`,
      symbol: tx.ft?.symbol || "FT",
      incoming,
      amount: Number.isFinite(amount) ? amount : 0,
      ago: time ? agoFrom(tx.block_timestamp || "0") : "—",
      kind: incoming ? "Token in" : "Token out",
      detail: tx.cause || "",
      time,
    });
  }
  for (const tx of nfts) {
    const time = stamp(tx.block_timestamp);
    const incoming = !String(tx.delta_amount ?? "").startsWith("-");
    rows.push({
      id: `${tx.transaction_hash ?? time}-nft`,
      symbol: tx.nft?.token_id || tx.token_id || "NFT",
      incoming,
      amount: 1,
      ago: time ? agoFrom(tx.block_timestamp || "0") : "—",
      kind: incoming ? "NFT in" : "NFT out",
      detail: "",
      time,
    });
  }
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    })
    .sort((a, b) => b.time - a.time)
    .slice(0, 40);
}

