import { useEffect, useState, type ReactNode } from "react";
import { Check, ShieldAlert } from "lucide-react";
import { CandleChart } from "@/components/terminal/CandleChart";
import { TokenIcon, TokenPicker } from "@/components/terminal/TokenIcon";
import { fmt, scoreLabel, tokenBySymbol, usd, type Print } from "@/lib/market";
import { useDesk, type Side } from "@/lib/store";
import { liveCandles, livePrints, loadPrints, watchCandles } from "@/lib/live";
import { executeIntent } from "@/lib/intents";

const FRAMES = ["1m", "5m", "15m", "1H", "4H", "1D"];

export function ChartDesk({ mode, symbol, onSymbol }: { mode: "spot" | "perp"; symbol: string; onSymbol: (symbol: string) => void }) {
  const token = tokenBySymbol(symbol);
  const marks = useDesk((s) => s.marks);
  useDesk((s) => s.clock);
  const mark = mode === "perp" ? (marks[token.symbol] ?? token.price) : token.price;
  const [frame, setFrame] = useState("1D");
  const [picker, setPicker] = useState(false);
  const [book, setBook] = useState<"Trades" | "Positions" | "Orders">("Trades");
  const series = liveCandles(symbol, frame);
  const bars = series && series.length > 1 ? series : [];
  const prints = livePrints(symbol) ?? [];
  useEffect(() => watchCandles(symbol, frame), [symbol, frame]);
  useEffect(() => {
    void loadPrints(symbol).catch(() => undefined);
  }, [symbol]);
  const open = bars[0] ?? { o: mark, h: mark, l: mark, c: mark };
  const close = bars[bars.length - 1] ?? open;
  const high = bars.length ? Math.max(...bars.map((bar) => bar.h)) : mark;
  const low = bars.length ? Math.min(...bars.map((bar) => bar.l)) : mark;
  const delta = close.c - open.o;
  const up = delta >= 0;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setPicker(true)} className="flex h-11 items-center gap-2 rounded-full pr-2">
            <TokenIcon token={token} className="size-9" />
            <span className="text-left">
              <span className="flex items-center gap-1 font-semibold">
                {token.symbol}
                <span className="font-normal text-muted">{token.name}</span>
                {token.verified ? <Check className="size-3.5 text-primary" /> : <ShieldAlert className="size-3.5 text-danger" />}
              </span>
              <span className="block text-xs text-muted">{token.chain}</span>
            </span>
          </button>
          <p className={`font-mono text-xl ${token.change >= 0 ? "text-primary" : "text-danger"}`}>
            {token.change >= 0 ? "+" : ""}
            {token.change.toFixed(2)}%
          </p>
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 lg:grid-cols-7">
          <Stat k="Price" v={usd(mark)} />
          <Stat k="Supply" v={token.supply} />
          <Stat k="FDV" v={token.fdv} />
          <Stat k="Liquidity" v={token.liquidity} />
          <Stat k="Volume" v={token.volume} />
          <Stat k="Txns 1H" v={token.txns} />
          <Stat k="Safety" v={scoreLabel(token)} tone={token.verified ? "good" : "bad"} />
        </dl>
        <div className="mt-3 flex gap-1 overflow-auto">
          {FRAMES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFrame(item)}
              className={`h-9 shrink-0 rounded-lg px-3 text-sm ${frame === item ? "bg-surface-2 text-fg" : "text-muted"}`}
            >
              {item}
            </button>
          ))}
        </div>
        <p className="mt-2 font-mono text-xs text-muted">
          O {fmt(open.o)} H {fmt(high)} L {fmt(low)} C {fmt(close.c)}{" "}
          <span className={up ? "text-primary" : "text-danger"}>
            {up ? "+" : ""}
            {fmt(delta)} ({up ? "+" : ""}
            {((delta / open.o) * 100).toFixed(2)}%)
          </span>
        </p>
        <CandleChart seed={`${symbol}-${frame}`} last={mark} frame={frame} series={series} />
        <div className="mt-2 flex gap-1 overflow-auto">
          {(["Trades", "Positions", "Orders"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setBook(item)}
              className={`h-10 shrink-0 px-3 text-sm ${book === item ? "text-fg" : "text-muted"}`}
            >
              {item}
            </button>
          ))}
        </div>
        {book === "Trades" && <TradeTable prints={prints} symbol={token.symbol} />}
        {book === "Positions" && <Positions mode={mode} symbol={token.symbol} mark={mark} />}
        {book === "Orders" && <p className="px-1 py-6 text-sm text-muted">No open orders. Market tickets settle on NEAR Intents.</p>}
      </section>
      {mode === "spot" ? <SpotTicket token={token} /> : <PerpTicket token={token} mark={mark} />}
      <TokenPicker open={picker} onClose={() => setPicker(false)} onPick={onSymbol} />
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: "good" | "bad" }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{k}</dt>
      <dd className={`truncate font-mono text-sm ${tone === "good" ? "text-primary" : tone === "bad" ? "text-danger" : ""}`}>{v}</dd>
    </div>
  );
}

function TradeTable({ prints, symbol }: { prints: Print[]; symbol: string }) {
  if (prints.length === 0) return <p className="px-1 py-6 text-sm text-muted">No recent NEAR transfers for {symbol}. The tape reads NearBlocks.</p>;
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[36rem] text-left font-mono text-xs">
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
            <tr key={`${row.trader}-${row.age}-${index}`}>
              <td className="py-2 text-muted">{row.age}</td>
              <td className={row.side === "Buy" ? "text-primary" : "text-danger"}>{row.side}</td>
              <td>{fmt(row.amount)}</td>
              <td>{usd(row.usd)}</td>
              <td>{fmt(row.price)}</td>
              <td className="text-muted">{row.trader}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Positions({ mode, symbol, mark }: { mode: "spot" | "perp"; symbol: string; mark: number }) {
  const balances = useDesk((s) => s.balances);
  const positions = useDesk((s) => s.positions);
  const closePerp = useDesk((s) => s.closePerp);
  const marks = useDesk((s) => s.marks);
  if (mode === "spot") {
    const held = balances[symbol] ?? 0;
    return (
      <p className="py-4 font-mono text-sm">
        Holding {fmt(held)} {symbol} · {usd(held * mark)}
      </p>
    );
  }
  const open = positions.filter((position) => position.base === symbol);
  if (open.length === 0) return <p className="py-4 text-sm text-muted">No open perp on {symbol}.</p>;
  return (
    <ul>
      {open.map((position) => {
        const px = marks[position.base] ?? position.entry;
        const pnl = position.side === "long" ? (px - position.entry) * position.size : (position.entry - px) * position.size;
        return (
          <li key={position.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span className="font-mono text-sm">
              {position.side} {position.leverage}x · {fmt(position.size)} @ {fmt(position.entry)}
            </span>
            <span className="flex items-center gap-3">
              <span className={`font-mono text-sm ${pnl >= 0 ? "text-primary" : "text-danger"}`}>{usd(pnl)}</span>
              <button type="button" onClick={() => closePerp(position.id)} className="h-10 rounded-full border border-line px-3 text-sm">
                Close
              </button>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function SpotTicket({ token }: { token: ReturnType<typeof tokenBySymbol> }) {
  const connected = useDesk((s) => s.connected);
  const connect = useDesk((s) => s.connect);
  const balances = useDesk((s) => s.balances);
  const chain = useDesk((s) => s.chain);
  const accountId = useDesk((s) => s.accountId);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("0");
  const [note, setNote] = useState("");
  const pay = side === "buy" ? "USDC" : token.symbol;
  const receive = side === "buy" ? token.symbol : "USDC";
  const qty = Number(amount) || 0;
  const balance = connected ? (chain[pay] ?? 0) : (balances[pay] ?? 0);
  const out = side === "buy" ? qty / token.price : qty * token.price;

  async function trade() {
    if (!connected || !accountId) {
      connect();
      setNote("Connect a NEAR wallet to trade.");
      return;
    }
    if (token.symbol === "USDC") {
      setNote("Pick another token to trade against USDC.");
      return;
    }
    if (qty <= 0) {
      setNote("Enter an amount.");
      return;
    }
    setNote("Confirm the NEAR Intents deposit in your wallet.");
    try {
      const result = await executeIntent({ from: pay, to: receive, amount: String(qty), accountId, purpose: "Spot" });
      setNote(`${side === "buy" ? "Bought" : "Sold"} ${fmt(result.amountOutHuman)} ${receive}`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "NEAR Intents rejected the trade.");
    }
  }

  return (
    <TicketShell
      token={token}
      sideLabel={side}
      onSide={(next) => setSide(next as "buy" | "sell")}
      sides={[
        ["buy", "Buy"],
        ["sell", "Sell"],
      ]}
      amount={amount}
      onAmount={setAmount}
      unit={side === "buy" ? "USDC" : token.symbol}
      presets={[25, 50, 100, 250]}
      onPreset={(usdAmt) => setAmount(String(side === "buy" ? usdAmt : Number((usdAmt / token.price).toPrecision(6))))}
      onPercent={(pct) => setAmount(String(Number((balance * pct).toPrecision(6))))}
      footer={
        <>
          <button type="button" onClick={() => void trade()} className="mt-3 h-12 w-full rounded-xl bg-primary font-semibold text-primary-fg">
            {connected ? (side === "buy" ? "Buy via Intents" : "Sell via Intents") : "Connect to trade"}
          </button>
          <dl className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs">
            <Stat k="Bought" v={usd(side === "buy" && note.startsWith("Bought") ? qty : 0)} />
            <Stat k="Sold" v={usd(side === "sell" && note.startsWith("Sold") ? qty * token.price : 0)} />
            <Stat k="Holding" v={usd((balances[token.symbol] ?? 0) * token.price)} />
            <Stat k="You receive" v={`${fmt(out)} ${receive}`} />
          </dl>
          {note && <p className="mt-2 font-mono text-xs text-primary">{note}</p>}
        </>
      }
    />
  );
}

function PerpTicket({ token, mark }: { token: ReturnType<typeof tokenBySymbol>; mark: number }) {
  const connected = useDesk((s) => s.connected);
  const connect = useDesk((s) => s.connect);
  const balances = useDesk((s) => s.balances);
  const openPerp = useDesk((s) => s.openPerp);
  const [side, setSide] = useState<Side>("long");
  const [amount, setAmount] = useState("0");
  const [leverage, setLeverage] = useState(5);
  const [note, setNote] = useState("");
  const notion = Number(amount) || 0;
  const margin = notion / leverage;

  function trade() {
    if (!connected) {
      connect();
      setNote("Connect a NEAR wallet to trade.");
      return;
    }
    if (notion <= 0) {
      setNote("Enter a size.");
      return;
    }
    if (token.symbol !== "NEAR" && token.symbol !== "ETH") {
      setNote("Perps are listed on NEAR and ETH.");
      return;
    }
    const ok = openPerp(`${token.symbol}-PERP`, token.symbol, side, notion, leverage);
    setNote(ok ? `${side} opened` : "Not enough USDC margin");
  }

  return (
    <TicketShell
      token={token}
      sideLabel={side}
      onSide={(next) => setSide(next as Side)}
      sides={[
        ["long", "Long"],
        ["short", "Short"],
      ]}
      amount={amount}
      onAmount={setAmount}
      unit="USD"
      presets={[25, 50, 100, 250]}
      onPreset={(usdAmt) => setAmount(String(usdAmt))}
      onPercent={(pct) => setAmount(String(Math.floor((balances.USDC ?? 0) * leverage * pct)))}
      footer={
        <>
          <label className="mt-3 block text-xs text-muted">
            Leverage {leverage}x
            <input type="range" min={1} max={20} value={leverage} onChange={(event) => setLeverage(Number(event.target.value))} className="mt-2" />
          </label>
          <dl className="mt-2 space-y-1 font-mono text-xs">
            <div className="flex justify-between">
              <dt className="text-muted">Margin</dt>
              <dd>{usd(margin)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Liq. est.</dt>
              <dd>{usd(side === "long" ? mark * (1 - 1 / leverage + 0.04) : mark * (1 + 1 / leverage - 0.04))}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">USDC free</dt>
              <dd>{usd(balances.USDC ?? 0)}</dd>
            </div>
          </dl>
          <button type="button" onClick={trade} className="mt-3 h-12 w-full rounded-xl bg-primary font-semibold text-primary-fg">
            {connected ? `Open ${side}` : "Connect to trade"}
          </button>
          {note && <p className="mt-2 font-mono text-xs text-primary">{note}</p>}
        </>
      }
    />
  );
}

function TicketShell({
  token,
  sideLabel,
  onSide,
  sides,
  amount,
  onAmount,
  unit,
  presets,
  onPreset,
  onPercent,
  footer,
}: {
  token: ReturnType<typeof tokenBySymbol>;
  sideLabel: string;
  onSide: (side: string) => void;
  sides: [string, string][];
  amount: string;
  onAmount: (value: string) => void;
  unit: string;
  presets: number[];
  onPreset: (value: number) => void;
  onPercent: (pct: number) => void;
  footer: ReactNode;
}) {
  const safety = token.safety;
  return (
    <aside className="panel h-fit p-3">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-bg p-1">
        {sides.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => onSide(id)}
            className={`h-11 rounded-lg font-semibold ${sideLabel === id ? "bg-primary text-primary-fg" : "text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">Market</p>
      <label className="mt-2 flex h-12 items-center gap-2 rounded-xl border border-line bg-bg px-3">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(event) => onAmount(event.target.value.replace(/[^0-9.]/g, ""))}
          aria-label="Order amount"
          className="min-w-0 flex-1 bg-transparent font-mono text-lg outline-none"
        />
        <span className="flex items-center gap-1 text-sm">
          <TokenIcon token={unit === "USD" ? tokenBySymbol("USDC") : tokenBySymbol(unit === "USDC" ? "USDC" : token.symbol)} className="size-4" />
          {unit === "USD" ? "USD" : unit}
        </span>
      </label>
      <div className="mt-2 grid grid-cols-4 gap-1">
        {presets.map((preset) => (
          <button key={preset} type="button" onClick={() => onPreset(preset)} className="h-10 rounded-lg bg-surface-2 text-sm">
            {preset}
          </button>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input type="range" min={0} max={100} defaultValue={0} aria-label="Percent of balance" onChange={(event) => onPercent(Number(event.target.value) / 100)} />
        <span className="w-10 text-right font-mono text-xs text-muted">%</span>
      </div>
      <p className="mt-2 text-xs text-muted">Slippage auto</p>
      {footer}
      <div className="mt-4 border-t border-line pt-3">
        <p className="mb-2 text-sm font-semibold">Token info</p>
        <dl className="grid grid-cols-2 gap-y-2 font-mono text-xs">
          <Info k="Top 10%" v={`${safety.top10}%`} bad={safety.top10 > 50} />
          <Info k="Insiders" v={`${safety.insiders}%`} bad={safety.insiders > 20} />
          <Info k="Snipers" v={`${safety.snipers}%`} bad={safety.snipers > 0} />
          <Info k="Bundlers" v={`${safety.bundlers}%`} bad={safety.bundlers > 0} />
          <Info k="Dev holds" v={`${safety.dev}%`} bad={safety.dev > 5} />
          <Info k="LP locked" v={`${safety.lp}%`} bad={safety.lp < 50} />
          <Info k="Buy tax" v={`${safety.buyTax}%`} bad={safety.buyTax > 0} />
          <Info k="Sell tax" v={`${safety.sellTax}%`} bad={safety.sellTax > 0} />
        </dl>
      </div>
    </aside>
  );
}

function Info({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div>
      <dt className="text-muted">{k}</dt>
      <dd className={bad ? "text-danger" : "text-primary"}>{v}</dd>
    </div>
  );
}
