import { useEffect, useState } from "react";
import { CHAINS_META, chainByLabel } from "@/lib/chains";
import { TOKENS } from "@/lib/market";
import { useDesk } from "@/lib/store";
import type { LinkedWallet } from "@/lib/foreign-wallet";

const cache = new Map<string, Record<string, number>>();
const inflight = new Map<string, Promise<Record<string, number>>>();

export function holdingOf(id: "near" | "evm" | "sol" | "btc", address: string, symbol: string) {
  if (id === "near") return useDesk.getState().chain[symbol] ?? useDesk.getState().balances[symbol] ?? 0;
  return cache.get(`${id}:${address.toLowerCase()}`)?.[symbol] ?? 0;
}

export function creditHolding(id: "near" | "evm" | "sol" | "btc", address: string, symbol: string, amount: number) {
  if (!(amount > 0) || !symbol) return;
  if (id === "near") {
    const state = useDesk.getState();
    useDesk.setState({
      balances: { ...state.balances, [symbol]: (state.balances[symbol] ?? 0) + amount },
      chain: { ...state.chain, [symbol]: (state.chain[symbol] ?? 0) + amount },
      clock: state.clock + 1,
    });
    return;
  }
  const key = `${id}:${address.toLowerCase()}`;
  const current = cache.get(key) ?? {};
  cache.set(key, { ...current, [symbol]: (current[symbol] ?? 0) + amount });
  useDesk.setState({ clock: useDesk.getState().clock + 1 });
}

export async function refreshBalances(wallets: LinkedWallet[]) {
  const seen = new Set<string>();
  await Promise.all(
    wallets.map(async (wallet) => {
      const key = `${wallet.id}:${wallet.address.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      cache.delete(key);
      inflight.delete(key);
      if (wallet.id === "near") {
        const { syncWallet } = await import("@/lib/near-wallet");
        await syncWallet(wallet.address).catch(() => undefined);
      }
    }),
  );
  useDesk.setState({ clock: useDesk.getState().clock + 1 });
}

export function useHoldings(wallet: LinkedWallet | null) {
  const chain = useDesk((state) => state.chain);
  const clock = useDesk((state) => state.clock);
  const [book, setBook] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!wallet) {
      setBook({});
      setLoading(false);
      return;
    }
    if (wallet.id === "near") {
      const next: Record<string, number> = {};
      for (const token of TOKENS) {
        if (token.chain !== "NEAR") continue;
        const amount = chain[token.symbol] ?? 0;
        if (amount > 0) next[token.symbol] = amount;
      }
      setBook(next);
      setLoading(false);
      return;
    }
    let cancel = false;
    setLoading(true);
    void loadHoldings(wallet.id, wallet.address).then((next) => {
      if (cancel) return;
      setBook(next);
      setLoading(false);
    });
    return () => {
      cancel = true;
    };
  }, [wallet?.id, wallet?.address, clock, chain]);

  return { book, loading };
}

async function loadHoldings(id: "evm" | "sol" | "btc", address: string) {
  const key = `${id}:${address.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = inflight.get(key);
  if (pending) return pending;
  const job = (id === "evm" ? evmBook(address) : id === "sol" ? solBook(address) : btcBook(address))
    .then((book) => {
      cache.set(key, book);
      inflight.delete(key);
      return book;
    })
    .catch(() => {
      inflight.delete(key);
      return {} as Record<string, number>;
    });
  inflight.set(key, job);
  return job;
}

function listed(kind: "evm" | "sol" | "btc") {
  return TOKENS.filter((token) => token.listed && token.price > 0 && chainByLabel(token.chain)?.kind === kind);
}

async function evmBook(address: string) {
  const book: Record<string, number> = {};
  const tokens = listed("evm");
  await Promise.all(
    CHAINS_META.filter((chain) => chain.kind === "evm" && chain.rpc).map(async (chain) => {
      const mine = tokens.filter((token) => token.chain === chain.label);
      if (!mine.length) return;
      const native = mine.filter((token) => !/^0x[a-fA-F0-9]{40}$/.test(token.address ?? "")).sort((a, b) => b.price - a.price)[0];
      const erc20 = mine.filter((token) => /^0x[a-fA-F0-9]{40}$/.test(token.address ?? "") && token.decimals != null);
      const [gas, balances] = await Promise.all([
        native ? ethBalance(chain.rpc!, address) : Promise.resolve(0n),
        mapPool(erc20, 6, (token) => tokenBalance(chain.rpc!, token.address!, address)),
      ]);
      if (native && gas > 0n) {
        const amount = Number(gas) / 10 ** (native.decimals ?? 18);
        if (amount > 0) book[native.symbol] = (book[native.symbol] ?? 0) + amount;
      }
      erc20.forEach((token, index) => {
        const raw = balances[index];
        if (!raw || raw <= 0n || token.decimals == null) return;
        const amount = Number(raw) / 10 ** token.decimals;
        if (amount > 0) book[token.symbol] = amount;
      });
    }),
  );
  return book;
}

async function solBook(address: string) {
  const book: Record<string, number> = {};
  const tokens = listed("sol");
  const body = async (method: string, params: unknown[]) => {
    const response = await fetch("https://api.mainnet-beta.solana.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!response.ok) return null;
    return (await response.json()) as { result?: { value?: unknown } };
  };
  const native = tokens.filter((token) => !token.address || token.address.length < 32).sort((a, b) => b.price - a.price)[0];
  const lamports = await body("getBalance", [address]);
  const sol = Number((lamports?.result?.value as number | undefined) ?? 0) / 1e9;
  if (native && sol > 0) book[native.symbol] = sol;
  const programs = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
  const byMint = new Map(tokens.filter((token) => token.address && token.address.length >= 32).map((token) => [token.address!, token.symbol]));
  for (const program of programs) {
    const parsed = await body("getTokenAccountsByOwner", [address, { programId: program }, { encoding: "jsonParsed" }]);
    const rows = (parsed?.result?.value as { account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number } } } } } }[]) ?? [];
    for (const row of rows) {
      const info = row.account?.data?.parsed?.info;
      const symbol = info?.mint ? byMint.get(info.mint) : undefined;
      const amount = info?.tokenAmount?.uiAmount ?? 0;
      if (symbol && amount > 0) book[symbol] = (book[symbol] ?? 0) + amount;
    }
  }
  return book;
}

async function btcBook(address: string) {
  const book: Record<string, number> = {};
  const native = listed("btc").sort((a, b) => b.price - a.price)[0];
  const response = await fetch(`https://blockstream.info/api/address/${encodeURIComponent(address)}`);
  if (!response.ok || !native) return book;
  const body = (await response.json()) as { chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number } };
  const sats = (body.chain_stats?.funded_txo_sum ?? 0) - (body.chain_stats?.spent_txo_sum ?? 0);
  if (sats > 0) book[native.symbol] = sats / 1e8;
  return book;
}

async function ethBalance(rpc: string, address: string) {
  const value = await rpcCall(rpc, "eth_getBalance", [address, "latest"]);
  return hex(value);
}

async function tokenBalance(rpc: string, contract: string, address: string) {
  const data = `0x70a08231${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  const value = await rpcCall(rpc, "eth_call", [{ to: contract, data }, "latest"]);
  return hex(value);
}

async function rpcCall(rpc: string, method: string, params: unknown[]) {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).catch(() => null);
  if (!response?.ok) return "0x0";
  const body = (await response.json()) as { result?: string };
  return body.result ?? "0x0";
}

function hex(value: string) {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

async function mapPool<T>(items: T[], size: number, fn: (item: T) => Promise<bigint>) {
  const out = new Array<bigint>(items.length).fill(0n);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index]).catch(() => 0n);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}
