import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, Copy, Search, ShieldAlert } from "lucide-react";
import { CandleChart, type ChartHover } from "@/components/terminal/CandleChart";
import { TradingViewChart } from "@/components/terminal/TradingViewChart";
import { tradingViewPerp, tradingViewSpot } from "@/lib/tv";
import { LiveBook } from "@/components/terminal/LiveBook";
import { SecurityGate } from "@/components/terminal/SecurityGate";
import { TokenIcon, VerifiedMark, ChainBadge } from "@/components/terminal/TokenIcon";
import { PnlCard } from "@/components/terminal/PnlCard";
import {
  canPerp,
  displayName,
  fmt,
  isHoneypot,
  money,
  qualityScore,
  qty as bal,
  scoreLabel,
  signedPct,
  tokenBySymbol,
  usd,
  px,
  MARKETS,
  TOKENS,
  type Print,
  type Token,
} from "@/lib/market";
import { useDesk, type Side } from "@/lib/store";
import { candleMeta, liveCandles, livePrints, loadHolders, loadOlderCandles, loadPrints, warmCharts, watchCandles, type HolderRow } from "@/lib/live";
import { searchTokens, syncNearMarkets } from "@/lib/dex";
import { logoOf } from "@/lib/logo-book";
import { quoteRoutes, type LiveRoute } from "@/lib/routes";
import { chainByLabel, validAddress } from "@/lib/chains";
import { linkedWallets, foreignWallets, useForeign, type ForeignWallets } from "@/lib/foreign-wallet";
import { refreshBalances } from "@/lib/wallet-holdings";
import { loadChainHistory, rememberTx, useWalletHistory, type WalletTx } from "@/lib/wallet-history";
import { logTrade, useTradeLog } from "@/lib/trade-log";

const FRAMES = ["1m", "5m", "15m", "1H", "4H", "1D"] as const;
const BOOKS = ["Trades", "Positions", "Orders", "Order history", "Trade history", "Transactions"] as const;
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
  const chartPane = useRef<HTMLElement>(null);
  const [chartH, setChartH] = useState(0);

  useEffect(() => setFrame("15m"), [symbol]);
  useEffect(() => setHover(null), [frame, scale]);

  useEffect(() => {
    if (!canPerp(symbol) && mode === "perp") onMode("spot");
  }, [symbol, mode, onMode]);
  useEffect(() => {
    if (mode !== "perp" || !canPerp(symbol)) return;
    const base = symbol.split(".")[0]?.toUpperCase() ?? "";
    const near = TOKENS.find((item) => item.chain === "NEAR" && item.symbol.split(".")[0].toUpperCase() === base);
    if (near && near.symbol !== symbol) onSymbol(near.symbol);
  }, [mode, symbol, onSymbol]);

  const deskMode: TicketMode = canPerp(symbol) ? mode : "spot";
  const plotted = deskMode === "perp" ? tradingViewPerp(symbol) : tradingViewSpot(symbol);
  const tvChart = Boolean(plotted);
  useEffect(() => {
    const node = chartPane.current;
    if (!node) return;
    const measure = () => setChartH(Math.round(node.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [symbol, tvChart]);
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
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 sm:px-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <TokenMenu token={token} mode={deskMode} scanning={scanning} onPick={onSymbol} />
          {canPerp(symbol) ? (
            <div className="flex shrink-0 rounded-md bg-surface p-0.5 text-[10px] font-semibold lg:hidden">
              <button type="button" onClick={() => onMode("spot")} className={`h-6 rounded px-2 ${deskMode === "spot" ? "bg-surface-2 text-fg" : "text-muted"}`}>
                Spot
              </button>
              <button type="button" onClick={() => onMode("perp")} className={`h-6 rounded px-2 ${deskMode === "perp" ? "bg-surface-2 text-fg" : "text-muted"}`}>
                Perp
              </button>
            </div>
          ) : (
            <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted lg:hidden">Spot</span>
          )}
          <span className={`ml-auto shrink-0 font-mono text-xs lg:hidden ${token.change >= 0 ? "text-primary" : "text-danger"}`}>
            {token.change >= 0 ? "+" : ""}
            {Number.isFinite(token.change) ? `${token.change.toFixed(2)}%` : "—"}
          </span>
        </div>
        <dl className="scroll-x hidden max-w-full items-stretch self-end overflow-x-auto sm:flex lg:ml-auto lg:self-center">
          <Stat k="Mcap" v={token.mcap} />
          <Stat k="Price" v={px(token.price)} accent />
          <Stat k="Liq" v={token.liquidity} />
          <Stat k="Vol" v={token.volume} />
          <Stat k="FDV" v={token.fdv} />
          <Stat k="Txns" v={token.txns} />
          <SafetyStat token={token} />
        </dl>
      </header>

      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_18rem_22rem] lg:grid-rows-[auto_minmax(0,1fr)] lg:items-start">
        <section ref={chartPane} className="relative order-1 shrink-0 lg:col-start-1 lg:row-start-1 lg:self-start lg:border-r lg:border-line">
          {tvChart ? (
            <TradingViewChart symbol={symbol} market={deskMode} />
          ) : (
            <>
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
                  {(((hover.c - hover.o) / (hover.o || 1)) * 100).toFixed(2)}%)
                </span>
              </>
            ) : (
              <>
                O {fmt(open.o)} H {fmt(high)} L {fmt(low)} C {fmt(close.c)}{" "}
                <span className={delta >= 0 ? "text-primary" : "text-danger"}>
                  {delta >= 0 ? "+" : ""}
                  {fmt(delta)} ({delta >= 0 ? "+" : ""}
                  {((delta / (open.o || 1)) * 100).toFixed(2)}%)
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
            </>
          )}
        </section>
        <div className="order-2 grid grid-cols-2 items-start lg:contents">
        <div
          className="flex h-[22rem] flex-col overflow-hidden border-t border-line lg:col-start-2 lg:row-start-1 lg:h-[var(--book-h)] lg:border-r lg:border-t-0"
          style={chartH > 0 ? ({ "--book-h": `${chartH}px` } as CSSProperties) : undefined}
        >
          <LiveBook symbol={symbol} mark={Number.isFinite(mark ?? token.price) ? (mark ?? token.price) : 0} liquidity={token.liqN} />
        </div>
        <div className="border-t border-line lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:self-stretch lg:border-t-0">
          <Ticket token={token} mode={mode} quickUsd={quickUsd} scanning={scanning} onMode={onMode} onFlash={onFlash} />
        </div>
        </div>
        <section className="book-hinge order-4 border-t border-line lg:col-span-2 lg:col-start-1 lg:row-start-2 lg:self-stretch lg:border-r lg:border-t-0">
          <div className="scroll-x flex gap-3 border-b border-line bg-bg px-3 py-0 sm:gap-1 sm:px-3 sm:py-1.5">
            {BOOKS.map((item) => (
              <button
                key={item}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setBook(item)}
                className={`h-9 shrink-0 border-b-2 px-1 text-xs font-semibold sm:h-8 sm:flex-1 sm:rounded-full sm:border-b-0 sm:px-3 sm:text-sm ${book === item ? "border-primary text-fg sm:bg-surface-2 sm:shadow-[inset_0_0_0_1px_var(--color-line)]" : "border-transparent text-muted"}`}
              >
                {item === "Orders" ? "Open orders" : item}
              </button>
            ))}
          </div>
          <div key={book} className="book-page px-3 pb-3 pt-1 sm:px-4 lg:min-h-[26rem]">
            {book === "Trades" && <WalletTrades symbol={token.symbol} />}
            {book === "Positions" && <Positions symbol={token.symbol} mark={token.price} mode={deskMode} />}
            {book === "Orders" && <Orders symbol={token.symbol} />}
            {book === "Order history" && <OrderHistory symbol={token.symbol} />}
            {book === "Trade history" && <WalletTrades symbol={token.symbol} />}
            {book === "Transactions" && <TxHistory />}
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

function TokenMenu({ token, mode, onPick }: { token: Token; scanning: boolean; mode: TicketMode; onPick: (symbol: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const clock = useDesk((state) => state.clock);
  const list = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (mode === "perp") {
      const bases = new Set(MARKETS.map((market) => market.base));
      return TOKENS.filter((item) => item.chain === "NEAR" && bases.has(item.symbol.split(".")[0].toUpperCase()))
        .map((item) => {
          const base = item.symbol.split(".")[0].toUpperCase();
          const market = MARKETS.find((entry) => entry.base === base);
          return { id: item.symbol, label: market?.label ?? `${base}-USD`, token: item };
        })
        .filter((row) => tradingViewPerp(row.token.symbol) && (!needle || `${row.token.symbol} ${row.token.name} near perp`.toLowerCase().includes(needle) || row.label.toLowerCase().includes(needle)))
        .sort((a, b) => b.token.volN - a.token.volN || a.label.localeCompare(b.label));
    }
    const SPOT_CHAINS = new Set(["NEAR", "Ethereum", "Solana", "Base", "Arbitrum", "Optimism", "BNB", "Polygon", "Avalanche", "Bitcoin", "Tron", "TON", "Sui", "Aptos", "Gnosis"]);
    return TOKENS.filter((item) => {
      if (!SPOT_CHAINS.has(item.chain)) return false;
      if (!item.assetId || !(item.price > 0)) return false;
      if (!logoOf(item.symbol)) return false;
      if (!tradingViewSpot(item.symbol)) return false;
      const hay = `${item.symbol} ${item.name} ${item.chain} spot`.toLowerCase();
      return !needle || hay.includes(needle);
    })
      .sort((a, b) => a.chain.localeCompare(b.chain) || b.volN - a.volN || a.symbol.localeCompare(b.symbol))
      .slice(0, needle ? 160 : 200)
      .map((item) => ({ id: `${item.chain}:${item.symbol}`, label: displayName(item), token: item }));
  }, [clock, mode, query]);

  useEffect(() => {
    if (!open || mode !== "spot") return;
    void syncNearMarkets().catch(() => undefined);
  }, [mode, open]);

  useEffect(() => {
    if (mode !== "spot") return;
    const clean = query.trim();
    if (clean.length < 2) return;
    const timer = window.setTimeout(() => {
      void searchTokens(clean).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [mode, query]);

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
            <span className="truncate">
              {displayName(token)}
              <span className="font-normal text-muted">/USDT</span>
            </span>
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
              placeholder={mode === "spot" ? "Spot Market" : "Perp Market"}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
          <ul className="max-h-72 overflow-y-auto" role="listbox">
            {list.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(row.token.symbol);
                    setOpen(false);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-surface-2"
                  onPointerDown={() => warmCharts(row.token.symbol)}
                >
                  <TokenIcon token={row.token} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 font-semibold">
                      {row.label}
                      <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted">{mode === "spot" ? "SPOT" : "PERP"}</span>
                    </span>
                    <span className="flex items-center gap-1 truncate text-xs text-muted">
                      <ChainBadge chain={row.token.chain} />
                      {displayName(row.token)} · {row.token.chain}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {list.length === 0 && <li className="px-2 py-6 text-center text-sm text-muted">{mode === "spot" ? "No spot market matches that name." : "No perp market matches that name."}</li>}
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

function baseOf(symbol: string) {
  return symbol.split(".")[0]?.toUpperCase() ?? symbol.toUpperCase();
}

function WalletTrades({ symbol }: { symbol: string }) {
  const accountId = useDesk((state) => (state.connected ? state.accountId : null));
  const rows = useTradeLog().filter((row) => accountId && row.account === accountId && row.bucket === "trade" && baseOf(row.symbol) === baseOf(symbol));
  if (!accountId) return <BookNote>Connect a wallet to see its trades.</BookNote>;
  if (rows.length === 0) return <BookNote>No trades from the connected wallet on {symbol} yet.</BookNote>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-3 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{row.title}</span>
            <span className="block truncate text-[11px] text-muted">{row.detail} · {row.status}</span>
          </span>
          <span className={`font-mono text-xs ${row.value < 0 ? "text-danger" : "text-fg"}`}>{usd(row.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function OrderHistory({ symbol }: { symbol: string }) {
  const accountId = useDesk((state) => (state.connected ? state.accountId : null));
  const rows = useTradeLog().filter((row) => accountId && row.account === accountId && row.bucket === "order" && baseOf(row.symbol) === baseOf(symbol) && row.status !== "open");
  if (!accountId) return <BookNote>Connect a wallet to see its orders.</BookNote>;
  if (rows.length === 0) return <BookNote>No filled or canceled orders from this wallet on {symbol} yet.</BookNote>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-3 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{row.title}</span>
            <span className="block truncate text-[11px] text-muted">{row.detail}</span>
          </span>
          <span className="text-xs capitalize text-muted">{row.status}</span>
        </li>
      ))}
    </ul>
  );
}

function TxHistory() {
  const saved = useWalletHistory();
  const accountId = useDesk((state) => state.accountId);
  const connected = useDesk((state) => state.connected);
  const foreign = useForeign();
  const wallets = linkedWallets(connected ? accountId : null, foreign);
  const [chain, setChain] = useState<WalletTx[]>([]);
  useEffect(() => {
    if (!wallets.length) return;
    void loadChainHistory(wallets).then(setChain).catch(() => undefined);
  }, [accountId, foreign, wallets.length]);
  if (!wallets.length) return <BookNote>Connect a wallet to see its transactions.</BookNote>;
  const ids = new Set(wallets.map((wallet) => wallet.address.toLowerCase()));
  const rows = [...saved, ...chain].filter((row) => ids.has(row.address.toLowerCase())).sort((a, b) => b.time - a.time);
  if (rows.length === 0) return <BookNote>No transactions from the connected wallets yet.</BookNote>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((row) => (
        <li key={row.id} className="flex items-center gap-3 py-2.5">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{row.title}</span>
            <span className="block truncate text-[11px] text-muted">{row.detail || row.chain}</span>
          </span>
          <span className="font-mono text-xs">{row.value ? usd(row.value) : row.chain}</span>
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

function Positions({ symbol, mark, mode }: { symbol: string; mark: number; mode: TicketMode }) {
  const balances = useDesk((s) => s.balances);
  const positions = useDesk((s) => s.positions);
  const closePerp = useDesk((s) => s.closePerp);
  const marks = useDesk((s) => s.marks);
  const held = balances[symbol] ?? 0;
  const perps = positions.filter((position) => position.base === symbol);
  if (mode === "spot") {
    return (
      <div className="space-y-2 py-2">
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-3">
          <span>
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">Spot</span>
            <span className="mt-0.5 block font-mono text-sm">
              {bal(held)} {symbol}
            </span>
          </span>
          <span className="font-mono text-sm">{usd(held * mark)}</span>
        </div>
        {held <= 0 && <BookNote>No open spot balance on {symbol}.</BookNote>}
      </div>
    );
  }
  return (
    <div className="space-y-2 py-2">
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
  const [top10, setTop10] = useState<number | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [miss, setMiss] = useState(false);
  useEffect(() => {
    let cancel = false;
    setRows(null);
    setTop10(null);
    setCount(null);
    setMiss(false);
    void loadHolders(token.symbol, token.address)
      .then((result) => {
        if (cancel) return;
        setRows(result.rows);
        setTop10(result.top10);
        setCount(result.count);
        setMiss(result.rows.length === 0 && result.count == null);
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
  if (miss || rows.length === 0) return <BookNote>No holder list has been published for this token.</BookNote>;
  const price = Number.isFinite(token.price) ? token.price : 0;
  const maxShare = Math.max(...rows.map((row) => row.share ?? 0), 0.01);
  return (
    <div className="py-1">
      <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-muted">
        <span>{count == null ? "Holders" : `${count.toLocaleString("en-US")} holders`}</span>
        <span>{top10 == null || top10 > 100 ? "" : `Top 10 ${top10.toFixed(1)}%`}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-[12px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.14em] text-muted">
              <th className="w-8 border-b border-line py-2 text-left font-medium">#</th>
              <th className="border-b border-line py-2 text-left font-medium">Wallet</th>
              <th className="border-b border-line py-2 text-left font-medium">Share</th>
              <th className="border-b border-line py-2 text-right font-medium">Avg buy mc</th>
              <th className="border-b border-line py-2 text-right font-medium">Avg sell mc</th>
              <th className="border-b border-line py-2 text-right font-medium">PnL</th>
              <th className="border-b border-line py-2 text-right font-medium">Funded by</th>
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {rows.map((row, index) => {
              const share = row.share;
              const value = share != null && token.mcapN > 0 ? (share / 100) * token.mcapN : row.amount * price;
              const whale = (share ?? 0) >= 1;
              return (
                <tr key={row.account} className="border-b border-line/60 hover:bg-white/[0.03]">
                  <td className="py-2.5 pr-2 text-muted">{index + 1}</td>
                  <td className="py-2.5 pr-3">
                    <span className="flex items-center gap-1.5">
                      <span title={row.account}>{shortWallet(row.account)}</span>
                      <CopyButton value={row.account} />
                      {whale && <span className="rounded border border-line px-1 text-[10px] font-sans font-medium tracking-normal text-muted">Whale</span>}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className="flex items-center gap-2">
                      <span className="w-11 text-fg">{share == null ? "—" : `${share.toFixed(1)}%`}</span>
                      <span className="h-[3px] w-14 overflow-hidden rounded-full bg-white/10">
                        <span className="block h-full rounded-full bg-[#8b7cff]" style={{ width: `${Math.max(8, ((share ?? 0) / maxShare) * 100)}%` }} />
                      </span>
                      <span className="text-fg/90">{value > 0 ? money(value) : "—"}</span>
                    </span>
                  </td>
                  <td className="py-2.5 text-right text-muted">—</td>
                  <td className="py-2.5 text-right text-muted">—</td>
                  <td className="py-2.5 text-right text-muted">—</td>
                  <td className="py-2.5 text-right text-muted">—</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function shortWallet(id: string) {
  if (!id || id === "—") return "—";
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function CopyButton({ value }: { value: string }) {
  return (
    <button
      type="button"
      aria-label="Copy wallet"
      title="Copy"
      onClick={() => void navigator.clipboard?.writeText(value)}
      className="text-muted hover:text-fg"
    >
      <Copy className="size-3" />
    </button>
  );
}

function stableOn(chain: string, avoid: string) {
  const usdt = (item: Token) => item.symbol.split(".")[0].toUpperCase() === "USDT" && item.symbol !== avoid;
  return (
    TOKENS.find((item) => item.chain === chain && usdt(item) && item.assetId) ??
    TOKENS.find((item) => item.chain === chain && usdt(item)) ??
    TOKENS.find((item) => usdt(item) && item.assetId) ??
    tokenBySymbol("USDT")
  );
}

function walletFor(chain: string, near: string, foreign: ForeignWallets) {
  const kind = chainByLabel(chain)?.kind;
  if (kind === "near") return near;
  if (kind === "evm") return foreign.evm ?? "";
  if (kind === "sol") return foreign.sol ?? "";
  if (kind === "btc") return foreign.btc ?? "";
  return "";
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
  const clock = useDesk((s) => s.clock);
  const foreign = useForeign();
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
  const spend = side === "sell" ? (token.price > 0 ? qty / token.price : 0) : qty;
  const stable = useMemo(() => stableOn(token.chain, token.symbol), [token.chain, token.symbol, clock]);
  const pay = side === "buy" ? stable : token;
  const receiveToken = side === "buy" ? token : stable;
  const refundTo = walletFor(pay.chain, accountId ?? "", foreign);
  const recipient = walletFor(receiveToken.chain, accountId ?? "", foreign);
  const slipPct = slip === "Auto" ? 1 : Number(slip.replace("%", ""));
  useEffect(() => {
    setRoutes([]);
    if (!connected || spend <= 0 || (pay.symbol === receiveToken.symbol && pay.chain === receiveToken.chain)) return;
    if (!validAddress(pay.chain, refundTo) || !validAddress(receiveToken.chain, recipient)) return;
    setQuoting(true);
    const timer = window.setTimeout(() => {
      void quoteRoutes({
        from: pay,
        to: receiveToken,
        amount: String(spend),
        accountId: accountId || refundTo,
        refundTo,
        recipient,
        slippageBps: Math.round(slipPct * 100),
        purpose: "Spot",
      })
        .then((next) => setRoutes(next))
        .catch(() => setRoutes([]))
        .finally(() => setQuoting(false));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [accountId, connected, pay.symbol, pay.chain, spend, receiveToken.symbol, receiveToken.chain, refundTo, recipient, slipPct]);
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
  const usdtFree = balances.USDT ?? 0;
  const heldUsdt = (balances[token.symbol] ?? 0) * token.price;
  const windows = [
    ["5M", token.windows.m5],
    ["1H", token.windows.h1],
    ["6H", token.windows.h6],
    ["24H", token.windows.h24],
  ] as const;

  function execute() {
    if (token.symbol.split(".")[0]?.toUpperCase() === "USDT") {
      onFlash("USDT is the quote. Pick another token.");
      return;
    }
    if (viewMode === "spot" && side === "sell" && !(token.price > 0)) {
      onFlash("This token has no price yet.");
      return;
    }
    if (qty <= 0 || (viewMode === "spot" && spend <= 0)) {
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
      onFlash(ok ? `${limit ? "Limit " : ""}${perpSide} ${token.symbol}/USDT ${lev}x ${marginMode}${guards ? ` · ${guards}` : ""}. USDT margin is locked until this position closes.` : token.price > 0 ? "Not enough USDT margin" : "This market has no price yet.");
      return;
    }
    if (orderType === "limit") {
      const limit = Number(limitPrice) || token.price;
      const ok = useDesk.getState().placeOrder({
        symbol: token.symbol,
        kind: "spot",
        side,
        amount: spend,
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
      .then(async (result) => {
        const state = useDesk.getState();
        const wallets = linkedWallets(state.accountId, foreignWallets());
        const signer = wallets[0];
        if (signer) {
          rememberTx({
            wallet: signer.label,
            address: signer.address,
            chain: pay.chain,
            title: `${side === "buy" ? "Buy" : "Sell"} ${token.symbol}`,
            detail: `${picked.name} · ${fmt(result.amountOutHuman)} ${receiveToken.symbol}`,
            hash: result.status.startsWith("0x") || result.status.length > 20 ? result.status : "",
            value: qty,
          });
        }
        state.log(`${side === "buy" ? "Buy" : "Sell"} via ${picked.name}`, `${pay.symbol} → ${receiveToken.symbol}`, qty);
        logTrade({ bucket: "trade", symbol: token.symbol, title: `${side === "buy" ? "Buy" : "Sell"} ${token.symbol}/USDT`, detail: picked.name, value: qty, status: "filled", account: state.accountId ?? "" });
        await refreshBalances(wallets);
        setFills((prev) => (side === "buy" ? { ...prev, bought: prev.bought + qty } : { ...prev, sold: prev.sold + qty }));
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
    <aside className="px-1.5 py-2 lg:p-4">
      <div className="lg:deck lg:panel lg:p-3">
      <div className="mb-2 hidden grid-cols-4 gap-1 text-center font-mono text-xs lg:grid">
        {windows.map(([label, value]) => (
          <div key={label}>
            <p className="text-muted">{label}</p>
            <p className={value >= 0 ? "text-primary" : "text-danger"}>{signedPct(value)}</p>
          </div>
        ))}
      </div>
      {listed ? (
        <div className="mb-2 hidden grid-cols-2 gap-1 rounded-xl bg-bg p-1 lg:grid">
          <button type="button" onClick={() => onMode("spot")} className={`h-9 rounded-lg text-sm font-semibold ${viewMode === "spot" ? "bg-surface-2 text-fg shadow-[inset_0_-2px_0_var(--color-primary)]" : "text-muted"}`}>
            Spot
          </button>
          <button type="button" onClick={() => onMode("perp")} className={`h-9 rounded-lg text-sm font-semibold ${viewMode === "perp" ? "bg-surface-2 text-fg shadow-[inset_0_-2px_0_var(--color-primary)]" : "text-muted"}`}>
            Perps
          </button>
        </div>
      ) : (
        <div className="mb-2 hidden grid-cols-2 gap-1 rounded-xl bg-bg p-1 lg:grid" aria-label="Spot only">
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

      {viewMode === "perp" && (
        <div className="mt-2 flex gap-3 text-xs lg:hidden">
          {(["market", "limit"] as const).map((item) => (
            <button key={item} type="button" onClick={() => setPerpType(item)} className={perpType === item ? "font-semibold text-fg" : "text-muted"}>
              {item === "market" ? "Market" : "Limit"}
            </button>
          ))}
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
          <TokenIcon token={tokenBySymbol("USDT")} className="size-4" />
          USDT
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
          <span className="text-xs text-muted">USDT</span>
        </label>
      )}
      <div className="mt-2 hidden grid-cols-4 gap-1 lg:grid">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setAmount(String(preset))}
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
            const base = viewMode === "perp" ? usdtFree * lev : side === "sell" ? heldUsdt : usdtFree;
            setAmount(String(Number((base * pct).toPrecision(6))));
          }}
        />
        <span className="shrink-0">Balance</span>
      </label>

      <div className="mt-2 space-y-1 text-[11px] text-muted lg:hidden">
        <div className="flex justify-between"><span>Avbl</span><span className="font-mono text-fg">{bal(side === "sell" && viewMode === "spot" ? heldUsdt : usdtFree)} USDT</span></div>
        <div className="flex justify-between"><span>Max</span><span className="font-mono text-fg">{bal(viewMode === "perp" ? usdtFree * lev : side === "sell" ? heldUsdt : usdtFree)} USDT</span></div>
        <div className="flex justify-between"><span>Est. fee</span><span className="font-mono text-fg">{picked ? `${(picked.feeBps / 100).toFixed(2)}%` : "—"}</span></div>
      </div>

      {viewMode === "perp" ? (
        <div className="mt-3 hidden space-y-2 lg:block">
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
        <div className="mt-3 hidden lg:block">
          <div className="flex items-center justify-between text-xs text-muted">
            <span className="font-mono">Bal {bal(side === "sell" ? heldUsdt : usdtFree)} USDT</span>
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
            <p className="mt-2 text-xs text-muted">{!validAddress(pay.chain, refundTo) || !validAddress(receiveToken.chain, recipient) ? `Connect a ${!validAddress(pay.chain, refundTo) ? pay.chain : receiveToken.chain} wallet. The route refunds and delivers there.` : connected ? (quoting ? "Comparing live routes…" : "No live route for this size.") : "Connect a wallet for a live route."}</p>
          )}
        </div>
      )}

      <div className={`relative mt-1.5 hidden overflow-hidden rounded-lg px-2 py-1 text-xs lg:block sm:p-3 sm:text-sm ${blocked ? "bg-surface-2" : "bg-surface"}`}>
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
        className="press mt-2 h-10 w-full rounded-full bg-primary text-sm font-semibold text-primary-fg disabled:opacity-50 lg:rounded-xl lg:h-12"
      >
        {blocked ? "Swap blocked" : scanning || busy ? "Scanning" : connected ? (viewMode === "perp" ? `Open ${perpSide} ${token.symbol}/USDT` : `${side === "buy" ? "Buy" : "Sell"} ${token.symbol}/USDT`) : "Enable Trading"}
      </button>

      <dl className="mt-3 hidden grid-cols-2 gap-2 font-mono text-xs sm:grid">
        <Stat k="Holding" v={usd((balances[token.symbol] ?? 0) * token.price)} />
        <Stat k="USDT" v={usd(usdtFree)} />
        <Stat k="Bought" v={usd(fills.bought)} />
        <Stat k="Sold" v={usd(fills.sold)} />
      </dl>
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
