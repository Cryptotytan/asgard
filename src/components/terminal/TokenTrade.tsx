import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Search, ShieldAlert } from "lucide-react";
import { CandleChart, type ChartHover } from "@/components/terminal/CandleChart";
import { SecurityGate } from "@/components/terminal/SecurityGate";
import { TokenIcon, VerifiedMark, ChainBadge } from "@/components/terminal/TokenIcon";
import { PnlCard } from "@/components/terminal/PnlCard";
import {
  canPerp,
  displayName,
  fmt,
  isHoneypot,
  qualityScore,
  scoreLabel,
  signedPct,
  tokenBySymbol,
  usd,
  px,
  TOKENS,
  type Print,
  type Token,
} from "@/lib/market";
import { useDesk, type Side } from "@/lib/store";
import { candleMeta, liveCandles, livePrints, loadHolders, loadOlderCandles, loadPrints, warmCharts, watchCandles, type HolderBand, type HolderRow } from "@/lib/live";
import { searchTokens } from "@/lib/dex";
import { quoteRoutes, type LiveRoute } from "@/lib/routes";

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
  const [frame, setFrame] = useState<(typeof FRAMES)[number]>("15m");
  const [scale, setScale] = useState<"price" | "mcap">("price");
  const [book, setBook] = useState<(typeof BOOKS)[number]>("Trades");
  const scanning = false;
  const [hover, setHover] = useState<ChartHover | null>(null);

  useEffect(() => setFrame("15m"), [symbol]);
  useEffect(() => setHover(null), [frame, scale]);

  useEffect(() => {
    if (!canPerp(symbol) && mode === "perp") onMode("spot");
  }, [symbol, mode, onMode]);

  const last = scale === "price" ? (mark ?? token.price) : token.mcapN;
  const series = scale === "price" ? liveCandles(symbol, frame) : undefined;
  const history = candleMeta(symbol, frame);
  const needOlder = useCallback(() => {
    if (scale !== "price") return;
    void loadOlderCandles(symbol, frame);
  }, [symbol, frame, scale]);
  const bars = series && series.length > 1 ? series : [];
  const open = bars[0] ?? { o: last, h: last, l: last, c: last };
  const close = bars[bars.length - 1] ?? open;
  const high = bars.length ? Math.max(...bars.map((bar) => bar.h)) : last;
  const low = bars.length ? Math.min(...bars.map((bar) => bar.l)) : last;
  const delta = close.c - open.o;
  const prints = livePrints(symbol) ?? [];
  useEffect(() => {
    warmCharts(symbol);
    if (scale !== "price") return;
    return watchCandles(symbol, frame);
  }, [symbol, frame, scale]);
  useEffect(() => {
    if (scale !== "price") return;
    void loadPrints(symbol).catch(() => undefined);
  }, [symbol, scale]);

  return (
    <div className="flex flex-col lg:block">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 sm:flex-col sm:items-stretch sm:px-4 lg:flex-row lg:items-center lg:justify-between">
        <TokenMenu token={token} scanning={scanning} onPick={onSymbol} />
        <p className="ml-auto shrink-0 font-mono text-sm sm:hidden">{px(token.price)}</p>
        <dl className="scroll-x hidden min-w-0 flex-1 items-stretch overflow-x-auto sm:flex">
          <Stat k="Mcap" v={token.mcap} />
          <Stat k="Price" v={px(token.price)} accent />
          <Stat k="Liq" v={token.liquidity} />
          <Stat k="Vol" v={token.volume} />
          <Stat k="Supply" v={token.supply} />
          <Stat k="FDV" v={token.fdv} />
          <Stat k="Txns" v={token.txns} />
          <SafetyStat token={token} />
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
              "Waiting on the live chart"
            ) : hover ? (
              <>
                {hover.label} O {fmt(hover.o)} H {fmt(hover.h)} L {fmt(hover.l)} C {fmt(hover.c)}{" "}
                <span className={hover.c >= hover.o ? "text-primary" : "text-danger"}>
                  {hover.c >= hover.o ? "+" : ""}
                  {fmt(hover.c - hover.o)} ({hover.c >= hover.o ? "+" : ""}
                  {(((hover.c - hover.o) / hover.o) * 100).toFixed(2)}%)
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
            <CandleChart
              seed={`${symbol}-${frame}-${scale}`}
              last={last}
              frame={frame}
              compact={scale === "mcap"}
              live={scale === "price" ? mark : undefined}
              series={series}
              historyEnded={history.exhausted}
              historyTick={history.from}
              onHover={setHover}
              onNeedHistory={scale === "price" ? needOlder : undefined}
            />
          </div>
        </section>
        <div className="order-2 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-stretch">
          <Ticket token={token} mode={mode} quickUsd={quickUsd} scanning={scanning} onMode={onMode} onFlash={onFlash} />
        </div>
        <section className="book-hinge order-3 border-t border-line lg:col-start-1 lg:row-start-2 lg:self-stretch lg:border-r lg:border-t-0">
          <div className="scroll-x flex gap-1 border-b border-line bg-bg px-2 py-1.5 sm:px-3">
            {BOOKS.map((item) => (
              <button
                key={item}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setBook(item)}
                className={`h-8 shrink-0 rounded-full px-3 text-xs font-semibold sm:flex-1 sm:text-sm ${book === item ? "bg-surface-2 text-fg shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-muted"}`}
              >
                {item}
              </button>
            ))}
          </div>
          <div key={book} className="book-page px-3 pb-3 pt-1 sm:px-4 lg:min-h-[26rem]">
            {book === "Trades" && <Trades prints={prints} symbol={token.symbol} />}
            {book === "Positions" && <Positions symbol={token.symbol} mark={token.price} />}
            {book === "Orders" && <Orders symbol={token.symbol} />}
            {book === "Holders" && <Holders token={token} />}
            {book === "History" && <SessionHistory />}
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ k, v, accent = false }: { k: string; v: string; accent?: boolean }) {
  const empty = !v || v === "—" || v === "–" || v === "-";
  return (
    <div className="flex min-w-[5.4rem] shrink-0 flex-col justify-center border-l border-line px-3 first:border-l-0 first:pl-1">
      <dt className="text-[10px] uppercase tracking-[0.16em] text-muted">{k}</dt>
      <dd className={`mt-1 truncate font-mono ${accent ? "text-[15px] text-fg" : "text-[13px]"} ${empty ? "text-muted/70" : "text-fg"}`}>{empty ? "—" : v}</dd>
    </div>
  );
}

function SafetyStat({ token }: { token: Token }) {
  const score = qualityScore(token);
  const tone = score == null ? "bg-line" : score >= 70 ? "bg-primary" : score >= 40 ? "bg-amber-400" : "bg-danger";
  return (
    <div className="flex min-w-[6.2rem] shrink-0 flex-col justify-center border-l border-line px-3">
      <dt className="text-[10px] uppercase tracking-[0.16em] text-muted">Safety</dt>
      <dd className="mt-1 flex items-center gap-2">
        <span className="font-mono text-[13px] text-fg">{scoreLabel(token)}</span>
        <span className="h-1.5 w-10 overflow-hidden rounded-full bg-white/10">
          <span className={`block h-full rounded-full ${tone}`} style={{ width: `${score ?? 0}%` }} />
        </span>
      </dd>
    </div>
  );
}

function TokenMenu({ token, scanning, onPick }: { token: Token; scanning: boolean; onPick: (symbol: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const clock = useDesk((state) => state.clock);
  const list = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return TOKENS.filter((item) => item.listed && Number.isFinite(item.price) && item.price > 0 && (!needle || `${item.symbol} ${item.name} ${item.address ?? ""}`.toLowerCase().includes(needle))).slice(0, 16);
  }, [clock, query]);

  useEffect(() => {
    const needle = query.trim();
    if (!open || needle.length < 2) {
      setSearching(false);
      return;
    }
    let cancel = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchTokens(needle)
        .catch(() => undefined)
        .finally(() => {
          if (!cancel) setSearching(false);
        });
    }, 280);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

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
            <span className="truncate">{displayName(token)}</span>
            {token.verified && <VerifiedMark />}
            <ChevronDown className={`size-4 text-muted ${open ? "rotate-180" : ""}`} />
          </span>
          <span className="flex items-center gap-1 truncate text-xs text-muted">
            <ChainBadge chain={token.chain} />
            {token.chain}
          </span>
        </span>
      </button>
      {open && (
        <div className="panel menu-pop absolute left-0 top-full z-30 mt-1 w-[min(24rem,calc(100vw-1.5rem))] p-2">
          <label className="mb-2 flex h-10 items-center gap-2 rounded-xl border border-line px-3">
            <Search className="size-4 text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name or symbol"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <ul className="max-h-72 overflow-y-auto">
            {list.map((item) => (
              <li key={`${item.symbol}-${item.address ?? ""}`}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(item.symbol);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-surface-2"
                  onPointerDown={() => warmCharts(item.symbol)}
                >
                  <TokenIcon token={item} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 font-semibold">
                      {displayName(item)}
                      {item.verified && <VerifiedMark />}
                    </span>
                    <span className="flex items-center gap-1 truncate text-xs text-muted">
                      <ChainBadge chain={item.chain} />
                      {item.chain}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {list.length === 0 && (
              <li className="px-2 py-6 text-center text-sm text-muted">
                {searching ? "Looking up that token…" : query.trim() ? "No token matches that name or contract." : "Loading live markets…"}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function BookNote({ children }: { children: ReactNode }) {
  return <p className="px-2 py-10 text-center text-sm text-muted">{children}</p>;
}

function SidePill({ label }: { label: string }) {
  const buy = label === "Buy" || label === "buy" || label === "long";
  return (
    <span className={`inline-grid h-6 min-w-12 place-items-center rounded-full px-2 text-[10px] font-semibold uppercase ${buy ? "bg-primary/15 text-primary" : "bg-danger/15 text-danger"}`}>
      {label}
    </span>
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
  if (activity.length === 0) return <BookNote>Fills from this session show up here with their value.</BookNote>;
  return (
    <ul className="space-y-2 py-2">
      {activity.map((item) => (
        <li key={item.id} className={`flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 ${landed === item.id ? "stamp" : ""}`}>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{item.title}</span>
            <span className="block truncate text-xs text-muted">{item.detail}</span>
          </span>
          <span className={`shrink-0 rounded-full bg-bg px-2 py-1 font-mono text-xs ${item.value < 0 ? "text-danger" : "text-fg"}`}>{usd(item.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function Trades({ prints, symbol }: { prints: Print[]; symbol: string }) {
  if (prints.length === 0) return <BookNote>No recent trades published for {symbol} yet.</BookNote>;
  return (
    <ul className="divide-y divide-line">
      {prints.map((row, index) => (
        <li key={`${row.trader}-${row.age}-${index}`} className="flex items-center gap-3 py-2.5">
          <SidePill label={row.side} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-mono text-xs">
              {fmt(row.amount)} <span className="text-muted">{symbol}</span>
            </span>
            <span className="block truncate text-[11px] text-muted">{row.trader}</span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block font-mono text-xs">{row.usd >= 0.01 ? usd(row.usd) : px(row.usd)}</span>
            <span className="block font-mono text-[11px] text-muted">
              {row.age} · {fmt(row.price)}
            </span>
          </span>
        </li>
      ))}
    </ul>
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
    <div className="space-y-2 py-2">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-3">
        <span>
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">Spot</span>
          <span className="mt-0.5 block font-mono text-sm">
            {fmt(held)} {symbol}
          </span>
        </span>
        <span className="font-mono text-sm">{usd(held * mark)}</span>
      </div>
      {perps.length === 0 ? (
        <BookNote>No open perp on {symbol}.</BookNote>
      ) : (
        perps.map((position) => <PnlCard key={position.id} position={position} mark={marks[position.base] ?? position.entry} onClose={() => closePerp(position.id)} />)
      )}
    </div>
  );
}

function Orders({ symbol }: { symbol: string }) {
  const orders = useDesk((s) => s.orders);
  const cancelOrder = useDesk((s) => s.cancelOrder);
  const list = orders.filter((order) => order.symbol === symbol);
  if (list.length === 0) return <BookNote>No open orders. Limits rest here until the market reaches them.</BookNote>;
  return (
    <ul className="space-y-2 py-2">
      {list.map((order) => (
        <li key={order.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
          <SidePill label={order.side} />
          <span className="min-w-0 flex-1 font-mono text-xs">
            <span className="block capitalize">{order.kind}</span>
            <span className="block truncate text-muted">
              {fmt(order.amount)} @ {fmt(order.limit)}
            </span>
          </span>
          <button type="button" className="h-8 shrink-0 rounded-full border border-line px-3 text-xs text-danger" onClick={() => cancelOrder(order.id)}>
            Cancel
          </button>
        </li>
      ))}
    </ul>
  );
}

function Holders({ token }: { token: Token }) {
  const [rows, setRows] = useState<HolderRow[] | null>(null);
  const [bands, setBands] = useState<HolderBand[]>([]);
  const [top10, setTop10] = useState<number | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [miss, setMiss] = useState(false);
  useEffect(() => {
    let cancel = false;
    setRows(null);
    setBands([]);
    setTop10(null);
    setCount(null);
    setMiss(false);
    void loadHolders(token.symbol, token.address)
      .then((result) => {
        if (cancel) return;
        setRows(result.rows);
        setBands(result.bands);
        setTop10(result.top10);
        setCount(result.count);
        setMiss(result.rows.length === 0 && result.bands.length === 0 && result.count == null);
      })
      .catch(() => {
        if (!cancel) {
          setRows([]);
          setMiss(true);
        }
      });
    return () => {
      cancel = true;
    };
  }, [token.address, token.symbol]);
  if (!rows) return <BookNote>Reading holders…</BookNote>;
  if (miss) return <BookNote>No holder list has been published for this token.</BookNote>;
  const tones = ["var(--color-primary)", "color-mix(in srgb, var(--color-primary) 62%, white)", "var(--color-muted)", "var(--color-line)"];
  return (
    <div className="py-2">
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-line bg-surface px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Holders</p>
          <p className="mt-0.5 font-mono text-sm">{count == null ? "—" : count.toLocaleString("en-US")}</p>
        </div>
        <div className="rounded-xl border border-line bg-surface px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Top 10</p>
          <p className="mt-0.5 font-mono text-sm">{top10 == null || top10 > 100 ? "—" : `${top10.toFixed(1)}%`}</p>
        </div>
      </div>
      {bands.length > 0 && (
        <>
          <div className="mb-2 flex h-2 overflow-hidden rounded-full bg-surface-2">
            {bands.map((band, index) => (
              <span key={band.label} className="h-full" style={{ width: `${Math.max(band.pct, 0)}%`, background: tones[index % tones.length] }} />
            ))}
          </div>
          <ul className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {bands.map((band, index) => (
              <li key={band.label} className="rounded-lg border border-line px-2 py-1.5">
                <p className="flex items-center gap-1.5 text-[10px] uppercase text-muted">
                  <span className="size-1.5 rounded-full" style={{ background: tones[index % tones.length] }} />
                  {band.label}
                </p>
                <p className="font-mono text-sm">{band.pct.toFixed(1)}%</p>
              </li>
            ))}
          </ul>
        </>
      )}
      {rows.length > 0 && (
        <table className="w-full table-fixed border-collapse text-xs">
          <colgroup>
            <col />
            <col className="w-[7.5rem] sm:w-[9.5rem]" />
            <col className="w-[4.25rem]" />
          </colgroup>
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted">
              <th className="border-b border-line py-1.5 pr-3 text-left font-normal">Account</th>
              <th className="border-b border-line py-1.5 text-right font-normal">Balance</th>
              <th className="border-b border-line py-1.5 text-right font-normal">Share</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {rows.map((row) => (
              <tr key={row.account} className="border-t border-line">
                <td className="truncate py-2 pr-3 text-left" title={row.account}>
                  {row.account}
                </td>
                <td className="whitespace-nowrap py-2 text-right">{fmt(row.amount)}</td>
                <td className="whitespace-nowrap py-2 text-right text-muted">{row.share == null ? "—" : `${row.share.toFixed(2)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
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
  const [routes, setRoutes] = useState<LiveRoute[]>([]);
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
    setRoutes([]);
    if (!connected || !accountId || qty <= 0 || pay.symbol === receiveToken.symbol) return;
    setQuoting(true);
    const timer = window.setTimeout(() => {
      void quoteRoutes({
        from: pay,
        to: receiveToken,
        amount: String(qty),
        accountId,
        refundTo: accountId,
        recipient: accountId,
        slippageBps: Math.round(slipPct * 100),
        purpose: "Spot",
      })
        .then((next) => setRoutes(next))
        .catch(() => setRoutes([]))
        .finally(() => setQuoting(false));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [accountId, connected, pay.symbol, qty, receiveToken.symbol, slipPct]);
  const quotes = routes;
  const quoteKey = quotes.map((quote) => `${quote.id}:${quote.receive.toFixed(2)}`).join("|");
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
    ["6H", token.windows.h6],
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
      const limit = perpType === "limit" ? Number(limitPrice) || token.price : undefined;
      const ok = useDesk.getState().openPerp(`${token.symbol}-PERP`, token.symbol, perpSide, qty, lev, {
        tp: Number(tp) || undefined,
        sl: Number(sl) || undefined,
        reduceOnly,
        limit,
      });
      const guards = [tp && `TP ${tp}`, sl && `SL ${sl}`, reduceOnly && "reduce-only"].filter(Boolean).join(" · ");
      onFlash(ok ? `${limit ? "Limit " : ""}${perpSide} ${token.symbol} ${lev}x ${marginMode}${guards ? ` · ${guards}` : ""}. USDC margin is locked until this position closes.` : "Not enough USDC margin");
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
    onFlash(`Confirm the deposit. ${picked.name} has the lowest fee inside your slippage.`);
    void picked
      .execute()
      .then((result) => {
        setFills((prev) => (side === "buy" ? { ...prev, bought: prev.bought + qty } : { ...prev, sold: prev.sold + qty * token.price }));
        onFlash(`${side === "buy" ? "Bought" : "Sold"} ${token.symbol} via ${picked.name} · ${fmt(result.amountOutHuman)} ${receiveToken.symbol} · ${result.status}`);
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
              <p className="mt-1 font-semibold">{picked.name}</p>
              <p className="mt-1 font-mono text-muted">
                Fee {(picked.feeBps / 100).toFixed(2)}% · impact {picked.impact.toFixed(2)}% · {picked.eta}
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
                      key={`${deck}-${quote.id}`}
                      className={`route-card ${index === 0 ? "is-best" : ""}`}
                      style={{ animationDelay: `${index * 45}ms` }}
                    >
                      <div className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left ${index === 0 ? "bg-surface-2" : ""}`}>
                        <span>
                          {quote.name}
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
            <p className="mt-2 text-xs text-muted">{connected ? (quoting ? "Comparing live routes…" : "No live route for this size.") : "Connect a wallet for a live route."}</p>
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
              {blocked ? "Honeypot · swap blocked" : `Not verified · ${scoreLabel(token)}`}
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
