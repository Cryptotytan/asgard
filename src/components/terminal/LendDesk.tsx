import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft, Search, TriangleAlert } from "lucide-react";
import { LEND_MARKETS, px, qty, tokenBySymbol, TOKENS, usd, type LendMarket } from "@/lib/market";
import { TokenIcon } from "@/components/terminal/TokenIcon";
import { ConfirmGate } from "@/components/terminal/ConfirmGate";
import { borrowFromBurrow, lendDecimals, readMarketConfigs, repayOnBurrow, supplyOnBurrow, warmBurrow, withdrawFromBurrow, type MarketConfig, type RatePoint } from "@/lib/burrow";
import { armWalletPopup, cancelNearSigning, syncWallet, warmNearSigner } from "@/lib/near-wallet";
import { iconFor, lendIcon, loadIconBook } from "@/lib/dex";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/cn";

const STABLES = new Set(["USDT", "USDT.E", "USDC", "USDC.E", "DAI", "FRAX"]);
const NAMES: Record<string, string> = {
  NEAR: "Wrapped NEAR",
  USDT: "Tether",
  "USDT.e": "Tether",
  USDC: "USD Coin",
  "USDC.e": "USD Coin",
  wBTC: "Wrapped BTC",
  ETH: "Ether",
  STNEAR: "Staked NEAR",
  DAI: "Dai",
  FRAX: "Frax",
  NBTC: "Bitcoin",
  ZEC: "Zcash",
  BRRR: "Burrow",
  LINEAR: "LiNEAR",
  RNEAR: "Rhea Staked NEAR",
  NEARX: "Stader NearX",
  META: "Meta",
};

const FALLBACK: LendMarket[] = [
  blank("USDC", "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"),
  blank("USDT", "usdt.tether-token.near"),
  blank("ETH", "eth.bridge.near"),
  blank("wBTC", "2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near"),
  blank("NEAR", "wrap.near"),
];

type Kind = "supply" | "withdraw" | "borrow" | "repay";
type SortKey = "asset" | "supplied" | "supplyApy" | "borrowed" | "borrowApy";

export function LendDesk() {
  const connected = useDesk((s) => s.connected);
  const accountId = useDesk((s) => s.accountId);
  const connect = useDesk((s) => s.connect);
  const supplied = useDesk((s) => s.supplied);
  const loans = useDesk((s) => s.loans);
  const chain = useDesk((s) => s.chain);
  const clock = useDesk((s) => s.clock);
  const [openId, setOpenId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [inWallet, setInWallet] = useState(false);
  const [showSmall, setShowSmall] = useState(true);
  const [sort, setSort] = useState<SortKey>("supplied");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Kind | "">("");
  const [flight, setFlight] = useState<{ title: string; detail: string } | null>(null);
  const [configs, setConfigs] = useState<Record<string, MarketConfig>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const flightGen = useRef(0);

  function dismissFlight() {
    flightGen.current += 1;
    cancelNearSigning();
    setFlight(null);
    setBusy("");
    setNote("Cancelled.");
  }

  useEffect(() => {
    warmNearSigner();
    if (accountId) void syncWallet(accountId);
  }, [accountId]);
  useEffect(() => {
    void loadIconBook()
      .then(() => useDesk.setState((state) => ({ clock: state.clock + 1 })))
      .catch(() => undefined);
  }, []);
  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollTop = 0;
    let parent = node.parentElement;
    while (parent) {
      if (parent.scrollTop > 0) parent.scrollTop = 0;
      parent = parent.parentElement;
    }
  }, [openId]);
  useEffect(() => {
    let live = true;
    void readMarketConfigs()
      .then((book) => {
        if (live) setConfigs(book);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const live = LEND_MARKETS.length > 0;
  const markets = useMemo(() => (live ? [...LEND_MARKETS] : FALLBACK), [clock, live]);
  const warmKey = markets.map((market) => market.token || "").filter(Boolean).join(",");
  useEffect(() => {
    if (!accountId || !warmKey) return;
    warmBurrow(accountId, warmKey.split(","));
  }, [accountId, warmKey]);
  const suppliedUsd = Object.entries(supplied).reduce((sum, [symbol, value]) => sum + value * priceOf(symbol), 0);
  const debtUsd = Object.entries(loans).reduce((sum, [symbol, value]) => sum + value * priceOf(symbol), 0);
  const credit = collateralCredit(supplied, configs);
  const health = debtUsd <= 0 ? (credit > 0 ? 99 : 0) : credit / debtUsd;
  const room = Math.max(0, credit - debtUsd);
  const totals = useMemo(() => {
    return markets.reduce(
      (sum, market) => {
        sum.supplied += market.suppliedUsd;
        sum.borrowed += market.borrowedUsd;
        sum.available += market.availableUsd;
        return sum;
      },
      { supplied: 0, borrowed: 0, available: 0 },
    );
  }, [markets]);
  const feature = useMemo(() => {
    const ranked = markets.filter((market) => market.suppliedUsd >= 100_000 && market.supplyApy > 0);
    ranked.sort((a, b) => b.supplyApy - a.supplyApy);
    return ranked[0] ?? null;
  }, [markets]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const next = markets.filter((market) => {
      if (!showSmall && market.suppliedUsd < 10_000) return false;
      if (category === "stable" && !isStable(market)) return false;
      if (category === "other" && isStable(market)) return false;
      if (inWallet && bookAmount(chain, market) <= 0 && bookAmount(supplied, market) <= 0 && bookAmount(loans, market) <= 0) return false;
      if (!needle) return true;
      const name = assetName(market, configs[market.token?.toLowerCase() ?? ""]).toLowerCase();
      return [market.symbol, market.ticker, market.token, name].some((part) => part?.toLowerCase().includes(needle));
    });
    const sign = dir === "asc" ? 1 : -1;
    next.sort((a, b) => {
      if (sort === "asset") return tickerOf(a).localeCompare(tickerOf(b)) * sign;
      if (sort === "supplyApy") return (a.supplyApy - b.supplyApy) * sign;
      if (sort === "borrowApy") return (a.borrowApy - b.borrowApy) * sign;
      if (sort === "borrowed") return (a.borrowedUsd - b.borrowedUsd) * sign;
      return (a.suppliedUsd - b.suppliedUsd) * sign;
    });
    return next;
  }, [markets, query, category, inWallet, showSmall, sort, dir, chain, supplied, loans, configs]);
  const openMarket = openId ? markets.find((market) => marketId(market) === openId) ?? null : null;

  function toggleSort(key: SortKey) {
    if (sort === key) setDir((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setDir(key === "asset" ? "asc" : "desc");
    }
  }

  function borrowableTokens(market: LendMarket) {
    const price = market.price || tokenBySymbol(market.symbol).price || 0;
    const roomTokens = price > 0 ? room / price : 0;
    const liquidity = market.available > 0 ? market.available : roomTokens;
    return Math.max(0, Math.min(roomTokens, liquidity));
  }

  async function act(kind: Kind, market: LendMarket) {
    if (!connected || !accountId) {
      connect();
      setNote("Connect a NEAR wallet first.");
      return;
    }
    const qtyN = Number(amount) || 0;
    if (busy) return;
    if (qtyN <= 0) {
      setNote("Enter an amount.");
      return;
    }
    const token = market.token;
    if (!token) {
      setNote("That market has no NEAR contract.");
      return;
    }
    const config = configs[token.toLowerCase()];
    if (kind === "supply" && config && !config.deposit) {
      setNote("Supply is turned off for this asset.");
      return;
    }
    if (kind === "borrow" && config && !config.borrowable) {
      setNote("Borrowing is turned off for this asset.");
      return;
    }
    const decimals = config?.decimals ?? lendDecimals(token);
    const wallet = useDesk.getState().accountId;
    if (!wallet) return;
    const walletQty = bookAmount(useDesk.getState().chain, market);
    const suppliedQty = bookAmount(useDesk.getState().supplied, market);
    const debtQty = bookAmount(useDesk.getState().loans, market);
    if (kind === "supply" && walletQty + 1e-8 < qtyN) {
      setNote(`This wallet holds ${qty(walletQty)} ${tickerOf(market)}.`);
      return;
    }
    if (kind === "repay" && debtQty + 1e-8 < qtyN) {
      setNote("This account does not owe that much.");
      return;
    }
    if (kind === "withdraw" && suppliedQty + 1e-8 < qtyN) {
      setNote("That is more than this account supplied on Rhea.");
      return;
    }
    if (kind === "borrow") {
      const cap = borrowableTokens(market);
      if (qtyN > cap + 1e-8) {
        setNote(cap <= 0 ? "Supply collateral before borrowing." : `You can borrow up to ${qty(cap)} ${tickerOf(market)}.`);
        return;
      }
    }
    const generation = flightGen.current;
    armWalletPopup();
    setBusy(kind);
    const verb = kind === "supply" ? "Supply" : kind === "withdraw" ? "Withdraw" : kind === "borrow" ? "Borrow" : "Repay";
    setFlight({ title: `${verb} ${tickerOf(market)}`, detail: `${qty(qtyN)} ${tickerOf(market)}` });
    try {
      setNote("Confirm the transaction in your NEAR wallet.");
      if (kind === "supply") await supplyOnBurrow(wallet, token, String(qtyN), decimals);
      else if (kind === "withdraw") await withdrawFromBurrow(wallet, token, String(qtyN), decimals);
      else if (kind === "borrow") await borrowFromBurrow(wallet, token, String(qtyN), decimals);
      else await repayOnBurrow(wallet, token, String(qtyN), decimals);
      await syncWallet(wallet);
      if (flightGen.current !== generation) return;
      const verb = kind === "supply" ? "Supplied" : kind === "withdraw" ? "Withdrew" : kind === "borrow" ? "Borrowed" : "Repaid";
      setNote(`${verb} ${qty(qtyN)} ${tickerOf(market)} on Rhea.`);
      setAmount("");
    } catch (error) {
      if (flightGen.current !== generation) return;
      setNote(error instanceof Error ? error.message : "Lending move failed.");
    } finally {
      if (flightGen.current === generation) {
        setBusy("");
        setFlight(null);
      }
    }
  }

  return (
    <div ref={scroller} className="flex h-full min-h-0 w-full flex-1 flex-col overflow-y-auto overscroll-contain pb-8">
      {openMarket ? (
        <Reserve
          market={openMarket}
          config={configs[openMarket.token?.toLowerCase() ?? ""]}
          connected={connected}
          connect={connect}
          amount={amount}
          setAmount={setAmount}
          walletQty={bookAmount(chain, openMarket)}
          suppliedQty={bookAmount(supplied, openMarket)}
          debtQty={bookAmount(loans, openMarket)}
          borrowQty={borrowableTokens(openMarket)}
          room={room}
          health={health}
          suppliedUsd={suppliedUsd}
          debtUsd={debtUsd}
          note={note}
          busy={busy}
          onBack={() => {
            setOpenId(null);
            setNote("");
          }}
          onAct={(kind) => void act(kind, openMarket)}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <header>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              <Stat label="Total supplied" value={live ? money(totals.supplied) : "—"} />
              <Stat label="Total borrowed" value={live ? money(totals.borrowed) : "—"} />
              <Stat label="Available" value={live ? money(totals.available) : "—"} />
              <Stat label="Your supplied" value={connected ? usd(suppliedUsd) : "—"} />
              <Stat label="Borrow room" value={connected ? usd(room) : "—"} hint={connected ? `Of ${usd(suppliedUsd)} supplied` : "Connect a NEAR wallet"} />
              <Stat label="Health" value={connected ? healthText(health) : "—"} tone={!connected ? undefined : health > 0 && health < 1.15 ? "bad" : "good"} hint={connected ? (health >= 99 ? "Nothing borrowed" : "Collateral factor") : "Connect a NEAR wallet"} />
            </dl>
          </header>

          {feature && (
            <button
              type="button"
              onClick={() => setOpenId(marketId(feature))}
              className="grid items-center gap-4 rounded-2xl border border-line bg-surface p-4 text-left sm:grid-cols-[minmax(0,1.2fr)_auto_auto_auto]"
            >
              <span className="flex min-w-0 items-center gap-3">
                <TokenIcon token={iconOf(feature)} className="size-10" />
                <span className="min-w-0">
                  <span className="block font-semibold">Earn on {tickerOf(feature)}</span>
                  <span className="block text-sm text-muted">Supply yield on Rhea. Withdraw any time.</span>
                </span>
              </span>
              <span>
                <span className="block text-xs text-muted">Total supplied</span>
                <span className="font-mono text-lg">{money(feature.suppliedUsd)}</span>
              </span>
              <span>
                <span className="block text-xs text-muted">Supply APY</span>
                <span className="font-mono text-lg text-primary">{apyText(feature.supplyApy)}</span>
              </span>
              <span className="inline-flex h-11 items-center justify-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg">View details</span>
            </button>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search asset name, symbol, or address"
                className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-sm outline-none"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setInWallet((value) => !value)}
                className={cn("inline-flex h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm", inWallet && "border-primary text-primary")}
              >
                In wallet
                <span className={cn("relative h-5 w-9 rounded-full", inWallet ? "bg-primary" : "bg-line")}>
                  <span className={cn("absolute top-0.5 size-4 rounded-full bg-fg", inWallet ? "right-0.5" : "left-0.5")} />
                </span>
              </button>
              <div className="flex h-11 w-full items-center gap-1 rounded-xl border border-line bg-surface p-1 sm:w-auto" role="group" aria-label="Asset category">
                {(
                  [
                    ["all", "All"],
                    ["stable", "Stablecoins"],
                    ["other", "Other"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={category === id}
                    onClick={() => setCategory(id)}
                    className={cn("h-9 flex-1 rounded-lg px-3 text-sm sm:flex-none", category === id ? "bg-primary font-semibold text-primary-fg" : "text-muted")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="grid min-h-48 place-items-center rounded-2xl border border-line bg-surface px-6 py-16 text-center">
              <div>
                <p className="font-semibold">No search results for '{query || "that filter"}'</p>
                <p className="mt-1 text-sm text-muted">No Rhea asset matches this search.</p>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-line bg-surface">
              <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_auto] gap-3 border-b border-line px-4 py-3 text-xs uppercase tracking-wide text-muted md:grid">
                <SortButton label="Asset" active={sort === "asset"} dir={dir} onClick={() => toggleSort("asset")} />
                <SortButton label="Total supplied" active={sort === "supplied"} dir={dir} onClick={() => toggleSort("supplied")} align />
                <SortButton label="Supply APY" active={sort === "supplyApy"} dir={dir} onClick={() => toggleSort("supplyApy")} align />
                <SortButton label="Total borrowed" active={sort === "borrowed"} dir={dir} onClick={() => toggleSort("borrowed")} align />
                <SortButton label="Borrow APY" active={sort === "borrowApy"} dir={dir} onClick={() => toggleSort("borrowApy")} align />
                <span className="sr-only">Details</span>
              </div>
              <ul>
                {rows.map((market) => {
                  const config = configs[market.token?.toLowerCase() ?? ""];
                  return (
                    <li key={marketId(market)} className="border-b border-line last:border-b-0">
                      <div className="hidden items-center gap-3 px-4 py-3 md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_auto]">
                        <AssetCell market={market} config={config} />
                        <AmountCell amount={market.supplied} usd={market.suppliedUsd} />
                        <p className="text-right font-mono text-primary">{apyText(market.supplyApy)}</p>
                        <AmountCell amount={market.borrowed} usd={market.borrowedUsd} />
                        <div className="text-right">
                          <p className="font-mono">{apyText(market.borrowApy)}</p>
                          {config && !config.borrowable && <p className="text-xs text-muted">Disabled</p>}
                        </div>
                        <button type="button" onClick={() => setOpenId(marketId(market))} className="h-11 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-fg">
                          Details
                        </button>
                      </div>
                      <button type="button" onClick={() => setOpenId(marketId(market))} className="flex w-full flex-col gap-3 px-3 py-3 text-left md:hidden">
                        <span className="flex items-center justify-between gap-3">
                          <AssetCell market={market} config={config} />
                          <span className="inline-flex h-8 shrink-0 items-center rounded-lg bg-primary px-3 text-xs font-semibold text-primary-fg">Details</span>
                        </span>
                        <span className="grid grid-cols-2 gap-2 text-sm">
                          <MiniStat label="Supplied" value={compact(market.supplied)} hint={money(market.suppliedUsd)} />
                          <MiniStat label="Supply APY" value={apyText(market.supplyApy)} tone="primary" />
                          <MiniStat label="Borrowed" value={compact(market.borrowed)} hint={money(market.borrowedUsd)} />
                          <MiniStat label="Borrow APY" value={apyText(market.borrowApy)} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <label className="inline-flex h-11 w-fit items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={showSmall} onChange={(event) => setShowSmall(event.target.checked)} className="size-4 accent-primary" />
            Show assets under $10k supplied
          </label>
          {!live && <p className="text-sm text-muted">Loading Rhea markets…</p>}
          {note && <p className="text-sm text-muted">{note}</p>}
        </div>
      )}
      {flight && <ConfirmGate title={flight.title} detail={flight.detail} onDismiss={dismissFlight} />}
    </div>
  );
}

function Reserve({
  market,
  config,
  connected,
  connect,
  amount,
  setAmount,
  walletQty,
  suppliedQty,
  debtQty,
  borrowQty,
  room,
  health,
  suppliedUsd,
  debtUsd,
  note,
  busy,
  onBack,
  onAct,
}: {
  market: LendMarket;
  config?: MarketConfig;
  connected: boolean;
  connect: () => void | Promise<void>;
  amount: string;
  setAmount: (value: string) => void;
  walletQty: number;
  suppliedQty: number;
  debtQty: number;
  borrowQty: number;
  room: number;
  health: number;
  suppliedUsd: number;
  debtUsd: number;
  note: string;
  busy: Kind | "";
  onBack: () => void;
  onAct: (kind: Kind) => void;
}) {
  const name = assetName(market, config);
  const ticker = tickerOf(market);
  const price = market.price || tokenBySymbol(market.symbol).price || 0;
  const util = market.supplied > 0 ? Math.max(0, Math.min(100, (market.borrowed / market.supplied) * 100)) : 0;
  const supplyCap = config?.supplyCap ?? 0;
  const borrowCap = config?.borrowCap ?? 0;
  const supplyFill = supplyCap > 0 ? Math.min(100, (market.supplied / supplyCap) * 100) : util;
  const borrowFill = borrowCap > 0 ? Math.min(100, (market.borrowed / borrowCap) * 100) : util;
  const walletUsd = walletQty * price;
  const good = /^(Supplied|Withdrew|Borrowed|Repaid)\b/.test(note);

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className="inline-flex h-11 w-fit items-center gap-2 text-sm text-muted">
        <ArrowLeft className="size-4" />
        Back
      </button>
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <TokenIcon token={iconOf(market)} className="size-12" />
          <div className="min-w-0">
            <h2 className="truncate text-2xl font-semibold tracking-tight">
              {name} <span className="text-muted">{ticker}</span>
            </h2>
            <p className="text-sm text-muted">on Rhea · NEAR</p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
          <Stat label="Reserve size" value={money(market.suppliedUsd)} />
          <Stat label="Available liquidity" value={money(market.availableUsd)} />
          <Stat label="Utilization" value={`${util.toFixed(2)}%`} />
          <Stat label="Oracle price" value={price > 0 ? px(price) : "—"} />
        </dl>
      </header>

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.5fr)_20rem]">
        <aside className="order-2 rounded-2xl border border-line bg-surface p-4 lg:sticky lg:top-0">
          <h3 className="text-lg font-semibold">Your info</h3>
          {!connected ? (
            <div className="mt-4">
              <p className="text-sm leading-relaxed text-muted">Connect a NEAR wallet to supply, withdraw, borrow, or repay.</p>
              <button type="button" onClick={() => void connect()} className="mt-4 h-11 w-full rounded-xl bg-primary font-semibold text-primary-fg">
                Connect wallet
              </button>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              <div className="rounded-xl bg-bg px-3 py-2">
                <p className="text-xs text-muted">Wallet balance</p>
                <p className="font-mono">
                  {qty(walletQty)} {ticker}
                </p>
                <p className="text-xs text-muted">{usd(walletUsd)}</p>
              </div>
              <label className="text-xs uppercase tracking-wide text-muted">
                Amount
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
                  className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 font-mono text-base normal-case text-fg outline-none"
                />
              </label>
              <ActionRow
                label="Available to supply"
                amount={`${qty(walletQty)} ${ticker}`}
                hint={usd(walletUsd)}
                action="Supply"
                tone="primary"
                disabled={Boolean(busy) || (config ? !config.deposit : false)}
                busy={busy === "supply"}
                onMax={() => setAmount(plain(walletQty))}
                onClick={() => onAct("supply")}
              />
              <ActionRow
                label="Your supplied"
                amount={`${qty(suppliedQty)} ${ticker}`}
                hint={usd(suppliedQty * price)}
                action="Withdraw"
                disabled={Boolean(busy) || suppliedQty <= 0 || (config ? !config.withdraw : false)}
                busy={busy === "withdraw"}
                onMax={() => setAmount(plain(suppliedQty))}
                onClick={() => onAct("withdraw")}
              />
              <ActionRow
                label="Available to borrow"
                amount={`${qty(borrowQty)} ${ticker}`}
                hint={usd(borrowQty * price)}
                action="Borrow"
                disabled={Boolean(busy) || borrowQty <= 0 || (config ? !config.borrowable : false)}
                busy={busy === "borrow"}
                onMax={() => setAmount(plain(borrowQty))}
                onClick={() => onAct("borrow")}
              />
              <ActionRow
                label="Your debt"
                amount={`${qty(debtQty)} ${ticker}`}
                hint={usd(debtQty * price)}
                action="Repay"
                disabled={Boolean(busy) || debtQty <= 0}
                busy={busy === "repay"}
                onMax={() => setAmount(plain(Math.min(debtQty, walletQty)))}
                onClick={() => onAct("repay")}
              />
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-bg px-3 py-2 text-sm">
                <p>
                  <span className="block text-xs text-muted">Health</span>
                  <span className={cn("font-mono", health > 0 && health < 1.15 ? "text-danger" : "text-primary")}>{healthText(health)}</span>
                </p>
                <p>
                  <span className="block text-xs text-muted">Borrow room</span>
                  <span className="font-mono">{usd(room)}</span>
                </p>
              </div>
              <p className="text-xs leading-relaxed text-muted">Borrow room is 70% of {usd(suppliedUsd)} supplied, minus {usd(debtUsd)} already owed.</p>
              {walletQty <= 0 && (
                <p className="flex gap-2 rounded-xl bg-bg px-3 py-2 text-sm text-muted">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-primary" />
                  This wallet has no {ticker} to supply.
                </p>
              )}
              {borrowQty <= 0 && (
                <p className="flex gap-2 rounded-xl bg-bg px-3 py-2 text-sm text-muted">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
                  {market.available <= 0 ? "No liquidity left to borrow in this market." : "Supply collateral before borrowing."}
                </p>
              )}
              {note && <p className={cn("text-sm", good ? "text-primary" : "text-muted")}>{note}</p>}
            </div>
          )}
        </aside>

        <section className="order-1 flex flex-col gap-6 rounded-2xl border border-line bg-surface p-4">
          <h3 className="text-lg font-semibold">Reserve status</h3>
          <div>
            <p className="text-sm text-muted">Supply info</p>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <Ring value={supplyFill} tone="supply" />
              <div>
                <p className="text-xs text-muted">{supplyCap > 0 ? "Total supplied" : "Pool utilization"}</p>
                <p className="font-mono text-lg">
                  {compact(market.supplied)}
                  {supplyCap > 0 ? ` of ${compact(supplyCap)}` : ""}
                </p>
                <p className="text-sm text-muted">
                  {money(market.suppliedUsd)}
                  {supplyCap > 0 ? ` of ${money(supplyCap * price)}` : ""}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted">Supply APY</p>
                <p className="font-mono text-lg text-primary">{apyText(market.supplyApy)}</p>
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm">
                <span className="text-muted">Collateral</span>{" "}
                <span className={config ? (config.collateral ? "text-primary" : "text-danger") : "text-muted"}>
                  {config ? (config.collateral ? "Can be collateral" : "Cannot be collateral") : "Loading collateral rules…"}
                </span>
              </p>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Tile label="Desk max LTV" value="70.00%" />
              <Tile label="Protocol factor" value={config ? `${config.ltv.toFixed(2)}%` : "—"} />
              <Tile label="Reserve factor" value={config ? `${config.reserve.toFixed(2)}%` : "—"} />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">This desk lends against 70% of what you supplied. Rhea’s own collateral factor is the protocol number.</p>
          </div>

          <div>
            <p className="text-sm text-muted">Borrow info</p>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <Ring value={borrowFill} tone="borrow" />
              <div>
                <p className="text-xs text-muted">{borrowCap > 0 ? "Total borrowed" : "Pool utilization"}</p>
                <p className="font-mono text-lg">
                  {compact(market.borrowed)}
                  {borrowCap > 0 ? ` of ${compact(borrowCap)}` : ""}
                </p>
                <p className="text-sm text-muted">
                  {money(market.borrowedUsd)}
                  {borrowCap > 0 ? ` of ${money(borrowCap * price)}` : ""}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted">Borrow APY</p>
                <p className="font-mono text-lg">{apyText(market.borrowApy)}</p>
                {config && !config.borrowable && <p className="text-xs text-muted">Disabled</p>}
              </div>
              {borrowCap > 0 && (
                <div>
                  <p className="text-xs text-muted">Borrow cap</p>
                  <p className="font-mono text-lg">{compact(borrowCap)}</p>
                  <p className="text-sm text-muted">{money(borrowCap * price)}</p>
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-sm font-medium">Interest rate model</p>
                <p className="text-xs text-muted">
                  Utilization {util.toFixed(2)}%{config ? ` · optimal ${config.target.toFixed(0)}%` : ""}
                </p>
              </div>
              <p className="flex gap-3 text-xs text-muted">
                <span className="text-primary">Supply APR</span>
                <span className="text-danger">Borrow APR</span>
              </p>
            </div>
            <RateChart points={config?.curve ?? []} current={util} optimal={config?.target} />
            <p className="text-xs leading-relaxed text-muted">The lines are Rhea’s on-chain rate model, not a guessed price history. The dashed line is where this market sits now.</p>
            <a href="https://nearblocks.io/address/contract.main.burrow.near" target="_blank" rel="noreferrer" className="mt-3 inline-flex h-11 items-center text-sm text-primary">
              View market contract
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}

function RateChart({ points, current, optimal }: { points: RatePoint[]; current: number; optimal?: number }) {
  if (points.length < 2) return <p className="py-10 text-center text-sm text-muted">Loading the rate model…</p>;
  return (
    <div className="mt-3 h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis type="number" dataKey="util" domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(value) => `${value}%`} stroke="var(--color-muted)" fontSize={11} />
          <YAxis tickFormatter={(value) => `${Number(value).toFixed(0)}%`} stroke="var(--color-muted)" fontSize={11} width={42} />
          <Tooltip
            formatter={(value, name) => [`${Number(value ?? 0).toFixed(2)}%`, name === "supply" ? "Supply APR" : "Borrow APR"]}
            labelFormatter={(label) => `Utilization ${label}%`}
            contentStyle={{ background: "var(--color-surface-2)", border: "1px solid var(--color-line)", borderRadius: 12, color: "var(--color-fg)" }}
          />
          <ReferenceLine x={current} stroke="var(--color-fg)" strokeDasharray="3 3" />
          {optimal != null && <ReferenceLine x={optimal} stroke="var(--color-primary)" strokeDasharray="2 4" />}
          <Area type="monotone" dataKey="supply" stroke="var(--color-primary)" fill="var(--color-primary)" fillOpacity={0.12} dot={false} />
          <Area type="monotone" dataKey="borrow" stroke="var(--color-danger)" fill="var(--color-danger)" fillOpacity={0.08} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function Ring({ value, tone }: { value: number; tone: "supply" | "borrow" }) {
  const p = Math.max(0, Math.min(100, value));
  const radius = 34;
  const turn = 2 * Math.PI * radius;
  return (
    <div className="relative grid size-24 shrink-0 place-items-center">
      <svg viewBox="0 0 88 88" className="size-24 -rotate-90">
        <circle cx="44" cy="44" r={radius} className="fill-none stroke-line" strokeWidth="7" />
        <circle
          cx="44"
          cy="44"
          r={radius}
          className={tone === "supply" ? "fill-none stroke-primary" : "fill-none stroke-danger"}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${(p / 100) * turn} ${turn}`}
        />
      </svg>
      <span className="absolute font-mono text-xs font-semibold">{p.toFixed(2)}%</span>
    </div>
  );
}

function ActionRow({
  label,
  amount,
  hint,
  action,
  tone,
  disabled,
  busy,
  onMax,
  onClick,
}: {
  label: string;
  amount: string;
  hint: string;
  action: string;
  tone?: "primary";
  disabled?: boolean;
  busy?: boolean;
  onMax: () => void;
  onClick: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className="truncate font-mono text-sm">{amount}</p>
        <button type="button" onClick={onMax} className="text-xs text-primary">
          Max · {hint}
        </button>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "h-11 shrink-0 rounded-xl px-4 text-sm font-semibold disabled:opacity-40",
          tone === "primary" ? "bg-primary text-primary-fg" : "border border-line",
        )}
      >
        {busy ? "Confirm…" : action}
      </button>
    </div>
  );
}

function AssetCell({ market, config }: { market: LendMarket; config?: MarketConfig }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <TokenIcon token={iconOf(market)} className="size-8" />
      <span className="min-w-0">
        <span className="block truncate font-semibold">{assetName(market, config)}</span>
        <span className="block text-xs text-muted">{tickerOf(market)}</span>
      </span>
    </span>
  );
}

function AmountCell({ amount, usd: value }: { amount: number; usd: number }) {
  return (
    <div className="text-right">
      <p className="font-mono">{compact(amount)}</p>
      <p className="text-xs text-muted">{money(value)}</p>
    </div>
  );
}

function MiniStat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "primary" }) {
  return (
    <span>
      <span className="block text-xs text-muted">{label}</span>
      <span className={cn("font-mono", tone === "primary" && "text-primary")}>{value}</span>
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </span>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className={cn("min-w-0 rounded-2xl border bg-surface px-3 py-3", tone === "good" ? "border-primary/40" : tone === "bad" ? "border-danger/50" : "border-line")}>
      <dt className="truncate text-[11px] font-medium uppercase tracking-wide text-muted">{label}</dt>
      <dd className={cn("mt-1 truncate font-mono text-lg font-semibold leading-none", tone === "good" && "text-primary", tone === "bad" && "text-danger")}>{value}</dd>
      {hint && <p className="mt-1.5 truncate text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="font-mono text-lg">{value}</p>
    </div>
  );
}

function SortButton({ label, active, dir, align, onClick }: { label: string; active: boolean; dir: "asc" | "desc"; align?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("inline-flex items-center gap-1 uppercase", align && "justify-end text-right")}>
      {label}
      <span className={cn("w-3 text-center", active ? "text-fg" : "text-transparent")}>{dir === "asc" ? "↑" : "↓"}</span>
    </button>
  );
}

function priceOf(symbol: string) {
  const market = LEND_MARKETS.find((item) => item.symbol === symbol || item.ticker === symbol || item.token?.toLowerCase() === symbol.toLowerCase());
  if (market && market.price > 0) return market.price;
  const listed = tokenBySymbol(symbol).price;
  if (listed > 0) return listed;
  if (STABLES.has(symbol.toUpperCase())) return 1;
  return 0;
}

function collateralCredit(book: Record<string, number>, configs: Record<string, MarketConfig>) {
  let credit = 0;
  for (const [symbol, amount] of Object.entries(book)) {
    if (!(amount > 0)) continue;
    const market = LEND_MARKETS.find((item) => item.symbol === symbol || item.ticker === symbol || item.token?.toLowerCase() === symbol.toLowerCase());
    const config = market?.token ? configs[market.token.toLowerCase()] : configs[symbol.toLowerCase()];
    if (config && !config.collateral) continue;
    const ltv = config && config.ltv > 1 ? config.ltv / 100 : config && config.ltv > 0 ? config.ltv : 0.75;
    credit += amount * priceOf(symbol) * ltv;
  }
  return credit;
}

function blank(symbol: string, token: string): LendMarket {
  return { symbol, ticker: symbol, token, supplyApy: 0, borrowApy: 0, price: 0, supplied: 0, suppliedUsd: 0, borrowed: 0, borrowedUsd: 0, available: 0, availableUsd: 0 };
}

function marketId(market: LendMarket) {
  return market.token || market.symbol;
}

function tickerOf(market: LendMarket) {
  return market.ticker || market.symbol;
}

function isStable(market: LendMarket) {
  const ticker = (market.ticker || market.symbol).toUpperCase();
  return STABLES.has(market.symbol.toUpperCase()) || STABLES.has(ticker);
}

function assetName(market: LendMarket, config?: MarketConfig) {
  return NAMES[market.symbol] || NAMES[market.ticker ?? ""] || config?.name || tickerOf(market);
}

function iconOf(market: LendMarket) {
  const ticker = tickerOf(market);
  const listed =
    TOKENS.find((item) => market.token && item.address?.toLowerCase() === market.token.toLowerCase()) ??
    TOKENS.find((item) => item.symbol.toUpperCase() === market.symbol.toUpperCase() || item.symbol.toUpperCase() === ticker.toUpperCase());
  const icon = lendIcon(market.token) || iconFor(market.token, ticker) || listed?.icon || "";
  if (listed) return { ...listed, icon: icon || listed.icon, address: market.token || listed.address, chain: listed.chain || "NEAR" };
  return { symbol: ticker, icon, address: market.token, chain: "NEAR" };
}

function bookAmount(book: Record<string, number>, market: LendMarket) {
  const wanted = [market.symbol, market.ticker, market.token].filter((item): item is string => Boolean(item)).map((item) => item.toLowerCase());
  for (const [key, amount] of Object.entries(book)) {
    if (wanted.includes(key.toLowerCase()) && amount) return amount;
  }
  return 0;
}

function compact(n: number) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const trim = (value: number) => (value >= 100 ? value.toFixed(1) : value.toFixed(2));
  if (abs >= 1e9) return `${sign}${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}${trim(abs / 1e3)}K`;
  if (abs >= 1) return `${sign}${abs.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  if (abs > 0) return `${sign}${abs.toPrecision(2)}`;
  return "0";
}

function money(n: number) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const trim = (value: number) => (value >= 100 ? value.toFixed(1) : value.toFixed(2));
  if (abs >= 1e9) return `${sign}$${trim(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}$${trim(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}$${trim(abs / 1e3)}K`;
  return usd(n);
}

function apyText(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "0.00%";
  if (n < 0.01) return "<0.01%";
  return `${n.toFixed(2)}%`;
}

function healthText(health: number) {
  if (!Number.isFinite(health) || health <= 0) return "—";
  if (health >= 99) return "No debt";
  return health.toFixed(2);
}

function plain(n: number) {
  if (!(n > 0) || !Number.isFinite(n)) return "";
  const text = n >= 1 ? n.toFixed(6) : n.toPrecision(8);
  return text.replace(/\.?0+$/, "");
}
