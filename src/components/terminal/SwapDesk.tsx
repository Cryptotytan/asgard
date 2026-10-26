import { useEffect, useRef, useState } from "react";
import { ArrowDownUp, ChevronDown, LoaderCircle, ShieldAlert } from "lucide-react";
import { TokenIcon, TokenPicker, VerifiedMark, ChainBadge } from "@/components/terminal/TokenIcon";
import { linkedWallets, useForeign, WALLET_MARK, type LinkedWallet } from "@/lib/foreign-wallet";
import { canSign, chainByLabel, validAddress } from "@/lib/chains";
import { fmt, scoreLabel, tokenBySymbol, tokenLabel, usd } from "@/lib/market";
import { quoteRoutes, type LiveRoute } from "@/lib/routes";
import { useDesk } from "@/lib/store";
import { refreshBalances, useHoldings } from "@/lib/wallet-holdings";
import { rememberTx } from "@/lib/wallet-history";

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
  const [routes, setRoutes] = useState<LiveRoute[]>([]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [settling, setSettling] = useState(false);
  const [flight, setFlight] = useState<{ amount: string; sell: string; buy: string; sellSymbol: string; buySymbol: string; route: string; legs: string; phase: "sign" | "balances" } | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [turn, setTurn] = useState<"a" | "b" | null>(null);
  const turnLock = useRef(false);
  const foreign = useForeign();
  const [refundEdit, setRefundEdit] = useState<string | null>(null);
  const [receiveEdit, setReceiveEdit] = useState<string | null>(null);
  const [menu, setMenu] = useState<"sell" | "buy" | null>(null);
  const [sellWalletId, setSellWalletId] = useState<LinkedWallet["id"] | null>(null);
  const [buyWalletId, setBuyWalletId] = useState<LinkedWallet["id"] | null>(null);

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
  const wallets = linkedWallets(accountId, foreign);
  const sellActive = wallets.find((wallet) => wallet.id === sellWalletId) ?? wallets.find((wallet) => wallet.id === chainByLabel(sell.chain)?.kind) ?? wallets[0] ?? null;
  const buyActive = wallets.find((wallet) => wallet.id === buyWalletId) ?? wallets.find((wallet) => wallet.id === chainByLabel(buy.chain)?.kind) ?? wallets[0] ?? null;
  const sellHold = useHoldings(sellActive);
  const buyHold = useHoldings(buyActive);
  const refundTo = (refundEdit ?? sellActive?.address ?? "").trim();
  const recipient = (receiveEdit ?? buyActive?.address ?? "").trim();
  const refundOk = validAddress(sell.chain, refundTo);
  const receiveOk = validAddress(buy.chain, recipient);
  const originKind = chainByLabel(sell.chain)?.kind;
  const originConnected = Boolean(sellActive) && sellActive?.id === originKind;
  const book = routes;
  const best = book.find((route) => route.id === pickedId) ?? book[0] ?? null;
  const parked = Object.values(receipts).reduce((sum, receipt) => sum + (receipt.asset === sell.symbol ? receipt.amount : 0), 0);
  const margin = sell.symbol === "USDC" ? positions.reduce((sum, position) => sum + position.margin, 0) : 0;
  const walletAmt = sellHold.book[sell.symbol] ?? 0;
  const held = sellActive?.id === "near" ? Math.max(0, walletAmt - (vault[sell.symbol] ?? 0) - parked - margin) : walletAmt;
  const walletUsd = Object.entries(sellHold.book).reduce((sum, [symbol, amount]) => sum + amount * (tokenBySymbol(symbol).price || 0), 0);
  const short = Boolean(sellActive) && sellActive?.id === originKind && amountN > held + 1e-8;
  const needsWallet = amountN > 0 && !originConnected;
  const risk = !sell.verified || !buy.verified;

  useEffect(() => {
    if (!sellWalletId) return;
    const wallet = wallets.find((item) => item.id === sellWalletId);
    if (!wallet || chainByLabel(tokenBySymbol(sellS).chain)?.kind === wallet.id) return;
    const top = Object.entries(sellHold.book).sort((a, b) => b[1] * (tokenBySymbol(b[0]).price || 0) - a[1] * (tokenBySymbol(a[0]).price || 0))[0];
    if (top) setSellS(top[0]);
  }, [sellWalletId]);
  useEffect(() => {
    if (!buyWalletId) return;
    const wallet = wallets.find((item) => item.id === buyWalletId);
    if (!wallet || chainByLabel(tokenBySymbol(buyS).chain)?.kind === wallet.id) return;
    const top = Object.entries(buyHold.book).sort((a, b) => b[1] * (tokenBySymbol(b[0]).price || 0) - a[1] * (tokenBySymbol(a[0]).price || 0))[0];
    if (top) setBuyS(top[0]);
  }, [buyWalletId]);

  useEffect(() => {
    setAcked(false);
    setRoutes([]);
    setPickedId(null);
    setQuoteError("");
    if (amountN <= 0 || sell.symbol === buy.symbol) return;
    if (!refundOk || !receiveOk) {
      setQuoteError(`Add a ${!refundOk ? sell.chain : buy.chain} address. A failed bridge refunds there.`);
      return;
    }
    setFetching(true);
    const timer = window.setTimeout(() => {
      void quoteRoutes({ from: sell, to: buy, amount, accountId: accountId || refundTo, refundTo, recipient, slippageBps: 100 })
        .then((next) => {
          setRoutes(next);
          setPickedId(next[0]?.id ?? null);
          setQuoteError(next.length ? "" : "No live route between these chains.");
        })
        .catch((error: unknown) => {
          setRoutes([]);
          setPickedId(null);
          setQuoteError(error instanceof Error ? error.message : "No live route.");
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

  function chooseWallet(side: "sell" | "buy", id: LinkedWallet["id"]) {
    if (side === "sell") {
      setSellWalletId(id);
      setRefundEdit(null);
    } else {
      setBuyWalletId(id);
      setReceiveEdit(null);
    }
    setMenu(null);
  }

  async function submit() {
    if (!sellActive) {
      connect();
      return;
    }
    if (!originConnected) {
      setPicking("sell");
      setNote("Pick a token this wallet holds.");
      return;
    }
    if (!canSign(sell.chain)) {
      setNote(`No browser wallet can sign ${sell.chain}. Nothing was sent.`);
      return;
    }
    if (!refundOk || !receiveOk || !best || amountN <= 0 || short || (risk && !acked) || settling) {
      if (!best && amountN > 0) setNote(quoteError || "No route inside 1% slippage.");
      return;
    }
    setSettling(true);
    setFlight({
      amount,
      sell: `${tokenLabel(sell)} · ${sell.chain}`,
      buy: `${tokenLabel(buy)} · ${buy.chain}`,
      sellSymbol: sell.symbol,
      buySymbol: buy.symbol,
      route: best.name,
      legs: best.kind,
      phase: "sign",
    });
    setNote("Confirm the deposit in the origin wallet. A failed bridge refunds to your origin address.");
    try {
      const result = await best.execute();
      setFlight((current) => (current ? { ...current, phase: "balances" } : current));
      const touched = [sellActive, buyActive].filter((wallet): wallet is LinkedWallet => Boolean(wallet));
      rememberTx({
        wallet: sellActive.label,
        address: sellActive.address,
        chain: sell.chain,
        title: `Swap ${tokenLabel(sell)} → ${tokenLabel(buy)}`,
        detail: `${best.name} · ${sell.chain} to ${buy.chain}`,
        hash: /^0x[a-fA-F0-9]{64}$/.test(result.status) || result.status.length > 20 ? result.status : "",
        value: amountN * sell.price,
      });
      useDesk.getState().log(`Swap via ${best.name}`, `${tokenLabel(sell)} → ${tokenLabel(buy)}`, amountN * sell.price);
      await refreshBalances(touched);
      setAmount("");
      setNote(`Settled ${fmt(result.amountOutHuman)} ${tokenLabel(buy)} on ${buy.chain}.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Swap failed. Nothing else was sent.");
    } finally {
      setSettling(false);
      setFlight(null);
    }
  }

  return (
    <div className="mx-auto grid h-full max-h-full min-h-0 w-full min-w-0 max-w-5xl content-center overflow-hidden lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-4">
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

      <section className="deck panel flex h-full max-h-full min-h-0 min-w-0 w-full flex-col justify-center overflow-hidden p-3 sm:p-4">
        <h2 className="text-base font-semibold tracking-tight sm:text-xl">Swap your assets</h2>
        <p className="mt-1 hidden text-sm text-muted lg:block">Pick a connected wallet on each side. You sign on the chain you sell.</p>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted sm:mt-3 sm:text-xs">
          <span className="min-w-0 truncate font-mono">{sellHold.loading ? "Reading wallet…" : sellActive ? `Bal ${fmt(held)} · ${usd(held * sell.price)}` : "No wallet"}</span>
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
          address={sellActive?.address ?? refundTo}
          wallets={wallets}
          activeId={sellActive?.id ?? null}
          menuOpen={menu === "sell"}
          onAmount={setAmount}
          onPick={() => setPicking("sell")}
          onMenu={() => setMenu((current) => (current === "sell" ? null : "sell"))}
          onCloseMenu={() => setMenu(null)}
          onChoose={(id) => chooseWallet("sell", id)}
          onConnect={() => connect()}
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
          address={buyActive?.address ?? recipient}
          wallets={wallets}
          activeId={buyActive?.id ?? null}
          menuOpen={menu === "buy"}
          onPick={() => setPicking("buy")}
          onMenu={() => setMenu((current) => (current === "buy" ? null : "buy"))}
          onCloseMenu={() => setMenu(null)}
          onChoose={(id) => chooseWallet("buy", id)}
          onConnect={() => connect()}
        />
        </div>

        <p className="mt-2 truncate font-mono text-[11px] text-muted">
          {best && !fetching ? `1 ${tokenLabel(sell)} = ${fmt(best.receive / Math.max(amountN, 1e-9))} ${tokenLabel(buy)} · impact ${best.impact.toFixed(2)}%` : "Enter an amount to price the route"}
        </p>

        {risk && (
          <label className="mt-2 flex items-start gap-2 text-xs sm:text-sm">
            <input type="checkbox" checked={acked} onChange={(event) => setAcked(event.target.checked)} className="mt-0.5 size-4" />
            I understand this token failed the scan.
          </label>
        )}

        <div className="mt-1.5 flex items-center justify-between gap-3">
          <button type="button" onClick={() => setRoutesOpen((open) => !open)} className="truncate text-xs text-primary sm:text-sm">
            {best ? `Best route · ${best.name}` : "Best route"}
          </button>
          <span className="shrink-0 text-[11px] text-muted">{best ? best.kind : quoteError ? "Unavailable" : ""}</span>
        </div>
        {routesOpen && (
          <ul className="route-deck mt-1 max-h-16 min-h-0 overflow-auto rounded-xl bg-bg sm:mt-2 sm:max-h-48">
            {book.length === 0 && <li className="px-3 py-2 text-sm text-muted">{quoteError || "No live route for this pair."}</li>}
            {book.map((route, index) => (
              <li key={`${deck}-${route.id}`}>
                <button
                  type="button"
                  onClick={() => setPickedId(route.id)}
                  className={`route-card flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm sm:py-2 ${route.id === best?.id ? "is-best" : ""}`}
                  style={{ animationDelay: `${index * 45}ms` }}
                >
                  <span className={route.id === best?.id ? "" : "text-muted"}>
                    {route.name}
                    {index === 0 && <span className="ml-2 text-xs text-primary">Cheapest</span>}
                  </span>
                  <span className="font-mono text-xs text-muted">
                    {(route.feeBps / 100).toFixed(2)}% · {route.kind}
                  </span>
                </button>
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
          {settling ? "Settling…" : fetching ? "Fetching routes…" : amountN <= 0 ? "Enter an amount" : !sellActive ? "Connect wallet" : !originConnected ? `Connect a ${sell.chain} wallet` : short ? "Not enough balance" : best && best.impact > slipPct ? "Fee above 5%" : best ? `${best.kind} via ${best.name}` : "No live route"}
        </button>
        {quoteError && !note && <p className="mt-2 font-mono text-xs text-danger">{quoteError}</p>}
        {note && <p className="mt-3 break-words font-mono text-xs text-primary">{note}</p>}
      </section>
      <TokenPicker
        open={picking !== null}
        balances={picking === "buy" ? buyHold.book : sellHold.book}
        walletKind={picking === "buy" ? buyActive?.id : sellActive?.id}
        walletName={picking === "buy" ? buyActive?.label : sellActive?.label}
        loadingBalances={picking === "buy" ? buyHold.loading : sellHold.loading}
        onClose={() => setPicking(null)}
        onPick={(symbol) => {
          const next = tokenBySymbol(symbol);
          const kind = chainByLabel(next.chain)?.kind;
          const match = wallets.find((wallet) => wallet.id === kind);
          if (picking === "sell") {
            if (symbol === buyS) setBuyS(sellS);
            setSellS(symbol);
            if (match) setSellWalletId(match.id);
          } else {
            if (symbol === sellS) setSellS(buyS);
            setBuyS(symbol);
            if (match) setBuyWalletId(match.id);
          }
        }}
      />
      {flight && <SwapFlight flight={flight} />}
    </div>
  );
}

function SwapFlight({ flight }: { flight: { amount: string; sell: string; buy: string; sellSymbol: string; buySymbol: string; route: string; legs: string; phase: "sign" | "balances" } }) {
  const sell = tokenBySymbol(flight.sellSymbol);
  const buy = tokenBySymbol(flight.buySymbol);
  const signing = flight.phase === "sign";
  return (
    <div className="fixed inset-0 z-[90] grid place-items-end bg-black/80 p-3 backdrop-blur-sm sm:place-items-center" role="presentation">
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-primary/30 bg-[#0c100e] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="swap-flight-title">
        <div className="h-1 overflow-hidden bg-white/10">
          <div className="h-full w-1/3 bg-primary" style={{ animation: "flight-bar 1.15s ease-in-out infinite" }} />
        </div>
        <div className="p-5">
          <div className="flex items-center justify-center gap-3">
            <TokenIcon token={sell} className="size-14 ring-2 ring-black" />
            <span className="grid size-9 place-items-center rounded-full border border-line bg-surface text-primary">
              <LoaderCircle className="size-4 animate-spin" />
            </span>
            <TokenIcon token={buy} className="size-14 ring-2 ring-black" />
          </div>
          <h2 id="swap-flight-title" className="mt-4 text-center text-lg font-semibold">
            {signing ? "Confirm in your wallet" : "Updating balances"}
          </h2>
          <p className="mt-1 text-center text-sm text-muted">{signing ? "The card stays up until the transfer is finalized on chain." : "The fill is on chain. Reading the new balances."}</p>
          <dl className="mt-4 space-y-2 rounded-2xl border border-line bg-black/40 px-3 py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Sending</dt>
              <dd className="truncate font-mono">
                {flight.amount} {flight.sell}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Receiving</dt>
              <dd className="truncate font-mono">{flight.buy}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Route</dt>
              <dd className="truncate font-semibold text-primary">
                {flight.route}
                <span className="font-normal text-muted"> · {flight.legs}</span>
              </dd>
            </div>
          </dl>
          <ol className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
            <li className={`rounded-xl px-2 py-2 ${signing ? "bg-primary/15 text-primary" : "bg-white/5 text-muted"}`}>1 · Sign and wait</li>
            <li className={`rounded-xl px-2 py-2 ${signing ? "bg-white/5 text-muted" : "bg-primary/15 text-primary"}`}>2 · Refresh balances</li>
          </ol>
        </div>
      </div>
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
  address,
  wallets,
  activeId,
  menuOpen,
  onMenu,
  onCloseMenu,
  onChoose,
  onConnect,
}: {
  label: string;
  token: ReturnType<typeof tokenBySymbol>;
  amount: string;
  usdValue: number;
  onAmount?: (value: string) => void;
  onPick: () => void;
  readOnly?: boolean;
  motion?: "a" | "b" | null;
  address: string;
  wallets: LinkedWallet[];
  activeId: LinkedWallet["id"] | null;
  menuOpen: boolean;
  onMenu: () => void;
  onCloseMenu: () => void;
  onChoose: (id: LinkedWallet["id"]) => void;
  onConnect: () => void;
}) {
  const role = label === "Buying" ? "is-buy" : "is-sell";
  return (
    <div className={`swap-tile relative rounded-xl border border-line bg-bg p-1.5 sm:p-2.5 ${menuOpen ? "z-40" : ""} ${motion ? `is-${motion}` : ""} ${role}`}>
      <p className="text-[11px] text-muted sm:text-xs">{label}</p>
      <div className="mt-0.5 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {readOnly ? (
            <p className="truncate font-mono text-base sm:text-xl">{amount}</p>
          ) : (
            <input
              inputMode="decimal"
              value={amount}
              placeholder="0.0"
              onChange={(event) => onAmount?.(event.target.value.replace(/[^0-9.]/g, ""))}
              aria-label={`${label} amount`}
              className="w-full min-w-0 bg-transparent font-mono text-base outline-none sm:text-xl"
            />
          )}
          <p className="font-mono text-[11px] text-muted sm:text-xs">{usd(usdValue)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button type="button" onClick={onMenu} className="flex h-8 max-w-full items-center gap-1.5 rounded-full border border-line bg-surface px-1.5 pr-2.5 font-mono text-xs text-fg">
            {address && activeId ? <img src={WALLET_MARK[activeId]} alt="" className="size-5 shrink-0 rounded-full object-cover" /> : <span className="size-1.5 shrink-0 rounded-full bg-muted" />}
            <span className="truncate">{address ? shortAddr(address) : "Connect"}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted" />
          </button>
          <button type="button" onClick={onPick} className="flex h-11 max-w-full items-center gap-2 rounded-2xl border border-line bg-surface py-1 pl-1 pr-2.5">
            <TokenIcon token={token} className="size-8" />
            <span className="min-w-0 text-left leading-tight">
              <span className="block truncate text-sm font-semibold">{tokenLabel(token)}</span>
              <span className="flex items-center gap-1 truncate text-[10px] text-muted">
                <ChainBadge chain={token.chain} className="size-3" />
                {token.chain}
              </span>
            </span>
          </button>
        </div>
      </div>
      {menuOpen && (
        <div className={`absolute right-0 z-30 w-64 max-w-[calc(100vw-2.5rem)] rounded-2xl border border-line bg-[#101412] p-2 shadow-2xl ${label === "Buying" ? "bottom-14" : "top-14"}`}>
          <div className="flex items-center justify-between px-2 py-1.5">
            <p className="text-sm font-semibold">Choose wallet</p>
            <p className="text-[11px] text-muted">{wallets.length} connected</p>
          </div>
          <ul className="space-y-1">
            {wallets.map((wallet) => (
              <li key={wallet.id}>
                <button type="button" onClick={() => onChoose(wallet.id)} className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left ${wallet.id === activeId ? "bg-surface-2 ring-1 ring-primary" : "hover:bg-surface"}`}>
                  <img src={WALLET_MARK[wallet.id]} alt="" className="size-9 shrink-0 rounded-full bg-bg object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{wallet.label}</span>
                    <span className="block truncate font-mono text-[11px] text-muted">{shortAddr(wallet.address)}</span>
                  </span>
                  {wallet.id === activeId && <span className="text-[10px] font-semibold text-primary">Using</span>}
                </button>
              </li>
            ))}
          </ul>
          {wallets.length === 0 && <p className="px-2 py-2 text-xs text-muted">No wallet connected yet.</p>}
          <button type="button" onClick={onConnect} className="mt-2 h-10 w-full rounded-xl bg-primary text-sm font-semibold text-primary-fg">
            Connect wallet
          </button>
          <button type="button" onClick={onCloseMenu} className="mt-1 h-8 w-full text-[11px] text-muted">
            Close
          </button>
        </div>
      )}
    </div>
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
