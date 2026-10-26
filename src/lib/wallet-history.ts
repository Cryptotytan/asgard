import { useSyncExternalStore } from "react";
import type { LinkedWallet } from "@/lib/foreign-wallet";

export type WalletTx = {
  id: string;
  wallet: string;
  address: string;
  chain: string;
  title: string;
  detail: string;
  hash: string;
  value: number;
  time: number;
};

const KEY = "asgard-wallet-history";
const listeners = new Set<() => void>();
let rows: WalletTx[] = read();

function read(): WalletTx[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]") as WalletTx[];
    return Array.isArray(parsed) ? parsed.filter((row) => row && row.id && row.title) : [];
  } catch {
    return [];
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function snapshot() {
  return rows;
}

export function useWalletHistory() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot,
    snapshot,
  );
}

export function rememberTx(entry: Omit<WalletTx, "id" | "time"> & { time?: number }) {
  const next: WalletTx = { ...entry, hash: entry.hash || "", time: entry.time ?? Date.now(), id: `${entry.hash || Date.now()}-${entry.address}` };
  rows = [next, ...rows.filter((row) => row.id !== next.id && (!next.hash || row.hash !== next.hash))].slice(0, 80);
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(rows));
  emit();
}

const EXPLORERS: { chain: string; host: string }[] = [
  { chain: "Ethereum", host: "https://eth.blockscout.com" },
  { chain: "Base", host: "https://base.blockscout.com" },
  { chain: "Arbitrum", host: "https://arbitrum.blockscout.com" },
  { chain: "Optimism", host: "https://optimism.blockscout.com" },
  { chain: "Polygon", host: "https://polygon.blockscout.com" },
  { chain: "Gnosis", host: "https://gnosis.blockscout.com" },
  { chain: "Scroll", host: "https://scroll.blockscout.com" },
];

export async function loadChainHistory(wallets: LinkedWallet[]): Promise<WalletTx[]> {
  const jobs = wallets.flatMap((wallet) => {
    if (wallet.id === "near") return [nearHistory(wallet)];
    if (wallet.id === "sol") return [solHistory(wallet)];
    if (wallet.id === "btc") return [btcHistory(wallet)];
    if (wallet.id === "evm") return EXPLORERS.map((explorer) => evmHistory(wallet, explorer.chain, explorer.host));
    return [];
  });
  const found = await Promise.all(jobs);
  return found.flat();
}

async function nearHistory(wallet: LinkedWallet): Promise<WalletTx[]> {
  const response = await fetch(`https://api.nearblocks.io/v1/account/${encodeURIComponent(wallet.address)}/txns?per_page=8`).catch(() => null);
  if (!response?.ok) return [];
  const body = (await response.json()) as { txns?: { transaction_hash?: string; block_timestamp?: string; receiver_account_id?: string; actions?: { action?: string; method?: string }[] }[] };
  return (body.txns ?? []).map((tx) => {
    const action = tx.actions?.[0];
    const method = action?.method || action?.action || "Transaction";
    const nanos = Number(tx.block_timestamp);
    return {
      id: tx.transaction_hash || `${wallet.address}-${nanos}`,
      wallet: wallet.label,
      address: wallet.address,
      chain: "NEAR",
      title: method.replaceAll("_", " "),
      detail: tx.receiver_account_id || wallet.address,
      hash: tx.transaction_hash || "",
      value: 0,
      time: Number.isFinite(nanos) && nanos > 0 ? Math.floor(nanos / 1e6) : Date.now(),
    };
  });
}

async function evmHistory(wallet: LinkedWallet, chain: string, host: string): Promise<WalletTx[]> {
  const response = await fetch(`${host}/api/v2/addresses/${wallet.address}/transactions`).catch(() => null);
  if (!response?.ok) return [];
  const body = (await response.json()) as { items?: { hash?: string; timestamp?: string; method?: string; status?: string; to?: { hash?: string }; value?: string }[] };
  return (body.items ?? []).slice(0, 6).map((tx) => ({
    id: `${chain}:${tx.hash}`,
    wallet: wallet.label,
    address: wallet.address,
    chain,
    title: tx.method || (tx.status === "ok" ? "Transfer" : "Failed"),
    detail: tx.to?.hash || chain,
    hash: tx.hash || "",
    value: 0,
    time: tx.timestamp ? Date.parse(tx.timestamp) : Date.now(),
  }));
}

async function solHistory(wallet: LinkedWallet): Promise<WalletTx[]> {
  const response = await fetch("https://api.mainnet-beta.solana.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params: [wallet.address, { limit: 8 }] }),
  }).catch(() => null);
  if (!response?.ok) return [];
  const body = (await response.json()) as { result?: { signature?: string; blockTime?: number; err?: unknown }[] };
  return (body.result ?? []).map((tx) => ({
    id: tx.signature || "",
    wallet: wallet.label,
    address: wallet.address,
    chain: "Solana",
    title: tx.err ? "Failed" : "Transaction",
    detail: wallet.address,
    hash: tx.signature || "",
    value: 0,
    time: (tx.blockTime ?? 0) * 1000 || Date.now(),
  }));
}

async function btcHistory(wallet: LinkedWallet): Promise<WalletTx[]> {
  const response = await fetch(`https://mempool.space/api/address/${wallet.address}/txs`).catch(() => null);
  if (!response?.ok) return [];
  const body = (await response.json()) as { txid?: string; status?: { block_time?: number; confirmed?: boolean } }[];
  return (Array.isArray(body) ? body : []).slice(0, 8).map((tx) => ({
    id: tx.txid || "",
    wallet: wallet.label,
    address: wallet.address,
    chain: "Bitcoin",
    title: tx.status?.confirmed ? "Transaction" : "Unconfirmed",
    detail: wallet.address,
    hash: tx.txid || "",
    value: 0,
    time: (tx.status?.block_time ?? 0) * 1000 || Date.now(),
  }));
}
