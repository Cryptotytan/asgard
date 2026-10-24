import { useState } from "react";
import { fmt, px, usd } from "@/lib/market";
import type { Position } from "@/lib/store";
import { PnlPoster } from "@/components/terminal/PnlPoster";

export function PnlCard({ position, mark, onClose }: { position: Position; mark: number; onClose?: () => void }) {
  const pnl = position.side === "long" ? (mark - position.entry) * position.size : (position.entry - mark) * position.size;
  const roe = position.margin > 0 ? (pnl / position.margin) * 100 : 0;
  const up = pnl >= 0;
  const liq = position.side === "long" ? position.entry * (1 - 0.9 / position.leverage) : position.entry * (1 + 0.9 / position.leverage);
  const half = Math.min(48, Math.abs(roe) / 2);
  const [share, setShare] = useState(false);

  return (
    <article className="rounded-xl border border-line bg-bg p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${position.side === "long" ? "bg-primary/15 text-primary" : "bg-danger/15 text-danger"}`}>
              {position.side}
            </span>
            {position.leverage}x
            <span className="truncate font-normal text-muted">{position.market}</span>
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted">
            Size {fmt(position.size)} · margin {usd(position.margin)}
          </p>
        </div>
        <div className="text-right">
          <p className={`font-mono text-lg leading-none ${up ? "text-primary" : "text-danger"}`}>{up ? "+" : ""}{usd(pnl)}</p>
          <p className={`mt-1 font-mono text-xs ${up ? "text-primary" : "text-danger"}`}>{up ? "+" : ""}{roe.toFixed(2)}%</p>
        </div>
      </div>
      <div className="relative mt-3 h-1.5 rounded-full bg-surface-2">
        <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-line" />
        <span
          className={`absolute top-0 h-full rounded-full ${up ? "left-1/2 bg-primary" : "right-1/2 bg-danger"}`}
          style={{ width: `${half}%` }}
        />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        <Stat k="Entry" v={px(position.entry)} />
        <Stat k="Mark" v={px(mark)} />
        <Stat k="Liq" v={px(Math.max(liq, 0))} />
      </dl>
      <div className={`mt-3 grid gap-2 ${onClose ? "grid-cols-2" : "grid-cols-1"}`}>
        <button type="button" onClick={() => setShare(true)} className="h-9 rounded-lg border border-line text-xs">
          Share
        </button>
        {onClose && (
          <button type="button" onClick={onClose} className="h-9 rounded-lg border border-line text-xs">
            Close
          </button>
        )}
      </div>
      {share && (
        <PnlPoster
          data={{ market: position.market, side: position.side, leverage: position.leverage, pnl, roe, entry: position.entry, mark }}
          onClose={() => setShare(false)}
        />
      )}
    </article>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted">{k}</dt>
      <dd className="mt-0.5 truncate font-mono text-xs">{v}</dd>
    </div>
  );
}
