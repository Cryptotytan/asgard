import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { livePrints, loadPrints } from "@/lib/live";
import { useDesk } from "@/lib/store";

type Level = { price: number; qty: number };
type Tape = { id: string; price: number; qty: number; side: "buy" | "sell"; time: string };
type View = "both" | "buy" | "sell";
type Unit = "quote" | "base";

const ALIAS: Record<string, string> = {
  NEAR: "NEARUSDT",
  WNEAR: "NEARUSDT",
  ETH: "ETHUSDT",
  WETH: "ETHUSDT",
  BTC: "BTCUSDT",
  WBTC: "BTCUSDT",
  SOL: "SOLUSDT",
  AVAX: "AVAXUSDT",
  BNB: "BNBUSDT",
  DOGE: "DOGEUSDT",
  XRP: "XRPUSDT",
  ADA: "ADAUSDT",
  LINK: "LINKUSDT",
  UNI: "UNIUSDT",
  AAVE: "AAVEUSDT",
  SUI: "SUIUSDT",
  APT: "APTUSDT",
  TON: "TONUSDT",
  LTC: "LTCUSDT",
  BCH: "BCHUSDT",
  TRX: "TRXUSDT",
  ATOM: "ATOMUSDT",
  OP: "OPUSDT",
  ARB: "ARBUSDT",
  POL: "POLUSDT",
  MATIC: "POLUSDT",
};

const listed = new Map<string, boolean>();

function binancePair(symbol: string) {
  const key = symbol.split(".")[0]?.toUpperCase() ?? "";
  if (ALIAS[key]) return ALIAS[key];
  if (/^[A-Z0-9]{2,12}$/.test(key)) return `${key}USDT`;
  return "";
}

function stepsFor(price: number) {
  if (!(price > 0)) return [0.01];
  if (price >= 1000) return [0.01, 0.1, 1, 10, 50, 100];
  if (price >= 50) return [0.01, 0.1, 1, 5, 10];
  if (price >= 1) return [0.0001, 0.001, 0.01, 0.1, 1];
  if (price >= 0.01) return [0.000001, 0.00001, 0.0001, 0.001, 0.01];
  const fine = price / 1000;
  return [fine, fine * 10, fine * 100].filter((step) => step > 0);
}

function stepLabel(step: number) {
  if (step >= 1) return String(step);
  return step.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

function sizeText(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1000) return `${(abs / 1000).toFixed(2)}K`;
  if (abs >= 1) return abs.toFixed(2);
  if (abs >= 0.01) return abs.toFixed(4);
  return abs.toPrecision(2);
}

function priceText(n: number, step: number) {
  const digits = step >= 1 ? 0 : step >= 0.1 ? 2 : step >= 0.01 ? 2 : step >= 0.001 ? 3 : step >= 0.0001 ? 4 : 6;
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function clock(ms: number) {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function poolBook(price: number, liquidity: number) {
  const depth = Math.max(liquidity, price * 500, 1000);
  const asks: Level[] = [];
  const bids: Level[] = [];
  for (let i = 1; i <= 24; i += 1) {
    const slip = i * 0.0012;
    const quote = (depth * 0.09) / i;
    const ask = price * (1 + slip);
    const bid = price * (1 - slip);
    asks.push({ price: ask, qty: quote / ask });
    bids.push({ price: bid, qty: quote / bid });
  }
  return { asks, bids };
}

function bucket(levels: Level[], step: number, side: "ask" | "bid") {
  const map = new Map<number, number>();
  for (const level of levels) {
    if (!(level.price > 0) || !(level.qty > 0)) continue;
    const key = side === "ask" ? Math.ceil(level.price / step) * step : Math.floor(level.price / step) * step;
    map.set(key, (map.get(key) ?? 0) + level.qty);
  }
  return [...map.entries()]
    .map(([price, qty]) => ({ price, qty }))
    .sort((a, b) => b.price - a.price);
}

export function LiveBook({ symbol, mark, liquidity }: { symbol: string; mark: number; liquidity: number }) {
  const [tab, setTab] = useState<"book" | "tape">("book");
  const [view, setView] = useState<View>("both");
  const [unit, setUnit] = useState<Unit>("quote");
  const [step, setStep] = useState(0.01);
  const [menu, setMenu] = useState<"step" | "unit" | null>(null);
  const [asks, setAsks] = useState<Level[]>([]);
  const [bids, setBids] = useState<Level[]>([]);
  const [tape, setTape] = useState<Tape[]>([]);
  const [last, setLast] = useState(mark);
  const [up, setUp] = useState(true);
  const [venue, setVenue] = useState<"binance" | "pool">("pool");
  const box = useRef<HTMLDivElement>(null);
  const base = symbol.split(".")[0] || symbol;
  useDesk((state) => state.clock);

  const steps = useMemo(() => stepsFor(last > 0 ? last : mark), [last, mark]);

  useEffect(() => {
    setStep(steps[0] ?? 0.01);
  }, [symbol, steps]);

  useEffect(() => {
    if (!menu) return;
    function onDoc(event: MouseEvent) {
      if (!box.current?.contains(event.target as Node)) setMenu(null);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menu]);

  useEffect(() => {
    let stop = false;
    let socket: WebSocket | null = null;
    const pair = binancePair(symbol);
    setAsks([]);
    setBids([]);
    setTape([]);
    setVenue("pool");

    async function listedPair() {
      if (!pair) return false;
      const cached = listed.get(pair);
      if (cached != null) return cached;
      const response = await fetch(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${pair}`).catch(() => null);
      const ok = Boolean(response?.ok);
      listed.set(pair, ok);
      return ok;
    }

    function applyBook(nextAsks: Level[], nextBids: Level[]) {
      if (stop) return;
      setAsks(nextAsks);
      setBids(nextBids);
    }

    function pushTrade(trade: Tape) {
      if (stop) return;
      setLast((prev) => {
        if (prev > 0) setUp(trade.price >= prev);
        return trade.price;
      });
      setTape((rows) => [trade, ...rows].slice(0, 40));
    }

    async function openBinance() {
      const ok = await listedPair();
      if (stop || !ok) return false;
      const [depthRes, tradeRes] = await Promise.all([
        fetch(`https://data-api.binance.vision/api/v3/depth?symbol=${pair}&limit=50`),
        fetch(`https://data-api.binance.vision/api/v3/trades?symbol=${pair}&limit=30`),
      ]);
      if (stop || !depthRes.ok) return false;
      const depth = (await depthRes.json()) as { bids?: [string, string][]; asks?: [string, string][] };
      applyBook(
        (depth.asks ?? []).map(([price, qty]) => ({ price: Number(price), qty: Number(qty) })),
        (depth.bids ?? []).map(([price, qty]) => ({ price: Number(price), qty: Number(qty) })),
      );
      if (tradeRes.ok) {
        const rows = (await tradeRes.json()) as { id: number; price: string; qty: string; time: number; isBuyerMaker: boolean }[];
        if (!stop) {
          const next = [...rows].reverse().map((row) => ({
            id: String(row.id),
            price: Number(row.price),
            qty: Number(row.qty),
            side: row.isBuyerMaker ? ("sell" as const) : ("buy" as const),
            time: clock(row.time),
          }));
          setTape(next);
          const top = next[0];
          if (top) {
            setLast(top.price);
            setUp(top.side === "buy");
          }
        }
      }
      const next = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${pair.toLowerCase()}@depth20@100ms/${pair.toLowerCase()}@trade`);
      if (stop) {
        next.close();
        return false;
      }
      socket = next;
      socket.onmessage = (event) => {
        const message = JSON.parse(String(event.data)) as { stream?: string; data?: { bids?: [string, string][]; asks?: [string, string][]; p?: string; q?: string; m?: boolean; T?: number; t?: number } };
        const data = message.data;
        if (!data) return;
        if (message.stream?.includes("@depth")) {
          applyBook(
            (data.asks ?? []).map(([price, qty]) => ({ price: Number(price), qty: Number(qty) })),
            (data.bids ?? []).map(([price, qty]) => ({ price: Number(price), qty: Number(qty) })),
          );
        } else if (data.p && data.q) {
          pushTrade({
            id: String(data.t ?? data.T ?? Date.now()),
            price: Number(data.p),
            qty: Number(data.q),
            side: data.m ? "sell" : "buy",
            time: clock(data.T ?? Date.now()),
          });
        }
      };
      if (!stop) setVenue("binance");
      return true;
    }

    void openBinance().catch(() => undefined);
    return () => {
      stop = true;
      socket?.close();
    };
  }, [symbol]);

  useEffect(() => {
    if (venue !== "pool" || !(mark > 0)) return;
    const book = poolBook(mark, liquidity);
    setAsks(book.asks);
    setBids(book.bids);
    setLast(mark);
  }, [venue, mark, liquidity]);

  useEffect(() => {
    if (venue !== "pool") return;
    let stop = false;
    const pull = () => {
      void loadPrints(symbol)
        .then((rows) => {
          if (stop || !rows) return;
          setTape(
            rows.slice(0, 40).map((row, index) => ({
              id: `${row.trader}-${row.age}-${index}`,
              price: row.price,
              qty: row.amount,
              side: row.side === "Buy" ? "buy" : "sell",
              time: row.age,
            })),
          );
        })
        .catch(() => undefined);
    };
    pull();
    const timer = window.setInterval(pull, 8000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [symbol, venue]);

  const prints = livePrints(symbol);
  useEffect(() => {
    if (venue !== "pool" || !prints?.length) return;
    setTape(
      prints.slice(0, 40).map((row, index) => ({
        id: `${row.trader}-${row.age}-${index}`,
        price: row.price,
        qty: row.amount,
        side: row.side === "Buy" ? "buy" : "sell",
        time: row.age,
      })),
    );
  }, [prints, venue]);

  const groupedAsks = bucket(asks, step, "ask").slice(-16);
  const groupedBids = bucket(bids, step, "bid").slice(0, 16);
  const askRows = withTotal(groupedAsks, "ask");
  const bidRows = withTotal(groupedBids, "bid");
  const spread = (askRows[askRows.length - 1]?.price ?? last) - (bidRows[0]?.price ?? last);
  const mid = last > 0 ? last : mark;

  return (
    <div ref={box} className="flex h-full min-h-[28rem] flex-col bg-bg lg:min-h-[36rem]">
      <div className="grid grid-cols-2 border-b border-line text-[13px]">
        <button type="button" onClick={() => setTab("book")} className={`h-10 ${tab === "book" ? "bg-surface-2 font-semibold text-fg" : "text-muted"}`}>
          Order Book
        </button>
        <button type="button" onClick={() => setTab("tape")} className={`h-10 ${tab === "tape" ? "bg-surface-2 font-semibold text-fg" : "text-muted"}`}>
          Trades
        </button>
      </div>
      {tab === "book" ? (
        <>
          <div className="flex items-center gap-2 px-2 py-1.5">
            <div className="flex items-center gap-1">
              <ViewButton title="Both" active={view === "both"} onClick={() => setView("both")}>
                <span className="flex h-3.5 w-3 gap-0.5"><i className="h-full flex-1 rounded-[1px] bg-primary" /><i className="h-full flex-1 rounded-[1px] bg-danger" /></span>
              </ViewButton>
              <ViewButton title="Buy" active={view === "buy"} onClick={() => setView("buy")}>
                <span className="flex h-3.5 w-3 flex-col gap-0.5"><i className="flex-1 rounded-[1px] bg-primary" /><i className="flex-1 rounded-[1px] bg-primary/70" /><i className="flex-1 rounded-[1px] bg-primary/40" /></span>
              </ViewButton>
              <ViewButton title="Sell" active={view === "sell"} onClick={() => setView("sell")}>
                <span className="flex h-3.5 w-3 flex-col gap-0.5"><i className="flex-1 rounded-[1px] bg-danger" /><i className="flex-1 rounded-[1px] bg-danger/70" /><i className="flex-1 rounded-[1px] bg-danger/40" /></span>
              </ViewButton>
            </div>
            <div className="relative ml-auto">
              <button type="button" onClick={() => setMenu(menu === "step" ? null : "step")} className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted hover:text-fg">
                {stepLabel(step)} <ChevronDown className="size-3" />
              </button>
              {menu === "step" && (
                <ul className="absolute right-0 z-20 mt-1 w-20 rounded-lg border border-line bg-bg py-1 text-right text-[12px] shadow-lg">
                  {steps.map((item) => (
                    <li key={item}>
                      <button type="button" onClick={() => { setStep(item); setMenu(null); }} className={`flex w-full items-center justify-end gap-2 px-3 py-1.5 hover:bg-surface-2 ${item === step ? "text-fg" : "text-muted"}`}>
                        {stepLabel(item)} {item === step && <span className="text-primary">✓</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="relative">
              <button type="button" onClick={() => setMenu(menu === "unit" ? null : "unit")} className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted hover:text-fg">
                {unit === "quote" ? "USDT" : base} <ChevronDown className="size-3" />
              </button>
              {menu === "unit" && (
                <ul className="absolute right-0 z-20 mt-1 w-24 rounded-lg border border-line bg-bg py-1 text-[12px] shadow-lg">
                  {(["base", "quote"] as const).map((item) => (
                    <li key={item}>
                      <button type="button" onClick={() => { setUnit(item); setMenu(null); }} className={`flex w-full items-center justify-between px-3 py-1.5 hover:bg-surface-2 ${unit === item ? "text-fg" : "text-muted"}`}>
                        {item === "base" ? base : "USDT"} {unit === item && <span className="text-primary">✓</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="grid grid-cols-[1.15fr_1fr_1fr] px-2 pb-1 text-[10px] uppercase tracking-wide text-muted">
            <span>Price (USDT)</span>
            <span className="text-right">Size ({unit === "quote" ? "USDT" : base})</span>
            <span className="text-right">Total (USDT)</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            {view !== "buy" && <Ladder rows={askRows} side="ask" step={step} unit={unit} edge="end" />}
            <div className="flex items-baseline gap-2 border-y border-line/70 px-2 py-1.5">
              <span className={`font-mono text-[15px] font-semibold ${up ? "text-primary" : "text-danger"}`}>{priceText(mid, step >= 1 ? 1 : 0.01)}</span>
              <span className="font-mono text-[11px] text-muted">{spread > 0 && Number.isFinite(spread) ? `$${priceText(mid, 0.01)}` : "—"}</span>
            </div>
            {view !== "sell" && <Ladder rows={bidRows} side="bid" step={step} unit={unit} edge="start" />}
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-[1.15fr_1fr_auto] px-2 py-1 text-[10px] uppercase tracking-wide text-muted">
            <span>Price (USDT)</span>
            <span className="text-right">Size ({base})</span>
            <span className="text-right">Time</span>
          </div>
          <ul>
            {tape.map((row) => (
              <li key={row.id} className="grid grid-cols-[1.15fr_1fr_auto] px-2 py-[3px] font-mono text-[11px]">
                <span className={row.side === "buy" ? "text-primary" : "text-danger"}>{priceText(row.price, row.price >= 100 ? 0.01 : 0.0001)}</span>
                <span className="text-right text-fg/90">{sizeText(row.qty)}</span>
                <span className="pl-3 text-right text-muted">{row.time}</span>
              </li>
            ))}
            {tape.length === 0 && <li className="px-2 py-8 text-center text-xs text-muted">Waiting on prints.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function withTotal(rows: Level[], side: "ask" | "bid") {
  const ordered = side === "ask" ? [...rows].sort((a, b) => a.price - b.price) : rows;
  let sum = 0;
  const next = ordered.map((row) => {
    sum += row.qty * row.price;
    return { ...row, total: sum };
  });
  return side === "ask" ? next.sort((a, b) => b.price - a.price) : next;
}

function Ladder({ rows, side, step, unit, edge }: { rows: { price: number; qty: number; total: number }[]; side: "ask" | "bid"; step: number; unit: Unit; edge: "start" | "end" }) {
  const max = Math.max(...rows.map((row) => row.total), 1);
  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${edge === "end" ? "justify-end" : ""}`}>
      {rows.map((row) => {
        const size = unit === "quote" ? row.qty * row.price : row.qty;
        return (
          <div key={`${side}-${row.price}`} className="relative grid grid-cols-[1.15fr_1fr_1fr] px-2 py-[3px] font-mono text-[11px]">
            <span
              className="absolute inset-y-0 right-0"
              style={{ width: `${Math.max(6, (row.total / max) * 100)}%`, background: side === "ask" ? "rgba(255,121,102,0.22)" : "rgba(0,236,151,0.18)" }}
            />
            <span className={`relative ${side === "ask" ? "text-danger" : "text-primary"}`}>{priceText(row.price, step)}</span>
            <span className="relative text-right">{sizeText(size)}</span>
            <span className="relative text-right text-fg/75">{sizeText(row.total)}</span>
          </div>
        );
      })}
    </div>
  );
}

function ViewButton({ title, active, onClick, children }: { title: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className={`grid size-7 place-items-center rounded-md ${active ? "bg-surface-2" : "opacity-50 hover:opacity-100"}`}>
      {children}
    </button>
  );
}
