import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { CHAIN_ICON, fmt, TOKENS, usd, type Token } from "@/lib/market";

if (typeof window !== "undefined") {
  for (const token of TOKENS) {
    const img = new Image();
    img.decoding = "async";
    img.src = token.icon;
  }
  for (const src of Object.values(CHAIN_ICON)) {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  }
}

export function TokenIcon({ token, className }: { token: Pick<Token, "icon" | "symbol">; className?: string }) {
  const seen = useRef(token.symbol);
  const [turn, setTurn] = useState<"a" | "b" | null>(null);
  useEffect(() => {
    if (seen.current === token.symbol) return;
    seen.current = token.symbol;
    setTurn((current) => (current === "a" ? "b" : "a"));
  }, [token.symbol]);
  return (
    <span className={cn("icon-flip", turn && `is-${turn}`)}>
      <img
        src={token.icon}
        alt=""
        width={24}
        height={24}
        decoding="async"
        loading="eager"
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

const CHAINS = [
  { id: "All", label: "All chains" },
  { id: "NEAR", label: "NEAR", icon: CHAIN_ICON.NEAR },
  { id: "Aurora", label: "Aurora", icon: CHAIN_ICON.Aurora },
  { id: "Ethereum", label: "Ethereum", icon: CHAIN_ICON.Ethereum },
] as const;

export function TokenPicker({
  open,
  balances,
  onClose,
  onPick,
}: {
  open: boolean;
  balances?: Record<string, number>;
  onClose: () => void;
  onPick: (symbol: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [chain, setChain] = useState("All");
  const list = useMemo(
    () =>
      TOKENS.filter((token) => (chain === "All" || token.chain === chain) && `${token.symbol} ${token.name}`.toLowerCase().includes(query.toLowerCase())),
    [chain, query],
  );
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-bg/70 p-3 sm:place-items-center" onClick={onClose}>
      <div className="panel flex max-h-[86vh] w-full max-w-2xl flex-col p-4" onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Choose token</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="grid size-11 place-items-center">
            <X className="size-4" />
          </button>
        </div>
        <div className="grid min-h-0 gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <div className="flex flex-wrap gap-2 sm:flex-col">
            {CHAINS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setChain(item.id)}
                className={`flex h-11 items-center gap-2 rounded-xl px-3 text-left text-sm ${chain === item.id ? "bg-surface-2 text-fg" : "text-muted"}`}
              >
                {"icon" in item ? <img src={item.icon} alt="" className="size-5 rounded-full object-cover" /> : <span className="size-5 rounded-full bg-surface-2" />}
                {item.label}
              </button>
            ))}
          </div>
          <div className="min-h-0">
            <label className="mb-2 flex h-11 items-center gap-2 rounded-xl border border-line px-3">
              <Search className="size-4 text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search a token"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>
            <ul className="max-h-80 overflow-x-hidden overflow-y-auto">
              {list.map((token) => (
                <li key={token.symbol}>
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
                        {token.symbol}
                        {token.verified && <VerifiedMark />}
                      </span>
                      <span className="flex items-center gap-1 truncate text-xs text-muted">
                        <img src={CHAIN_ICON[token.chain]} alt="" className="size-3.5 rounded-full object-cover" />
                        {token.name} · {token.chain}
                      </span>
                    </span>
                    <span className="text-right font-mono text-xs">
                      <span className="block">{usd(token.price)}</span>
                      <span className="text-muted">{balances ? fmt(balances[token.symbol] ?? 0) : token.chain}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
