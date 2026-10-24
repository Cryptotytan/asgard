import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { candles as buildCandles, fmt, money, type Candle } from "@/lib/market";

const FRAME_MIN: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "1H": 60, "4H": 240, "1D": 1440 };
const DEFAULT_SPAN = 168;
const UP = "#00e8a0";
const DOWN = "#ff4d8d";

function bucket(points: Candle[], minutes: number): Candle[] {
  const size = Math.max(1, Math.round(minutes / 5));
  if (size === 1) return points;
  const out: Candle[] = [];
  for (let index = 0; index < points.length; index += size) {
    const slice = points.slice(index, index + size);
    const first = slice[0];
    const last = slice[slice.length - 1];
    if (!first || !last) continue;
    out.push({
      t: last.t,
      o: first.o,
      h: Math.max(...slice.map((candle) => candle.h)),
      l: Math.min(...slice.map((candle) => candle.l)),
      c: last.c,
    });
  }
  return out;
}

export type ChartHover = { o: number; h: number; l: number; c: number; label: string };

export function CandleChart({
  seed,
  last,
  frame = "5m",
  compact = false,
  live,
  series,
  onHover,
}: {
  seed: string;
  last: number;
  frame?: string;
  compact?: boolean;
  live?: number;
  series?: Candle[];
  onHover?: (hover: ChartHover | null) => void;
}) {
  const all = useMemo(() => (series && series.length > 1 ? bucket(series, FRAME_MIN[frame] ?? 5) : []), [series, frame]);
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
  const width = 960;
  const height = 460;
  const pad = { l: 8, r: 72, t: 16, b: 26 };
  const max = data.length ? Math.max(...data.map((candle) => candle.h)) : 1;
  const min = data.length ? Math.min(...data.map((candle) => candle.l)) : 0;
  const priceSpan = max - min || 1;
  const plotW = width - pad.l - pad.r;
  const priceH = (height - pad.t - pad.b) * 0.74;
  const slot = plotW / Math.max(data.length, 1);
  const bodyW = Math.min(5.2, Math.max(1.5, slot * 0.58));
  const y = (price: number) => pad.t + ((max - price) / priceSpan) * priceH;
  const vols = data.map((candle) => Math.abs(candle.c - candle.o) + (candle.h - candle.l) * 0.35);
  const maxVol = Math.max(...vols, 1);
  const volTop = pad.t + priceH + 10;
  const volH = height - pad.b - volTop;
  const lastCandle = data[data.length - 1] ?? { o: last, h: last, l: last, c: last };
  const lastUp = lastCandle.c >= lastCandle.o;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((step) => max - priceSpan * step);
  const label = (n: number) => (compact || Math.abs(n) >= 100_000 ? money(n) : fmt(n, Math.abs(n) >= 1 ? 4 : 6));
  const quote = live ?? lastCandle.c;
  const zoomed = span !== DEFAULT_SPAN || end !== all.length;
  const plotRight = pad.l + plotW;

  function clock(ts?: number) {
    if (!ts) return "";
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

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
    if (px < pad.l || px > plotRight) return null;
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
    const candle = data[index];
    const stamp = clock(candle.t);
    const mins = (FRAME_MIN[frame] ?? 5) * (data.length - 1 - index);
    const when = stamp || (mins <= 0 ? "now" : mins >= 60 ? `${Math.round(mins / 60)}h ago` : `${mins}m ago`);
    onHover({ o: candle.o, h: candle.h, l: candle.l, c: candle.c, label: when });
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

  if (data.length < 2) {
    return <div className="grid h-80 place-items-center px-6 text-center text-sm text-muted">Live candles have not arrived yet. History comes from DefiLlama.</div>;
  }

  const timeMarks = [0, 0.25, 0.5, 0.75, 1]
    .map((step) => Math.min(data.length - 1, Math.round((data.length - 1) * step)))
    .filter((value, index, list) => list.indexOf(value) === index);

  return (
    <div
      className={`chart-frame relative h-80 overflow-hidden outline-none sm:h-[28rem] ${armed ? "is-hot" : ""}`}
      onPointerEnter={arm}
      onPointerLeave={disarm}
      onKeyDown={key}
      tabIndex={0}
    >
      {armed && zoomed && (
        <button type="button" onClick={reset} className="absolute left-2 top-2 z-10 h-7 rounded-md bg-white/10 px-2 text-[11px] text-fg">
          Reset
        </button>
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={`block h-full w-full ${armed ? "cursor-crosshair" : ""}`}
        style={{ touchAction: "none" }}
        role="img"
        aria-label="Price chart. Hover to inspect, scroll to zoom, drag to pan."
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
        onDoubleClick={() => hotRef.current && reset()}
      >
        {ticks.map((tick, index) => (
          <line key={index} x1={pad.l} x2={plotRight} y1={y(tick)} y2={y(tick)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        ))}
        <line x1={pad.l} x2={plotRight} y1={volTop - 4} y2={volTop - 4} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
        {data.map((candle, index) => {
          const rising = candle.c >= candle.o;
          const color = rising ? UP : DOWN;
          const x = pad.l + index * slot + slot / 2;
          const bodyTop = y(Math.max(candle.o, candle.c));
          const bodyBot = y(Math.min(candle.o, candle.c));
          const bodyH = Math.max(0.8, bodyBot - bodyTop);
          const bar = Math.max(1, (vols[index] / maxVol) * volH);
          return (
            <g key={index}>
              <line x1={x} x2={x} y1={y(candle.h)} y2={y(candle.l)} stroke={color} strokeWidth="1" />
              <rect x={x - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} />
              <rect x={x - bodyW / 2} y={volTop + volH - bar} width={bodyW} height={bar} fill={color} opacity="0.85" />
            </g>
          );
        })}
        <line
          x1={pad.l}
          x2={plotRight}
          y1={y(quote)}
          y2={y(quote)}
          stroke={lastUp ? UP : DOWN}
          strokeDasharray="3 3"
          strokeOpacity="0.85"
        />
        {hover !== null && (
          <line x1={pad.l + hover * slot + slot / 2} x2={pad.l + hover * slot + slot / 2} y1={pad.t} y2={height - pad.b} stroke="rgba(255,255,255,0.45)" strokeDasharray="2 3" />
        )}
        {crossY !== null && <line x1={pad.l} x2={plotRight} y1={crossY} y2={crossY} stroke="rgba(255,255,255,0.35)" strokeDasharray="2 3" />}
      </svg>
      {ticks.map((tick) => (
        <span
          key={tick}
          className="pointer-events-none absolute right-1.5 -translate-y-1/2 font-mono text-[10px] text-[#8b8b8b]"
          style={{ top: `${(y(tick) / height) * 100}%` }}
        >
          {label(tick)}
        </span>
      ))}
      <span
        className="pointer-events-none absolute right-1 z-[1] -translate-y-1/2 rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] text-black"
        style={{ top: `${(y(quote) / height) * 100}%`, background: lastUp ? UP : DOWN }}
      >
        {label(quote)}
      </span>
      {armed && crossY !== null && (
        <span
          className="pointer-events-none absolute right-1 z-[1] -translate-y-1/2 rounded-[3px] bg-[#2a2a2a] px-1.5 py-0.5 font-mono text-[10px] text-white"
          style={{ top: `${(crossY / height) * 100}%` }}
        >
          {label(priceAt(crossY))}
        </span>
      )}
      {timeMarks.map((index) => (
        <span
          key={index}
          className="pointer-events-none absolute bottom-1 -translate-x-1/2 font-mono text-[10px] text-[#8b8b8b]"
          style={{ left: `${((pad.l + index * slot + slot / 2) / width) * 100}%` }}
        >
          {clock(data[index]?.t) || ""}
        </span>
      ))}
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
