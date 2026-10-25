import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Star, X } from "lucide-react";
import { TokenIcon, VerifiedMark } from "@/components/terminal/TokenIcon";
import {
  ageLabel,
  CHAIN_ICON,
  CHAINS,
  compactCount,
  money,
  px,
  signedPct,
  TOKENS,
  WINDOWS,
  type Token,
  type WindowId,
} from "@/lib/market";
import { marketsSynced } from "@/lib/dex";
import { hideToken, toggleStar, useWatch, visitToken } from "@/lib/watch";
import { useDesk } from "@/lib/store";

const TABS = ["Trending", "Newest", "All", "Recents"] as const;
type Tab = (typeof TABS)[number];

export function Markets({
  query,
  onOpen,
  onSwap,
}: {
  query: string;
  onOpen: (symbol: string) => void;
  onSwap: (symbol: string) => void;
}) {
  const watch = useWatch();
  const clock = useDesk((state) => state.clock);
  const [tab, setTab] = useState<Tab>("Trending");
  const [win, setWin] = useState<WindowId>("h24");
  const [chain, setChain] = useState("All");
  const [chainOpen, setChainOpen] = useState(false);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const chainMenu = useRef<HTMLDivElement>(null);

  const windowLabel = WINDOWS.find((item) => item.id === win)?.label ?? "24H";
  const chainOptions = useMemo(() => {
    const present = new Set(TOKENS.filter((token) => token.listed && token.price > 0).map((token) => token.chain));
    const ordered = CHAINS.filter((id) => present.has(id));
    const extra = [...present].filter((id) => !(CHAINS as readonly string[]).includes(id)).sort();
    return ["All", ...ordered, ...extra];
  }, [clock]);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = TOKENS.filter((token) => !watch.hidden.includes(token.symbol));
    if (tab !== "Recents") list = list.filter((token) => token.listed && Number.isFinite(token.price) && token.price > 0);
    if (chain !== "All") list = list.filter((token) => token.chain === chain);
    if (verifiedOnly) list = list.filter((token) => token.verified);
    if (q) list = list.filter((token) => `${token.symbol} ${token.name} ${token.tag} ${token.chain} ${token.address ?? ""}`.toLowerCase().includes(q));
    if (tab === "Recents") {
      return watch.recents.map((symbol) => list.find((token) => token.symbol === symbol)).filter((token): token is Token => Boolean(token));
    }
    const rank = (token: Token) => (completeStats(token) ? 1 : 0);
    if (tab === "Newest") {
      return [...list].sort((a, b) => rank(b) - rank(a) || (a.ageH > 0 ? a.ageH : Number.POSITIVE_INFINITY) - (b.ageH > 0 ? b.ageH : Number.POSITIVE_INFINITY));
    }
    if (tab === "All") return [...list].sort((a, b) => rank(b) - rank(a) || b.mcapN - a.mcapN || b.liqN - a.liqN);
    const volumeOf = (token: Token) => {
      const windowVol = token.volBy?.[win] ?? 0;
      return windowVol > 0 ? windowVol : token.volN || 0;
    };
    return [...list].sort((a, b) => rank(b) - rank(a) || volumeOf(b) - volumeOf(a) || b.txnsN - a.txnsN || b.liqN - a.liqN);
  }, [chain, clock, query, tab, verifiedOnly, watch.hidden, watch.recents, win]);

  useEffect(() => {
    if (!chainOpen) return;
    function onDown(event: MouseEvent) {
      if (!chainMenu.current?.contains(event.target as Node)) setChainOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [chainOpen]);

  return (
    <div>
      <div className="sticky top-0 z-20 flex flex-col gap-2 border-b border-line bg-bg px-2 py-2 sm:px-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid grid-cols-4 gap-4">
          {TABS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setTab(item)}
              className={`h-10 rounded-lg px-1 text-[11px] font-semibold tracking-wide min-[390px]:text-xs sm:text-sm ${tab === item ? "bg-surface-2 text-fg shadow-[inset_0_-2px_0_var(--color-primary)]" : "text-muted"}`}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center">
          <div className="flex min-w-0 items-center gap-2">
            <div className="inline-flex w-fit max-w-full overflow-x-auto rounded-full bg-surface p-1">
              {WINDOWS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setWin(item.id)}
                  className={`h-8 min-w-11 rounded-full px-3 text-xs font-semibold ${win === item.id ? "bg-bg text-fg shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-muted"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div ref={chainMenu} className="relative shrink-0 lg:hidden">
              <button
                type="button"
                aria-expanded={chainOpen}
                onClick={() => setChainOpen((value) => !value)}
                className="flex h-8 items-center gap-1.5 rounded-full bg-surface px-2.5 text-xs font-semibold"
              >
                <ChainLogo id={chain} />
                <span className="max-w-20 truncate">{chain === "All" ? "Chains" : chain}</span>
                <ChevronDown className={`size-3.5 text-muted ${chainOpen ? "rotate-180" : ""}`} />
              </button>
              {chainOpen && (
                <ul className="absolute right-0 top-10 z-30 max-h-72 w-52 overflow-y-auto rounded-xl border border-line bg-surface py-1 shadow-2xl">
                  {chainOptions.map((id) => (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => {
                          setChain(id);
                          setChainOpen(false);
                        }}
                        className={`flex h-10 w-full items-center gap-2 px-3 text-left text-sm ${chain === id ? "bg-bg text-fg" : "text-muted"}`}
                      >
                        <ChainLogo id={id} />
                        <span className="truncate">{id === "All" ? "All chains" : id}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              type="button"
              aria-pressed={verifiedOnly}
              onClick={() => setVerifiedOnly((value) => !value)}
              className={`grid size-8 shrink-0 place-items-center rounded-lg border lg:hidden ${verifiedOnly ? "border-primary bg-primary/15" : "border-line text-muted"}`}
              title="Verified only"
            >
              <VerifiedMark className={verifiedOnly ? "" : "bg-muted text-bg shadow-none"} />
            </button>
          </div>
          <div className="hidden min-w-0 items-center gap-1.5 lg:flex">
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-0.5">
              {CHAINS.map((item) => (
                <ChainMark key={item} id={item} active={chain === item} onClick={() => setChain(chain === item ? "All" : item)} />
              ))}
            </div>
            <button
              type="button"
              aria-pressed={verifiedOnly}
              onClick={() => setVerifiedOnly((value) => !value)}
              className={`grid size-8 shrink-0 place-items-center rounded-lg border ${verifiedOnly ? "border-primary bg-primary/15" : "border-line text-muted"}`}
              title="Verified only"
            >
              <VerifiedMark className={verifiedOnly ? "" : "bg-muted text-bg shadow-none"} />
            </button>
          </div>
        </div>
      </div>
      {(!marketsSynced && rows.length === 0) ? (
        <Skeleton />
      ) : rows.length === 0 ? (
        <p className="px-4 py-16 text-center text-sm text-muted">
          {tab === "Recents" ? "Tokens you open show up here." : "No tokens match that filter."}
        </p>
      ) : (
        <>
          <div className="md:hidden">
            {rows.map((token) => (
              <MobileRow
                key={token.symbol}
                token={token}
                win={win}
                windowLabel={windowLabel}
                starred={watch.starred.includes(token.symbol)}
                onOpen={() => {
                  visitToken(token.symbol);
                  onOpen(token.symbol);
                }}
                onSwap={() => onSwap(token.symbol)}
              />
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="market-table w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-line">
                  <th className="px-4 py-3 font-medium">Token</th>
                  <th className="px-3 py-3 font-medium">Price</th>
                  <th className="px-3 py-3 font-medium">Token stats</th>
                  <th className="px-3 py-3 font-medium">Liquidity</th>
                  <th className="px-3 py-3 font-medium">Volume</th>
                  <th className="px-3 py-3 font-medium">Txns</th>
                  <th className="px-4 py-3 text-right font-medium">Buy</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((token) => (
                  <DesktopRow
                    key={token.symbol}
                    token={token}
                    win={win}
                    windowLabel={windowLabel}
                    starred={watch.starred.includes(token.symbol)}
                    onOpen={() => {
                      visitToken(token.symbol);
                      onOpen(token.symbol);
                    }}
                    onSwap={() => onSwap(token.symbol)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function DesktopRow({ token, win, windowLabel, starred, onOpen, onSwap }: RowProps) {
  const change = token.windows[win];
  const volume = token.volBy?.[win] ?? token.volN;
  const sellPct = token.txnsN ? Math.round((token.sells / token.txnsN) * 1000) / 10 : 0;
  return (
    <tr className="row-lift cursor-pointer border-b border-line hover:bg-surface" onClick={onOpen}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <TokenIcon token={token} className="size-10 rounded-lg" />
          <div className="min-w-0">
            <p className="flex items-center gap-1">
              <span className="font-semibold">{token.symbol}</span>
              <span className="truncate text-muted">{token.tag}</span>
              {token.verified && <VerifiedMark />}
            </p>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
              <span>{ageLabel(token.ageH)}</span>
              <span className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-fg">
                <img src={CHAIN_ICON[token.chain]} alt="" className="size-3.5 rounded-full object-cover" />
                {token.chain}
              </span>
              <IconButton
                label={starred ? "Unstar" : "Star"}
                onClick={() => toggleStar(token.symbol)}
              >
                <Star className={`size-3.5 ${starred ? "fill-fg text-fg" : ""}`} />
              </IconButton>
              <IconButton label="Hide" onClick={() => hideToken(token.symbol)}>
                <X className="size-3.5" />
              </IconButton>
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-3 font-mono">
        <p>{px(token.price)}</p>
        <p className={`text-xs ${!Number.isFinite(token.price) ? "text-muted" : change >= 0 ? "text-primary" : "text-danger"}`}>
          {token.mcapN > 0 ? `${money(token.mcapN)} · ` : ""}
          {windowLabel.toLowerCase()} {Number.isFinite(token.price) ? signedPct(change) : "—"}
        </p>
      </td>
      <td className="px-3 py-3">
        {token.txnsN > 0 ? (
          <>
            <p className="flex items-center gap-1.5 font-mono text-xs">
              <span className="text-muted">{token.holdersN > 0 ? compactCount(token.holdersN) : "—"}</span>
              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-primary">{compactCount(token.buys)}</span>
              <span className="rounded bg-danger/15 px-1.5 py-0.5 text-danger">{sellPct}%</span>
            </p>
            <div className="mt-1.5 h-1 w-24 overflow-hidden rounded-full bg-danger/30">
              <div className="h-full bg-primary" style={{ width: `${(token.buys / token.txnsN) * 100}%` }} />
            </div>
          </>
        ) : (
          <p className="font-mono text-xs text-muted">—</p>
        )}
      </td>
      <td className="px-3 py-3 font-mono">{token.liqN > 0 ? money(token.liqN) : "—"}</td>
      <td className="px-3 py-3 font-mono">{volume > 0 ? money(volume) : "—"}</td>
      <td className="px-3 py-3 font-mono">
        <p>{token.txnsN > 0 ? token.txnsN.toLocaleString("en-US") : "—"}</p>
      </td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSwap();
          }}
          className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-fg"
        >
          BUY
        </button>
      </td>
    </tr>
  );
}

function completeStats(token: Token) {
  const volume = token.volN > 0 || (token.volBy?.h24 ?? 0) > 0;
  return token.ageH > 0 && token.price > 0 && token.liqN > 0 && volume && token.txnsN > 0;
}

function ChainLogo({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  const icon = id === "All" ? "" : CHAIN_ICON[id];
  if (id === "All") return <span className="size-4 shrink-0 rounded-full border border-line bg-surface-2" />;
  if (!icon || failed) return <span className="grid size-4 shrink-0 place-items-center rounded-full bg-surface-2 text-[9px] font-semibold">{id.slice(0, 1)}</span>;
  return <img src={icon} alt="" onError={() => setFailed(true)} className="size-4 shrink-0 rounded-full object-cover" />;
}

function ChainMark({ id, active, onClick }: { id: string; active: boolean; onClick: () => void }) {
  const [failed, setFailed] = useState(false);
  const icon = CHAIN_ICON[id];
  return (
    <button
      type="button"
      aria-label={id}
      aria-pressed={active}
      onClick={onClick}
      className={`grid size-9 shrink-0 place-items-center rounded-full ${active ? "ring-2 ring-primary" : "opacity-80"}`}
    >
      {icon && !failed ? (
        <img src={icon} alt="" onError={() => setFailed(true)} className="size-6 rounded-full object-cover" />
      ) : (
        <span className="grid size-6 place-items-center rounded-full bg-surface-2 text-[10px] font-semibold">{id.slice(0, 1)}</span>
      )}
    </button>
  );
}

function MobileRow({ token, win, windowLabel, starred, onOpen, onSwap }: RowProps) {
  const change = token.windows[win];
  const volume = token.volBy?.[win] ?? token.volN;
  return (
    <article className="row-lift border-b border-line px-3 py-2">
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-2 text-left">
        <TokenIcon token={token} className="size-9 rounded-lg" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span className="font-semibold">{token.symbol}</span>
            {token.verified && <VerifiedMark />}
          </span>
          <span className="block truncate text-xs text-muted">{token.tag}</span>
          <span className="mt-0.5 flex items-center gap-1 text-xs text-muted">
            {ageLabel(token.ageH)} · <img src={CHAIN_ICON[token.chain]} alt="" className="size-3.5 rounded-full object-cover" />
            {token.chain}
          </span>
        </span>
        <span className="text-right font-mono">
          <span className="block text-sm">{px(token.price)}</span>
          <span className={`text-xs ${!Number.isFinite(token.price) ? "text-muted" : change >= 0 ? "text-primary" : "text-danger"}`}>
            {Number.isFinite(token.price) ? signedPct(change) : "—"}
          </span>
          <span className="block text-xs text-muted">{token.mcapN > 0 ? money(token.mcapN) : windowLabel}</span>
        </span>
      </button>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="min-w-0 text-[11px] leading-4 text-muted">
          <span className="block truncate">
            {ageLabel(token.ageH)} · {token.txnsN > 0 ? `${compactCount(token.txnsN)} txns` : "— txns"}
          </span>
          <span className="block truncate">
            Liq {token.liqN > 0 ? money(token.liqN) : "—"} · Vol {volume > 0 ? money(volume) : "—"}
          </span>
        </p>
        <div className="flex items-center gap-1">
          <button type="button" aria-label={starred ? "Unstar" : "Star"} onClick={() => toggleStar(token.symbol)} className="grid size-9 place-items-center text-muted">
            <Star className={`size-4 ${starred ? "fill-fg text-fg" : ""}`} />
          </button>
          <button type="button" aria-label="Hide" onClick={() => hideToken(token.symbol)} className="grid size-9 place-items-center text-muted">
            <X className="size-4" />
          </button>
          <button type="button" onClick={onSwap} className="h-9 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-fg">
            BUY
          </button>
        </div>
      </div>
    </article>
  );
}

type RowProps = {
  token: Token;
  win: WindowId;
  windowLabel: string;
  starred: boolean;
  onOpen: () => void;
  onSwap: () => void;
};

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="grid size-6 place-items-center rounded text-muted hover:text-fg"
    >
      {children}
    </button>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3 px-4 py-4">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="h-14 animate-pulse rounded-lg bg-surface" />
      ))}
    </div>
  );
}
