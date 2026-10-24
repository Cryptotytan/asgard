import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, ShieldAlert } from "lucide-react";
import { CandleChart, type ChartHover } from "@/components/terminal/CandleChart";
import { SecurityGate } from "@/components/terminal/SecurityGate";
import { TokenIcon, VerifiedMark } from "@/components/terminal/TokenIcon";
import { PnlCard } from "@/components/terminal/PnlCard";
import {
  canPerp,
  fmt,
  isHoneypot,
  signedPct,
  tokenBySymbol,
  usd,
  px,
  TOKENS,
  type Print,
  type Token,
} from "@/lib/market";
import { useDesk, type Side } from "@/lib/store";
import { liveCandles, livePrints, loadPrints } from "@/lib/live";
import { executeIntent, quoteIntent, type IntentQuote } from "@/lib/intents";

const FRAMES = ["1m", "5m", "15m", "1H", "4H", "1D"] as const;
const BOOKS = ["Trades", "Positions", "Orders", "Holders", "History"] as const;
let stampedId = "";
const PRESETS = [25, 50, 100, 250];
const SLIPS = ["Auto", "0.5%", "1%", "3%"];

type TicketMode = "spot" | "perp";

export function TokenTrade({
  symbol,
  mode,
  quickUsd,
  onMode,
  onSymbol,
  onFlash,
}: {
  symbol: string;
  mode: TicketMode;
  quickUsd: number;
  onMode: (mode: TicketMode) => void;
  onSymbol: (symbol: string) => void;
  onFlash: (message: string) => void;
}) {
  const mark = useDesk((s) => s.marks[symbol]);
  useDesk((s) => s.clock);
  const token = tokenBySymbol(symbol);
  const [frame, setFrame] = useState<(typeof FRAMES)[number]>("5m");
  const [scale, setScale] = useState<"price" | "mcap">("price");
  const [book, setBook] = useState<(typeof BOOKS)[number]>("Trades");
  const [scanning, setScanning] = useState(true);
  const [hover, setHover] = useState<ChartHover | null>(null);

  useEffect(() => {
    setScanning(true);
    setHover(null);
    const timer = window.setTimeout(() => setScanning(false), 480);
    return () => window.clearTimeout(timer);
  }, [symbol]);

  useEffect(() => setHover(null), [frame, scale]);

  useEffect(() => {
    if (!canPerp(symbol) && mode === "perp") onMode("spot");
  }, [symbol, mode, onMode]);

  const last = scale === "price" ? (mark ?? token.price) : token.mcapN;
  const series = scale === "price" ? liveCandles(symbol) : undefined;
  const bars = series && series.length > 1 ? series : [];
  const open = bars[0] ?? { o: last, h: last, l: last, c: last };
  const close = bars[bars.length - 1] ?? open;
  const high = bars.length ? Math.max(...bars.map((bar) => bar.h)) : last;
  const low = bars.length ? Math.min(...bars.map((bar) => bar.l)) : last;
  const delta = close.c - open.o;
  const prints = livePrints(symbol) ?? [];
  useEffect(() => {
    if (scale !== "price") return;
    void loadPrints(symbol).catch(() => undefined);
  }, [symbol, scale]);

  return (
    <div className="flex flex-col lg:block">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 sm:flex-col sm:items-stretch sm:px-4 lg:flex-row lg:items-center lg:justify-between">
        <TokenMenu token={token} scanning={scanning} onPick={onSymbol} />
        <p className="ml-auto shrink-0 font-mono text-sm sm:hidden">{px(token.price)}</p>
        <dl className="hidden grid-cols-4 gap-x-3 gap-y-1 sm:grid lg:grid-cols-8">
          <Stat k="Mcap" v={token.mcap} />
          <Stat k="Price" v={px(token.price)} />
          <Stat k="Liq" v={token.liquidity} />
          <Stat k="Vol" v={token.volume} />
          <Stat k="Supply" v={token.supply} className="hidden lg:block" />
          <Stat k="FDV" v={token.fdv} className="hidden lg:block" />
          <Stat k="Txns" v={token.txns} className="hidden lg:block" />
          <div className="hidden lg:block">
            <dt className="text-xs text-muted">Safety</dt>
            <dd className="mt-0.5 flex items-center gap-2">
              <span className="font-mono text-sm text-muted">{token.score > 0 ? `${token.score}/100` : "Live"}</span>
            </dd>
          </div>
        </dl>
      </header>

      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:grid-rows-[auto_minmax(0,1fr)] lg:items-start">
        <section className="relative order-1 lg:col-start-1 lg:row-start-1 lg:self-start lg:border-r lg:border-line">
          <div className="flex items-center gap-2 px-3 pt-3 sm:px-4 sm:py-2">
            <div className="grid min-w-0 flex-1 grid-cols-6 gap-1">
              {FRAMES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setFrame(item)}
                  className={`h-8 rounded-md px-1 text-[11px] sm:h-8 sm:bg-transparent sm:px-0 sm:text-xs ${frame === item ? "bg-surface-2 text-fg" : "text-muted"}`}
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="flex shrink-0 rounded-lg bg-surface p-0.5 text-[11px] sm:text-xs">
              {(["price", "mcap"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setScale(item)}
                  className={`h-8 rounded-md px-2 uppercase sm:px-2 ${scale === item ? "bg-surface-2 text-fg" : "text-muted"}`}
                >
                  {item === "price" ? "Price" : "Mcap"}
                </button>
              ))}
            </div>
          </div>
          <p className="hidden px-4 font-mono text-xs text-muted sm:block">
            {bars.length < 2 ? (
              "Waiting on DefiLlama candles"
            ) : hover ? (
              <>
                {hover.label} O {fmt(hover.o)} H {fmt(hover.h)} L {fmt(hover.l)} C {fmt(hover.c)}{" "}
                <span className={hover.c >= hover.o ? "text-primary" : "text-danger"}>
                  {hover.c >= hover.o ? "+" : ""}
                  {fmt(hover.c - hover.o)} ({hover.c >= hover.o ? "+" : ""}
                  {((hover.c - hover.o) / hover.o * 100).toFixed(2)}%)
                </span>
              </>
            ) : (
              <>
                O {fmt(open.o)} H {fmt(high)} L {fmt(low)} C {fmt(close.c)}{" "}
                <span className={delta >= 0 ? "text-primary" : "text-danger"}>
                  {delta >= 0 ? "+" : ""}
                  {fmt(delta)} ({delta >= 0 ? "+" : ""}
                  {((delta / open.o) * 100).toFixed(2)}%)
                </span>
              </>
            )}
          </p>
          <div className="px-3 py-3 sm:px-0 sm:py-0">
            <CandleChart seed={`${symbol}-${frame}-${scale}`} last={last} frame={frame} compact={scale === "mcap"} live={scale === "price" ? mark : undefined} series={series} onHover={setHover} />
          </div>
        </section>
        <div className="order-2 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-stretch">
          <Ticket token={token} mode={mode} quickUsd={quickUsd} scanning={scanning} onMode={onMode} onFlash={onFlash} />
        </div>
        <section className="book-hinge order-3 border-t border-line lg:col-start-1 lg:row-start-2 lg:self-stretch lg:border-r lg:border-t-0">
          <div className="grid grid-cols-5 border-b border-line bg-bg">
            {BOOKS.map((item) => (
              <button
                key={item}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setBook(item)}
                className={`h-7 min-w-0 truncate px-0.5 text-[10px] sm:h-10 sm:text-sm ${book === item ? "text-fg shadow-[inset_0_-2px_0_var(--color-primary)]" : "text-muted"}`}
              >
                {item === "Holders" ? (
                  <>
                    <span className="sm:hidden">Hold</span>
                    <span className="hidden sm:inline">Holders</span>
                  </>
                ) : (
                  item
                )}
              </button>
            ))}
          </div>
          <div key={book} className="book-page px-2 pb-1 sm:px-4 sm:pb-3 lg:min-h-[26rem]">
            {book === "Trades" && <Trades prints={prints} symbol={token.symbol} />}
            {book === "Positions" && <Positions symbol={token.symbol} mark={token.price} />}
            {book === "Orders" && <Orders symbol={token.symbol} />}
            {book === "Holders" && <Holders />}
            {book === "History" && <SessionHistory />}
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ k, v, className = "" }: { k: string; v: string; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="truncate font-mono text-xs sm:text-sm">{v}</dd>
    </div>
  );
}

function TokenMenu({ token, scanning, onPick }: { token: Token; scanning: boolean; onPick: (symbol: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const list = useMemo(
    () => TOKENS.filter((item) => `${item.symbol} ${item.name} ${item.chain}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 12),
    [query],
  );

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={box} className="relative min-w-0">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex max-w-full items-center gap-2 rounded-xl px-1 py-1 pr-2 text-left hover:bg-surface" aria-expanded={open} aria-haspopup="listbox">
        <TokenIcon token={token} className="size-9 rounded-lg sm:size-10" />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 font-semibold">
            <span className="truncate">{token.name}</span>
            <span className="font-normal text-muted">{token.symbol}</span>
            {scanning ? (
              <span className="text-xs font-normal text-muted">Scanning…</span>
            ) : token.verified ? (
              <VerifiedMark />
            ) : (
              <ShieldAlert className="size-4 text-danger" aria-label="Not verified" />
            )}
            <ChevronDown className={`size-4 text-muted transition ${open ? "rotate-180" : ""}`} />
          </span>
          <span className="block truncate text-xs text-muted">
            {token.tag} · {token.chain}
          </span>
        </span>
      </button>
      {open && (
        <div className="panel menu-pop absolute left-0 top-full z-30 mt-1 w-[min(18rem,calc(100vw-1.5rem))] p-2">
          <label className="mb-2 flex h-10 items-center gap-2 rounded-xl border border-line px-3">
            <Search className="size-4 text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search token"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <ul className="max-h-64 overflow-y-auto">
            {list.map((item) => (
              <li key={item.symbol}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(item.symbol);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-surface-2"
                >
                  <TokenIcon token={item} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 font-semibold">
                      {item.symbol}
                      {item.verified && <VerifiedMark />}
                    </span>
                    <span className="block truncate text-xs text-muted">{item.name}</span>
                  </span>
                  <span className="font-mono text-xs text-muted">{item.mcap}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SessionHistory() {
  const activity = useDesk((s) => s.activity);
  const newest = activity[0]?.id ?? "";
  const [landed, setLanded] = useState("");
  useEffect(() => {
    if (!newest || newest === stampedId) return;
    stampedId = newest;
    setLanded(newest);
    const timer = window.setTimeout(() => setLanded(""), 480);
    return () => window.clearTimeout(timer);
  }, [newest]);
  if (activity.length === 0) {
    return <p className="py-6 text-sm text-muted">Fills from this session show up here with their value.</p>;
  }
  return (
    <ul className="divide-y divide-line">
      {activity.map((item) => (
        <li key={item.id} className={`flex items-center justify-between gap-3 py-2 text-sm ${landed === item.id ? "stamp" : ""}`}>
          <span className="min-w-0">
            <span className="block font-semibold">{item.title}</span>
            <span className="block truncate text-xs text-muted">{item.detail}</span>
          </span>
          <span className={`shrink-0 font-mono text-xs ${item.value < 0 ? "text-danger" : ""}`}>{usd(item.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function Trades({ prints, symbol }: { prints: Print[]; symbol: string }) {
  if (prints.length === 0) {
    return <p className="py-6 text-sm text-muted">No recent NEAR transfers for {symbol} yet. The tape reads NearBlocks, not a simulated book.</p>;
  }
  const mobile = prints.slice(0, 4);
  return (
    <div>
      <ul className="sm:hidden">
        <li className="grid grid-cols-[2rem_2.4rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_3rem] gap-1 py-0.5 text-[10px] uppercase text-muted">
          <span>Time</span>
          <span>Type</span>
          <span>Amount</span>
          <span>Total</span>
          <span>Price</span>
          <span className="text-right">Trader</span>
        </li>
        {mobile.map((row, index) => (
          <li key={`${row.trader}-${row.age}-${index}`} className="grid grid-cols-[2rem_2.4rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_3rem] gap-1 border-t border-line py-1 font-mono text-[10px]">
            <span className="text-muted">{row.age}</span>
            <span className={row.side === "Buy" ? "text-primary" : "text-danger"}>{row.side}</span>
            <span className="truncate">{fmt(row.amount)}</span>
            <span className="truncate">{row.usd >= 0.01 ? usd(row.usd) : px(row.usd)}</span>
            <span className="truncate">{fmt(row.price)}</span>
            <span className="truncate text-right text-muted">{row.trader}</span>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-auto sm:block">
        <table className="w-full text-left font-mono text-xs">
          <thead className="text-muted">
            <tr>
              <th className="py-2 font-normal">Time</th>
              <th className="font-normal">Type</th>
              <th className="font-normal">Amount {symbol}</th>
              <th className="font-normal">Total USD</th>
              <th className="font-normal">Price</th>
              <th className="font-normal">Trader</th>
            </tr>
          </thead>
          <tbody>
            {prints.map((row, index) => (
              <tr key={`${row.trader}-${row.age}-${index}`} className="border-t border-line">
                <td className="py-2 text-muted">{row.age}</td>
                <td className={row.side === "Buy" ? "text-primary" : "text-danger"}>{row.side}</td>
                <td>{fmt(row.amount)}</td>
                <td>{row.usd >= 0.01 ? usd(row.usd) : px(row.usd)}</td>
                <td>{fmt(row.price)}</td>
                <td className="text-muted">{row.trader}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Positions({ symbol, mark }: { symbol: string; mark: number }) {
  const balances = useDesk((s) => s.balances);
  const positions = useDesk((s) => s.positions);
  const closePerp = useDesk((s) => s.closePerp);
  const marks = useDesk((s) => s.marks);
  const held = balances[symbol] ?? 0;
  const perps = positions.filter((position) => position.base === symbol);
  return (
    <div className="space-y-3 py-3 text-sm">
      <p className="font-mono">
        Holding {fmt(held)} {symbol} · {usd(held * mark)}
      </p>
      {perps.length === 0 ? (
        <p className="text-muted">No open perp on {symbol}.</p>
      ) : (
        perps.map((position) => (
          <PnlCard
            key={position.id}
            position={position}
            mark={marks[position.base] ?? position.entry}
            onClose={() => closePerp(position.id)}
          />
        ))
      )}
    </div>
  );
}

function Orders({ symbol }: { symbol: string }) {
  const orders = useDesk((s) => s.orders);
  const cancelOrder = useDesk((s) => s.cancelOrder);
  const list = orders.filter((order) => order.symbol === symbol);
  if (list.length === 0) return <p className="py-6 text-sm text-muted">No open orders. Limits rest here until the market reaches them.</p>;
  return (
    <ul className="py-2">
      {list.map((order) => (
        <li key={order.id} className="flex items-center justify-between gap-2 border-t border-line py-2 font-mono text-xs">
          <span>
            {order.kind} {order.side} {fmt(order.amount)} @ {fmt(order.limit)}
          </span>
          <button type="button" className="h-10 rounded-lg border border-line px-3" onClick={() => cancelOrder(order.id)}>
            Cancel
          </button>
        </li>
      ))}
    </ul>
  );
}

function Holders() {
  return <p className="py-6 text-sm text-muted">Holder concentration is not published on the live feed. Balances you see in Portfolio are read from NEAR mainnet.</p>;
}

function Ticket({
  token,
  mode,
  quickUsd,
  scanning,
  onMode,
  onFlash,
}: {
  token: Token;
  mode: TicketMode;
  quickUsd: number;
  scanning: boolean;
  onMode: (mode: TicketMode) => void;
  onFlash: (message: string) => void;
}) {
  const listed = canPerp(token.symbol);
  const viewMode: TicketMode = listed ? mode : "spot";
  const connected = useDesk((s) => s.connected);
  const accountId = useDesk((s) => s.accountId);
  const balances = useDesk((s) => s.balances);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [perpSide, setPerpSide] = useState<Side>("long");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [amount, setAmount] = useState(String(quickUsd));
  const [slip, setSlip] = useState("Auto");
  const [lev, setLev] = useState(5);
  const [marginMode, setMarginMode] = useState<"cross" | "isolated">("cross");
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [reduceOnly, setReduceOnly] = useState(false);
  const [perpType, setPerpType] = useState<"market" | "limit">("market");
  const [routesOpen, setRoutesOpen] = useState(false);
  const [deck, setDeck] = useState(0);
  const [busy, setBusy] = useState(false);
  const [acked, setAcked] = useState(false);
  const [gate, setGate] = useState(false);
  const [fills, setFills] = useState({ bought: 0, sold: 0 });
  const [live, setLive] = useState<IntentQuote | null>(null);
  const [quoting, setQuoting] = useState(false);

  useEffect(() => {
    setAmount(String(quickUsd));
    setAcked(false);
    setSide("buy");
    setFills({ bought: 0, sold: 0 });
  }, [token.symbol, quickUsd]);

  const qty = Number(amount) || 0;
  const pay = side === "buy" ? tokenBySymbol("USDC") : token;
  const receiveToken = side === "buy" ? token : tokenBySymbol("USDC");
  const slipPct = slip === "Auto" ? 1 : Number(slip.replace("%", ""));
  useEffect(() => {
    setLive(null);
    if (!connected || !accountId || qty <= 0 || pay.symbol === receiveToken.symbol) return;
    setQuoting(true);
    const timer = window.setTimeout(() => {
      void quoteIntent({
        from: pay.symbol,
        to: receiveToken.symbol,
        amount: String(qty),
        accountId,
        dry: true,
        slippageBps: Math.round(slipPct * 100),
      })
        .then((quote) => setLive(quote))
        .catch(() => setLive(null))
        .finally(() => setQuoting(false));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [accountId, connected, pay.symbol, qty, receiveToken.symbol, slipPct]);
  const quotes = useMemo(() => {
    if (!live) return [];
    const impact = live.amountInUsd > 0 ? Math.max(0, (1 - live.amountOutUsd / live.amountInUsd) * 100) : 0;
    const feeBps = live.amountInUsd > 0 ? Math.max(0, ((live.amountInUsd - live.amountOutUsd) / live.amountInUsd) * 10_000) : 0;
    return [
      {
        venue: { id: "intents", name: "NEAR Intents", kind: "Bridge" as const, feeBps, impactBps: Math.round(impact * 100), depthUsd: 0, eta: `${live.timeEstimate}s` },
        feeBps,
        impact,
        receive: live.amountOutHuman,
        score: 0,
      },
    ];
  }, [live]);
  const quoteKey = quotes.map((quote) => `${quote.venue.id}:${quote.receive.toFixed(2)}`).join("|");
  useEffect(() => {
    if (!routesOpen) return;
    setDeck((value) => value + 1);
  }, [routesOpen, quoteKey]);
  const minFee = Math.min(...quotes.map((quote) => quote.feeBps), Infinity);
  const minImpact = Math.min(...quotes.map((quote) => quote.impact), Infinity);
  const picked = quotes[0];
  const receive = picked?.receive ?? 0;
  const blocked = isHoneypot(token);
  const balance = balances[pay.symbol] ?? 0;
  const windows = [
    ["5M", token.windows.m5],
    ["1H", token.windows.h1],
    ["4H", token.windows.h4],
    ["24H", token.windows.h24],
  ] as const;

  function execute() {
    if (token.symbol === "USDC" && side === "buy") {
      onFlash("Pick another token to buy against USDC.");
      return;
    }
    if (qty <= 0) {
      onFlash("Enter an amount.");
      return;
    }
    const desk = useDesk.getState();
    if (!desk.connected) {
      desk.connect();
      onFlash("Connect a NEAR wallet to trade.");
      return;
    }
    if (viewMode === "perp") {
      if (token.symbol !== "NEAR" && token.symbol !== "ETH") {
        onFlash("Perps are listed on NEAR and ETH.");
        return;
      }
      const limit = perpType === "limit" ? Number(limitPrice) || token.price : undefined;
      const ok = useDesk.getState().openPerp(`${token.symbol}-PERP`, token.symbol, perpSide, qty, lev, {
        tp: Number(tp) || undefined,
        sl: Number(sl) || undefined,
        reduceOnly,
        limit,
      });
      const guards = [tp && `TP ${tp}`, sl && `SL ${sl}`, reduceOnly && "reduce-only"].filter(Boolean).join(" · ");
      onFlash(ok ? `${limit ? "Limit " : ""}${perpSide} ${token.symbol} ${lev}x ${marginMode}${guards ? ` · ${guards}` : ""}. Margin stays in this wallet.` : "Not enough USDC margin");
      return;
    }
    if (orderType === "limit") {
      const limit = Number(limitPrice) || token.price;
      const ok = useDesk.getState().placeOrder({
        symbol: token.symbol,
        kind: "spot",
        side,
        amount: qty,
        limit,
        pay: pay.symbol,
        receive: receiveToken.symbol,
      });
      onFlash(ok ? `Limit ${side} parked at ${fmt(limit)}. Market orders settle on NEAR Intents.` : "Not enough balance");
      return;
    }
    const accountId = useDesk.getState().accountId;
    if (!accountId) {
      onFlash("Connect a NEAR wallet to trade.");
      return;
    }
    if (!picked) {
      onFlash("No route inside your slippage.");
      return;
    }
    onFlash(`Confirm the deposit. ${picked.venue.name} has the lowest fee and impact inside your slippage.`);
    void executeIntent({
      from: pay.symbol,
      to: receiveToken.symbol,
      amount: String(qty),
      accountId,
      purpose: "Spot",
      slippageBps: slipPct * 100,
      maxImpactPct: slipPct,
    })
      .then((result) => {
        setFills((prev) => (side === "buy" ? { ...prev, bought: prev.bought + qty } : { ...prev, sold: prev.sold + qty * token.price }));
        onFlash(`${side === "buy" ? "Bought" : "Sold"} ${token.symbol} via ${picked.venue.name} · ${fmt(result.amountOutHuman)} ${receiveToken.symbol} · ${result.status}`);
      })
      .catch((error: unknown) => onFlash(error instanceof Error ? error.message : "The route rejected the trade."));
  }

  function submit() {
    if (scanning || busy || blocked) return;
    setBusy(true);
    window.setTimeout(() => {
      setBusy(false);
      if (!token.verified && !acked) {
        setGate(true);
        return;
      }
      execute();
    }, 320);
  }

  return (
    <aside className="px-2 py-1 lg:p-4">
      <div className="deck panel p-1.5 sm:p-3">
      <div className="mb-2 hidden grid-cols-4 gap-1 text-center font-mono text-xs sm:grid">
        {windows.map(([label, value]) => (
          <div key={label}>
            <p className="text-muted">{label}</p>
            <p className={value >= 0 ? "text-primary" : "text-danger"}>{signedPct(value)}</p>
          </div>
        ))}
      </div>
      {listed ? (
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-bg p-1">
          <button type="button" onClick={() => onMode("spot")} className={`h-9 rounded-lg text-sm font-semibold ${viewMode === "spot" ? "bg-surface-2 text-fg shadow-[inset_0_-2px_0_var(--color-primary)]" : "text-muted"}`}>
            Spot
          </button>
          <button type="button" onClick={() => onMode("perp")} className={`h-9 rounded-lg text-sm font-semibold ${viewMode === "perp" ? "bg-surface-2 text-fg shadow-[inset_0_-2px_0_var(--color-primary)]" : "text-muted"}`}>
            Perps
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-bg p-1" aria-label="Spot only">
          <div className="grid h-9 place-items-center rounded-lg bg-surface-2 text-sm font-semibold text-fg shadow-[inset_0_-2px_0_var(--color-primary)]">Spot</div>
          <div className="grid h-9 place-items-center rounded-lg text-sm text-muted/45" title="Perps are not listed for this token">
            Perps
          </div>
        </div>
      )}

      {viewMode === "spot" ? (
        <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-xl bg-bg p-0.5">
          <button type="button" onClick={() => setSide("buy")} className={`h-8 rounded-lg text-sm font-semibold sm:h-11 ${side === "buy" ? "bg-primary text-primary-fg" : "text-muted"}`}>
            Buy
          </button>
          <button type="button" onClick={() => setSide("sell")} className={`h-8 rounded-lg text-sm font-semibold sm:h-11 ${side === "sell" ? "bg-danger text-bg" : "text-muted"}`}>
            Sell
          </button>
        </div>
      ) : (
        <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-xl bg-bg p-0.5">
          <button type="button" onClick={() => setPerpSide("long")} className={`h-8 rounded-lg text-sm font-semibold sm:h-11 ${perpSide === "long" ? "bg-primary text-primary-fg" : "text-muted"}`}>
            Long
          </button>
          <button type="button" onClick={() => setPerpSide("short")} className={`h-8 rounded-lg text-sm font-semibold sm:h-11 ${perpSide === "short" ? "bg-danger text-bg" : "text-muted"}`}>
            Short
          </button>
        </div>
      )}

      {viewMode === "spot" && (
        <div className="mt-2 flex gap-3 text-xs">
          {(["market", "limit"] as const).map((item) => (
            <button key={item} type="button" onClick={() => setOrderType(item)} className={orderType === item ? "font-semibold text-fg" : "text-muted"}>
              {item === "market" ? "Market" : "Limit"}
            </button>
          ))}
        </div>
      )}

      <label className="mt-2 flex h-11 items-center gap-2 rounded-xl border border-line bg-bg px-3">
        <span className="text-[10px] uppercase tracking-wide text-muted">{viewMode === "perp" ? "Size" : "Amount"}</span>
        <input
          inputMode="decimal"
          value={amount}
          aria-label="Order amount"
          onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
          className="min-w-0 flex-1 bg-transparent font-mono text-base outline-none"
        />
        <span className="flex items-center gap-1 text-sm">
          <TokenIcon token={viewMode === "perp" || side === "buy" ? tokenBySymbol("USDC") : token} className="size-4" />
          {viewMode === "perp" ? "USD" : side === "buy" ? "USDC" : token.symbol}
        </span>
      </label>
      {viewMode === "spot" && orderType === "limit" && (
        <label className="mt-2 flex h-11 items-center gap-2 rounded-xl border border-line bg-bg px-3">
          <span className="text-[10px] uppercase tracking-wide text-muted">Price</span>
          <input
            inputMode="decimal"
            value={limitPrice}
            placeholder={fmt(token.price)}
            aria-label="Limit price"
            onChange={(event) => setLimitPrice(event.target.value.replace(/[^0-9.]/g, ""))}
            className="min-w-0 flex-1 bg-transparent font-mono text-base outline-none"
          />
          <span className="text-xs text-muted">USD</span>
        </label>
      )}
      <div className="mt-2 grid grid-cols-4 gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setAmount(String(viewMode === "perp" || side === "buy" ? preset : Number((preset / token.price).toPrecision(6))))}
            className="h-8 rounded-lg bg-surface-2 text-xs sm:h-10 sm:text-sm"
          >
            {preset}
          </button>
        ))}
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-muted">
        <input
          type="range"
          min={0}
          max={100}
          defaultValue={0}
          aria-label="Percent of balance"
          onChange={(event) => {
            const pct = Number(event.target.value) / 100;
            const base = viewMode === "perp" ? (balances.USDC ?? 0) * lev : balance;
            setAmount(String(Number((base * pct).toPrecision(6))));
          }}
        />
        <span className="shrink-0">Balance</span>
      </label>

      {viewMode === "perp" ? (
        <div className="mt-3 space-y-2">
          <div className="flex gap-3 text-xs">
            {(["market", "limit"] as const).map((item) => (
              <button key={item} type="button" onClick={() => setPerpType(item)} className={perpType === item ? "font-semibold text-fg" : "text-muted"}>
                {item === "market" ? "Market" : "Limit"}
              </button>
            ))}
          </div>
          {perpType === "limit" && (
            <label className="flex h-11 items-center gap-2 rounded-xl border border-line bg-bg px-3">
              <span className="text-[10px] uppercase tracking-wide text-muted">Price</span>
              <input
                inputMode="decimal"
                value={limitPrice}
                placeholder={fmt(token.price)}
                aria-label="Perp limit price"
                onChange={(event) => setLimitPrice(event.target.value.replace(/[^0-9.]/g, ""))}
                className="min-w-0 flex-1 bg-transparent font-mono text-base outline-none"
              />
            </label>
          )}
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-bg p-1">
            {(["cross", "isolated"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMarginMode(item)}
                className={`h-8 rounded-lg text-xs capitalize ${marginMode === item ? "bg-surface-2 text-fg" : "text-muted"}`}
              >
                {item}
              </button>
            ))}
          </div>
          <div>
            <div className="flex items-center justify-between text-xs text-muted">
              <span>Leverage</span>
              <span className="font-mono text-fg">{lev}x</span>
            </div>
            <input type="range" min={1} max={20} value={lev} aria-label="Leverage" onChange={(event) => setLev(Number(event.target.value))} className="mt-1" />
            <div className="mt-1 grid grid-cols-4 gap-1">
              {[1, 5, 10, 20].map((step) => (
                <button key={step} type="button" onClick={() => setLev(step)} className={`h-7 rounded-lg text-xs ${lev === step ? "bg-surface-2 text-fg" : "bg-bg text-muted"}`}>
                  {step}x
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[10px] uppercase tracking-wide text-muted">
              Take profit
              <input
                inputMode="decimal"
                value={tp}
                placeholder="Price"
                aria-label="Take profit"
                onChange={(event) => setTp(event.target.value.replace(/[^0-9.]/g, ""))}
                className="mt-1 h-10 w-full rounded-xl border border-line bg-bg px-3 font-mono text-sm text-fg outline-none"
              />
            </label>
            <label className="block text-[10px] uppercase tracking-wide text-muted">
              Stop loss
              <input
                inputMode="decimal"
                value={sl}
                placeholder="Price"
                aria-label="Stop loss"
                onChange={(event) => setSl(event.target.value.replace(/[^0-9.]/g, ""))}
                className="mt-1 h-10 w-full rounded-xl border border-line bg-bg px-3 font-mono text-sm text-fg outline-none"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={reduceOnly} onChange={(event) => setReduceOnly(event.target.checked)} className="size-4" />
            Reduce only
          </label>
          <dl className="grid grid-cols-2 gap-y-1 font-mono text-[11px]">
            <div>
              <dt className="text-muted">Margin</dt>
              <dd>{usd(qty / lev || 0)}</dd>
            </div>
            <div>
              <dt className="text-muted">Notional</dt>
              <dd>{usd(qty || 0)}</dd>
            </div>
            <div>
              <dt className="text-muted">Mark</dt>
              <dd>{px(token.price)}</dd>
            </div>
            <div>
              <dt className="text-muted">Liq. price</dt>
              <dd>{px(perpSide === "long" ? token.price * (1 - 0.9 / lev) : token.price * (1 + 0.9 / lev))}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-muted">
            <span className="font-mono">Bal {fmt(balance)} {pay.symbol}</span>
            <button type="button" onClick={() => setSlip(SLIPS[(SLIPS.indexOf(slip) + 1) % SLIPS.length])}>
              Slippage {slip}
            </button>
          </div>
          {picked ? (
            <div className="mt-2 rounded-xl border border-line p-3 text-xs">
              <p className="text-muted">Cheapest fee, then lowest impact, inside slippage</p>
              <p className="mt-1 font-semibold">{picked.venue.name}</p>
              <p className="mt-1 font-mono text-muted">
                Fee {(picked.feeBps / 100).toFixed(2)}% · impact {picked.impact.toFixed(2)}% · {picked.venue.eta}
              </p>
              <p className="mt-1 font-mono">
                You receive {fmt(receive)} {receiveToken.symbol}
              </p>
              <button type="button" onClick={() => setRoutesOpen((open) => !open)} className="mt-2 text-primary">
                {routesOpen ? "Hide routes" : "Compare routes"}
              </button>
              {routesOpen && (
                <ul className="route-deck mt-2 space-y-1">
                  {quotes.map((quote, index) => (
                    <li
                      key={`${deck}-${quote.venue.id}`}
                      className={`route-card ${index === 0 ? "is-best" : ""}`}
                      style={{ animationDelay: `${index * 45}ms` }}
                    >
                      <div className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left ${index === 0 ? "bg-surface-2" : ""}`}>
                        <span>
                          {quote.venue.name}
                          <span className="mt-0.5 block text-muted">
                            {quote.feeBps === minFee ? "Lowest fee" : `${(quote.feeBps / 100).toFixed(2)}% fee`}
                            {" · "}
                            {quote.impact === minImpact ? "Lowest impact" : `${quote.impact.toFixed(2)}% impact`}
                          </span>
                        </span>
                        {index === 0 && <span className="text-primary">Best</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted">{connected ? (quoting ? "Fetching the NEAR Intents quote…" : "No live Intents quote for this size.") : "Connect a wallet for a live Intents quote."}</p>
          )}
        </div>
      )}

      <div className={`relative mt-1.5 overflow-hidden rounded-lg px-2 py-1 text-xs sm:mt-3 sm:block sm:p-3 sm:text-sm ${blocked ? "bg-surface-2" : "bg-surface"}`}>
        {scanning && <span className="scan-shutter" aria-hidden />}
        {scanning ? (
          <p className="text-muted">Scanning {token.symbol}…</p>
        ) : token.verified && !blocked ? (
          <p className="flex items-start gap-2">
            <VerifiedMark className="mt-0.5" />
            <span>
              Listed asset
              <span className="mt-1 hidden text-xs text-muted sm:block">{token.notes.join(" · ")}</span>
            </span>
          </p>
        ) : (
          <p className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 size-4 text-danger" />
            <span>
              {blocked ? "Honeypot · swap blocked" : `Not verified · ${token.score}/100`}
              <span className="mt-1 hidden text-xs text-muted sm:block">{token.notes.join(" · ")}</span>
            </span>
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={scanning || busy || blocked}
        onClick={submit}
        className="press mt-1.5 h-9 w-full rounded-xl bg-primary text-sm font-semibold text-primary-fg disabled:opacity-50 sm:mt-3 sm:h-12"
      >
        {blocked ? "Swap blocked" : scanning || busy ? "Scanning" : connected ? (viewMode === "perp" ? `Open ${perpSide}` : side === "buy" ? "Buy via Intents" : "Sell via Intents") : "Connect to trade"}
      </button>

      <dl className="mt-3 hidden grid-cols-2 gap-2 font-mono text-xs sm:grid">
        <Stat k="Holding" v={usd((balances[token.symbol] ?? 0) * token.price)} />
        <Stat k="USDC" v={usd(balances.USDC ?? 0)} />
        <Stat k="Bought" v={usd(fills.bought)} />
        <Stat k="Sold" v={usd(fills.sold)} />
      </dl>

      <div className="mt-4 hidden border-t border-line pt-3 sm:block">
        <p className="mb-2 text-sm font-semibold">Sources</p>
        <p className="text-xs text-muted">Price and candles: DefiLlama. Liquidity and lend rates: Rhea. Transfers: NearBlocks. Quotes: NEAR Intents. Taxes, snipers, and holder share are not invented when a feed does not publish them.</p>
      </div>
      </div>
      {gate && (
        <SecurityGate
          token={token}
          onClose={() => setGate(false)}
          onConfirm={() => {
            setAcked(true);
            setGate(false);
            execute();
          }}
        />
      )}
    </aside>
  );
}
