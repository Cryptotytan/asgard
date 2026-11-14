import { useEffect, useMemo, useState } from "react";
import { Copy, Zap } from "lucide-react";
import { fmt, money, px, type Print, type Token } from "@/lib/market";
import { loadMemeBoard } from "@/lib/live";
import { useDesk } from "@/lib/store";
import { useTradeLog } from "@/lib/trade-log";
import { readTracker } from "@/lib/tracker";
import { TokenIcon } from "@/components/terminal/TokenIcon";

const TABS = ["Trades", "Positions", "Orders", "Alerts", "Holders", "Top Traders", "History", "Dev"] as const;
type Tab = (typeof TABS)[number];

type Trader = {
  wallet: string;
  label: string;
  buyN: number;
  buyUsd: number;
  buyPx: number;
  sellN: number;
  sellUsd: number;
  sellPx: number;
  net: number;
  pnl: number | null;
};

export function MemeBook({ token }: { token: Token }) {
  const [tab, setTab] = useState<Tab>("Trades");
  const [lens, setLens] = useState<"all" | "tracked">("all");
  const [trades, setTrades] = useState<Print[] | null>(null);
  const [holders, setHolders] = useState<{ account: string; amount: number; share: number | null }[] | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const orders = useDesk((s) => s.orders);
  const balances = useDesk((s) => s.balances);
  const chain = useDesk((s) => s.chain);
  const accountId = useDesk((s) => s.accountId);
  const cancelOrder = useDesk((s) => s.cancelOrder);
  const log = useTradeLog();

  useEffect(() => {
    let stop = false;
    setTrades(null);
    setHolders(null);
    setCount(null);
    setTab("Trades");
    const pull = () => {
      void loadMemeBoard(token.symbol, token.address).then((board) => {
        if (stop) return;
        setTrades(board.trades);
        setHolders(board.holders);
        setCount(board.count);
      });
    };
    pull();
    const timer = window.setInterval(pull, 12_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [token.symbol, token.address]);

  const traders = useMemo(() => rankTraders(trades ?? [], token.price), [trades, token.price]);
  const tracked = useMemo(() => {
    if (!accountId) return new Set<string>();
    return new Set(readTracker(accountId).wallets.map((wallet) => wallet.address.toLowerCase()));
  }, [accountId, tab]);
  const holderRows = (holders ?? []).filter((row) => lens === "all" || tracked.has(row.account.toLowerCase()));
  const topShare = holderRows.reduce((sum, row) => sum + (row.share ?? 0), 0);
  const held = Math.max(balances[token.symbol] ?? 0, chain[token.symbol] ?? 0, chain[token.symbol.toUpperCase()] ?? 0);
  const mine = log.filter((row) => row.symbol === token.symbol || row.title.toLowerCase().includes(token.symbol.toLowerCase()));
  const openOrders = orders.filter((order) => order.symbol === token.symbol || order.base === token.symbol);

  return (
    <div className="flex min-h-[28rem] flex-col bg-black text-[12px]">
      <div className="flex items-center gap-1 border-b border-white/10 px-3">
        <div className="scroll-x flex min-w-0 flex-1 items-center gap-4 overflow-x-auto">
          {TABS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`h-10 shrink-0 border-b-2 text-xs font-semibold ${tab === item ? "border-[#b9a6ff] text-fg" : "border-transparent text-muted"}`}
            >
              {item === "Holders" ? `Holders${count ? ` (${compact(count)})` : ""}` : item === "Dev" ? "Dev" : item}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => document.querySelector("[data-trade-ticket]")?.scrollIntoView({ behavior: "smooth", block: "nearest" })}
          className="hidden h-7 shrink-0 items-center gap-1 rounded-md bg-[#6d4aff] px-2.5 text-[11px] font-semibold text-white sm:inline-flex"
        >
          <Zap className="size-3" /> Instant trade
        </button>
        <button type="button" onClick={() => setTab("Trades")} className="hidden h-7 shrink-0 rounded-md border border-white/15 px-2.5 text-[11px] font-semibold text-fg sm:inline-block">
          Trades panel
        </button>
        {tab === "Holders" && (
          <div className="ml-1 hidden shrink-0 rounded-md border border-white/10 p-0.5 text-[10px] font-semibold sm:flex">
            <button type="button" onClick={() => setLens("all")} className={`h-6 rounded px-2 ${lens === "all" ? "bg-white/10 text-fg" : "text-muted"}`}>All</button>
            <button type="button" onClick={() => setLens("tracked")} className={`h-6 rounded px-2 ${lens === "tracked" ? "bg-white/10 text-fg" : "text-muted"}`}>Tracked</button>
          </div>
        )}
      </div>

      {tab === "Trades" && <TradeTape rows={trades} symbol={token.symbol} />}
      {tab === "Positions" && <Positions token={token} held={held} opened={mine[mine.length - 1]?.time} />}
      {tab === "Orders" && <OrderBook rows={openOrders} onCancel={cancelOrder} />}
      {tab === "Alerts" && <Empty title="No alerts on this token yet" />}
      {tab === "Holders" && (
        <Holders
          rows={holders == null ? null : holderRows}
          topShare={topShare}
          price={token.price}
          mcap={token.mcapN}
          traders={traders}
          lens={lens}
        />
      )}
      {tab === "Top Traders" && <TopTraders rows={trades == null ? null : traders} price={token.price} mcap={token.mcapN} />}
      {tab === "History" && <History rows={mine} />}
      {tab === "Dev" && <Dev token={token} count={count} />}
    </div>
  );
}

function TradeTape({ rows, symbol }: { rows: Print[] | null; symbol: string }) {
  if (!rows) return <Skeleton cols={6} />;
  if (!rows.length) return <Empty title="No trades published for this token yet" />;
  return (
    <div className="scroll-x overflow-auto">
      <table className="w-full min-w-[720px] text-left">
        <thead className="text-[10px] uppercase tracking-wide text-muted">
          <tr className="border-b border-white/10">
            {["Time", "Type", `Amount ${symbol}`, "Total USD", "Price", "Trader"].map((label) => (
              <th key={label} className={`px-3 py-2 font-medium ${label === "Time" || label === "Type" || label === "Trader" ? "" : "text-right"}`}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((row, index) => {
            const buy = row.side === "Buy";
            const tone = buy ? "text-primary" : "text-[#ff5c8a]";
            return (
              <tr key={`${row.wallet ?? row.trader}-${row.at ?? index}-${index}`} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                <td className="px-3 py-2 text-muted">{stamp(row)}</td>
                <td className={`px-3 py-2 font-sans font-semibold ${tone}`}>{row.side}</td>
                <td className="px-3 py-2 text-right">{fmt(row.amount)}</td>
                <td className={`px-3 py-2 text-right ${tone}`}>{cash(row.usd)}</td>
                <td className="px-3 py-2 text-right">{px(row.price)}</td>
                <td className="px-3 py-2">
                  <Wallet id={row.wallet || row.trader} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Positions({ token, held, opened }: { token: Token; held: number; opened?: number }) {
  if (!(held > 0)) {
    return (
      <Empty
        title="No open positions"
        detail="Buy a token in the terminal and your position lands here."
      />
    );
  }
  const value = held * (token.price > 0 ? token.price : 0);
  return (
    <div className="scroll-x overflow-auto">
      <table className="w-full min-w-[760px] text-left">
        <thead className="text-[10px] uppercase tracking-wide text-muted">
          <tr className="border-b border-white/10">
            {["Token", "Invested", "Remaining", "Avg entry", "PnL", "Opened", "Action"].map((label) => (
              <th key={label} className="px-3 py-2 font-medium">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-white/[0.04]">
            <td className="px-3 py-2.5">
              <span className="flex items-center gap-2 font-semibold">
                <TokenIcon token={token} className="size-6" />
                {token.symbol}
              </span>
            </td>
            <td className="px-3 py-2.5 font-mono text-muted">—</td>
            <td className="px-3 py-2.5 font-mono">{fmt(held)} <span className="text-muted">{cash(value)}</span></td>
            <td className="px-3 py-2.5 font-mono text-muted">—</td>
            <td className="px-3 py-2.5 font-mono text-muted">—</td>
            <td className="px-3 py-2.5 text-muted">{opened ? new Date(opened).toLocaleString() : "—"}</td>
            <td className="px-3 py-2.5 text-muted">—</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function OrderBook({ rows, onCancel }: { rows: { id: string; symbol: string; side: string; amount: number; limit: number; guard?: string }[]; onCancel: (id: string) => void }) {
  if (!rows.length) return <Empty title="No open orders" detail="A trigger you set on this token shows here until it fills or you cancel it." />;
  return (
    <div className="scroll-x overflow-auto">
      <table className="w-full min-w-[760px] text-left">
        <thead className="text-[10px] uppercase tracking-wide text-muted">
          <tr className="border-b border-white/10">
            {["Token", "Type", "Trigger price", "Amount", "Expiry", "Status", "Actions"].map((label) => (
              <th key={label} className="px-3 py-2 font-medium">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono">
          {rows.map((order) => (
            <tr key={order.id} className="border-b border-white/[0.04]">
              <td className="px-3 py-2 font-sans font-semibold">{order.symbol}</td>
              <td className="px-3 py-2 font-sans">{order.guard === "tp" ? "Take profit" : order.guard === "sl" ? "Stop loss" : order.side}</td>
              <td className="px-3 py-2">{px(order.limit)}</td>
              <td className="px-3 py-2">{fmt(order.amount)}</td>
              <td className="px-3 py-2 text-muted">—</td>
              <td className="px-3 py-2 text-primary">Open</td>
              <td className="px-3 py-2">
                <button type="button" onClick={() => onCancel(order.id)} className="font-sans text-xs text-[#ff5c8a]">Cancel</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Holders({
  rows,
  topShare,
  price,
  mcap,
  traders,
  lens,
}: {
  rows: { account: string; amount: number; share: number | null }[] | null;
  topShare: number;
  price: number;
  mcap: number;
  traders: Trader[];
  lens: "all" | "tracked";
}) {
  if (!rows) return <Skeleton cols={7} />;
  if (!rows.length) return <Empty title={lens === "tracked" ? "None of your tracked wallets hold this token" : "No holder list has been published for this token"} />;
  const book = new Map(traders.map((row) => [row.wallet.toLowerCase(), row]));
  const max = Math.max(...rows.map((row) => row.share ?? 0), 0.01);
  return (
    <div>
      <Statline
        items={[
          ["Top holders", topShare > 0 ? `${topShare.toFixed(1)}%` : "—"],
          ["Avg buy MC", avgMc(traders, "buy", price, mcap)],
          ["Avg sell MC", avgMc(traders, "sell", price, mcap)],
          ["Avg PnL", avgPnl(traders)],
        ]}
      />
      <div className="scroll-x overflow-auto">
        <table className="w-full min-w-[860px] text-left">
          <thead className="text-[10px] uppercase tracking-wide text-muted">
            <tr className="border-b border-white/10">
              {["#", "Wallet", "Share", "Avg buy MC", "Avg sell MC", "PnL", "Funded by"].map((label) => (
                <th key={label} className="px-3 py-2 font-medium">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((row, index) => {
              const stat = book.get(row.account.toLowerCase());
              const value = row.share != null && mcap > 0 ? (row.share / 100) * mcap : row.amount * price;
              return (
                <tr key={row.account} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                  <td className="px-3 py-2 text-muted">{index + 1}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      <Wallet id={row.account} />
                      {(row.share ?? 0) >= 1 && <span className="rounded border border-white/15 px-1 font-sans text-[10px] text-muted">Whale</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <span className="w-12">{row.share == null ? "—" : `${row.share.toFixed(1)}%`}</span>
                      <span className="h-[3px] w-16 overflow-hidden rounded-full bg-white/10">
                        <span className="block h-full rounded-full bg-[#8b7cff]" style={{ width: `${Math.max(6, ((row.share ?? 0) / max) * 100)}%` }} />
                      </span>
                      <span className="text-fg/80">{value > 0 ? money(value) : "—"}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-primary">{stat ? mc(stat.buyPx, price, mcap) : "—"}</td>
                  <td className="px-3 py-2 text-[#ff5c8a]">{stat ? mc(stat.sellPx, price, mcap) : "—"}</td>
                  <td className={`px-3 py-2 ${stat?.pnl == null ? "text-muted" : stat.pnl >= 0 ? "text-primary" : "text-[#ff5c8a]"}`}>{stat?.pnl == null ? "—" : signed(stat.pnl)}</td>
                  <td className="px-3 py-2 text-right text-muted">—</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TopTraders({ rows, price, mcap }: { rows: Trader[] | null; price: number; mcap: number }) {
  if (!rows) return <Skeleton cols={6} />;
  if (!rows.length) return <Empty title="No trader history published for this token yet" />;
  const holding = rows.filter((row) => row.net > 0);
  const share = rows.length ? (holding.length / rows.length) * 100 : 0;
  const took = rows.reduce((sum, row) => sum + row.sellUsd, 0);
  return (
    <div>
      <Statline
        items={[
          ["Still holding", `${share.toFixed(1)}%`],
          ["Avg buy MC", avgMc(rows, "buy", price, mcap)],
          ["Avg sell MC", avgMc(rows, "sell", price, mcap)],
          ["Took out", took > 0 ? money(took) : "—"],
        ]}
      />
      <div className="scroll-x overflow-auto">
        <table className="w-full min-w-[760px] text-left">
          <thead className="text-[10px] uppercase tracking-wide text-muted">
            <tr className="border-b border-white/10">
              {["#", "Wallet", "Avg buy MC", "Avg sell MC", "PnL", "Holding"].map((label) => (
                <th key={label} className="px-3 py-2 font-medium">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((row, index) => (
              <tr key={row.wallet} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                <td className="px-3 py-2 text-muted">{index + 1}</td>
                <td className="px-3 py-2"><Wallet id={row.wallet} /></td>
                <td className="px-3 py-2">
                  <span className="block text-primary">{mc(row.buyPx, price, mcap)}</span>
                  {row.buyN > 0 && <span className="block text-[10px] text-muted">{row.buyN} · {cash(row.buyUsd / row.buyN)}</span>}
                </td>
                <td className="px-3 py-2">
                  <span className="block text-[#ff5c8a]">{mc(row.sellPx, price, mcap)}</span>
                  {row.sellN > 0 && <span className="block text-[10px] text-muted">{row.sellN} · {cash(row.sellUsd / row.sellN)}</span>}
                </td>
                <td className={`px-3 py-2 ${row.pnl == null ? "text-muted" : row.pnl >= 0 ? "text-primary" : "text-[#ff5c8a]"}`}>{row.pnl == null ? "—" : signed(row.pnl)}</td>
                <td className={`px-3 py-2 font-sans ${row.net > 0 ? "text-primary" : "text-[#ff5c8a]"}`}>{row.net > 0 ? "✓ holds" : "Sold"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function History({ rows }: { rows: { id: string; title: string; detail: string; value: number; time: number; status: string }[] }) {
  const trades = rows.filter((row) => row.status !== "open");
  if (!trades.length) return <Empty title="No trades yet" detail="Your buys and sells of this token in the terminal land here." />;
  return (
    <div className="scroll-x overflow-auto">
      <table className="w-full min-w-[640px] text-left">
        <thead className="text-[10px] uppercase tracking-wide text-muted">
          <tr className="border-b border-white/10">
            {["Type", "Amount", "Price", "PnL", "Time", "Action"].map((label) => (
              <th key={label} className="px-3 py-2 font-medium">{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {trades.map((row) => (
            <tr key={row.id} className="border-b border-white/[0.04]">
              <td className="px-3 py-2 font-semibold">{row.title}</td>
              <td className="px-3 py-2 font-mono text-muted">{row.detail || "—"}</td>
              <td className="px-3 py-2 font-mono text-muted">—</td>
              <td className={`px-3 py-2 font-mono ${row.value >= 0 ? "text-primary" : "text-[#ff5c8a]"}`}>{row.value ? signed(row.value) : "—"}</td>
              <td className="px-3 py-2 text-muted">{new Date(row.time).toLocaleString()}</td>
              <td className="px-3 py-2 capitalize text-muted">{row.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Dev({ token, count }: { token: Token; count: number | null }) {
  const age = token.ageH > 0 ? (token.ageH < 48 ? `${Math.max(1, Math.round(token.ageH))}h` : `${Math.round(token.ageH / 24)}d`) : "";
  return (
    <div>
      <div className="flex flex-wrap gap-4 border-b border-white/10 px-3 py-2 text-[11px] text-muted">
        <span>Holders {count ? count.toLocaleString("en-US") : token.holdersN > 0 ? token.holdersN.toLocaleString("en-US") : "—"}</span>
        <span>Pair age {age || "—"}</span>
      </div>
      <div className="scroll-x overflow-auto">
        <table className="w-full min-w-[860px] text-left">
          <thead className="text-[10px] uppercase tracking-wide text-muted">
            <tr className="border-b border-white/10">
              {["Token", "Market cap", "Token stats", "Liquidity", "Volume", "Txns"].map((label) => (
                <th key={label} className="px-3 py-2 font-medium">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-white/[0.04]">
              <td className="px-3 py-2.5">
                <span className="flex items-center gap-2">
                  <TokenIcon token={token} className="size-7 rounded-md" />
                  <span>
                    <span className="block font-semibold">{token.name || token.symbol}</span>
                    <span className="block text-[10px] text-muted">{age}</span>
                  </span>
                </span>
              </td>
              <td className="px-3 py-2.5 font-mono">
                <span className="block">{token.mcapN > 0 ? money(token.mcapN) : "—"}</span>
                <span className={`block text-[10px] ${token.change >= 0 ? "text-primary" : "text-[#ff5c8a]"}`}>{token.change ? `24h ${token.change >= 0 ? "+" : ""}${token.change.toFixed(1)}%` : "—"}</span>
              </td>
              <td className="px-3 py-2.5">
                <span className="flex flex-wrap gap-1 text-[10px]">
                  {count ? <Pill>{compact(count)}</Pill> : null}
                  {token.buys > 0 && <Pill tone="up">{`${token.buys.toLocaleString("en-US")} buys`}</Pill>}
                  {token.sells > 0 && <Pill tone="down">{`${token.sells.toLocaleString("en-US")} sells`}</Pill>}
                </span>
              </td>
              <td className="px-3 py-2.5 font-mono">{token.liqN > 0 ? money(token.liqN) : "—"}</td>
              <td className="px-3 py-2.5 font-mono">{token.volN > 0 ? money(token.volN) : "—"}</td>
              <td className="px-3 py-2.5 font-mono">
                <span className="block">{token.txnsN > 0 ? token.txnsN.toLocaleString("en-US") : "—"}</span>
                {(token.buys > 0 || token.sells > 0) && (
                  <span className="block text-[10px]"><span className="text-primary">{token.buys.toLocaleString("en-US")}</span> / <span className="text-[#ff5c8a]">{token.sells.toLocaleString("en-US")}</span></span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Statline({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-white/10 px-3 py-2 text-[11px]">
      {items.map(([label, value]) => (
        <span key={label} className="text-muted">
          {label} <span className={value.startsWith("+") ? "text-primary" : value.startsWith("-") ? "text-[#ff5c8a]" : "text-fg"}>{value}</span>
        </span>
      ))}
    </div>
  );
}

function Pill({ children, tone }: { children: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "border-primary/40 text-primary" : tone === "down" ? "border-[#ff5c8a]/40 text-[#ff5c8a]" : "border-white/15 text-muted";
  return <span className={`rounded border px-1.5 py-0.5 ${color}`}>{children}</span>;
}

function Wallet({ id }: { id: string }) {
  const shown = id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id || "—";
  return (
    <span className="inline-flex items-center gap-1">
      <span title={id}>{shown}</span>
      {id && id !== "—" && (
        <button type="button" aria-label="Copy wallet" onClick={() => void navigator.clipboard?.writeText(id)} className="text-muted hover:text-fg">
          <Copy className="size-3" />
        </button>
      )}
    </span>
  );
}

function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-sm font-semibold">{title}</p>
      {detail && <p className="mt-1 max-w-sm text-xs text-muted">{detail}</p>}
    </div>
  );
}

function Skeleton({ cols }: { cols: number }) {
  return (
    <div className="space-y-2 px-3 py-3">
      {Array.from({ length: 8 }, (_, row) => (
        <div key={row} className="flex gap-3">
          {Array.from({ length: cols }, (_, col) => (
            <span key={col} className="h-3 flex-1 animate-pulse rounded bg-white/[0.06]" />
          ))}
        </div>
      ))}
    </div>
  );
}

function rankTraders(rows: Print[], price: number): Trader[] {
  const map = new Map<string, Trader>();
  for (const row of rows) {
    const wallet = row.wallet || row.trader;
    if (!wallet || wallet === "—") continue;
    const key = wallet.toLowerCase();
    const hit = map.get(key) ?? { wallet, label: row.trader, buyN: 0, buyUsd: 0, buyPx: 0, sellN: 0, sellUsd: 0, sellPx: 0, net: 0, pnl: null };
    if (row.side === "Buy") {
      hit.buyN += 1;
      hit.buyUsd += row.usd;
      hit.buyPx = hit.buyN === 1 ? row.price : (hit.buyPx * (hit.buyN - 1) + row.price) / hit.buyN;
      hit.net += row.amount;
    } else {
      hit.sellN += 1;
      hit.sellUsd += row.usd;
      hit.sellPx = hit.sellN === 1 ? row.price : (hit.sellPx * (hit.sellN - 1) + row.price) / hit.sellN;
      hit.net -= row.amount;
    }
    map.set(key, hit);
  }
  const list = [...map.values()];
  for (const row of list) {
    if (!(row.buyPx > 0) || !(row.buyUsd > 0)) {
      row.pnl = null;
      continue;
    }
    const bought = row.buyUsd / row.buyPx;
    const sold = row.sellPx > 0 ? Math.min(bought, row.sellUsd / row.sellPx) : 0;
    const left = Math.max(0, bought - sold);
    row.pnl = row.sellUsd - sold * row.buyPx + (price > 0 ? left * (price - row.buyPx) : 0);
    row.net = left;
  }
  return list.sort((a, b) => (b.pnl ?? -Infinity) - (a.pnl ?? -Infinity)).slice(0, 40);
}

function mc(avg: number, price: number, mcap: number) {
  if (!(avg > 0) || !(price > 0) || !(mcap > 0)) return "—";
  return money((avg / price) * mcap);
}

function avgMc(rows: Trader[], side: "buy" | "sell", price: number, mcap: number) {
  const picked = rows.filter((row) => (side === "buy" ? row.buyPx : row.sellPx) > 0);
  if (!picked.length || !(price > 0) || !(mcap > 0)) return "—";
  const avg = picked.reduce((sum, row) => sum + (side === "buy" ? row.buyPx : row.sellPx), 0) / picked.length;
  return money((avg / price) * mcap);
}

function avgPnl(rows: Trader[]) {
  const picked = rows.filter((row) => row.pnl != null) as (Trader & { pnl: number })[];
  if (!picked.length) return "—";
  const avg = picked.reduce((sum, row) => sum + row.pnl, 0) / picked.length;
  return signed(avg);
}

function signed(n: number) {
  const body = Math.abs(n) >= 1000 ? money(Math.abs(n)) : cash(Math.abs(n));
  return `${n >= 0 ? "+" : "-"}${body}`;
}

function cash(n: number) {
  if (!Number.isFinite(n)) return "—";
  if (n >= 1) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (n > 0) return `$${n.toFixed(n < 0.01 ? 6 : 4)}`;
  return "$0";
}

function stamp(row: Print) {
  if (row.at && row.at > 0) {
    const sec = Math.max(0, Math.round((Date.now() - row.at) / 1000));
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.round(sec / 60)}m`;
    if (sec < 86400) return `${Math.round(sec / 3600)}h`;
    return `${Math.round(sec / 86400)}d`;
  }
  return row.age;
}

function compact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 1 : 1)}K`;
  return n.toLocaleString("en-US");
}
