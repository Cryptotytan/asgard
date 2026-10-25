import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { knownLogo, logoFallback, lookupNearToken, searchTokens } from "@/lib/dex";
import { chainIcon } from "@/lib/chains";
import { CHAIN_ICON, CHAINS, displayName, fmt, glyph, px, TOKENS, usd, type Token } from "@/lib/market";
import { useDesk } from "@/lib/store";

const iconCache = new Map<string, string>();

if (typeof window !== "undefined") {
  for (const src of new Set([...Object.values(CHAIN_ICON), ...TOKENS.map((token) => token.icon).filter((src) => src.startsWith("/"))])) {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  }
}

export function ChainBadge({ chain, className = "size-3.5" }: { chain: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = CHAIN_ICON[chain] || chainIcon(chain);
  if (!src || failed) {
    return <span className={cn("grid shrink-0 place-items-center rounded-full bg-surface-2 text-[8px] font-semibold", className)}>{chain.slice(0, 1)}</span>;
  }
  return <img src={src} alt="" onError={() => setFailed(true)} className={cn("shrink-0 rounded-full bg-bg object-cover", className)} />;
}

export function TokenIcon({ token, className }: { token: Pick<Token, "icon" | "symbol" | "address"> & { chain?: string }; className?: string }) {
  const seen = useRef(token.symbol + token.icon + (token.chain ?? ""));
  const [turn, setTurn] = useState<"a" | "b" | null>(null);
  const [step, setStep] = useState(0);
  const key = `${token.chain ?? ""}:${token.address ?? token.symbol}`;
  const sources = useMemo(() => {
    const remote = token.icon?.startsWith("https://") ? token.icon : "";
    const local = knownLogo(token.symbol) || knownLogo(token.symbol.split(".")[0] ?? token.symbol);
    const extra = logoFallback(token);
    const list = [iconCache.get(key), remote, local, token.icon, extra].filter((src): src is string => Boolean(src && !src.startsWith("data:image/svg+xml;utf8,")));
    return [...new Set(list)];
  }, [key, token.icon, token.symbol]);
  useEffect(() => {
    setStep(0);
    if (seen.current === token.symbol + token.icon) return;
    seen.current = token.symbol + token.icon;
    setTurn((current) => (current === "a" ? "b" : "a"));
  }, [token.symbol, token.icon]);
  const src = sources[step] || glyph(token.symbol, 150);
  return (
    <span className={cn("icon-flip", turn && `is-${turn}`)}>
      <img
        src={src}
        alt=""
        width={24}
        height={24}
        decoding="async"
        loading="eager"
        onLoad={() => iconCache.set(key, src)}
        onError={() => setStep((current) => current + 1)}
        className={cn("size-6 shrink-0 rounded-full bg-surface-2 object-cover", className)}
      />
    </span>
  );
}

export function VerifiedMark({ className }: { className?: string }) {
  return (
    <span className={cn("verified", className)} aria-label="Verified">
      <Check className="size-1.5" strokeWidth={3} />
    </span>
  );
}

export function TokenPicker({
  open,
  balances,
  loadingBalances,
  onClose,
  onPick,
}: {
  open: boolean;
  balances?: Record<string, number>;
  walletKind?: "near" | "evm" | "sol" | "btc" | null;
  walletName?: string;
  heldOnly?: boolean;
  loadingBalances?: boolean;
  onClose: () => void;
  onPick: (symbol: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [chain, setChain] = useState("All");
  const [looking, setLooking] = useState(false);
  const clock = useDesk((state) => state.clock);
  const needle = query.trim().toLowerCase();
  const tabs = useMemo(() => {
    const present = new Set(TOKENS.filter((token) => token.listed && token.price > 0).map((token) => token.chain));
    const ordered = CHAINS.filter((id) => present.has(id));
    const extra = [...present].filter((id) => !(CHAINS as readonly string[]).includes(id)).sort();
    return [{ id: "All", label: "All chains", icon: "" }, ...[...ordered, ...extra].map((id) => ({ id, label: id, icon: CHAIN_ICON[id] || chainIcon(id) }))];
  }, [clock]);
  const list = useMemo(
    () =>
      TOKENS.filter((token) => {
        if (!token.listed || !Number.isFinite(token.price) || token.price <= 0) return false;
        if (chain !== "All" && token.chain !== chain) return false;
        if (!needle) return true;
        return `${token.symbol} ${token.name} ${token.address ?? ""}`.toLowerCase().includes(needle);
      }).sort((a, b) => {
        const heldUsd = (token: Token) => (balances?.[token.symbol] ?? 0) * (token.price || 0);
        const byHold = heldUsd(b) - heldUsd(a);
        if (byHold !== 0) return byHold;
        return b.volN - a.volN || b.liqN - a.liqN;
      }),
    [balances, chain, clock, needle],
  );
  useEffect(() => {
    if (!open) {
      setQuery("");
      setLooking(false);
      return;
    }
    const raw = query.trim();
    if (raw.length < 2) {
      setLooking(false);
      return;
    }
    let cancel = false;
    const timer = window.setTimeout(() => {
      setLooking(true);
      void searchTokens(raw)
        .catch(() => lookupNearToken(raw).then(() => undefined))
        .catch(() => undefined)
        .finally(() => {
          if (!cancel) setLooking(false);
        });
    }, 280);
    return () => {
      cancel = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-bg/70 p-3 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="choose-token-title"
        className="panel flex h-[min(32rem,calc(100dvh-2.5rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl sm:h-[min(40rem,calc(100dvh-3rem))]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-4 pb-2">
          <h2 id="choose-token-title" className="text-lg font-semibold">Choose token</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2">
            <X className="size-4" />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 px-4 pb-4 sm:grid-cols-[12rem_minmax(0,1fr)] sm:grid-rows-1">
          <div className="flex max-h-28 min-w-0 flex-wrap content-start gap-2 overflow-y-auto sm:max-h-none sm:flex-col sm:flex-nowrap">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setChain(item.id)}
                className={`flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-left text-sm sm:h-11 sm:w-full ${chain === item.id ? "bg-surface-2 text-fg" : "text-muted"}`}
              >
                {item.icon ? <img src={item.icon} alt="" className="size-5 rounded-full object-cover" /> : <span className="size-5 rounded-full bg-surface-2" />}
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex min-h-0 min-w-0 flex-col">
            <label className="mb-2 flex h-11 shrink-0 items-center gap-2 rounded-xl border border-line px-3">
              <Search className="size-4 shrink-0 text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Name, symbol, or contract address"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>
            <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {list.map((token) => (
                <li key={`${token.symbol}-${token.address ?? ""}`}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(token.symbol);
                      onClose();
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-2"
                  >
                    <TokenIcon token={token} className="size-8" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 font-semibold">
                        {displayName(token)}
                        {token.verified && <VerifiedMark />}
                      </span>
                      <span className="flex items-center gap-1 truncate text-xs text-muted">
                        <ChainBadge chain={token.chain} />
                        {token.chain}
                      </span>
                    </span>
                    <span className="shrink-0 text-right font-mono text-xs">
                      {balances && (balances[token.symbol] ?? 0) > 0 ? (
                        <>
                          <span className="block">{fmt(balances[token.symbol] ?? 0)}</span>
                          <span className="text-muted">{usd((balances[token.symbol] ?? 0) * token.price)}</span>
                        </>
                      ) : (
                        <>
                          <span className="block">{px(token.price)}</span>
                          <span className="text-muted">{token.chain}</span>
                        </>
                      )}
                    </span>
                  </button>
                </li>
              ))}
              {list.length === 0 && (
                <li className="px-2 py-6 text-center text-sm text-muted">
                  {looking || loadingBalances
                    ? "Reading this wallet…"
                    : needle
                      ? "No token matches that name or contract."
                      : "No tokens on this chain."}
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
