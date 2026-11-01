import { useEffect, useState } from "react";
import { CHAINS_META, chainByLabel, chainRpcs } from "@/lib/chains";
import { TOKENS, ensureToken } from "@/lib/market";
import { useDesk } from "@/lib/store";
import { foreignWallets, type LinkedWallet } from "@/lib/foreign-wallet";

const cache = new Map<string, Record<string, number>>();
const inflight = new Map<string, Promise<Record<string, number>>>();

export function holdingOf(id: "near" | "evm" | "sol" | "btc", address: string, symbol: string) {
  if (id === "near") return useDesk.getState().chain[symbol] ?? useDesk.getState().balances[symbol] ?? 0;
  return cache.get(`${id}:${address.toLowerCase()}`)?.[symbol] ?? 0;
}

const pendingForeign = new Map<string, { target: number; dir: 1 | -1; until: number }>();

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
    if (got > 0) {
      pendingForeign.delete(id);
      continue;
    }
    if (item.dir > 0 && item.target > 0) book[symbol] = item.target;
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
  const book = overlayForeign(key, { ...(cache.get(key) ?? {}) });
  const target = Math.max(0, (book[symbol] ?? 0) + delta);
  book[symbol] = target;
  pendingForeign.set(`${key}:${symbol}`, { target, dir: delta > 0 ? 1 : -1, until: Date.now() + 180_000 });
  cache.set(key, book);
  useDesk.setState({ clock: useDesk.getState().clock + 1 });
  const kind: "evm" | "sol" | "btc" = chain.kind === "sol" ? "sol" : chain.kind === "btc" ? "btc" : "evm";
  const pull = () => {
    cache.delete(key);
    inflight.delete(key);
    void loadHoldings(kind, address).then(() => useDesk.setState({ clock: useDesk.getState().clock + 1 }));
  };
  for (const delay of [2500, 7000, 16000, 32000]) window.setTimeout(pull, delay);
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
      const next: Record<string, number> = { ...chain };
      for (const symbol of Object.keys(next)) {
        if (!(next[symbol] > 0)) delete next[symbol];
        else if (!TOKENS.some((token) => token.symbol === symbol)) ensureToken({ symbol, name: symbol, price: 0, chain: "NEAR" });
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
      cache.set(key, overlayForeign(key, book));
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
  return TOKENS.filter((token) => token.listed && chainByLabel(token.chain)?.kind === kind);
}

const EVM_STABLES: Record<string, { symbol: string; address: string; decimals: number }[]> = {
  Ethereum: [
    { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
    { symbol: "USDT", address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
  ],
  Base: [{ symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 }],
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

async function evmBook(address: string) {
  const book: Record<string, number> = {};
  const tokens = listed("evm");
  await Promise.all(
    CHAINS_META.filter((chain) => chain.kind === "evm" && chain.rpc).map(async (chain) => {
      const mine = tokens.filter((token) => token.chain === chain.label);
      const native = mine.filter((token) => !/^0x[a-fA-F0-9]{40}$/.test(token.address ?? "")).sort((a, b) => b.price - a.price)[0];
      const forced = EVM_STABLES[chain.label] ?? [];
      const erc20 = [
        ...mine.filter((token) => /^0x[a-fA-F0-9]{40}$/.test(token.address ?? "") && token.decimals != null),
        ...forced
          .filter((token) => !mine.some((item) => item.address?.toLowerCase() === token.address.toLowerCase()))
          .map((token) => ({ address: token.address, decimals: token.decimals, symbol: token.symbol })),
      ];
      const rpcs = chainRpcs(chain);
      const [gas, balances] = await Promise.all([
        ethBalance(rpcs, address),
        mapPool(erc20, 6, (token) => tokenBalance(rpcs, token.address!, address)),
      ]);
      if (gas > 0n) {
        const symbol = native?.symbol || NATIVE_SYMBOL[chain.label] || chain.label;
        const decimals = native?.decimals ?? 18;
        book[symbol] = (book[symbol] ?? 0) + Number(gas) / 10 ** decimals;
        if (native) native.listed = true;
        else ensureToken({ symbol, name: symbol, price: 0, chain: chain.label }).listed = true;
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
  const mints = [...unknown.keys()].slice(0, 30);
  if (mints.length) {
    const response = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mints.join(",")}`).catch(() => null);
    const pairs = response?.ok ? ((await response.json()) as { baseToken?: { address?: string; symbol?: string; name?: string }; priceUsd?: string; info?: { imageUrl?: string } }[]) : [];
    for (const mint of mints) {
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
  const native = listed("btc").sort((a, b) => b.price - a.price)[0];
  const response = await fetch(`https://blockstream.info/api/address/${encodeURIComponent(address)}`);
  if (!response.ok || !native) return book;
  const body = (await response.json()) as { chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number } };
  const sats = (body.chain_stats?.funded_txo_sum ?? 0) - (body.chain_stats?.spent_txo_sum ?? 0);
  if (sats > 0) book[native.symbol] = sats / 1e8;
  return book;
}

async function ethBalance(rpcs: string[], address: string) {
  for (const rpc of rpcs) {
    const value = await rpcCall(rpc, "eth_getBalance", [address, "latest"]);
    const amount = hex(value);
    if (amount > 0n) return amount;
  }
  return 0n;
}

async function tokenBalance(rpcs: string[], contract: string, address: string) {
  const data = `0x70a08231${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  for (const rpc of rpcs) {
    const value = await rpcCall(rpc, "eth_call", [{ to: contract, data }, "latest"]);
    const amount = hex(value);
    if (amount > 0n) return amount;
  }
  return 0n;
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
