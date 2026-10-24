import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, ShieldAlert } from "lucide-react";
import { TokenIcon, TokenPicker, VerifiedMark } from "@/components/terminal/TokenIcon";
import { fmt, rankQuotes, tokenBySymbol, usd, type Quote } from "@/lib/market";
import { executeIntent, quoteIntent, type IntentQuote } from "@/lib/intents";
import { useDesk } from "@/lib/store";

export function SwapDesk({ focus }: { focus?: string }) {
  const connected = useDesk((s) => s.connected);
  const connect = useDesk((s) => s.connect);
  const balances = useDesk((s) => s.balances);
  const accountId = useDesk((s) => s.accountId);
  const chain = useDesk((s) => s.chain);
  const vault = useDesk((s) => s.vault);
  const receipts = useDesk((s) => s.receipts);
  const positions = useDesk((s) => s.positions);
  const [sellS, setSellS] = useState(focus && focus !== "USDC" ? "USDC" : "NEAR");
  const [buyS, setBuyS] = useState(focus || "USDC");
  const [amount, setAmount] = useState("");
  const [picking, setPicking] = useState<"sell" | "buy" | null>(null);
  const [acked, setAcked] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [routesOpen, setRoutesOpen] = useState(false);
  const [deck, setDeck] = useState(0);
  const [note, setNote] = useState("");
  const [live, setLive] = useState<IntentQuote | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [settling, setSettling] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [turn, setTurn] = useState<"a" | "b" | null>(null);
  const turnLock = useRef(false);

  function flipPair() {
    if (turnLock.current) return;
    const nextSell = buyS;
    const nextBuy = sellS;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setFlipped((value) => !value);
    if (reduce) {
      setSellS(nextSell);
      setBuyS(nextBuy);
      return;
    }
    turnLock.current = true;
    setTurn((current) => (current === "a" ? "b" : "a"));
    window.setTimeout(() => {
      setSellS(nextSell);
      setBuyS(nextBuy);
    }, 250);
    window.setTimeout(() => {
      turnLock.current = false;
    }, 440);
  }

  useEffect(() => {
    if (!focus) return;
    setBuyS(focus);
    setSellS((current) => (current === focus ? (focus === "USDC" ? "NEAR" : "USDC") : current));
  }, [focus]);

  const sell = tokenBySymbol(sellS);
  const buy = tokenBySymbol(buyS);
  const amountN = Number(amount) || 0;
  const slipPct = 1;
  const book = useMemo(() => rankQuotes(sell, buy, amountN, slipPct), [sell, buy, amountN]);
  const liveImpact = live && amountN > 0 ? Math.max(0, (1 - live.amountOutHuman / ((amountN * sell.price) / Math.max(buy.price, 1e-12))) * 100) : 0;
  const liveFeeBps = live && live.amountInUsd > 0 ? Math.max(0, ((live.amountInUsd - live.amountOutUsd) / live.amountInUsd) * 10_000) : 0;
  const quotes = useMemo(() => {
    if (!live) return book;
    const rest = book.filter((quote) => quote.venue.id !== "intents");
    if (liveImpact > slipPct) return rest;
    const venue = book.find((quote) => quote.venue.id === "intents")?.venue ?? {
      id: "intents",
      name: "NEAR Intents",
      kind: "Bridge" as const,
      feeBps: liveFeeBps,
      impactBps: Math.round(liveImpact * 100),
      depthUsd: 0,
      eta: `${live.timeEstimate}s`,
    };
    const row: Quote = { venue, feeBps: liveFeeBps, impact: liveImpact, receive: live.amountOutHuman, score: liveFeeBps / 100 + liveImpact };
    return [...rest, row].sort((a, b) => a.feeBps - b.feeBps || a.impact - b.impact || b.receive - a.receive);
  }, [book, live, liveImpact, liveFeeBps]);
  const best = quotes[0] ?? null;
  const parked = Object.values(receipts).reduce((sum, receipt) => sum + (receipt.asset === sell.symbol ? receipt.amount : 0), 0);
  const margin = sell.symbol === "USDC" ? positions.reduce((sum, position) => sum + position.margin, 0) : 0;
  const held = connected ? Math.max(0, (chain[sell.symbol] ?? 0) - (vault[sell.symbol] ?? 0) - parked - margin) : balances[sell.symbol] ?? 0;
  const short = connected && amountN > held + 1e-8;
  const needsWallet = !connected && amountN > 0;
  const risk = !sell.verified || !buy.verified;

  useEffect(() => {
    setAcked(false);
    setLive(null);
    setQuoteError("");
    if (!connected || !accountId || amountN <= 0 || sell.symbol === buy.symbol) return;
    setFetching(true);
    const timer = window.setTimeout(() => {
      void quoteIntent({ from: sell.symbol, to: buy.symbol, amount, accountId, dry: true })
        .then((quote) => {
          setLive(quote);
          setQuoteError("");
        })
        .catch((error: unknown) => {
          setLive(null);
          setQuoteError(error instanceof Error ? error.message : "No NEAR Intents quote.");
        })
        .finally(() => setFetching(false));
    }, 400);
    return () => window.clearTimeout(timer);
  }, [sell.symbol, buy.symbol, amount, amountN, accountId, connected]);

  useEffect(() => {
    if (fetching || !routesOpen) return;
    setDeck((value) => value + 1);
  }, [fetching, routesOpen, sell.symbol, buy.symbol, amountN]);

  function setPct(pct: number) {
    const bal = held;
    const spendable = sell.symbol === "NEAR" ? bal : bal;
    setAmount(String(Number((spendable * pct).toPrecision(8))));
  }

  async function submit() {
    if (!connected || !accountId) {
      connect();
      setNote("Connect a NEAR wallet to swap.");
      return;
    }
    if (!best || amountN <= 0 || short || (risk && !acked) || settling) {
      if (!best && amountN > 0) setNote("No route inside 1% slippage.");
      return;
    }
    setSettling(true);
    setNote(`Confirm the deposit. ${best.venue.name} is the cheapest route inside your slippage.`);
    try {
      const result = await executeIntent({ from: sell.symbol, to: buy.symbol, amount, accountId, purpose: "Swap", slippageBps: 100, maxImpactPct: slipPct });
      setAmount("");
      setNote(result.status === "SUCCESS" ? `Settled ${fmt(result.amountOutHuman)} ${buy.symbol} · ${best.venue.name}` : `Deposit sent · ${best.venue.name} · ${result.status}`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Swap failed.");
    } finally {
      setSettling(false);
    }
  }

  return (
    <div className="mx-auto grid h-full max-h-full min-h-0 w-full max-w-5xl content-center overflow-hidden lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-4">
      <aside className="deck panel hidden max-h-full overflow-hidden p-3 lg:block">
        <div className="flex items-center gap-3">
          <TokenIcon token={buy} className="size-11" />
          <div>
            <p className="flex items-center gap-1 font-semibold">
              {buy.symbol}
              {buy.verified ? <VerifiedMark /> : <ShieldAlert className="size-3.5 text-danger" />}
            </p>
            <p className="text-xs text-muted">{buy.chain}</p>
          </div>
        </div>
        <p className="mt-2 font-mono text-xl">{usd(buy.price)}</p>
        <p className={`font-mono text-sm ${buy.change >= 0 ? "text-primary" : "text-danger"}`}>
          {buy.change >= 0 ? "+" : ""}
          {buy.change.toFixed(2)}% 24h
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <Pair k="Mcap" v={buy.mcap} />
          <Pair k="Volume" v={buy.volume} />
          <Pair k="Liquidity" v={buy.liquidity} />
          <Pair k="24h" v={`${buy.change >= 0 ? "+" : ""}${buy.change.toFixed(2)}%`} />
        </dl>
        <div className="mt-3 rounded-xl bg-bg p-3">
          {buy.verified ? (
            <p className="flex items-start gap-2 text-sm">
              <VerifiedMark className="mt-0.5" />
              <span>
                <span className="font-semibold">Verified · {buy.score}/100</span>
                <span className="mt-1 block text-xs text-muted">{buy.notes.join(" · ")}</span>
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-2 text-sm">
              <ShieldAlert className="mt-0.5 size-4 text-danger" />
              <span>
                <span className="font-semibold text-danger">Not verified · {buy.score}/100</span>
                <span className="mt-1 block text-xs text-muted">{buy.notes.join(" · ")}</span>
              </span>
            </p>
          )}
        </div>
      </aside>

      <section className="deck panel max-h-full overflow-visible p-2.5 sm:p-4">
        <h2 className="text-sm font-semibold tracking-tight sm:text-xl">Swap your assets</h2>
        <p className="mt-1 hidden text-sm text-muted sm:block">A live NEAR Intents 1-Click quote. Confirming sends the deposit from your wallet.</p>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted sm:mt-3 sm:text-xs">
          <span className="font-mono">Bal {fmt(held)}</span>
          <span className="flex gap-1">
            {[
              [0.25, "25%"],
              [0.5, "50%"],
              [0.75, "75%"],
              [1, "Max"],
            ].map(([pct, label]) => (
              <button key={label} type="button" onClick={() => setPct(Number(pct))} className="h-6 rounded-lg bg-surface-2 px-1.5 text-fg sm:h-8 sm:px-2">
                {label}
              </button>
            ))}
          </span>
        </div>

        <div className="swap-stage mt-1.5">
        <SwapRow
          label="Selling"
          token={sell}
          amount={amount}
          usdValue={amountN * sell.price}
          motion={turn}
          onAmount={setAmount}
          onPick={() => setPicking("sell")}
        />
        <div className="relative z-10 -my-2 flex justify-center sm:-my-3">
          <button
            type="button"
            aria-label="Flip pair"
            className={`flipper grid size-8 place-items-center rounded-full border border-line bg-bg sm:size-11 ${flipped ? "is-on" : ""}`}
            onClick={flipPair}
          >
            <ArrowDownUp className="size-4" />
          </button>
        </div>
        <SwapRow
          label="Buying"
          token={buy}
          amount={best && !fetching ? fmt(best.receive) : "0"}
          usdValue={best && !fetching ? best.receive * buy.price : 0}
          motion={turn}
          readOnly
          onPick={() => setPicking("buy")}
        />
        </div>

        <p className="mt-1.5 truncate font-mono text-[11px] text-muted sm:hidden">
          {best && !fetching ? `1 ${sell.symbol} = ${fmt(best.receive / Math.max(amountN, 1e-9))} ${buy.symbol} · impact ${best.impact.toFixed(2)}%` : "Enter an amount to price the route"}
        </p>
        <div className="mt-3 hidden gap-4 sm:grid sm:grid-cols-[minmax(0,1fr)_14rem]">
          <div />
          <dl className="space-y-1 text-xs">
            <p className="font-semibold">Transaction details</p>
            <Row k="Rate" v={best ? `1 ${sell.symbol} = ${fmt(best.receive / amountN)} ${buy.symbol}` : "—"} />
            <Row k="Price impact" v={best ? `${best.impact.toFixed(2)}%` : "—"} />
            <Row k="Network cost" v={best ? "Wallet gas" : "—"} />
            <Row k="Max slippage" v="1%" />
            <Row k="Settles in" v={live ? `${live.timeEstimate}s` : "—"} />
          </dl>
        </div>

        {risk && (
          <label className="mt-2 flex items-start gap-2 text-xs sm:text-sm">
            <input type="checkbox" checked={acked} onChange={(event) => setAcked(event.target.checked)} className="mt-0.5 size-4" />
            I understand this token failed the scan.
          </label>
        )}

        <div className="mt-1.5 flex items-center justify-between gap-3">
          <button type="button" onClick={() => setRoutesOpen((open) => !open)} className="truncate text-xs text-primary sm:text-sm">
            {best ? `Best route · ${best.venue.name}` : "Best route"}
          </button>
          <span className="shrink-0 text-[11px] text-muted">{best ? best.venue.kind : quoteError ? "Unavailable" : ""}</span>
        </div>
        {routesOpen && (
          <ul className="route-deck mt-1 max-h-16 min-h-0 overflow-auto rounded-xl bg-bg sm:mt-2 sm:max-h-48">
            {quotes.length === 0 && <li className="px-3 py-2 text-sm text-muted">Every route fails 1% slippage.</li>}
            {quotes.map((quote, index) => (
              <li key={`${deck}-${quote.venue.id}`} className={`route-card flex items-center justify-between gap-3 px-3 py-1.5 text-sm sm:py-2 ${index === 0 ? "is-best" : ""}`} style={{ animationDelay: `${index * 45}ms` }}>
                <span className={index === 0 ? "" : "text-muted"}>
                  {quote.venue.name}
                  {index === 0 && <span className="ml-2 text-xs text-primary">Best</span>}
                </span>
                <span className="font-mono text-xs text-muted">
                  {(quote.feeBps / 100).toFixed(2)}% · {quote.impact.toFixed(2)}% impact
                </span>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          disabled={settling || (!needsWallet && amountN > 0 && (fetching || !best || short || (risk && !acked) || sell.symbol === buy.symbol))}
          onClick={() => void submit()}
          className="mt-2 h-10 w-full rounded-xl bg-primary font-semibold text-primary-fg disabled:opacity-40"
        >
          {settling ? "Settling…" : fetching ? "Fetching quote…" : amountN <= 0 ? "Enter an amount" : needsWallet ? "Connect wallet" : short ? "Not enough balance" : best ? `Swap via ${best.venue.name}` : "Slippage error"}
        </button>
        {quoteError && !note && <p className="mt-2 font-mono text-xs text-danger">{quoteError}</p>}
        {note && <p className="mt-3 font-mono text-xs text-primary">{note}</p>}
      </section>
      <TokenPicker
        open={picking !== null}
        balances={balances}
        onClose={() => setPicking(null)}
        onPick={(symbol) => {
          if (picking === "sell") {
            if (symbol === buyS) setBuyS(sellS);
            setSellS(symbol);
          } else {
            if (symbol === sellS) setSellS(buyS);
            setBuyS(symbol);
          }
        }}
      />
    </div>
  );
}

function SwapRow({
  label,
  token,
  amount,
  usdValue,
  onAmount,
  onPick,
  readOnly,
  motion,
}: {
  label: string;
  token: ReturnType<typeof tokenBySymbol>;
  amount: string;
  usdValue: number;
  onAmount?: (value: string) => void;
  onPick: () => void;
  readOnly?: boolean;
  motion?: "a" | "b" | null;
}) {
  const role = label === "Buying" ? "is-buy" : "is-sell";
  return (
    <div className={`swap-tile rounded-xl border border-line bg-bg p-1.5 sm:p-2.5 ${motion ? `is-${motion}` : ""} ${role}`}>
      <p className="text-[11px] text-muted sm:text-xs">{label}</p>
      <div className="mt-0.5 flex items-center gap-2">
        {readOnly ? (
          <p className="min-w-0 flex-1 truncate font-mono text-base sm:text-xl">{amount}</p>
        ) : (
          <input
            inputMode="decimal"
            value={amount}
            placeholder="0.0"
            onChange={(event) => onAmount?.(event.target.value.replace(/[^0-9.]/g, ""))}
            aria-label={`${label} amount`}
            className="min-w-0 flex-1 bg-transparent font-mono text-base outline-none sm:text-xl"
          />
        )}
        <button type="button" onClick={onPick} className="flex h-8 items-center gap-1.5 rounded-full bg-surface-2 px-2 sm:h-10 sm:gap-2 sm:px-3">
          <TokenIcon token={token} />
          <span className="font-semibold">{token.symbol}</span>
          <span className="hidden text-xs text-muted sm:inline">{token.chain}</span>
        </button>
      </div>
      <p className="font-mono text-[11px] text-muted sm:text-xs">{usd(usdValue)}</p>
    </div>
  );
}

function Pair({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-muted">{k}</dt>
      <dd className="font-mono text-fg">{v}</dd>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 font-mono text-xs">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
