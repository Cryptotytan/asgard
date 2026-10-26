import { useSyncExternalStore } from "react";

export type TradeLog = {
  id: string;
  bucket: "order" | "trade" | "tx";
  symbol: string;
  title: string;
  detail: string;
  value: number;
  time: number;
  status: string;
  account: string;
};

const KEY = "asgard-trade-log";
const listeners = new Set<() => void>();
let rows: TradeLog[] = read();

function read(): TradeLog[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]") as TradeLog[];
    return Array.isArray(parsed) ? parsed.filter((row) => row && row.id && row.bucket && row.account) : [];
  } catch {
    return [];
  }
}

function emit() {
  for (const listener of listeners) listener();
}

export function logTrade(entry: Omit<TradeLog, "id" | "time" | "account"> & { account?: string | null; time?: number }) {
  if (!entry.account) return;
  const next: TradeLog = { ...entry, account: entry.account, time: entry.time ?? Date.now(), id: `${entry.bucket}-${entry.symbol}-${Date.now()}` };
  rows = [next, ...rows].slice(0, 200);
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(rows));
  emit();
}

export function useTradeLog() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => rows,
    () => rows,
  );
}
