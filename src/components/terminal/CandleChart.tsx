import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { fmt, money, type Candle } from "@/lib/market";

const FRAME_MIN: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "1H": 60, "4H": 240, "1D": 1440 };
const DEFAULT_SPAN = 168;
const MIN_SPAN = 8;
const UP = "#00e8a0";
const DOWN = "#ff4d8d";
const VB_W = 960;
const VB_H = 460;
const PAD = { l: 8, r: 72, t: 16, b: 26 };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

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
  const [end, setEnd] = useState<number | null>(null);
  const [yScale, setYScale] = useState(1);
  const [yShift, setYShift] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [crossY, setCrossY] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const spanRef = useRef(span);
  const endRef = useRef(end);
  const lenRef = useRef(all.length);
  const yScaleRef = useRef(yScale);
  const yShiftRef = useRef(yShift);
  const drag = useRef<{ x: number; y: number; end: number; yScale: number; yShift: number; axis: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; span: number } | null>(null);
  spanRef.current = span;
  endRef.current = end;
  lenRef.current = all.length;
  yScaleRef.current = yScale;
  yShiftRef.current = yShift;

  function commit(nextSpan: number, nextEnd: number | null) {
    const len = lenRef.current;
    const spanNext = clamp(Math.round(nextSpan), MIN_SPAN, Math.max(MIN_SPAN, len));
    const endNext = nextEnd == null || nextEnd >= len ? null : clamp(Math.round(nextEnd), Math.min(spanNext, len), len);
    spanRef.current = spanNext;
    endRef.current = endNext;
    setSpan(spanNext);
    setEnd(endNext);
  }

  function zoomBy(factor: number, focus: number) {
    const len = lenRef.current;
    const current = Math.min(spanRef.current, Math.max(len, 1));
    const next = clamp(Math.round(current * factor), MIN_SPAN, Math.max(MIN_SPAN, len));
    const right = endRef.current ?? len;
    const left = right - current;
    const at = clamp(focus, 0, 1);
    const anchor = left + at * current;
    const newRight = anchor + (1 - at) * next;
    commit(next, newRight);
  }

  const zoomRef = useRef(zoomBy);
  zoomRef.current = zoomBy;

  useEffect(() => {
    setSpan(DEFAULT_SPAN);
    setEnd(null);
    setYScale(1);
    setYShift(0);
    setHover(null);
    spanRef.current = DEFAULT_SPAN;
    endRef.current = null;
    yScaleRef.current = 1;
    yShiftRef.current = 0;
  }, [seed]);

  useEffect(() => {
    const node = frameRef.current;
    if (!node || all.length < 2) return;
    const onWheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest("button")) return;
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const px = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * VB_W;
      const plotW = VB_W - PAD.l - PAD.r;
      const focus = clamp((px - PAD.l) / plotW, 0, 1);
      const factor = event.deltaY > 0 ? 1.2 : 1 / 1.2;
      if (event.shiftKey) {
        setYScale((value) => clamp(value * (event.deltaY > 0 ? 0.85 : 1.18), 0.4, 12));
        return;
      }
      zoomRef.current(factor, focus);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [all.length]);

  const viewEnd = end == null ? all.length : clamp(end, Math.min(span, all.length), all.length);
  const start = Math.max(0, viewEnd - span);
  const data = all.slice(start, viewEnd);
  const width = VB_W;
  const height = VB_H;
  const pad = PAD;
  const rawMax = data.length ? Math.max(...data.map((candle) => candle.h)) : 1;
  const rawMin = data.length ? Math.min(...data.map((candle) => candle.l)) : 0;
  const rawSpan = rawMax - rawMin || Math.abs(rawMax) * 0.02 || 1;
  const baseMax = rawMax + rawSpan * 0.08;
  const baseMin = rawMin - rawSpan * 0.08;
  const mid = (baseMax + baseMin) / 2;
  const half = (baseMax - baseMin) / 2 / yScale;
  const max = mid + half + yShift * (baseMax - baseMin);
  const min = mid - half + yShift * (baseMax - baseMin);
  const priceSpan = max - min || 1;
  const plotW = width - pad.l - pad.r;
  const priceH = (height - pad.t - pad.b) * 0.74;
  const slot = plotW / Math.max(data.length, 1);
  const bodyW = Math.max(1.4, slot * 0.72);
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
  const changed = span !== DEFAULT_SPAN || end != null || yScale !== 1 || Math.abs(yShift) > 0.001;
  const plotRight = pad.l + plotW;

  function clock(ts?: number) {
    if (!ts) return "";
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
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
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.max(8, Math.hypot(a.x - b.x, a.y - b.y));
      commit(pinch.current.span * (pinch.current.dist / dist), endRef.current ?? lenRef.current);
      return;
    }
    const point = pointer(event);
    if (drag.current) {
      if (drag.current.axis) {
        const dy = event.clientY - drag.current.y;
        setYScale(clamp(drag.current.yScale * Math.exp(dy * 0.01), 0.4, 12));
      } else {
        const dx = event.clientX - drag.current.x;
        const dy = event.clientY - drag.current.y;
        const rect = event.currentTarget.getBoundingClientRect();
        const shift = Math.round((-dx / Math.max(rect.width, 1)) * spanRef.current);
        const next = drag.current.end + shift;
        const len = lenRef.current;
        const right = clamp(next, Math.min(spanRef.current, len), len);
        setEnd(right >= len ? null : right);
        endRef.current = right >= len ? null : right;
        if (Math.abs(dy) > 8) {
          const shiftY = drag.current.yShift + dy / Math.max(rect.height, 1) / Math.max(yScaleRef.current, 0.4);
          setYShift(shiftY);
          yShiftRef.current = shiftY;
        }
      }
    }
    setCrossY(point.py >= pad.t && point.py <= pad.t + priceH ? point.py : null);
    publish(point.index);
  }

  function down(event: PointerEvent<SVGSVGElement>) {
    frameRef.current?.focus();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.max(8, Math.hypot(a.x - b.x, a.y - b.y)), span: spanRef.current };
      drag.current = null;
      setDragging(true);
      return;
    }
    const point = pointer(event);
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      end: endRef.current ?? lenRef.current,
      yScale: yScaleRef.current,
      yShift: yShiftRef.current,
      axis: point.px > plotRight,
    };
    setDragging(true);
  }

  function release(event: PointerEvent<SVGSVGElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      drag.current = null;
      setDragging(false);
    }
  }

  function leave() {
    if (pointers.current.size > 0) return;
    drag.current = null;
    setDragging(false);
    setHover(null);
    setCrossY(null);
    onHover?.(null);
  }

  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      const len = lenRef.current;
      const right = (endRef.current ?? len) - Math.max(1, Math.round(spanRef.current / 8));
      commit(spanRef.current, right);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      const len = lenRef.current;
      const right = (endRef.current ?? len) + Math.max(1, Math.round(spanRef.current / 8));
      commit(spanRef.current, right);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      zoomBy(1 / 1.2, 1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      zoomBy(1.2, 1);
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(1 / 1.2, 1);
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomBy(1.2, 1);
    } else if (event.key === "0") {
      reset();
    }
  }

  function reset() {
    setSpan(DEFAULT_SPAN);
    setEnd(null);
    setYScale(1);
    setYShift(0);
    spanRef.current = DEFAULT_SPAN;
    endRef.current = null;
    yScaleRef.current = 1;
    yShiftRef.current = 0;
  }

  if (data.length < 2) {
    return <div className="grid h-80 place-items-center px-6 text-center text-sm text-muted">Live candles have not arrived yet. History comes from DefiLlama.</div>;
  }

  const timeMarks = [0, 0.25, 0.5, 0.75, 1]
    .map((step) => Math.min(data.length - 1, Math.round((data.length - 1) * step)))
    .filter((value, index, list) => list.indexOf(value) === index);

  return (
    <div
      ref={frameRef}
      className="chart-frame relative h-80 touch-none overflow-hidden outline-none select-none sm:h-[28rem]"
      onKeyDown={key}
      onPointerLeave={leave}
      tabIndex={0}
      data-span={data.length}
    >
      <div className="absolute left-2 top-2 z-10 flex gap-1">
        {changed && (
          <button type="button" onClick={reset} className="h-7 rounded-md bg-white/10 px-2 text-[11px] text-fg">
            Reset
          </button>
        )}
        <button type="button" aria-label="Bigger candles" title="Bigger candles" onClick={() => zoomBy(1 / 1.25, 1)} className="grid h-7 w-7 place-items-center rounded-md bg-white/10 text-sm text-fg">
          +
        </button>
        <button type="button" aria-label="Smaller candles" title="Smaller candles" onClick={() => zoomBy(1.25, 1)} className="grid h-7 w-7 place-items-center rounded-md bg-white/10 text-sm text-fg">
          −
        </button>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={`block h-full w-full ${dragging ? "cursor-grabbing" : "cursor-crosshair"}`}
        style={{ touchAction: "none" }}
        role="img"
        aria-label="Price chart. Drag to move, scroll or plus and minus to resize candles, drag the price scale to zoom price."
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={release}
        onPointerCancel={release}
        onDoubleClick={reset}
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
              <line x1={x} x2={x} y1={y(candle.h)} y2={y(candle.l)} stroke={color} strokeWidth={Math.max(1, bodyW * 0.12)} />
              <rect x={x - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} />
              <rect x={x - bodyW / 2} y={volTop + volH - bar} width={bodyW} height={bar} fill={color} opacity="0.85" />
            </g>
          );
        })}
        <line x1={pad.l} x2={plotRight} y1={y(quote)} y2={y(quote)} stroke={lastUp ? UP : DOWN} strokeDasharray="3 3" strokeOpacity="0.85" />
        {hover !== null && (
          <line x1={pad.l + hover * slot + slot / 2} x2={pad.l + hover * slot + slot / 2} y1={pad.t} y2={height - pad.b} stroke="rgba(255,255,255,0.45)" strokeDasharray="2 3" />
        )}
        {crossY !== null && <line x1={pad.l} x2={plotRight} y1={crossY} y2={crossY} stroke="rgba(255,255,255,0.35)" strokeDasharray="2 3" />}
      </svg>
      {ticks.map((tick) => (
        <span key={tick} className="pointer-events-none absolute right-1.5 -translate-y-1/2 font-mono text-[10px] text-[#8b8b8b]" style={{ top: `${(y(tick) / height) * 100}%` }}>
          {label(tick)}
        </span>
      ))}
      <span
        className="pointer-events-none absolute right-1 z-[1] -translate-y-1/2 rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] text-black"
        style={{ top: `${(y(quote) / height) * 100}%`, background: lastUp ? UP : DOWN }}
      >
        {label(quote)}
      </span>
      {crossY !== null && (
        <span className="pointer-events-none absolute right-1 z-[1] -translate-y-1/2 rounded-[3px] bg-[#2a2a2a] px-1.5 py-0.5 font-mono text-[10px] text-white" style={{ top: `${(crossY / height) * 100}%` }}>
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
