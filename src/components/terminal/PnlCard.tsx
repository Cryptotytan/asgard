import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { fmt, px, tokenBySymbol, usd } from "@/lib/market";
import { useDesk, type Position } from "@/lib/store";
import { PnlPoster } from "@/components/terminal/PnlPoster";

export function PnlCard({ position, mark, onClose, startShare = false, onShareClose }: { position: Position; mark: number; onClose?: () => void; startShare?: boolean; onShareClose?: () => void }) {
  const marks = useDesk((state) => state.marks);
  const clock = useDesk((state) => state.clock);
  const live = marks[position.base] ?? marks[position.base.split(".")[0] ?? ""];
  const listed = tokenBySymbol(position.base).price;
  const price = live > 0 ? live : listed > 0 ? listed : mark;
  void clock;
  const pnl = position.side === "long" ? (price - position.entry) * position.size : (position.entry - price) * position.size;
  const roe = position.margin > 0 ? (pnl / position.margin) * 100 : 0;
  const up = pnl >= 0;
  const liq = position.side === "long" ? position.entry * (1 - 0.9 / position.leverage) : position.entry * (1 + 0.9 / position.leverage);
  const half = Math.min(48, Math.abs(roe) / 2);
  const [share, setShare] = useState(startShare);
  useEffect(() => {
    setShare(startShare);
  }, [startShare, position.id]);
  const [confirm, setConfirm] = useState(false);
  const [guards, setGuardsOpen] = useState(false);
  const [tp, setTp] = useState(position.tp ? String(position.tp) : "");
  const [sl, setSl] = useState(position.sl ? String(position.sl) : "");
  const setGuards = useDesk((state) => state.setGuards);
  const setLeverage = useDesk((state) => state.setLeverage);
  const adjustMargin = useDesk((state) => state.adjustMargin);
  const free = useDesk((state) => state.balances.USDT ?? 0);
  const [lev, setLev] = useState(position.leverage);
  const [marginAmt, setMarginAmt] = useState("10");
  const [riskNote, setRiskNote] = useState("");
  useEffect(() => {
    setTp(position.tp ? String(position.tp) : "");
    setSl(position.sl ? String(position.sl) : "");
    setLev(position.leverage);
  }, [position.id, position.tp, position.sl, position.leverage]);

  const tpPrice = Number(tp);
  const slPrice = Number(sl);
  const tpPnl = Number.isFinite(tpPrice) && tpPrice > 0 ? outcome(position, tpPrice) : null;
  const slPnl = Number.isFinite(slPrice) && slPrice > 0 ? outcome(position, slPrice) : null;
  const savedTp = position.tp ? outcome(position, position.tp) : null;
  const savedSl = position.sl ? outcome(position, position.sl) : null;

  function saveGuards() {
    setGuards(position.id, { tp: tpPrice > 0 ? tpPrice : undefined, sl: slPrice > 0 ? slPrice : undefined });
    setGuardsOpen(false);
  }

  return (
    <>
      <div className="manage-stage w-full">
        <article className="manage-slab relative w-full overflow-hidden rounded-[1.35rem] border border-white/10 p-4 sm:p-5">
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.9fr)_minmax(0,1fr)]">
            <div className="min-w-0">
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
                  <p className={`font-mono text-lg leading-none ${up ? "text-primary" : "text-danger"}`}>{signedUsd(pnl)}</p>
                  <p className={`mt-1 font-mono text-xs ${up ? "text-primary" : "text-danger"}`}>{up ? "+" : ""}{roe.toFixed(2)}%</p>
                </div>
              </div>
              <div className="relative mt-3 h-1.5 rounded-full bg-black/40">
                <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/20" />
                <span className={`absolute top-0 h-full rounded-full ${up ? "left-1/2 bg-primary" : "right-1/2 bg-danger"}`} style={{ width: `${half}%` }} />
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2">
                <Stat k="Entry" v={px(position.entry)} />
                <Stat k="Mark" v={px(price)} />
                <Stat k="Liq" v={px(Math.max(liq, 0))} />
              </dl>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/25 p-3">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted">
                <span>Leverage</span>
                <span className="font-mono text-xs text-fg">{lev}x</span>
              </div>
              <input type="range" min={1} max={20} value={lev} aria-label="Position leverage" onChange={(event) => setLev(Number(event.target.value))} className="mt-1 w-full" />
              <button
                type="button"
                onClick={() => setRiskNote(setLeverage(position.id, lev) ? "" : "Not enough free USDT to lower leverage.")}
                className="mt-1 h-8 w-full rounded-lg border border-line text-xs"
              >
                Update leverage
              </button>
              <div className="mt-2 flex items-center gap-2">
                <input
                  inputMode="decimal"
                  value={marginAmt}
                  aria-label="Margin amount"
                  onChange={(event) => setMarginAmt(event.target.value.replace(/[^0-9.]/g, ""))}
                  className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 font-mono text-xs outline-none"
                />
                <button type="button" onClick={() => setRiskNote(adjustMargin(position.id, Number(marginAmt) || 0) ? "" : "Not enough free USDT.")} className="h-8 rounded-lg border border-line px-2 text-xs">Add</button>
                <button type="button" onClick={() => setRiskNote(adjustMargin(position.id, -(Number(marginAmt) || 0)) ? "" : "Margin can't go below the maintenance floor.")} className="h-8 rounded-lg border border-line px-2 text-xs">Remove</button>
              </div>
              <p className="mt-1 text-[10px] text-muted">{riskNote || `${usd(free)} USDT free`}</p>
            </div>
            <div>
              <button type="button" onClick={() => setGuardsOpen(true)} className="grid w-full grid-cols-2 gap-2 text-left">
                <span className="rounded-lg border border-white/10 bg-black/25 px-2 py-2">
                  <span className="block text-[10px] uppercase tracking-wide text-muted">Take profit</span>
                  <span className="mt-0.5 block font-mono text-xs text-primary">{position.tp ? px(position.tp) : "—"}</span>
                  <span className="block font-mono text-[11px] text-primary">{savedTp == null ? "—" : signedUsd(savedTp)}</span>
                </span>
                <span className="rounded-lg border border-white/10 bg-black/25 px-2 py-2">
                  <span className="block text-[10px] uppercase tracking-wide text-muted">Stop loss</span>
                  <span className="mt-0.5 block font-mono text-xs text-danger">{position.sl ? px(position.sl) : "—"}</span>
                  <span className="block font-mono text-[11px] text-danger">{savedSl == null ? "—" : signedUsd(savedSl)}</span>
                </span>
              </button>
              <button type="button" onClick={() => setGuardsOpen(true)} className="mt-2 h-8 w-full rounded-lg border border-line text-xs">
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
            </div>
          </div>
        </article>
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
      {guards && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4" onClick={() => setGuardsOpen(false)}>
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl border border-line bg-[#0e1210] p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <p className="text-base font-semibold">{position.tp || position.sl ? "Update TP and SL" : "Add TP and SL"}</p>
            <p className="mt-1 text-sm text-muted">{position.side} {position.leverage}x {position.market} · mark {px(price)}</p>
            <label className="mt-4 block text-[10px] uppercase tracking-wide text-muted">
              Take profit
              <input value={tp} inputMode="decimal" onChange={(event) => setTp(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="Price" className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 font-mono text-sm normal-case text-fg outline-none" />
            </label>
            <p className="mt-1 font-mono text-xs text-primary">Expected profit {tpPnl == null ? "—" : signedUsd(tpPnl)}</p>
            <label className="mt-3 block text-[10px] uppercase tracking-wide text-muted">
              Stop loss
              <input value={sl} inputMode="decimal" onChange={(event) => setSl(event.target.value.replace(/[^0-9.]/g, ""))} placeholder="Price" className="mt-1 h-11 w-full rounded-xl border border-line bg-bg px-3 font-mono text-sm normal-case text-fg outline-none" />
            </label>
            <p className="mt-1 font-mono text-xs text-danger">Expected loss {slPnl == null ? "—" : signedUsd(slPnl)}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={saveGuards} className="h-11 rounded-full bg-primary text-sm font-semibold text-primary-fg">
                Save
              </button>
              <button type="button" onClick={() => setGuardsOpen(false)} className="h-11 rounded-full border border-line text-sm">
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
          onClose={() => {
            setShare(false);
            onShareClose?.();
          }}
        />
      )}
    </>
  );
}

function outcome(position: Position, target: number) {
  return position.side === "long" ? (target - position.entry) * position.size : (position.entry - target) * position.size;
}

function signedUsd(n: number) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const digits = 2;
  const text = abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}$${text}`;
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted">{k}</dt>
      <dd className="mt-0.5 truncate font-mono text-xs">{v}</dd>
    </div>
  );
}