import { useEffect, useSyncExternalStore } from "react";

export type Watch = {
  recents: string[];
  hidden: string[];
  starred: string[];
};

const EMPTY: Watch = { recents: [], hidden: [], starred: [] };
const KEY = "asgard-markets";

let state: Watch = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function merge(current: string[], saved: string[]) {
  return [...current, ...saved.filter((item) => !current.includes(item))].slice(0, 30);
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<Watch>;
    state = {
      recents: merge(state.recents, strings(parsed.recents)),
      hidden: merge(state.hidden, strings(parsed.hidden)),
      starred: merge(state.starred, strings(parsed.starred)),
    };
    emit();
  } catch {
    /* ignore broken local cache */
  }
}

function write(next: Watch) {
  state = next;
  if (typeof window !== "undefined") localStorage.setItem(KEY, JSON.stringify(state));
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWatch() {
  const snap = useSyncExternalStore(subscribe, () => state, () => EMPTY);
  useEffect(() => {
    load();
  }, []);
  return snap;
}

export function visitToken(symbol: string) {
  write({ ...state, recents: [symbol, ...state.recents.filter((item) => item !== symbol)].slice(0, 30) });
}

export function toggleStar(symbol: string) {
  const starred = state.starred.includes(symbol) ? state.starred.filter((item) => item !== symbol) : [symbol, ...state.starred];
  write({ ...state, starred });
}

export function hideToken(symbol: string) {
  if (state.hidden.includes(symbol)) return;
  write({ ...state, hidden: [symbol, ...state.hidden] });
}
