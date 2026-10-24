import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { candles as buildCandles, fmt, money, type Candle } from "@/lib/market";

const FRAME_MIN: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "1H": 60, "4H": 240, "1D": 1440 };
const DEFAULT_SPAN = 80;

export type ChartHover = { o: number; h: number; l: number; c: number; label: string };

export function CandleChart({
  seed,
  last,
  frame = "5m",
  compact = false,
  live,
  onHover,
}: {
  seed: string;
  last: number;
  frame?: string;
  compact?: boolean;
  live?: number;
  onHover?: (hover: ChartHover | null) => void;
}) {
  const all = useMemo(() => buildCandles(seed, last, 180), [seed, last]);
  const [span, setSpan] = useState(DEFAULT_SPAN);
  const [end, setEnd] = useState(all.length);
  const [hover, setHover] = useState<number | null>(null);
  const [crossY, setCrossY] = useState<number | null>(null);
  const drag = useRef<{ x: number; end: number } | null>(null);
  const hotRef = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    setSpan(DEFAULT_SPAN);
    setEnd(all.length);
    setHover(null);
  }, [seed, all.length]);

  useEffect(() => {
    const node = svgRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!hotRef.current) return;
      event.preventDefault();
      setSpan((current) => {
        const next = Math.max(18, Math.min(all.length, Math.round(current * (event.deltaY > 0 ? 1.16 : 0.86))));
        setEnd((value) => Math.max(next, Math.min(all.length, value)));
        return next;
      });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [all.length]);

  const start = Math.max(0, Math.min(end, all.length) - span);
  const data = all.slice(start, Math.min(all.length, start + span));
  const width = 900;
  const height = 460;
  const pad = { l: 0, r: 0, t: 48, b: 18 };
  const max = Math.max(...data.map((candle) => candle.h));
  const min = Math.min(...data.map((candle) => candle.l));
  const priceSpan = max - min || 1;
  const innerW = width - pad.l - pad.r;
  const priceH = (height - pad.t - pad.b) * 0.78;
  const slot = innerW / Math.max(data.length, 1);
  const y = (price: number) => pad.t + ((max - price) / priceSpan) * priceH;
  const vols = data.map((candle) => Math.abs(candle.c - candle.o) + (candle.h - candle.l) * 0.4);
  const maxVol = Math.max(...vols, 1);
  const volTop = pad.t + priceH + 14;
  const volH = height - pad.b - volTop;
  const lastCandle = data[data.length - 1];
  const lastUp = lastCandle.c >= lastCandle.o;
  const ticks = [max, max - priceSpan * 0.33, max - priceSpan * 0.66, min];
  const active = hover !== null ? data[hover] : null;
  const tipX = hover === null ? 0 : ((pad.l + hover * slot + slot / 2) / width) * 100;
  const zoomed = span !== DEFAULT_SPAN || end !== all.length;
  const label = (n: number) => (compact || Math.abs(n) >= 100_000 ? money(n) : fmt(n, 4));
  const quote = live ?? lastCandle.c;
  const pill = label(quote);
  const shown = useRef(pill);
  const [turn, setTurn] = useState(0);
  useEffect(() => {
    if (shown.current === pill) return;
    shown.current = pill;
    setTurn((value) => value + 1);
  }, [pill]);

  function arm() {
    hotRef.current = true;
    setArmed(true);
  }

  function disarm() {
    hotRef.current = false;
    setArmed(false);
    drag.current = null;
    setHover(null);
    setCrossY(null);
    onHover?.(null);
  }

  function priceAt(py: number) {
    return max - ((py - pad.t) / priceH) * priceSpan;
  }

  function indexAt(px: number) {
    const index = Math.floor((px - pad.l) / slot);
    return index >= 0 && index < data.length ? index : null;
  }

  function publish(index: number | null) {
    setHover(index);
    if (!onHover) return;
    if (index === null || !data[index]) {
      onHover(null);
      return;
    }
    const mins = (FRAME_MIN[frame] ?? 5) * (data.length - 1 - index);
    const label = mins <= 0 ? "now" : mins >= 1440 ? `${Math.round(mins / 1440)}d ago` : mins >= 60 ? `${Math.round(mins / 60)}h ago` : `${mins}m ago`;
    const candle = data[index];
    onHover({ o: candle.o, h: candle.h, l: candle.l, c: candle.c, label });
  }

  function pointer(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * width;
    const py = ((event.clientY - rect.top) / rect.height) * height;
    return { px, py, index: indexAt(px) };
  }

  function move(event: PointerEvent<SVGSVGElement>) {
    if (!hotRef.current) return;
    const point = pointer(event);
    if (drag.current) {
      const dx = event.clientX - drag.current.x;
      const shift = Math.round((-dx / event.currentTarget.getBoundingClientRect().width) * span);
      setEnd(Math.max(span, Math.min(all.length, drag.current.end + shift)));
    }
    setCrossY(point.py >= pad.t && point.py <= pad.t + priceH ? point.py : null);
    publish(point.index);
  }

  function down(event: PointerEvent<SVGSVGElement>) {
    if (!hotRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, end };
  }

  function release() {
    drag.current = null;
  }

  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (!hotRef.current) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setEnd((value) => Math.max(span, value - Math.max(1, Math.round(span / 8))));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setEnd((value) => Math.min(all.length, value + Math.max(1, Math.round(span / 8))));
    } else if (event.key === "+" || event.key === "=") {
      setSpan((value) => Math.max(18, Math.round(value * 0.86)));
    } else if (event.key === "-" || event.key === "_") {
      setSpan((value) => {
        const next = Math.min(all.length, Math.round(value * 1.16));
        setEnd((current) => Math.max(next, Math.min(all.length, current)));
        return next;
      });
    }
  }

  function reset() {
    setSpan(DEFAULT_SPAN);
    setEnd(all.length);
  }

  return (
    <div
      className={`chart-frame relative flex h-80 flex-col overflow-hidden rounded-xl pt-10 outline-none sm:mx-4 sm:mb-2 sm:mt-0 sm:block sm:h-auto sm:min-h-16 sm:pt-7 ${armed ? "is-hot" : ""}`}
      onPointerEnter={arm}
      onPointerLeave={disarm}
      onKeyDown={key}
      tabIndex={0}
    >
      {armed && zoomed && (
        <button type="button" onClick={reset} className="absolute left-2 top-2 z-10 h-8 rounded-lg bg-surface px-2 text-xs text-muted">
          Reset
        </button>
      )}
      {armed && active && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-lg border border-line bg-surface px-2 py-1.5 font-mono text-xs"
          style={{ left: `${tipX}%`, transform: tipX > 68 ? "translateX(-108%)" : "translateX(8px)" }}
        >
          <p className={active.c >= active.o ? "text-primary" : "text-danger"}>
            {active.c >= active.o ? "Up" : "Down"} · {label(active.c)}
          </p>
          <p className="text-muted">
            O {label(active.o)} H {label(active.h)}
          </p>
          <p className="text-muted">
            L {label(active.l)} C {label(active.c)}
          </p>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={`block h-full w-full sm:h-80 ${armed ? "cursor-crosshair" : ""}`}
        style={{ touchAction: "pan-y" }}
        role="img"
        aria-label="Price chart. Hover to inspect, scroll to zoom, drag to pan."
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
        onDoubleClick={() => hotRef.current && reset()}
      >
        {ticks.map((tick, index) => (
          <line key={index} x1={0} x2={width} y1={y(tick)} y2={y(tick)} stroke="var(--color-line)" strokeWidth="1" />
        ))}
        {data.map((candle, index) => {
          const rising = candle.c >= candle.o;
          const color = rising ? "var(--color-primary)" : "var(--color-danger)";
          const x = pad.l + index * slot + slot / 2;
          const bodyTop = y(Math.max(candle.o, candle.c));
          const bodyBot = y(Math.min(candle.o, candle.c));
          const bodyH = Math.max(1.2, bodyBot - bodyTop);
          const bar = (vols[index] / maxVol) * volH;
          const hot = index === hover;
          return (
            <g key={index} opacity={hover === null || hot ? 1 : 0.45}>
              <line x1={x} x2={x} y1={y(candle.h)} y2={y(candle.l)} stroke={color} strokeWidth={hot ? 2 : 1.25} />
              <rect x={x - slot * 0.28} y={bodyTop} width={Math.max(1.4, slot * 0.56)} height={bodyH} fill={color} />
              <rect x={x - slot * 0.28} y={volTop + volH - bar} width={Math.max(1.4, slot * 0.56)} height={bar} fill={color} opacity="0.85" />
            </g>
          );
        })}
        {hover !== null && (
          <line
            x1={pad.l + hover * slot + slot / 2}
            x2={pad.l + hover * slot + slot / 2}
            y1={pad.t}
            y2={height - pad.b}
            stroke="var(--color-fg)"
            strokeDasharray="2 3"
          />
        )}
        {crossY !== null && (
          <line x1={0} x2={width} y1={crossY} y2={crossY} stroke="var(--color-muted)" strokeDasharray="2 3" />
        )}
        <line
          x1={0}
          x2={width}
          y1={y(lastCandle.c)}
          y2={y(lastCandle.c)}
          stroke={lastUp ? "var(--color-primary)" : "var(--color-danger)"}
          strokeDasharray="3 4"
        />
      </svg>
      {ticks.map((tick, index) => (
        <span
          key={index}
          className="pointer-events-none absolute left-1.5 -translate-y-1/2 rounded bg-surface/80 px-1 font-mono text-[10px] text-muted"
          style={{ top: `${(y(tick) / height) * 100}%` }}
        >
          {label(tick)}
        </span>
      ))}
      <span className="flap-board pointer-events-none absolute right-1 -translate-y-1/2" style={{ top: `${(y(lastCandle.c) / height) * 100}%` }}>
        <span
          key={turn}
          className={`block rounded px-1.5 py-0.5 font-mono text-[10px] text-primary-fg ${lastUp ? "bg-primary" : "bg-danger"} ${turn ? "flap" : ""}`}
        >
          {pill}
        </span>
      </span>
      {armed && crossY !== null && (
        <span
          className="pointer-events-none absolute left-2 -translate-y-full font-mono text-[10px] text-fg"
          style={{ top: `${(crossY / height) * 100}%` }}
        >
          {label(priceAt(crossY))}
        </span>
      )}
      </div>
      {armed && <p className="hidden px-3 pb-2 text-xs text-muted sm:block">Scroll to zoom · drag to pan · double-click to reset</p>}
      {!armed && <p className="hidden px-3 pb-2 text-xs text-muted sm:block">Point at the chart to inspect, zoom, and pan</p>}
    </div>
  );
}

export function ohlc(data: Candle[]) {
  const first = data[0];
  const last = data[data.length - 1];
  const high = Math.max(...data.map((candle) => candle.h));
  const low = Math.min(...data.map((candle) => candle.l));
  return { o: first.o, h: high, l: low, c: last.c };
}
