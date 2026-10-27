import { create } from "zustand";
import { LEND_MARKETS, canPerp, isHoneypot, tokenBySymbol } from "@/lib/market";
import { logTrade } from "@/lib/trade-log";

export type Side = "long" | "short";

export type Position = {
  id: string;
  market: string;
  base: string;
  side: Side;
  size: number;
  entry: number;
  margin: number;
  leverage: number;
  tp?: number;
  sl?: number;
};

export type Activity = { id: string; title: string; detail: string; value: number };

export type RestingOrder = {
  id: string;
  symbol: string;
  kind: "spot" | "perp";
  side: string;
  amount: number;
  limit: number;
  pay: string;
  receive: string;
  base?: string;
  leverage?: number;
  tp?: number;
  sl?: number;
};

export type Receipt = { asset: string; amount: number };

type Book = Record<string, number>;

type Desk = {
  connected: boolean;
  accountId: string | null;
  nearYocto: string | null;
  balances: Book;
  vault: Book;
  supplied: Book;
  loans: Book;
  positions: Position[];
  orders: RestingOrder[];
  activity: Activity[];
  marks: Book;
  chain: Book;
  receipts: Record<string, Receipt>;
  realized: number;
  wins: number;
  closes: number;
  clock: number;
  connect: () => void | Promise<void>;
  disconnect: () => void;
  setAccount: (accountId: string | null) => void;
  setNearYocto: (nearYocto: string | null) => void;
  applyChain: (chain: Book) => void;
  setLending: (supplied: Book, loans: Book) => void;
  log: (title: string, detail: string, value: number) => void;
  swap: (from: string, to: string, amountIn: number, amountOut: number, via: string) => boolean;
  placeOrder: (order: Omit<RestingOrder, "id">) => boolean;
  cancelOrder: (id: string) => void;
  openPerp: (
    market: string,
    base: string,
    side: Side,
    notional: number,
    leverage: number,
    extra?: { tp?: number; sl?: number; reduceOnly?: boolean; limit?: number },
  ) => boolean;
  closePerp: (id: string, reason?: string) => boolean;
  setGuards: (id: string, guards: { tp?: number; sl?: number }) => void;
  setLeverage: (id: string, leverage: number) => boolean;
  adjustMargin: (id: string, delta: number) => boolean;
  depositVault: (symbol: string, amount: number) => boolean;
  withdrawVault: (symbol: string, amount: number) => boolean;
  supply: (symbol: string, amount: number) => boolean;
  withdrawSupply: (symbol: string, amount: number) => boolean;
  borrow: (symbol: string, amount: number) => boolean;
  repay: (symbol: string, amount: number) => boolean;
  dropVault: (symbol: string, amount: number) => boolean;
  creditVault: (symbol: string, amount: number) => boolean;
  noteSupply: (symbol: string, amount: number) => void;
  noteUnsupply: (symbol: string, amount: number) => boolean;
  addReceipt: (key: string, asset: string, amount: number) => void;
  subReceipt: (key: string, amount: number) => void;
  tick: () => void;
};

let walletOpener: (() => void) | null = null;

export function setWalletOpener(opener: () => void) {
  walletOpener = opener;
}

function priceOf(symbol: string, marks: Book) {
  return marks[symbol] ?? tokenBySymbol(symbol).price;
}

function worth(symbol: string, amount: number, marks: Book) {
  const price = priceOf(symbol, marks);
  if (!Number.isFinite(price) || !Number.isFinite(amount)) return 0;
  return amount * price;
}

function push(activity: Activity[], title: string, detail: string, value: number): Activity[] {
  return [{ id: `${Date.now()}-${title}`, title, detail, value }, ...activity].slice(0, 200);
}

function take(book: Book, symbol: string, amount: number) {
  if (amount <= 0 || (book[symbol] ?? 0) + 1e-9 < amount) return null;
  return { ...book, [symbol]: (book[symbol] ?? 0) - amount };
}

function add(book: Book, symbol: string, amount: number) {
  return { ...book, [symbol]: (book[symbol] ?? 0) + amount };
}

const BLANK = {
  balances: {} as Book,
  vault: {} as Book,
  supplied: {} as Book,
  loans: {} as Book,
  positions: [] as Position[],
  orders: [] as RestingOrder[],
  activity: [] as Activity[],
  realized: 0,
  wins: 0,
  closes: 0,
  chain: {} as Book,
  receipts: {} as Record<string, Receipt>,
};

type Ledger = typeof BLANK;

const LEDGER_KEY = "asgard-ledgers-v2";

function readLedgers(): Record<string, Ledger> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Ledger>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveLedger(accountId: string, ledger: Ledger) {
  if (typeof window === "undefined") return;
  const all = readLedgers();
  all[accountId] = ledger;
  localStorage.setItem(LEDGER_KEY, JSON.stringify(all));
}

function snap(state: {
  balances: Book;
  vault: Book;
  supplied: Book;
  loans: Book;
  positions: Position[];
  orders: RestingOrder[];
  activity: Activity[];
  realized: number;
  wins: number;
  closes: number;
  chain: Book;
  receipts: Record<string, Receipt>;
}): Ledger {
  return {
    balances: state.balances,
    vault: state.vault,
    supplied: state.supplied,
    loans: state.loans,
    positions: state.positions,
    orders: state.orders,
    activity: state.activity,
    realized: state.realized,
    wins: state.wins,
    closes: state.closes,
    chain: state.chain,
    receipts: state.receipts,
  };
}

function cloneBook(book?: Book): Book {
  return { ...(book ?? {}) };
}

function cloneLedger(raw?: Partial<Ledger> | null): Ledger {
  return {
    balances: {},
    vault: cloneBook(raw?.vault),
    supplied: cloneBook(raw?.supplied),
    loans: cloneBook(raw?.loans),
    positions: [...(raw?.positions ?? [])],
    orders: [...(raw?.orders ?? [])],
    activity: [...(raw?.activity ?? [])],
    realized: raw?.realized ?? 0,
    wins: raw?.wins ?? 0,
    closes: raw?.closes ?? 0,
    chain: {},
    receipts: { ...(raw?.receipts ?? {}) },
  };
}

function freshLedger(): Ledger {
  return cloneLedger(null);
}

function bookUsd(book: Book, marks: Book) {
  return Object.entries(book).reduce((sum, [symbol, amount]) => sum + worth(symbol, amount, marks), 0);
}

export const useDesk = create<Desk>((set, get) => ({
  connected: false,
  accountId: null,
  nearYocto: null,
  ...BLANK,
  marks: { NEAR: tokenBySymbol("NEAR").price, ETH: tokenBySymbol("ETH").price },
  clock: 0,

  connect: () => {
    if (walletOpener) {
      walletOpener();
      return;
    }
    return import("@/lib/near-wallet").then((mod) => mod.openNearWallets());
  },
  disconnect: () => {
    void import("@/lib/near-wallet").then((mod) => mod.signOutNear());
  },
  setAccount: (accountId) => {
    const prev = get();
    const nextId = accountId?.trim().toLowerCase() || null;
    if (prev.accountId === nextId) {
      if (nextId) set({ connected: true });
      return;
    }
    if (prev.accountId) saveLedger(prev.accountId, snap(prev));
    if (!nextId) {
      set({ ...cloneLedger(null), accountId: null, connected: false, nearYocto: null });
      return;
    }
    const loaded = cloneLedger(readLedgers()[nextId]);
    set({ ...loaded, accountId: nextId, connected: true, nearYocto: null });
  },
  setNearYocto: (nearYocto) => set({ nearYocto }),
  applyChain: (chain) => {
    const copy = cloneBook(chain);
    const state = get();
    const locked = lockedMargin(state.positions, state.orders);
    const usdt = Math.max(0, (copy.USDT ?? 0) - locked);
    set({ chain: copy, balances: { ...copy, USDT: usdt } });
  },
  setLending: (supplied, loans) => set({ supplied: cloneBook(supplied), loans: cloneBook(loans) }),
  log: (title, detail, value) => set({ activity: push(get().activity, title, detail, value) }),

  swap: (from, to, amountIn, amountOut, via) => {
    if (from === to || amountIn <= 0 || amountOut <= 0) return false;
    if (isHoneypot(tokenBySymbol(from))) return false;
    const { balances, marks, activity } = get();
    const next = take(balances, from, amountIn);
    if (!next) return false;
    set({
      balances: add(next, to, amountOut),
      activity: push(activity, `Swap via ${via}`, `${from} → ${to}`, worth(from, amountIn, marks)),
    });
    return true;
  },

  placeOrder: (order) => {
    if (order.amount <= 0 || order.limit <= 0) return false;
    const { balances, orders } = get();
    if (order.kind === "spot" && (balances[order.pay] ?? 0) + 1e-9 < order.amount) return false;
    if (order.kind === "perp") {
      const margin = order.amount / Math.max(order.leverage ?? 1, 1);
      const next = take(balances, "USDT", margin);
      if (!next) return false;
      set({ balances: next, orders: [{ ...order, id: `${order.symbol}-${Date.now()}` }, ...orders].slice(0, 20) });
      logTrade({ bucket: "order", symbol: order.base ?? order.symbol, title: `Limit ${order.side}`, detail: `${order.amount} @ ${order.limit}`, value: order.amount, status: "open", account: get().accountId });
      return true;
    }
    set({ orders: [{ ...order, id: `${order.symbol}-${Date.now()}` }, ...orders].slice(0, 20) });
    logTrade({ bucket: "order", symbol: order.symbol, title: `Limit ${order.side}`, detail: `${order.amount} @ ${order.limit}`, value: order.amount, status: "open", account: get().accountId });
    return true;
  },

  cancelOrder: (id) => {
    const state = get();
    const order = state.orders.find((item) => item.id === id);
    if (!order) return;
    const orders = state.orders.filter((item) => item.id !== id);
    if (order.kind !== "perp") {
      logTrade({ bucket: "order", symbol: order.symbol, title: `Canceled ${order.side}`, detail: `${order.amount} @ ${order.limit}`, value: order.amount, status: "canceled", account: state.accountId });
      set({ orders });
      return;
    }
    const margin = order.amount / Math.max(order.leverage ?? 1, 1);
    logTrade({ bucket: "order", symbol: order.base ?? order.symbol, title: `Canceled ${order.side}`, detail: `${order.amount} @ ${order.limit}`, value: order.amount, status: "canceled", account: state.accountId });
    set({ orders, balances: add(state.balances, "USDT", margin) });
  },

  openPerp: (market, base, side, notional, leverage, extra) => {
    if (notional <= 0 || leverage < 1 || !canPerp(base)) return false;
    const state = get();
    const mark = priceOf(base, state.marks);
    if (!(mark > 0)) return false;
    const limit = extra?.limit;
    const marketable = !limit || (side === "long" ? mark <= limit : mark >= limit);
    if (!marketable) {
      return get().placeOrder({
        symbol: base,
        kind: "perp",
        side,
        amount: notional,
        limit: limit ?? mark,
        pay: "USDT",
        receive: base,
        base,
        leverage,
        tp: extra?.tp,
        sl: extra?.sl,
      });
    }
    if (extra?.reduceOnly) return reducePosition(base, side, notional);
    const entry = limit && marketable ? limit : mark;
    const margin = notional / leverage;
    const nextBal = take(state.balances, "USDT", margin);
    if (!nextBal) return false;
    const size = notional / entry;
    const existing = state.positions.find((position) => position.base === base && position.side === side);
    const positions = existing
      ? state.positions.map((position) =>
          position.id === existing.id
            ? {
                ...position,
                entry: (position.entry * position.size + entry * size) / (position.size + size),
                size: position.size + size,
                margin: position.margin + margin,
                leverage,
                tp: extra?.tp || position.tp,
                sl: extra?.sl || position.sl,
              }
            : position,
        )
      : [
          {
            id: `${market}-${Date.now()}`,
            market,
            base,
            side,
            size,
            entry,
            margin,
            leverage,
            tp: extra?.tp,
            sl: extra?.sl,
          },
          ...state.positions,
        ];
    set({
      balances: nextBal,
      positions,
      activity: push(state.activity, `${side === "long" ? "Long" : "Short"} ${market}`, `${leverage}x`, notional),
    });
    logTrade({ bucket: "trade", symbol: base, title: `${side === "long" ? "Long" : "Short"} ${base}/USDT`, detail: `${leverage}x`, value: notional, status: "open", account: state.accountId });
    return true;
  },

  closePerp: (id, reason = "Closed") => {
    const state = get();
    const position = state.positions.find((item) => item.id === id);
    if (!position) return false;
    const mark = priceOf(position.base, state.marks);
    const pnl = position.side === "long" ? (mark - position.entry) * position.size : (position.entry - mark) * position.size;
    const back = position.margin;
    set({
      balances: add(state.balances, "USDT", back),
      positions: state.positions.filter((item) => item.id !== id),
      realized: state.realized + pnl,
      wins: state.wins + (pnl >= 0 ? 1 : 0),
      closes: state.closes + 1,
      activity: push(state.activity, `${reason} ${position.market}`, position.side, pnl),
    });
    logTrade({ bucket: "trade", symbol: position.base, title: `${reason} ${position.base}/USDT`, detail: position.side, value: pnl, status: "closed", account: state.accountId });
    return true;
  },

  setGuards: (id, guards) => {
    set({
      positions: get().positions.map((position) =>
        position.id === id
          ? { ...position, tp: guards.tp && guards.tp > 0 ? guards.tp : undefined, sl: guards.sl && guards.sl > 0 ? guards.sl : undefined }
          : position,
      ),
    });
  },

  setLeverage: (id, leverage) => {
    const lev = Math.min(20, Math.max(1, Math.round(leverage)));
    const state = get();
    const position = state.positions.find((item) => item.id === id);
    if (!position) return false;
    const notional = position.size * position.entry;
    if (!(notional > 0)) return false;
    const nextMargin = notional / lev;
    const delta = nextMargin - position.margin;
    const balances = delta > 0 ? take(state.balances, "USDT", delta) : add(state.balances, "USDT", -delta);
    if (!balances) return false;
    set({
      balances,
      positions: state.positions.map((item) => (item.id === id ? { ...item, leverage: lev, margin: nextMargin } : item)),
    });
    return true;
  },

  adjustMargin: (id, delta) => {
    if (!Number.isFinite(delta) || delta === 0) return false;
    const state = get();
    const position = state.positions.find((item) => item.id === id);
    if (!position) return false;
    const notional = position.size * position.entry;
    if (delta > 0) {
      const balances = take(state.balances, "USDT", delta);
      if (!balances) return false;
      const margin = position.margin + delta;
      set({
        balances,
        positions: state.positions.map((item) => (item.id === id ? { ...item, margin, leverage: Math.min(20, Math.max(1, notional / margin)) } : item)),
      });
      return true;
    }
    const mark = priceOf(position.base, state.marks);
    const pnl = position.side === "long" ? (mark - position.entry) * position.size : (position.entry - mark) * position.size;
    const floor = Math.max(notional / 20, Math.max(0, -pnl));
    const release = Math.min(-delta, Math.max(0, position.margin - floor));
    if (release <= 0) return false;
    const margin = position.margin - release;
    set({
      balances: add(state.balances, "USDT", release),
      positions: state.positions.map((item) => (item.id === id ? { ...item, margin, leverage: Math.min(20, Math.max(1, notional / margin)) } : item)),
    });
    return true;
  },

  depositVault: (symbol, amount) => {
    const { balances, vault, marks, activity } = get();
    const next = take(balances, symbol, amount);
    if (!next) return false;
    set({
      balances: next,
      vault: add(vault, symbol, amount),
      activity: push(activity, "Vault deposit", symbol, worth(symbol, amount, marks)),
    });
    return true;
  },

  withdrawVault: (symbol, amount) => {
    const { balances, vault, marks, activity } = get();
    const next = take(vault, symbol, amount);
    if (!next) return false;
    set({
      vault: next,
      balances: add(balances, symbol, amount),
      activity: push(activity, "Vault withdraw", symbol, worth(symbol, amount, marks)),
    });
    return true;
  },

  supply: (symbol, amount) => {
    const { balances, supplied, marks, activity } = get();
    const next = take(balances, symbol, amount);
    if (!next) return false;
    set({
      balances: next,
      supplied: add(supplied, symbol, amount),
      activity: push(activity, "Supplied", symbol, worth(symbol, amount, marks)),
    });
    return true;
  },

  withdrawSupply: (symbol, amount) => {
    const { balances, supplied, loans, marks, activity } = get();
    const next = take(supplied, symbol, amount);
    if (!next) return false;
    const debt = bookUsd(loans, marks);
    if (debt > bookUsd(next, marks) * 0.7 + 1e-6) return false;
    set({
      supplied: next,
      balances: add(balances, symbol, amount),
      activity: push(activity, "Withdrew supply", symbol, worth(symbol, amount, marks)),
    });
    return true;
  },

  creditVault: (symbol, amount) => {
    if (amount <= 0) return false;
    const { vault, marks, activity } = get();
    set({ vault: add(vault, symbol, amount), activity: push(activity, "Vault deposit", symbol, worth(symbol, amount, marks)) });
    return true;
  },

  dropVault: (symbol, amount) => {
    const next = take(get().vault, symbol, amount);
    if (!next) return false;
    set({ vault: next, activity: push(get().activity, "Vault release", symbol, worth(symbol, amount, get().marks)) });
    return true;
  },

  noteSupply: (symbol, amount) => {
    const { supplied, marks, activity } = get();
    set({ supplied: add(supplied, symbol, amount), activity: push(activity, "Supplied", `${symbol} via NEAR Intents`, worth(symbol, amount, marks)) });
  },

  noteUnsupply: (symbol, amount) => {
    const next = take(get().supplied, symbol, amount);
    if (!next) return false;
    set({ supplied: next, activity: push(get().activity, "Withdrew supply", symbol, worth(symbol, amount, get().marks)) });
    return true;
  },

  addReceipt: (key, asset, amount) => {
    const current = get().receipts[key];
    set({ receipts: { ...get().receipts, [key]: { asset, amount: (current?.amount ?? 0) + amount } } });
  },

  subReceipt: (key, amount) => {
    const current = get().receipts[key];
    if (!current) return;
    const left = current.amount - amount;
    const receipts = { ...get().receipts };
    if (left <= 1e-8) delete receipts[key];
    else receipts[key] = { ...current, amount: left };
    set({ receipts });
  },

  borrow: (symbol, amount) => {
    const { supplied, loans, marks, activity } = get();
    const cost = worth(symbol, amount, marks);
    const room = Math.max(0, bookUsd(supplied, marks) * 0.7 - bookUsd(loans, marks));
    if (amount <= 0 || cost > room + 1e-6) return false;
    set({
      loans: add(loans, symbol, amount),
      activity: push(activity, "Borrowed", symbol, cost),
    });
    return true;
  },

  repay: (symbol, amount) => {
    const { loans, marks, activity } = get();
    const owed = loans[symbol] ?? 0;
    const pay = Math.min(amount, owed);
    if (pay <= 0) return false;
    const left = Math.max(0, owed - pay);
    set({
      loans: left > 1e-12 ? { ...loans, [symbol]: left } : Object.fromEntries(Object.entries(loans).filter(([key]) => key !== symbol)),
      activity: push(activity, "Repaid", symbol, worth(symbol, pay, marks)),
    });
    return true;
  },

  tick: () => {
    const state = get();
    const marks = state.marks;
    let balances = state.balances;
    let orders = state.orders;
    let positions = state.positions;
    let activity = state.activity;
    let realized = state.realized;
    let wins = state.wins;
    let closes = state.closes;
    const kept: RestingOrder[] = [];
    for (const order of orders) {
      const mark = priceOf(order.base ?? order.symbol, marks);
      const hit = order.side === "buy" || order.side === "long" ? mark <= order.limit : mark >= order.limit;
      if (!hit || order.kind === "spot" || !order.base || !(order.limit > 0)) {
        kept.push(order);
        continue;
      }
      const margin = order.amount / Math.max(order.leverage ?? 1, 1);
      positions = [
        {
          id: `${order.symbol}-${order.id}`,
          market: `${order.base}-PERP`,
          base: order.base,
          side: order.side === "short" ? "short" : "long",
          size: order.amount / order.limit,
          entry: order.limit,
          margin,
          leverage: order.leverage ?? 1,
          tp: order.tp,
          sl: order.sl,
        },
        ...positions,
      ];
      activity = push(activity, `Limit ${order.side}`, `${order.base}-PERP`, order.amount);
      logTrade({ bucket: "order", symbol: order.base, title: `Filled ${order.side}`, detail: `${order.amount} @ ${order.limit}`, value: order.amount, status: "filled", account: state.accountId });
      logTrade({ bucket: "trade", symbol: order.base, title: `${order.side} ${order.base}/USDT`, detail: `${order.leverage ?? 1}x`, value: order.amount, status: "filled", account: state.accountId });
    }
    orders = kept;
    const still: Position[] = [];
    for (const position of positions) {
      const mark = priceOf(position.base, marks);
      const liq = position.side === "long" ? position.entry * (1 - 0.9 / position.leverage) : position.entry * (1 + 0.9 / position.leverage);
      const liquidated = position.side === "long" ? mark <= liq : mark >= liq;
      const stopped = position.sl ? (position.side === "long" ? mark <= position.sl : mark >= position.sl) : false;
      const targeted = position.tp ? (position.side === "long" ? mark >= position.tp : mark <= position.tp) : false;
      if (!liquidated && !stopped && !targeted) {
        still.push(position);
        continue;
      }
      const pnl = position.side === "long" ? (mark - position.entry) * position.size : (position.entry - mark) * position.size;
      balances = add(balances, "USDT", position.margin);
      realized += pnl;
      wins += pnl >= 0 ? 1 : 0;
      closes += 1;
      const reason = liquidated ? "Liquidated" : stopped ? "Stop" : "Take profit";
      activity = push(activity, `${reason} ${position.market}`, position.side, pnl);
    }
    positions = still;
    const clock = state.clock + 1;
    let supplied = state.supplied;
    let loans = state.loans;
    if (clock % 8 === 0) {
      supplied = { ...supplied };
      loans = { ...loans };
      for (const market of LEND_MARKETS) {
        const supply = supplied[market.symbol];
        if (supply) supplied[market.symbol] = supply * (1 + market.supplyApy / 100 / 365 / 24);
        const debt = loans[market.symbol];
        if (debt) loans[market.symbol] = debt * (1 + market.borrowApy / 100 / 365 / 24);
      }
    }
    set({ balances, orders, positions, activity, realized, wins, closes, clock, supplied, loans });
  },
}));

useDesk.subscribe((state, prev) => {
  if (!state.accountId || !state.connected) return;
  if (
    state.balances === prev.balances &&
    state.vault === prev.vault &&
    state.supplied === prev.supplied &&
    state.loans === prev.loans &&
    state.positions === prev.positions &&
    state.orders === prev.orders &&
    state.activity === prev.activity &&
    state.realized === prev.realized &&
    state.wins === prev.wins &&
    state.closes === prev.closes &&
    state.chain === prev.chain &&
    state.receipts === prev.receipts
  ) {
    return;
  }
  saveLedger(state.accountId, snap(state));
});

function lockedMargin(positions: Position[], orders: RestingOrder[]) {
  let locked = 0;
  for (const position of positions) locked += Math.max(0, position.margin);
  for (const order of orders) {
    if (order.kind === "perp") locked += order.amount / Math.max(order.leverage ?? 1, 1);
  }
  return locked;
}

function reducePosition(base: string, side: Side, notional: number) {
  const state = useDesk.getState();
  const position = state.positions.find((item) => item.base === base && item.side !== side);
  if (!position) return false;
  const mark = priceOf(base, state.marks);
  const closing = Math.min(position.size, notional / mark);
  const part = closing / position.size;
  const pnl = (position.side === "long" ? mark - position.entry : position.entry - mark) * closing;
  const released = position.margin * part;
  const left = position.size - closing;
  const positions =
    left <= position.size * 0.001
      ? state.positions.filter((item) => item.id !== position.id)
      : state.positions.map((item) => (item.id === position.id ? { ...item, size: left, margin: item.margin - released } : item));
  useDesk.setState({
    balances: add(state.balances, "USDT", released),
    positions,
    realized: state.realized + pnl,
    wins: state.wins + (left <= position.size * 0.001 && pnl >= 0 ? 1 : 0),
    closes: state.closes + (left <= position.size * 0.001 ? 1 : 0),
    activity: push(state.activity, `Reduced ${position.market}`, position.side, pnl),
  });
  return true;
}
