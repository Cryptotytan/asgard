import { useEffect, useState } from "react";
import { CHAINS_META, chainByLabel, chainRpcs } from "@/lib/chains";
import { TOKENS, ensureToken } from "@/lib/market";
import { useDesk } from "@/lib/store";
import { foreignWallets, type LinkedWallet } from "@/lib/foreign-wallet";

const cache = new Map<string, Record<string, number>>();
const lines = new Map<string, { chain: string; symbol: string; amount: number }[]>();
const inflight = new Map<string, Promise<Record<string, number>>>();

export function holdingOf(id: "near" | "evm" | "sol" | "btc", address: string, symbol: string) {
  if (id === "near") return useDesk.getState().chain[symbol] ?? useDesk.getState().balances[symbol] ?? 0;
  return cache.get(`${id}:${address.toLowerCase()}`)?.[symbol] ?? 0;
}

const pendingForeign = new Map<string, { target: number; line: number; dir: 1 | -1; until: number; chain: string }>();

function overlayForeign(key: string, book: Record<string, number>) {
  const now = Date.now();
  for (const [id, item] of pendingForeign) {
    if (!id.startsWith(`${key}:`)) continue;
    if (item.until < now) {
      pendingForeign.delete(id);
      continue;
    }
    const symbol = id.slice(key.length + 1);
    const got = book[symbol] ?? 0;
    if (item.dir > 0) {
      if (got + 1e-8 >= item.target * 0.8 && got > 0) pendingForeign.delete(id);
      else if (item.target > got) book[symbol] = item.target;
    } else if (got <= item.target + 1e-8) {
      pendingForeign.delete(id);
    } else {
      book[symbol] = item.target;
    }
  }
  return book;
}

export function expectHolding(chainLabel: string, symbol: string, delta: number) {
  const chain = chainByLabel(chainLabel);
  if (!chain || chain.kind === "near" || chain.kind === "other" || !symbol || !Number.isFinite(delta) || delta === 0) return;
  const wallets = foreignWallets();
  const address = chain.kind === "evm" ? wallets.evm : chain.kind === "sol" ? wallets.sol : wallets.btc;
  if (!address) return;
  const key = `${chain.kind}:${address.toLowerCase()}`;
  const existing = { ...(cache.get(key) ?? {}) };
  const lineNow = (lines.get(key) ?? []).find((row) => row.symbol === symbol && row.chain === chainLabel)?.amount ?? 0;
  const lineNext = Math.max(0, lineNow + delta);
  const rest = Math.max(0, (existing[symbol] ?? 0) - lineNow);
  const total = rest + lineNext;
  const book = overlayForeign(key, { ...existing, [symbol]: total });
  book[symbol] = total;
  pendingForeign.set(`${key}:${symbol}`, { target: total, line: lineNext, dir: delta > 0 ? 1 : -1, until: Date.now() + 180_000, chain: chainLabel });
  cache.set(key, book);
  writeLine(key, chainLabel, symbol, lineNext);
  notifyHoldings(key);
  useDesk.setState({ clock: useDesk.getState().clock + 1 });
  const kind: "evm" | "sol" | "btc" = chain.kind === "sol" ? "sol" : chain.kind === "btc" ? "btc" : "evm";
  const pull = () => {
    inflight.delete(key);
    void loadHoldings(kind, address, true).then(() => notifyHoldings(key));
  };
  for (const delay of [2500, 7000, 16000, 32000]) window.setTimeout(pull, delay);
}

export function creditHolding(id: "near" | "evm" | "sol" | "btc", address: string, symbol: string, amount: number, chain = "") {
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
  const next = (current[symbol] ?? 0) + amount;
  cache.set(key, { ...current, [symbol]: next });
  writeLine(key, chain, symbol, next);
  notifyHoldings(key);
  useDesk.setState({ clock: useDesk.getState().clock + 1 });
}

export async function refreshBalances(wallets: LinkedWallet[]) {
  const seen = new Set<string>();
  await Promise.all(
    wallets.map(async (wallet) => {
      const key = `${wallet.id}:${wallet.address.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      inflight.delete(key);
      if (wallet.id === "near") {
        const { syncWallet } = await import("@/lib/near-wallet");
        await syncWallet(wallet.address, [], true).catch(() => undefined);
      } else {
        const next = await loadHoldings(wallet.id, wallet.address, true).catch(() => cache.get(key) ?? {});
        if (Object.keys(next).length) cache.set(key, next);
        notifyHoldings(key);
      }
    }),
  );
  useDesk.setState({ clock: useDesk.getState().clock + 1 });
}

const FOREIGN_CACHE = "asgard-foreign-v1";
const listeners = new Set<(key: string) => void>();

function notifyHoldings(key: string) {
  for (const listener of listeners) listener(key);
}

function writeLine(key: string, chain: string, symbol: string, amount: number) {
  const rows = [...(lines.get(key) ?? [])];
  const index = rows.findIndex((row) => row.symbol === symbol && (row.chain === chain || !chain || !row.chain));
  if (amount <= 1e-8) {
    if (index >= 0) rows.splice(index, 1);
  } else if (index >= 0) rows[index] = { chain: chain || rows[index].chain, symbol, amount };
  else rows.push({ chain, symbol, amount });
  lines.set(key, rows);
}

function withPendingLines(key: string, rows: { chain: string; symbol: string; amount: number }[]) {
  const next = rows.map((row) => ({ ...row }));
  const now = Date.now();
  for (const [id, item] of pendingForeign) {
    if (!id.startsWith(`${key}:`) || item.until < now) continue;
    const symbol = id.slice(key.length + 1);
    const hit = next.find((row) => row.symbol === symbol && (!item.chain || !row.chain || row.chain === item.chain));
    if (item.dir > 0) {
      if (hit) {
        if (hit.amount + 1e-8 < item.line) hit.amount = item.line;
      } else if (item.line > 0) next.push({ chain: item.chain, symbol, amount: item.line });
    } else if (hit && hit.amount > item.line) hit.amount = item.line;
  }
  return next.filter((row) => row.amount > 1e-8);
}

function peekForeign(key: string) {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${FOREIGN_CACHE}:${key}`);
    if (!raw) return null;
    const book = JSON.parse(raw) as Record<string, number>;
    return book && typeof book === "object" ? book : null;
  } catch {
    return null;
  }
}

function storeForeign(key: string, book: Record<string, number>) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(`${FOREIGN_CACHE}:${key}`, JSON.stringify(book));
  } catch {
    /* private mode */
  }
}

export function useHoldings(wallet: LinkedWallet | null) {
  const chain = useDesk((state) => state.chain);
  const [book, setBook] = useState<Record<string, number>>({});
  const [rows, setRows] = useState<{ chain: string; symbol: string; amount: number }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!wallet || wallet.id !== "near") return;
    const next: Record<string, number> = {};
    for (const [symbol, amount] of Object.entries(chain)) {
      if (!(amount > 0)) continue;
      if (!TOKENS.some((token) => token.symbol === symbol)) ensureToken({ symbol, name: symbol, price: 0, chain: "NEAR" });
      next[symbol] = amount;
    }
    setBook(next);
    setRows(Object.entries(next).map(([symbol, amount]) => ({ chain: "NEAR", symbol, amount })));
    setLoading(false);
  }, [wallet?.id, wallet?.address, chain]);

  useEffect(() => {
    if (!wallet || wallet.id === "near") {
      if (!wallet) {
        setBook({});
        setRows([]);
        setLoading(false);
      }
      return;
    }
    const key = `${wallet.id}:${wallet.address.toLowerCase()}`;
    const saved = cache.get(key) ?? peekForeign(key);
    if (saved) {
      cache.set(key, saved);
      setBook(saved);
      setRows(lines.get(key) ?? []);
      setLoading(false);
    } else setLoading(true);
    let cancel = false;
    void loadHoldings(wallet.id, wallet.address, true).then((next) => {
      if (cancel) return;
      setBook(next);
      setRows(lines.get(key) ?? []);
      setLoading(false);
    });
    return () => {
      cancel = true;
    };
  }, [wallet?.id, wallet?.address]);

  useEffect(() => {
    if (!wallet || wallet.id === "near") return;
    const key = `${wallet.id}:${wallet.address.toLowerCase()}`;
    const listener = (updated: string) => {
      if (updated !== key) return;
      const next = cache.get(key);
      if (next) {
        setBook(next);
        setRows(lines.get(key) ?? []);
        setLoading(false);
      }
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [wallet?.id, wallet?.address]);

  return { book, rows, loading };
}

async function loadHoldings(id: "evm" | "sol" | "btc", address: string, fresh = false) {
  const key = `${id}:${address.toLowerCase()}`;
  if (!fresh) {
    const hit = cache.get(key);
    if (hit) return hit;
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  const job =
    id === "evm"
      ? evmFast(address, (book, parts) => {
          const shown = overlayForeign(key, { ...(cache.get(key) ?? {}), ...book });
          cache.set(key, shown);
          const seen = new Set(parts.map((row) => `${row.chain}:${row.symbol}`));
          const kept = (lines.get(key) ?? []).filter((row) => !seen.has(`${row.chain}:${row.symbol}`));
          lines.set(key, withPendingLines(key, [...parts, ...kept]));
          storeForeign(key, shown);
          notifyHoldings(key);
        }).then((book) => {
          const shown = overlayForeign(key, { ...(cache.get(key) ?? {}), ...book });
          cache.set(key, shown);
          storeForeign(key, shown);
          inflight.delete(key);
          notifyHoldings(key);
          void stampPrices(shown);
          return shown;
        })
      : (id === "sol" ? solBook(address) : btcBook(address))
          .then((book) => {
            const previous = cache.get(key) ?? {};
            const shown = overlayForeign(key, Object.keys(book).length ? { ...previous, ...book } : previous);
            cache.set(key, shown);
            const chain = id === "sol" ? "Solana" : "Bitcoin";
            lines.set(
              key,
              withPendingLines(
                key,
                Object.entries(shown)
                  .filter(([, amount]) => amount > 0)
                  .map(([symbol, amount]) => ({ chain, symbol, amount })),
              ),
            );
            storeForeign(key, shown);
            inflight.delete(key);
            notifyHoldings(key);
            void stampPrices(shown);
            return shown;
          })
          .catch(() => {
            inflight.delete(key);
            return cache.get(key) ?? {};
          });
  inflight.set(key, job);
  if (id === "evm") {
    void evmRest(address).then((full) => {
      const current = { ...(cache.get(key) ?? {}) };
      for (const row of full) {
        if (row.amount > 0) current[row.symbol] = Math.max(current[row.symbol] ?? 0, row.amount);
      }
      const next = overlayForeign(key, current);
      cache.set(key, next);
      const rows = [...(lines.get(key) ?? [])];
      for (const row of full) {
        const hit = rows.find((line) => line.chain === row.chain && line.symbol === row.symbol);
        if (hit) hit.amount = Math.max(hit.amount, row.amount);
        else rows.push({ chain: row.chain, symbol: row.symbol, amount: row.amount });
      }
      lines.set(key, withPendingLines(key, rows));
      storeForeign(key, next);
      notifyHoldings(key);
      void stampPrices(next);
    });
  }
  return job;
}

function listed(kind: "evm" | "sol" | "btc") {
  return TOKENS.filter((token) => token.listed && chainByLabel(token.chain)?.kind === kind);
}

const EVM_STABLES: Record<string, { symbol: string; address: string; decimals: number }[]> = {
  Ethereum: [
    { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
  ],
  Base: [
    { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
    { symbol: "USDT", address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", decimals: 6 },
  ],
  Arbitrum: [
    { symbol: "USDC", address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6 },
    { symbol: "USDT", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6 },
  ],
  Optimism: [
    { symbol: "USDC", address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6 },
    { symbol: "USDT", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6 },
  ],
  Polygon: [
    { symbol: "USDC", address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
    { symbol: "USDT", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
  ],
  BNB: [
    { symbol: "USDT", address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
    { symbol: "USDC", address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18 },
  ],
  Avalanche: [
    { symbol: "USDC", address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6 },
    { symbol: "USDT", address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: 6 },
  ],
};

const NATIVE_SYMBOL: Record<string, string> = {
  Ethereum: "ETH",
  Base: "ETH",
  Arbitrum: "ETH",
  Optimism: "ETH",
  BNB: "BNB",
  Polygon: "POL",
  Avalanche: "AVAX",
  Gnosis: "XDAI",
  Scroll: "ETH",
  Aurora: "ETH",
};

async function readEvm(address: string, chains: typeof CHAINS_META, stablesOnly: boolean) {
  const book: Record<string, number> = {};
  const tokens = stablesOnly ? [] : listed("evm");
  await Promise.all(
    chains.map(async (chain) => {
      const mine = tokens.filter((token) => token.chain === chain.label);
      const native = mine.filter((token) => !/^0x[a-fA-F0-9]{40}$/.test(token.address ?? "")).sort((a, b) => b.price - a.price)[0];
      const forced = EVM_STABLES[chain.label] ?? [];
  const erc20: { address?: string; decimals?: number; symbol: string }[] = stablesOnly
    ? forced
    : mine.filter((token) => /^0x[a-fA-F0-9]{40}$/.test(token.address ?? "") && token.decimals != null && !forced.some((item) => item.address.toLowerCase() === token.address?.toLowerCase()));
      const rpcs = chainRpcs(chain);
      const [gas, balances] = await Promise.all([
        stablesOnly ? ethBalance(rpcs, address) : Promise.resolve(0n),
        erc20.length ? mapPool(erc20, 6, (token) => tokenBalance(rpcs, token.address!, address)) : Promise.resolve([]),
      ]);
      if (gas > 0n) {
        const symbol = native?.symbol || NATIVE_SYMBOL[chain.label] || "";
        if (symbol) {
          book[symbol] = (book[symbol] ?? 0) + Number(gas) / 10 ** (native?.decimals ?? 18);
          if (!native) ensureToken({ symbol, name: symbol, price: 0, chain: chain.label }).listed = true;
        }
      }
      erc20.forEach((token, index) => {
        const raw = balances[index];
        if (!raw || raw <= 0n || token.decimals == null) return;
        const amount = Number(raw) / 10 ** token.decimals;
        if (amount > 0) book[token.symbol] = (book[token.symbol] ?? 0) + amount;
      });
    }),
  );
  return book;
}

function evmFast(address: string, onPart?: (book: Record<string, number>, parts: { chain: string; symbol: string; amount: number }[]) => void) {
  const chains = CHAINS_META.filter((chain) => chain.kind === "evm" && chain.rpc && (EVM_STABLES[chain.label] || NATIVE_SYMBOL[chain.label]));
  const parts = new Map<string, Record<string, number>>();
  const publish = () => {
    const book: Record<string, number> = {};
    for (const part of parts.values()) {
      for (const [symbol, amount] of Object.entries(part)) {
        if (amount > 0) book[symbol] = (book[symbol] ?? 0) + amount;
      }
    }
    const rows = [...parts.entries()].flatMap(([chain, part]) =>
      Object.entries(part)
        .filter(([, amount]) => amount > 0)
        .map(([symbol, amount]) => ({ chain, symbol, amount })),
    );
    if (Object.keys(book).length) onPart?.(book, rows);
    return book;
  };
  return Promise.all(
    chains.map(async (chain) => {
      const part = await readChainFast(chain, address);
      parts.set(chain.label, part);
      publish();
    }),
  ).then(() => {
    const book: Record<string, number> = {};
    for (const part of parts.values()) {
      for (const [symbol, amount] of Object.entries(part)) {
        if (amount > 0) book[symbol] = (book[symbol] ?? 0) + amount;
      }
    }
    return overlayForeign(`evm:${address.toLowerCase()}`, book);
  });
}

async function readChainFast(chain: (typeof CHAINS_META)[number], address: string) {
  const book: Record<string, number> = {};
  const forced = EVM_STABLES[chain.label] ?? [];
  const data = `0x70a08231${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  const calls = [
    { method: "eth_getBalance", params: [address, "latest"] },
    ...forced.map((token) => ({ method: "eth_call", params: [{ to: token.address, data }, "latest"] })),
  ];
  const results = await rpcRace(chainRpcs(chain), calls);
  const gas = hex(results[0] ?? "0x0");
  if (gas > 0n) {
    const symbol = NATIVE_SYMBOL[chain.label] || "";
    if (symbol) {
      book[symbol] = Number(gas) / 1e18;
      ensureToken({ symbol, name: symbol, price: 0, chain: chain.label }).listed = true;
    }
  }
  forced.forEach((token, index) => {
    const raw = hex(results[index + 1] ?? "0x0");
    if (raw <= 0n) return;
    const amount = Number(raw) / 10 ** token.decimals;
    if (amount > 0) book[token.symbol] = (book[token.symbol] ?? 0) + amount;
  });
  return book;
}

async function rpcRace(rpcs: string[], calls: { method: string; params: unknown[] }[]) {
  const body = JSON.stringify(calls.map((call, id) => ({ jsonrpc: "2.0", id, method: call.method, params: call.params })));
  const jobs = rpcs.filter(Boolean).map(async (rpc) => {
    const response = await fetch(rpc, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(2200),
    });
    if (!response.ok) throw new Error("rpc");
    const parsed = (await response.json()) as { id?: number; result?: string } | { id?: number; result?: string }[];
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    if (!rows.some((row) => typeof row.result === "string")) throw new Error("empty");
    return calls.map((_, index) => rows.find((row) => row.id === index)?.result ?? rows[index]?.result ?? "0x0");
  });
  if (!jobs.length) return calls.map(() => "0x0");
  try {
    return await Promise.any(jobs);
  } catch {
    return calls.map(() => "0x0");
  }
}

async function evmRest(address: string) {
  const [extra, explored] = await Promise.all([
    readEvm(
      address,
      CHAINS_META.filter((chain) => chain.kind === "evm" && chain.rpc),
      false,
    ),
    readExplorers(address),
  ]);
  const rows = explored.map((row) => ({ chain: row.chain, symbol: row.symbol, amount: row.amount, price: row.price }));
  for (const [symbol, amount] of Object.entries(extra)) {
    if (amount > 0 && !rows.some((row) => row.symbol === symbol)) rows.push({ chain: "", symbol, amount, price: 0 });
  }
  for (const row of explored) {
    const token = TOKENS.find((item) => item.symbol === row.symbol && item.chain === row.chain) ?? ensureToken({ symbol: row.symbol, name: row.name, price: row.price, chain: row.chain, address: row.address, icon: row.icon });
    token.listed = true;
    if (row.decimals) token.decimals = row.decimals;
    if (row.price > 0) token.price = row.price;
  }
  return rows;
}

const EXPLORERS: Record<string, string> = {
  Ethereum: "https://eth.blockscout.com",
  Base: "https://base.blockscout.com",
  Optimism: "https://optimism.blockscout.com",
  Arbitrum: "https://arbitrum.blockscout.com",
  Polygon: "https://polygon.blockscout.com",
  Gnosis: "https://gnosis.blockscout.com",
  Scroll: "https://scroll.blockscout.com",
  BNB: "https://bsc.blockscout.com",
};

const KNOWN_STABLE = new Set(
  Object.values(EVM_STABLES)
    .flat()
    .map((item) => item.address.toLowerCase()),
);

async function readExplorers(address: string): Promise<{ symbol: string; amount: number; price: number; chain: string; address: string; name: string; decimals: number; icon: string }[]> {
  const rows = await Promise.all(
    Object.entries(EXPLORERS).map(async ([chain, host]) => {
      const response = await fetch(`${host}/api/v2/addresses/${address}/token-balances`, { signal: AbortSignal.timeout(3500) }).catch(() => null);
      if (!response?.ok) return [];
      const body = (await response.json().catch(() => null)) as ExplorerRow[] | null;
      if (!Array.isArray(body)) return [];
      return body.flatMap((row) => {
        const token = row.token;
        const reputation = (token?.reputation || "").toLowerCase();
        if (reputation === "spam" || reputation === "scam") return [];
        const decimals = Number(token?.decimals);
        const raw = row.value ?? "0";
        if (!token?.symbol || !(decimals >= 0) || !/^\d+$/.test(raw) || raw === "0") return [];
        const amount = Number(raw) / 10 ** decimals;
        if (!Number.isFinite(amount) || amount <= 0) return [];
        const rate = Number(token.exchange_rate) || 0;
        const address = token.address_hash || "";
        const stable = KNOWN_STABLE.has(address.toLowerCase());
        const price = stable ? 1 : rate;
        if (!(price > 0) || amount * price < 0.01) return [];
        const symbol = token.symbol.replace(/\s/g, "");
        return [{ symbol, amount, price, chain, address, name: token.name || symbol, decimals, icon: token.icon_url || "" }];
      });
    }),
  );
  return rows.flat();
}

type ExplorerRow = {
  value?: string;
  token?: { address_hash?: string; decimals?: string; exchange_rate?: string; symbol?: string; name?: string; reputation?: string; icon_url?: string };
};

async function solBook(address: string) {
  const book: Record<string, number> = {};
  const tokens = listed("sol");
  const rpcs = ["https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com", "https://solana.drpc.org"];
  let rpcOk = false;
  const body = async (method: string, params: unknown[]) => {
    for (const rpc of rpcs) {
      const response = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(2500),
      }).catch(() => null);
      if (!response?.ok) continue;
      const parsed = (await response.json()) as { result?: { value?: unknown }; error?: unknown };
      if (parsed.error || parsed.result == null) continue;
      rpcOk = true;
      return parsed;
    }
    return null;
  };
  const native = tokens.filter((token) => token.symbol.split(".")[0]?.toUpperCase() === "SOL").sort((a, b) => b.price - a.price)[0];
  const lamports = await body("getBalance", [address]);
  const sol = Number((lamports?.result?.value as number | undefined) ?? 0) / 1e9;
  if (sol > 0) {
    const symbol = native?.symbol || "SOL";
    if (!native) {
      const created = ensureToken({ symbol: "SOL", name: "Solana", price: 0, chain: "Solana", address: "So11111111111111111111111111111111111111112" });
      created.decimals = 9;
      created.listed = true;
    }
    book[symbol] = sol;
  }
  const programs = ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"];
  const byMint = new Map(tokens.filter((token) => token.address && token.address.length >= 32).map((token) => [token.address!, token.symbol]));
  byMint.set("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "USDC");
  byMint.set("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "USDT");
  const unknown = new Map<string, number>();
  for (const program of programs) {
    const parsed = await body("getTokenAccountsByOwner", [address, { programId: program }, { encoding: "jsonParsed" }]);
    const rows = (parsed?.result?.value as { account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number; uiAmountString?: string } } } } } }[]) ?? [];
    for (const row of rows) {
      const info = row.account?.data?.parsed?.info;
      const amount = info?.tokenAmount?.uiAmount ?? Number(info?.tokenAmount?.uiAmountString ?? 0);
      if (!info?.mint || !(amount > 0)) continue;
      const symbol = byMint.get(info.mint);
      if (symbol) book[symbol] = (book[symbol] ?? 0) + amount;
      else unknown.set(info.mint, (unknown.get(info.mint) ?? 0) + amount);
    }
  }
  if (!rpcOk) throw new Error("Solana RPC unavailable");
  const mints = [...unknown.keys()];
  for (let index = 0; index < mints.length; index += 30) {
    const batch = mints.slice(index, index + 30);
    const response = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${batch.join(",")}`).catch(() => null);
    const pairs = response?.ok ? ((await response.json()) as { baseToken?: { address?: string; symbol?: string; name?: string }; priceUsd?: string; info?: { imageUrl?: string } }[]) : [];
    for (const mint of batch) {
      const pair = Array.isArray(pairs) ? pairs.find((item) => item.baseToken?.address === mint) : undefined;
      const symbol = pair?.baseToken?.symbol?.replace(/\s/g, "") || mint.slice(0, 4);
      const price = Number(pair?.priceUsd) || 0;
      const token = ensureToken({ symbol, name: pair?.baseToken?.name || symbol, price, chain: "Solana", address: mint, icon: pair?.info?.imageUrl });
      token.decimals = token.decimals ?? 6;
      token.listed = true;
      if (price > 0) token.price = price;
      book[token.symbol] = (book[token.symbol] ?? 0) + (unknown.get(mint) ?? 0);
    }
  }
  return book;
}

async function btcBook(address: string) {
  const book: Record<string, number> = {};
  const response = await fetch(`https://blockstream.info/api/address/${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) return book;
  const body = (await response.json()) as { chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number } };
  const sats = (body.chain_stats?.funded_txo_sum ?? 0) - (body.chain_stats?.spent_txo_sum ?? 0);
  if (sats > 0) {
    const native = listed("btc").sort((a, b) => b.price - a.price)[0];
    const symbol = native?.symbol || "BTC";
    if (!native) {
      const created = ensureToken({ symbol: "BTC", name: "Bitcoin", price: 0, chain: "Bitcoin" });
      created.listed = true;
    }
    book[symbol] = sats / 1e8;
  }
  return book;
}

async function ethBalance(rpcs: string[], address: string) {
  const [value] = await rpcRace(rpcs, [{ method: "eth_getBalance", params: [address, "latest"] }]);
  return hex(value ?? "0x0");
}

async function tokenBalance(rpcs: string[], contract: string, address: string) {
  const data = `0x70a08231${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  const [value] = await rpcRace(rpcs, [{ method: "eth_call", params: [{ to: contract, data }, "latest"] }]);
  return hex(value ?? "0x0");
}

function hex(value: string) {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

const MAJOR_ID: Record<string, string> = {
  ETH: "ethereum",
  WETH: "ethereum",
  BNB: "binancecoin",
  WBNB: "binancecoin",
  SOL: "solana",
  WSOL: "solana",
  BTC: "bitcoin",
  WBTC: "bitcoin",
  POL: "polygon-ecosystem-token",
  MATIC: "polygon-ecosystem-token",
  AVAX: "avalanche-2",
  NEAR: "near",
  WNEAR: "near",
};
const majorSpot: Record<string, number> = {};
let priceFlight: Promise<void> | null = null;

export function ensureMajorPrices() {
  if (priceFlight) return priceFlight;
  priceFlight = (async () => {
    const { net } = await import("@/lib/net");
    const ids = [...new Set(Object.values(MAJOR_ID))].join(",");
    const response = await net(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`).catch(() => null);
    if (!response?.ok) return;
    const body = (await response.json()) as Record<string, { usd?: number }>;
    const marks = { ...useDesk.getState().marks };
    let changed = false;
    for (const [symbol, id] of Object.entries(MAJOR_ID)) {
      const price = Number(body[id]?.usd);
      if (!(price > 0)) continue;
      majorSpot[symbol] = price;
      if (!(marks[symbol] > 0)) {
        marks[symbol] = price;
        changed = true;
      }
      for (const token of TOKENS) {
        if (token.symbol.split(".")[0]?.toUpperCase() === symbol && !(token.price > 0)) token.price = price;
      }
    }
    if (changed) useDesk.setState({ marks, clock: useDesk.getState().clock + 1 });
  })().finally(() => {
    window.setTimeout(() => {
      priceFlight = null;
    }, 60_000);
  });
  return priceFlight;
}

function stampPrices(book: Record<string, number>) {
  const marks = { ...useDesk.getState().marks };
  let changed = false;
  let missing = false;
  for (const symbol of Object.keys(book)) {
    const base = symbol.split(".")[0]?.toUpperCase() ?? "";
    if (["USDT", "USDC", "DAI", "FRAX", "USN"].includes(base)) {
      if (!(marks[symbol] > 0)) {
        marks[symbol] = 1;
        changed = true;
      }
      continue;
    }
    const price = majorSpot[base] || marks[base] || marks[symbol] || TOKENS.find((token) => token.symbol.split(".")[0]?.toUpperCase() === base && token.price > 0)?.price || 0;
    if (!(price > 0)) {
      missing = true;
      continue;
    }
    if (!(marks[symbol] > 0)) {
      marks[symbol] = price;
      changed = true;
    }
  }
  if (changed) useDesk.setState({ marks, clock: useDesk.getState().clock + 1 });
  if (missing) void ensureMajorPrices();
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
