import { useMemo, useState, type ReactNode } from "react";
import { Star, X } from "lucide-react";
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
  const [verifiedOnly, setVerifiedOnly] = useState(false);

  const windowLabel = WINDOWS.find((item) => item.id === win)?.label ?? "24H";
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = TOKENS.filter((token) => !watch.hidden.includes(token.symbol));
    if (tab !== "Recents") list = list.filter((token) => token.listed && Number.isFinite(token.price) && token.price > 0);
    if (chain !== "All") list = list.filter((token) => (token.rails ?? ["NEAR"]).includes(chain));
    if (verifiedOnly) list = list.filter((token) => token.verified);
    if (q) list = list.filter((token) => `${token.symbol} ${token.name} ${token.tag} ${token.chain} ${token.address ?? ""}`.toLowerCase().includes(q));
    if (tab === "Recents") {
      return watch.recents.map((symbol) => list.find((token) => token.symbol === symbol)).filter((token): token is Token => Boolean(token));
    }
    if (tab === "Newest") return [...list].sort((a, b) => (a.ageH > 0 ? a.ageH : Number.POSITIVE_INFINITY) - (b.ageH > 0 ? b.ageH : Number.POSITIVE_INFINITY));
    if (tab === "All") return [...list].sort((a, b) => b.mcapN - a.mcapN || b.liqN - a.liqN);
    return [...list].sort((a, b) => (b.volBy?.[win] ?? b.volN) - (a.volBy?.[win] ?? a.volN) || Math.abs(b.windows[win]) - Math.abs(a.windows[win]));
  }, [chain, clock, query, tab, verifiedOnly, watch.hidden, watch.recents, win]);

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
        <div className="flex items-center gap-2">
          <div className="grid flex-1 grid-cols-4 rounded-lg bg-surface p-0.5 sm:flex sm:flex-none">
            {WINDOWS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setWin(item.id)}
                className={`h-8 rounded-md px-1 text-xs sm:px-2.5 ${win === item.id ? "bg-surface-2 text-fg" : "text-muted"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            {CHAINS.map((item) => (
              <button
                key={item}
                type="button"
                aria-label={item}
                aria-pressed={chain === item}
                onClick={() => setChain(chain === item ? "All" : item)}
                className={`grid size-9 place-items-center rounded-full ${chain === item ? "ring-2 ring-primary" : "opacity-70"}`}
              >
                <img src={CHAIN_ICON[item]} alt="" className="size-6 rounded-full object-cover" />
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={verifiedOnly}
            onClick={() => setVerifiedOnly((value) => !value)}
            className={`grid size-8 place-items-center rounded-lg border ${verifiedOnly ? "border-primary bg-primary/15" : "border-line text-muted"}`}
            title="Verified only"
          >
            <VerifiedMark className={verifiedOnly ? "" : "bg-muted text-bg shadow-none"} />
          </button>
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
        <p className="text-xs text-muted">
          Liq {token.liqN > 0 ? money(token.liqN) : "—"} · Vol {volume > 0 ? money(volume) : "—"}
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
