import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Search, Wallet } from "lucide-react";
import { LendDesk } from "@/components/terminal/LendDesk";
import { Markets } from "@/components/terminal/Markets";
import { PortfolioDesk } from "@/components/terminal/PortfolioDesk";
import { SwapDesk } from "@/components/terminal/SwapDesk";
import { TokenTrade } from "@/components/terminal/TokenTrade";
import { TrackerDesk } from "@/components/terminal/TrackerDesk";
import { VaultDesk } from "@/components/terminal/VaultDesk";
import { canPerp, fmt, money, TOKENS } from "@/lib/market";
import { setWalletOpener, useDesk } from "@/lib/store";
import { startLiveFeed } from "@/lib/live";
import { visitToken } from "@/lib/watch";

const NAV = [
  ["markets", "Markets"],
  ["trade", "Trade"],
  ["tracker", "Tracker"],
  ["swap", "Swap"],
  ["vault", "Vault"],
  ["lend", "Lend"],
  ["portfolio", "Portfolio"],
] as const;

type View = (typeof NAV)[number][0];

export function Terminal() {
  const [view, setView] = useState<View>("markets");
  const [symbol, setSymbol] = useState("NEAR");
  const [deskMode, setDeskMode] = useState<"spot" | "perp">("spot");
  const [swapFocus, setSwapFocus] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [quickUsd] = useState(20);
  const [flash, setFlash] = useState("");
  const [walletOpen, setWalletOpen] = useState(false);
  const [walletError, setWalletError] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const connected = useDesk((s) => s.connected);
  const accountId = useDesk((s) => s.accountId);
  const nearYocto = useDesk((s) => s.nearYocto);
  const disconnect = useDesk((s) => s.disconnect);
  const balances = useDesk((s) => s.balances);
  const positions = useDesk((s) => s.positions);
  const tick = useDesk((s) => s.tick);

  useEffect(() => {
    setWalletOpener(() => {
      setWalletError("");
      setWalletOpen(true);
    });
    void import("@/lib/near-wallet").then((mod) => mod.restoreNearSession()).catch(() => undefined);
    startLiveFeed();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => tick(), 1600);
    return () => window.clearInterval(timer);
  }, [tick]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(""), 2600);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    mainRef.current?.scrollTo(0, 0);
  }, [view, symbol]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && view === "markets") {
        event.preventDefault();
        const field = [...document.querySelectorAll<HTMLInputElement>("[data-market-search]")].find((node) => node.offsetParent !== null);
        field?.focus();
      }
      if (event.key === "Escape" && view === "trade") setView("markets");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view]);

  const marks = useDesk((s) => s.marks);
  const walletUsd = Object.entries(balances).reduce((sum, [name, amount]) => sum + amount * (marks[name] ?? TOKENS.find((token) => token.symbol === name)?.price ?? 0), 0);
  const fit = view === "vault";
  const lock = view === "swap" || view === "lend";

  function openToken(next: string) {
    setSymbol(next);
    setDeskMode("spot");
    setView("trade");
    setQuery("");
    visitToken(next);
  }

  function openSwap(next: string) {
    setSymbol(next);
    setSwapFocus(next);
    setView("swap");
    setQuery("");
    visitToken(next);
  }

  function onWallet() {
    if (connected) disconnect();
    else {
      setWalletError("");
      setWalletOpen(true);
    }
  }

  async function pickWallet(kind: "intear" | "here" | "more") {
    setWalletError("");
    try {
      if (kind === "intear") {
        const { connectIntearWallet } = await import("@/lib/near-wallet");
        await connectIntearWallet();
        setWalletOpen(false);
        return;
      }
      if (kind === "here") {
        const { connectHereWallet } = await import("@/lib/near-wallet");
        await connectHereWallet();
        setWalletOpen(false);
        return;
      }
      const { openNearWallets } = await import("@/lib/near-wallet");
      await openNearWallets();
      setWalletOpen(false);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Wallet did not open");
    }
  }

  async function watchAccount(account: string) {
    setWalletError("");
    try {
      const { connectReadOnly } = await import("@/lib/near-wallet");
      await connectReadOnly(account);
      setWalletOpen(false);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Account did not load");
    }
  }

  function go(next: View) {
    if (next === "swap") setSwapFocus(undefined);
    if (next === "trade") {
      visitToken(symbol);
      setView("trade");
      return;
    }
    setView(next);
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <header className="shrink-0 overflow-x-hidden border-b border-line">
        <div className="flex items-center gap-2 px-3 py-2 md:hidden">
          <Link to="/" className="mr-auto flex items-center gap-2">
            <span className="mark" aria-hidden />
            <span className="text-base font-semibold tracking-tight">Asgard</span>
          </Link>
          <WalletButton connected={connected} account={accountId} near={formatNear(nearYocto)} compact onClick={onWallet} />
        </div>
        <nav className="grid grid-cols-7 border-t border-line md:hidden">
          {NAV.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => go(id)}
              className={`h-10 min-w-0 truncate px-px text-[8px] font-medium tracking-tight min-[360px]:text-[10px] min-[420px]:text-[11px] ${view === id ? "bg-surface text-fg shadow-[inset_0_-2px_0_var(--color-primary)]" : "text-muted"}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="hidden items-center gap-3 px-4 py-2.5 md:flex lg:hidden">
          <Link to="/" className="flex shrink-0 items-center gap-2">
            <span className="mark" aria-hidden />
            <span className="text-lg font-semibold tracking-tight">Asgard</span>
          </Link>
          <nav className="grid min-w-0 flex-1 grid-cols-7 gap-1 rounded-full bg-surface p-1 ring-1 ring-line ring-inset">
            {NAV.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => go(id)}
                className={`inline-flex h-9 min-w-0 items-center justify-center truncate rounded-full px-1 text-center text-xs font-medium leading-none ${view === id ? "bg-bg text-fg shadow-[inset_0_-2px_0_var(--color-primary)]" : "text-muted"}`}
              >
                {label}
              </button>
            ))}
          </nav>
          <WalletButton connected={connected} account={accountId} near={formatNear(nearYocto)} compact onClick={onWallet} />
        </div>
        <div className="hidden items-center gap-5 px-6 py-3 lg:flex">
          <Link to="/" className="flex shrink-0 items-center gap-2.5">
            <span className="mark" aria-hidden />
            <span className="text-xl font-semibold tracking-tight">Asgard</span>
          </Link>
          <nav className="flex min-w-0 flex-1 items-center gap-1 rounded-full bg-surface p-1 ring-1 ring-line ring-inset">
            {NAV.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => go(id)}
                className={`h-10 min-w-0 flex-1 rounded-full px-2 text-sm font-medium ${view === id ? "bg-bg text-fg shadow-[inset_0_-2px_0_var(--color-primary)]" : "text-muted hover:text-fg"}`}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {view === "markets" && (
              <label className="relative hidden w-64 shrink-0 xl:block">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <input
                  ref={searchRef}
                  data-market-search
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search token"
                  className="h-10 w-full rounded-full border border-line bg-surface pl-9 pr-16 text-sm outline-none"
                />
                <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted">Ctrl K</kbd>
              </label>
            )}
            <WalletButton connected={connected} account={accountId} near={formatNear(nearYocto)} onClick={onWallet} />
          </div>
        </div>
        {view === "markets" && (
          <label className="relative mx-3 my-2 block xl:hidden">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              data-market-search
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search token"
              className="h-10 w-full rounded-full border border-line bg-surface pl-9 pr-3 text-sm outline-none"
            />
          </label>
        )}
      </header>

      <main ref={mainRef} className={`min-h-0 flex-1 overflow-x-hidden ${lock ? "overflow-y-hidden" : fit ? "overflow-y-hidden sm:overflow-y-auto" : "overflow-y-auto"}`}>
        <div key={view} className={`stage ${lock ? "flex h-full min-h-0 flex-col overflow-hidden" : fit ? "h-full min-h-0 overflow-hidden sm:h-auto sm:overflow-visible" : ""}`}>
        {view === "markets" && <Markets query={query} onOpen={(next) => openToken(next)} onSwap={openSwap} />}
        {(view === "trade") && (
          <TokenTrade
            symbol={symbol}
            mode={deskMode}
            quickUsd={quickUsd}
            onMode={setDeskMode}
            onSymbol={(next) => {
              setSymbol(next);
              visitToken(next);
            }}
            onFlash={setFlash}
          />
        )}
        {view === "swap" && (
          <div className="flex h-full min-h-0 flex-1 items-center overflow-hidden px-2 py-2 sm:px-4 sm:py-3">
            <SwapDesk key={swapFocus ?? "desk"} focus={swapFocus} />
          </div>
        )}
        {view === "vault" && (
          <div className="h-full min-h-0 overflow-hidden px-2 py-1.5 sm:h-auto sm:overflow-visible sm:px-4 sm:py-4">
            <VaultDesk />
          </div>
        )}
        {view === "lend" && (
          <div className="flex h-full min-h-0 flex-1 items-center overflow-hidden px-2 py-2 sm:px-4 sm:py-3">
            <LendDesk />
          </div>
        )}
        {view === "portfolio" && <PortfolioDesk />}
        {view === "tracker" && <TrackerDesk onTrade={openToken} onFlash={setFlash} />}
        </div>
      </main>

      <footer className="shrink-0 border-t border-line bg-bg px-3 py-2 sm:px-6">
        <div className="flex w-full items-center justify-between gap-3 sm:gap-8">
          <button
            type="button"
            onClick={() => {
              if (!canPerp(symbol)) setSymbol("NEAR");
              setDeskMode("perp");
              setView("trade");
              visitToken(canPerp(symbol) ? symbol : "NEAR");
            }}
            className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-surface px-3 ring-1 ring-line ring-inset"
          >
            <span className="text-[10px] uppercase tracking-wide text-muted">Positions</span>
            <span className="font-mono text-sm text-primary">{positions.length}</span>
          </button>
          <div className="flex min-w-0 flex-1 items-center justify-evenly gap-3 sm:justify-center sm:gap-10">
            <FooterStat label="USDC" value={connected ? money(balances.USDC ?? 0) : "—"} />
            <FooterStat label="NEAR" value={connected ? fmt(balances.NEAR ?? 0, 2) : "—"} />
            <FooterStat label="Wallet" value={connected ? money(walletUsd) : "—"} className="hidden sm:flex" />
          </div>
          <button type="button" onClick={() => setView("swap")} className="h-10 shrink-0 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-fg sm:px-4">
            <span className="sm:hidden">Route</span>
            <span className="hidden sm:inline">Aggregator</span>
          </button>
        </div>
      </footer>

      {flash && <p className="fixed bottom-16 left-1/2 z-30 max-w-md -translate-x-1/2 rounded-full border border-line bg-bg px-4 py-2 text-center text-sm">{flash}</p>}
      {walletOpen && <WalletSheet error={walletError} onClose={() => setWalletOpen(false)} onPick={(kind) => void pickWallet(kind)} onWatch={(account) => void watchAccount(account)} />}
    </div>
  );
}

function FooterStat({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <span className={`flex min-w-0 flex-col items-center gap-0.5 ${className}`}>
      <span className="text-[9px] uppercase tracking-wide text-muted">{label}</span>
      <span className="max-w-full truncate font-mono text-xs text-fg">{value}</span>
    </span>
  );
}

function WalletSheet({
  error,
  onClose,
  onPick,
  onWatch,
}: {
  error: string;
  onClose: () => void;
  onPick: (kind: "intear" | "here" | "more") => void;
  onWatch: (account: string) => void;
}) {
  const [account, setAccount] = useState("");
  return (
    <div className="fixed inset-0 z-[80] grid place-items-end bg-black/70 p-3 sm:place-items-center" onClick={onClose}>
      <section className="w-full max-w-md rounded-2xl border border-line bg-bg p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted">NEAR mainnet</p>
            <h2 className="text-lg font-semibold">Connect a wallet</h2>
          </div>
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-full border border-line text-sm text-muted">
            Close
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">Intear and HERE sign on this page. Extension wallets only work if they are installed.</p>
        <div className="mt-4 grid gap-2">
          <button type="button" onClick={() => onPick("intear")} className="h-12 rounded-xl bg-primary px-4 text-left text-sm font-semibold text-primary-fg">
            Intear Wallet
            <span className="mt-0.5 block text-xs font-normal opacity-80">Signs in this page. No extension.</span>
          </button>
          <button type="button" onClick={() => onPick("here")} className="h-12 rounded-xl border border-line px-4 text-left text-sm font-semibold">
            HERE Wallet
            <span className="mt-0.5 block text-xs font-normal text-muted">Opens an overlay on this page</span>
          </button>
          <button type="button" onClick={() => onPick("more")} className="h-11 rounded-xl border border-line px-4 text-left text-sm text-muted">
            Meteor, Nightly, Sender, HOT
          </button>
        </div>
        <form
          className="mt-4 border-t border-line pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            onWatch(account);
          }}
        >
          <label className="block text-xs text-muted" htmlFor="near-account">
            Or read a mainnet account
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="near-account"
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              placeholder="name.near"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-sm outline-none"
            />
            <button type="submit" className="h-11 shrink-0 rounded-xl border border-line px-3 text-sm font-semibold">
              Load
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">View only. Balances come from the chain. Swaps still need Intear or HERE to sign.</p>
        </form>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </section>
    </div>
  );
}

function formatNear(yocto: string | null) {
  if (!yocto) return null;
  try {
    const whole = BigInt(yocto) / 10n ** 20n;
    return (Number(whole) / 10_000).toLocaleString("en-US", { maximumFractionDigits: 4 });
  } catch {
    return null;
  }
}

function WalletButton({
  connected,
  account,
  near,
  onClick,
  compact = false,
}: {
  connected: boolean;
  account: string | null;
  near: string | null;
  onClick: () => void;
  compact?: boolean;
}) {
  if (!connected) {
    return (
      <button type="button" onClick={onClick} className="flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-semibold text-primary-fg">
        <Wallet className="size-4" />
        {compact ? "Connect" : "Connect wallet"}
      </button>
    );
  }
  const name = account ?? "near";
  const short = name.length > 18 ? `${name.slice(0, 8)}…${name.slice(-6)}` : name;
  return (
    <button type="button" onClick={onClick} className="flex h-10 items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-3 text-left">
      <span className="grid size-8 place-items-center rounded-full bg-primary font-mono text-xs font-bold text-primary-fg">{name.slice(0, 1).toUpperCase()}</span>
      <span className="leading-none">
        <span className="block max-w-32 truncate text-sm font-semibold">{compact ? short.split(".")[0] : short}</span>
        <span className="mt-0.5 block text-[10px] font-normal text-primary">{near ? `${near} NEAR` : "Connected"}</span>
      </span>
    </button>
  );
}
