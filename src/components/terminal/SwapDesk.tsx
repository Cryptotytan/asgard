import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, ShieldAlert } from "lucide-react";
import { TokenIcon, TokenPicker, VerifiedMark } from "@/components/terminal/TokenIcon";
import { addressFor, connectBtc, connectEvm, connectSol, useForeign } from "@/lib/foreign-wallet";
import { canSign, chainByLabel, validAddress } from "@/lib/chains";
import { fmt, rankQuotes, scoreLabel, tokenBySymbol, tokenLabel, usd, type Quote } from "@/lib/market";
import { executeIntent, quoteIntent, type IntentQuote } from "@/lib/intents";
import { useDesk } from "@/lib/store";

export function SwapDesk({ focus }: { focus?: string }) {
  const connected = useDesk((s) => s.connected);
  const connect = useDesk((s) => s.connect);
  const balances = useDesk((s) => s.balances);
  const accountId = useDesk((s) => s.accountId);
  const chain = useDesk((s) => s.chain);
  const vault = useDesk((s) => s.vault);
  useDesk((s) => s.clock);
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
  const foreign = useForeign();
  const [refundEdit, setRefundEdit] = useState<string | null>(null);
  const [receiveEdit, setReceiveEdit] = useState<string | null>(null);

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
  const slipPct = 5;
  const wallets = { near: accountId, evm: foreign.evm, sol: foreign.sol, btc: foreign.btc };
  const refundTo = (refundEdit ?? addressFor(sell.chain, wallets)).trim();
  const recipient = (receiveEdit ?? addressFor(buy.chain, wallets)).trim();
  const refundOk = validAddress(sell.chain, refundTo);
  const receiveOk = validAddress(buy.chain, recipient);
  const originKind = chainByLabel(sell.chain)?.kind;
  const originConnected =
    originKind === "near" ? Boolean(accountId) : originKind === "evm" ? Boolean(foreign.evm) : originKind === "sol" ? Boolean(foreign.sol) : originKind === "btc" ? Boolean(foreign.btc) : false;
  const book = useMemo(() => rankQuotes(sell, buy, amountN, slipPct), [sell, buy, amountN]);
  const liveImpact = live && live.amountInUsd > 0 ? Math.max(0, (1 - live.amountOutUsd / live.amountInUsd) * 100) : 0;
  const liveFeeBps = live && live.amountInUsd > 0 ? Math.max(0, ((live.amountInUsd - live.amountOutUsd) / live.amountInUsd) * 10_000) : 0;
  const quotes = useMemo(() => {
    if (!live) return book;
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
    return [row];
  }, [book, live, liveImpact, liveFeeBps]);
  const best = quotes[0] ?? null;
  const parked = Object.values(receipts).reduce((sum, receipt) => sum + (receipt.asset === sell.symbol ? receipt.amount : 0), 0);
  const margin = sell.symbol === "USDC" ? positions.reduce((sum, position) => sum + position.margin, 0) : 0;
  const held = sell.chain === "NEAR" && connected ? Math.max(0, (chain[sell.symbol] ?? 0) - (vault[sell.symbol] ?? 0) - parked - margin) : balances[sell.symbol] ?? 0;
  const short = sell.chain === "NEAR" && connected && amountN > held + 1e-8;
  const needsWallet = amountN > 0 && !originConnected;
  const risk = !sell.verified || !buy.verified;

  useEffect(() => {
    setRefundEdit(null);
  }, [sell.chain]);
  useEffect(() => {
    setReceiveEdit(null);
  }, [buy.chain]);

  useEffect(() => {
    setAcked(false);
    setLive(null);
    setQuoteError("");
    if (amountN <= 0 || sell.symbol === buy.symbol) return;
    if (!refundOk || !receiveOk) {
      setQuoteError(`Add a ${!refundOk ? sell.chain : buy.chain} address. A failed bridge refunds there.`);
      return;
    }
    setFetching(true);
    const timer = window.setTimeout(() => {
      void quoteIntent({ from: sell.symbol, to: buy.symbol, amount, accountId: accountId || refundTo, refundTo, recipient, dry: true })
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
  }, [sell.symbol, buy.symbol, amount, amountN, accountId, refundTo, recipient, refundOk, receiveOk]);

  useEffect(() => {
    if (fetching || !routesOpen) return;
    setDeck((value) => value + 1);
  }, [fetching, routesOpen, sell.symbol, buy.symbol, amountN]);

  function setPct(pct: number) {
    const bal = held;
    const spendable = sell.symbol === "NEAR" ? bal : bal;
    setAmount(String(Number((spendable * pct).toPrecision(8))));
  }

  async function connectOrigin() {
    try {
      if (originKind === "near") connect();
      else if (originKind === "evm") await connectEvm();
      else if (originKind === "sol") await connectSol();
      else if (originKind === "btc") await connectBtc();
      else setNote(`No browser wallet can sign ${sell.chain}. Nothing was sent.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Wallet did not connect.");
    }
  }

  async function submit() {
    if (!canSign(sell.chain)) {
      setNote(`No browser wallet can sign ${sell.chain}. Nothing was sent.`);
      return;
    }
    if (!originConnected) {
      await connectOrigin();
      return;
    }
    if (!refundOk || !receiveOk || !best || amountN <= 0 || short || (risk && !acked) || settling) {
      if (!best && amountN > 0) setNote(quoteError || "No route inside 1% slippage.");
      return;
    }
    setSettling(true);
    setNote("Confirm the deposit in the origin wallet. A failed bridge refunds to your origin address.");
    try {
      const result = await executeIntent({
        from: sell.symbol,
        to: buy.symbol,
        amount,
        accountId: accountId || refundTo,
        refundTo,
        recipient,
        purpose: "Swap",
        slippageBps: 100,
        maxImpactPct: slipPct,
      });
      setAmount("");
      setNote(`Settled ${fmt(result.amountOutHuman)} ${tokenLabel(buy)} on ${buy.chain}.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Swap failed. Nothing else was sent.");
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
                <span className="font-semibold">Verified · {scoreLabel(buy)}</span>
                <span className="mt-1 block text-xs text-muted">{buy.notes.join(" · ")}</span>
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-2 text-sm">
              <ShieldAlert className="mt-0.5 size-4 text-danger" />
              <span>
                <span className="font-semibold text-danger">Not verified · {scoreLabel(buy)}</span>
                <span className="mt-1 block text-xs text-muted">{buy.notes.join(" · ")}</span>
              </span>
            </p>
          )}
        </div>
      </aside>

      <section className="deck panel max-h-full overflow-visible p-2.5 sm:p-4">
        <h2 className="text-sm font-semibold tracking-tight sm:text-xl">Swap your assets</h2>
        <p className="mt-1 hidden text-sm text-muted sm:block">NEAR Intents picks the route. You sign on the origin chain. A failed bridge refunds there.</p>
        <div className="mt-2 flex gap-1.5 overflow-x-auto text-[11px]">
          <WalletChip label="NEAR" value={accountId} onClick={() => connect()} />
          <WalletChip label="EVM" value={foreign.evm} onClick={() => void connectEvm().catch((error: unknown) => setNote(error instanceof Error ? error.message : "EVM wallet did not connect."))} />
          <WalletChip label="Solana" value={foreign.sol} onClick={() => void connectSol().catch((error: unknown) => setNote(error instanceof Error ? error.message : "Solana wallet did not connect."))} />
          <WalletChip label="Bitcoin" value={foreign.btc} onClick={() => void connectBtc().catch((error: unknown) => setNote(error instanceof Error ? error.message : "Bitcoin wallet did not connect."))} />
        </div>
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
            <Row k="Refund" v={refundTo ? shortAddr(refundTo) : "—"} />
            <Row k="Receive" v={recipient ? shortAddr(recipient) : "—"} />
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
            {quotes.length === 0 && <li className="px-3 py-2 text-sm text-muted">{connected ? "No live NEAR Intents quote for this size." : "Connect a wallet to price this on NEAR Intents."}</li>}
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
          disabled={settling || (!needsWallet && amountN > 0 && (fetching || !best || short || (risk && !acked) || sell.symbol === buy.symbol || (best?.impact ?? 0) > slipPct))}
          onClick={() => void submit()}
          className="mt-2 h-10 w-full rounded-xl bg-primary font-semibold text-primary-fg disabled:opacity-40"
        >
          {settling ? "Settling…" : fetching ? "Fetching quote…" : amountN <= 0 ? "Enter an amount" : needsWallet ? `Connect ${sell.chain}` : !canSign(sell.chain) ? `Can't sign ${sell.chain}` : short ? "Not enough balance" : best && best.impact > slipPct ? "Fee above 5%" : best ? `Bridge via ${best.venue.name}` : "No live quote"}
        </button>
        {quoteError && !note && <p className="mt-2 font-mono text-xs text-danger">{quoteError}</p>}
        {note && <p className="mt-3 font-mono text-xs text-primary">{note}</p>}
        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
          <AddressField label={`Refund on ${sell.chain}`} value={refundTo} onChange={setRefundEdit} />
          <AddressField label={`Receive on ${buy.chain}`} value={recipient} onChange={setReceiveEdit} />
        </div>
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
          <span className="font-semibold">{tokenLabel(token)}</span>
          <span className="hidden text-xs text-muted sm:inline">{token.chain}</span>
        </button>
      </div>
      <p className="font-mono text-[11px] text-muted sm:text-xs">{usd(usdValue)}</p>
    </div>
  );
}

function WalletChip({ label, value, onClick }: { label: string; value: string | null; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-2.5">
      <span className="text-muted">{label}</span>
      <span className="font-mono text-fg">{value ? shortAddr(value) : "Connect"}</span>
    </button>
  );
}

function AddressField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-[11px] text-muted">
      {label}
      <input value={value} onChange={(event) => onChange(event.target.value.trim())} className="mt-1 h-8 w-full rounded-lg border border-line bg-bg px-2 font-mono text-xs text-fg outline-none" />
    </label>
  );
}

function shortAddr(value: string) {
  return value.length > 18 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
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
