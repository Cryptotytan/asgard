import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Search, Unplug, Wallet } from "lucide-react";
import { ChainBadge, TokenIcon } from "@/components/terminal/TokenIcon";
import { LendDesk } from "@/components/terminal/LendDesk";
import { Markets } from "@/components/terminal/Markets";
import { PortfolioDesk } from "@/components/terminal/PortfolioDesk";
import { SwapDesk } from "@/components/terminal/SwapDesk";
import { TokenTrade } from "@/components/terminal/TokenTrade";
import { TrackerDesk } from "@/components/terminal/TrackerDesk";
import { VaultDesk } from "@/components/terminal/VaultDesk";
import { canPerp, fmt, money, sealMajors, tokenBySymbol, TOKENS } from "@/lib/market";
import { setWalletOpener, useDesk } from "@/lib/store";
import { startLiveFeed } from "@/lib/live";
import { visitToken } from "@/lib/watch";
import { disconnectForeign, linkedWallets, useForeign, WALLET_MARK } from "@/lib/foreign-wallet";

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
  sealMajors();

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
    setWalletError("");
    setWalletOpen(true);
  }

  async function pickForeign(kind: "evm" | "sol" | "btc") {
    setWalletError("");
    try {
      const mod = await import("@/lib/foreign-wallet");
      if (kind === "evm") await mod.connectEvm();
      if (kind === "sol") await mod.connectSol();
      if (kind === "btc") await mod.connectBtc();
      setWalletOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wallet did not open";
      if (/closed/i.test(message)) return;
      setWalletError(message);
    }
  }

  async function pickWallet(kind: "intear" | "here" | "meteor" | "hot" | "nightly" | "sender") {
    setWalletError("");
    const ids = {
      intear: "intear-wallet",
      here: "here-wallet",
      meteor: "meteor-wallet",
      hot: "hot-wallet",
      nightly: "nightly",
      sender: "sender",
    } as const;
    try {
      const { connectSelectorWallet } = await import("@/lib/near-wallet");
      await connectSelectorWallet(ids[kind]);
      setWalletOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wallet did not open";
      if (/closed/i.test(message)) return;
      setWalletError(message);
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
      <header className="relative z-40 shrink-0 border-b border-line">
        <div className="flex items-center gap-2 px-3 py-2 md:hidden">
          <Link to="/" className="mr-auto flex items-center gap-2">
            <span className="mark" aria-hidden />
            <span className="text-base font-semibold tracking-tight">Asgard</span>
          </Link>
          <WalletButton compact onConnectNew={onWallet} />
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
          <WalletButton compact onConnectNew={onWallet} />
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
            <WalletButton onConnectNew={onWallet} />
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
          <div className="flex h-full min-h-0 flex-1 overflow-hidden px-2 py-2 sm:px-4 sm:py-3">
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
          <div className="flex min-w-0 flex-1 items-center justify-evenly gap-2 sm:justify-center sm:gap-10">
            <FooterStat token={tokenBySymbol("USDC")} value={connected ? money(balances.USDC ?? 0) : "—"} />
            <FooterStat token={tokenBySymbol("NEAR")} value={connected ? fmt(balances.NEAR ?? 0, 2) : "—"} />
            <FooterStat label="Wallet" value={connected ? money(walletUsd) : "—"} className="hidden sm:flex" />
          </div>
          <button type="button" onClick={() => setView("swap")} className="h-10 shrink-0 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-fg sm:px-4">
            <span className="sm:hidden">Route</span>
            <span className="hidden sm:inline">Aggregator</span>
          </button>
        </div>
      </footer>

      {flash && <p className="fixed bottom-16 left-1/2 z-30 max-w-md -translate-x-1/2 rounded-full border border-line bg-bg px-4 py-2 text-center text-sm">{flash}</p>}
      {walletOpen && (
        <WalletSheet
          error={walletError}
          nearAccount={accountId}
          onClose={() => setWalletOpen(false)}
          onPick={(kind) => void pickWallet(kind)}
          onForeign={(kind) => void pickForeign(kind)}
          onWatch={(account) => void watchAccount(account)}
          onDisconnectNear={() => disconnect()}
        />
      )}
    </div>
  );
}

function FooterStat({ token, label, value, className = "" }: { token?: { icon: string; symbol: string; address?: string; chain?: string }; label?: string; value: string; className?: string }) {
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${className}`}>
      {token ? <TokenIcon token={token} className="size-5" /> : null}
      <span className="min-w-0">
        <span className="block text-[9px] uppercase tracking-wide text-muted">{label ?? token?.symbol}</span>
        <span className="block max-w-[4.5rem] truncate font-mono text-xs text-fg sm:max-w-none">{value}</span>
      </span>
    </span>
  );
}

function WalletSheet({
  error,
  nearAccount,
  onClose,
  onPick,
  onForeign,
  onWatch,
  onDisconnectNear,
}: {
  error: string;
  nearAccount: string | null;
  onClose: () => void;
  onPick: (kind: "intear" | "here" | "meteor" | "hot" | "nightly" | "sender") => void;
  onForeign: (kind: "evm" | "sol" | "btc") => void;
  onWatch: (account: string) => void;
  onDisconnectNear: () => void;
}) {
  const [account, setAccount] = useState("");
  const foreign = useForeign();
  const wallets: { kind: "intear" | "here" | "meteor" | "hot" | "nightly" | "sender"; name: string; note: string; logo: string }[] = [
    { kind: "intear", name: "Intear Wallet", note: "Web", logo: "/wallets/intear.svg" },
    { kind: "here", name: "HERE Wallet", note: "Web", logo: "/wallets/here.png" },
    { kind: "meteor", name: "Meteor", note: "Extension", logo: "/wallets/meteor.png" },
    { kind: "hot", name: "HOT Wallet", note: "Extension", logo: "/wallets/hot.png" },
    { kind: "nightly", name: "Nightly", note: "Extension", logo: "/wallets/nightly.png" },
    { kind: "sender", name: "Sender", note: "Extension", logo: "/wallets/sender.png" },
  ];
  const chains: { kind: "evm" | "sol"; name: string; logos: string[]; address: string | null }[] = [
    { kind: "evm", name: "EVM", logos: ["/wallets/metamask.svg", "/wallets/zerion.svg", "/wallets/rabby.svg"], address: foreign.evm },
    { kind: "sol", name: "Solana", logos: ["/wallets/phantom.svg", "/wallets/solflare.svg", "/wallets/backpack.svg"], address: foreign.sol },
  ];
  return (
    <div className="fixed inset-0 z-[80] grid place-items-end bg-black/75 p-3 sm:place-items-center" onClick={onClose}>
      <section className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[420px] flex-col overflow-hidden rounded-[22px] border border-[#2a302b] bg-[#0c0f0d] shadow-[0_24px_80px_rgba(0,0,0,0.55)]" onClick={(event) => event.stopPropagation()}>
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-2 pt-5">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-[#8d938c]">Wallets</p>
            <h2 className="mt-1 text-[22px] font-semibold leading-none tracking-tight">Connect a wallet</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full bg-[#171b18] text-lg leading-none text-[#c8cdc6]">
            ×
          </button>
        </div>
        <p className="shrink-0 px-5 pb-3 text-sm text-[#8d938c]">NEAR signs NEAR deposits. EVM and Solana sign the chain you sell from.</p>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {nearAccount && (
            <div className="mb-2 flex items-center gap-3 rounded-2xl border border-[#243028] bg-[#121815] px-3 py-3">
              <img src="/tokens/near.svg" alt="" className="size-11 shrink-0 rounded-full bg-[#0c0f0d] object-cover" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  NEAR
                  <span className="size-1.5 rounded-full bg-[#00ec97]" />
                </span>
                <span className="mt-1 block truncate rounded-lg bg-[#0c0f0d] px-2 py-1 font-mono text-xs text-[#c8cdc6]">{nearAccount}</span>
              </span>
              <button type="button" aria-label="Disconnect NEAR" onClick={onDisconnectNear} className="grid size-9 shrink-0 place-items-center rounded-full text-[#ff5d73] hover:bg-[#ff5d73]/10">
                <Unplug className="size-4" />
              </button>
            </div>
          )}
          <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.18em] text-[#8d938c]">NEAR</p>
          <ul>
            {wallets.map((wallet) => (
              <li key={wallet.kind}>
                <button type="button" onClick={() => onPick(wallet.kind)} className="flex h-[60px] w-full items-center gap-3 rounded-2xl px-2 text-left transition hover:bg-[#171b18]">
                  <img src={wallet.logo} alt="" width={40} height={40} className="size-10 shrink-0 rounded-full bg-[#171b18] object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{wallet.name}</span>
                  </span>
                  <span className="rounded-full bg-[#171b18] px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-[#8d938c]">{wallet.note}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="px-2 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.18em] text-[#8d938c]">Other chains</p>
          <ul>
            {chains.map((chain) => (
              <li key={chain.kind} className="flex items-center gap-3 rounded-2xl px-2 py-2">
                <span className="flex w-[4.5rem] shrink-0 -space-x-2">
                  {chain.logos.map((logo) => (
                    <img key={logo} src={logo} alt="" className="size-8 rounded-full bg-[#171b18] object-cover ring-2 ring-[#0c0f0d]" />
                  ))}
                </span>
                <button type="button" onClick={() => onForeign(chain.kind)} className="min-w-0 flex-1 text-left">
                  <span className="flex items-center gap-1.5 text-[15px] font-semibold">
                    {chain.name}
                    {chain.address && <span className="size-1.5 rounded-full bg-[#00ec97]" />}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-[#8d938c]">{chain.address ? midAddress(chain.address) : "Browser wallet"}</span>
                </button>
                {chain.address ? (
                  <button type="button" aria-label={`Disconnect ${chain.name}`} onClick={() => disconnectForeign(chain.kind)} className="grid size-9 shrink-0 place-items-center rounded-full text-[#ff5d73] hover:bg-[#ff5d73]/10">
                    <Unplug className="size-4" />
                  </button>
                ) : (
                  <span className="rounded-full bg-[#171b18] px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-[#8d938c]">Connect</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <form
          className="shrink-0 border-t border-[#2a302b] bg-black/35 px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            onWatch(account);
          }}
        >
          <label className="block text-xs text-[#8d938c]" htmlFor="near-account">
            Or read a NEAR account
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
              className="h-11 min-w-0 flex-1 rounded-xl border border-[#2a302b] bg-[#111513] px-3 text-sm outline-none focus:border-[#00ec97]"
            />
            <button type="submit" className="h-11 shrink-0 rounded-xl bg-[#00ec97] px-4 text-sm font-semibold text-[#002116]">
              Load
            </button>
          </div>
          <p className="mt-2 text-xs text-[#8d938c]">View only. Swaps still need a wallet that can sign.</p>
        </form>
        {error && <p className="px-5 pb-4 text-sm text-danger">{error}</p>}
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

function midAddress(value: string) {
  return value.length > 16 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function WalletButton({ compact = false, onConnectNew }: { compact?: boolean; onConnectNew: () => void }) {
  const accountId = useDesk((state) => state.accountId);
  const nearYocto = useDesk((state) => state.nearYocto);
  const disconnect = useDesk((state) => state.disconnect);
  const foreign = useForeign();
  const rows = linkedWallets(accountId, foreign);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  const current = rows[0];
  const nearText = formatNear(nearYocto);
  const hint = current?.id === "near" ? (nearText ? `${nearText} NEAR` : "NEAR") : current?.label ?? null;
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} className={`flex h-11 min-w-0 items-center gap-2 rounded-full text-left ${current ? `border border-primary/40 bg-surface pl-1 pr-2.5 shadow-[inset_0_0_0_1px_rgba(0,236,151,0.08)] ${compact ? "max-w-[58vw]" : "max-w-[17rem]"}` : "bg-primary pl-1.5 pr-4 text-sm font-semibold text-primary-fg"}`}>
        {current ? (
          <>
            <span className="relative flex shrink-0">
              <span className="flex -space-x-2">
                {rows.slice(0, 3).map((row) => (
                  <img key={row.id} src={WALLET_MARK[row.id]} alt="" className="size-8 rounded-full bg-bg object-cover ring-2 ring-surface" />
                ))}
              </span>
              <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-primary ring-2 ring-surface" />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate font-mono text-[13px] font-semibold">{rows.length > 1 ? `${rows.length} wallets` : midAddress(current.address)}</span>
              <span className="block truncate text-[10px] font-medium text-muted">{rows.length > 1 ? rows.map((row) => row.label).join(" · ") : hint}</span>
            </span>
            <ChevronDown className={`size-4 shrink-0 text-muted transition ${open ? "rotate-180" : ""}`} />
          </>
        ) : (
          <>
            <span className="grid size-8 place-items-center rounded-full bg-black/20">
              <Wallet className="size-4" />
            </span>
            {compact ? "Connect" : "Connect wallet"}
          </>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-[3.15rem] z-50 w-[min(22rem,calc(100vw-1rem))] rounded-2xl border border-line bg-[#0e1210] p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between px-1">
            <p className="text-sm font-semibold">{rows.length ? "Connected" : "Wallets"}</p>
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">{rows.length}</span>
          </div>
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-3 py-3">
                <img src={WALLET_MARK[row.id]} alt="" className="size-11 shrink-0 rounded-full bg-bg object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    {row.label}
                    <ChainBadge chain={row.id === "near" ? "NEAR" : row.id === "sol" ? "Solana" : row.id === "btc" ? "Bitcoin" : "Ethereum"} className="size-4" />
                    <span className="size-1.5 rounded-full bg-primary" />
                  </span>
                  <span className="mt-1 block truncate rounded-lg bg-bg px-2 py-1 font-mono text-xs text-muted">{midAddress(row.address)}</span>
                </span>
                <button
                  type="button"
                  aria-label={`Disconnect ${row.label}`}
                  onClick={() => {
                    if (row.id === "near") disconnect();
                    else disconnectForeign(row.id);
                  }}
                  className="grid size-9 shrink-0 place-items-center rounded-full text-danger hover:bg-danger/10"
                >
                  <Unplug className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          {rows.length === 0 && <p className="px-1 pb-2 text-sm text-muted">No wallet connected yet.</p>}
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onConnectNew();
            }}
            className="mt-3 h-11 w-full rounded-xl bg-primary text-sm font-semibold text-primary-fg"
          >
            {rows.length ? "Connect another wallet" : "Connect wallet"}
          </button>
        </div>
      )}
    </div>
  );
}
