import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fmt, px, tokenBySymbol, usd } from "@/lib/market";
import { useDesk, type Position } from "@/lib/store";
import { PnlPoster } from "@/components/terminal/PnlPoster";

export function PnlCard({ position, mark, onClose }: { position: Position; mark: number; onClose?: () => void }) {
  const live = useDesk((state) => state.marks[position.base] ?? state.marks[position.base.split(".")[0] ?? ""]);
  const listed = tokenBySymbol(position.base).price;
  const price = live > 0 ? live : listed > 0 ? listed : mark;
  const pnl = position.side === "long" ? (price - position.entry) * position.size : (position.entry - price) * position.size;
  const roe = position.margin > 0 ? (pnl / position.margin) * 100 : 0;
  const up = pnl >= 0;
  const liq = position.side === "long" ? position.entry * (1 - 0.9 / position.leverage) : position.entry * (1 + 0.9 / position.leverage);
  const half = Math.min(48, Math.abs(roe) / 2);
  const [share, setShare] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [tp, setTp] = useState(position.tp ? String(position.tp) : "");
  const [sl, setSl] = useState(position.sl ? String(position.sl) : "");
  const setGuards = useDesk((state) => state.setGuards);
  useEffect(() => {
    setTp(position.tp ? String(position.tp) : "");
    setSl(position.sl ? String(position.sl) : "");
  }, [position.id, position.tp, position.sl]);

  function saveGuards() {
    setGuards(position.id, { tp: Number(tp) || undefined, sl: Number(sl) || undefined });
  }

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
        <Stat k="Mark" v={px(price)} />
        <Stat k="Liq" v={px(Math.max(liq, 0))} />
      </dl>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-[10px] uppercase tracking-wide text-muted">
          Take profit
          <input value={tp} inputMode="decimal" onChange={(event) => setTp(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="Price" className="mt-1 h-9 w-full rounded-lg border border-line bg-surface px-2 font-mono text-xs normal-case text-fg outline-none" />
        </label>
        <label className="text-[10px] uppercase tracking-wide text-muted">
          Stop loss
          <input value={sl} inputMode="decimal" onChange={(event) => setSl(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="Price" className="mt-1 h-9 w-full rounded-lg border border-line bg-surface px-2 font-mono text-xs normal-case text-fg outline-none" />
        </label>
      </div>
      <button type="button" onClick={saveGuards} className="mt-2 h-8 rounded-lg border border-line px-3 text-xs">
        {position.tp || position.sl ? "Update TP / SL" : "Add TP / SL"}
      </button>
      <div className={`mt-3 grid gap-2 ${onClose ? "grid-cols-2" : "grid-cols-1"}`}>
        <button type="button" onClick={() => setShare(true)} className="h-9 rounded-lg border border-line text-xs">
          Share
        </button>
        {onClose && (
          <button type="button" onClick={() => setConfirm(true)} className="h-9 rounded-lg border border-line text-xs">
            Close
          </button>
        )}
      </div>
      {confirm && onClose && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4" onClick={() => setConfirm(false)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl border border-line bg-[#0e1210] p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <p className="text-base font-semibold">Close this trade?</p>
            <p className="mt-1 text-sm text-muted">
              Are you sure you want to close this {position.side} {position.leverage}x {position.market}?
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={onClose} className="h-11 rounded-full bg-danger text-sm font-semibold text-bg">
                Confirm
              </button>
              <button type="button" onClick={() => setConfirm(false)} className="h-11 rounded-full border border-line text-sm">
                Close
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {share && (
        <PnlPoster
          data={{ market: position.market, side: position.side, leverage: position.leverage, pnl, roe, entry: position.entry, mark: price }}
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