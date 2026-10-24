import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { fmt, money, type Candle } from "@/lib/market";

const FRAME_MIN: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "1H": 60, "4H": 240, "1D": 1440 };
const DEFAULT_BARS: Record<string, number> = { "1m": 100, "5m": 100, "15m": 110, "1H": 130, "4H": 140, "1D": 180 };
const MIN_SPAN = 16;
const MAX_SPAN = 480;
const RIGHT_GAP = 4;
const UP = "#00e8a0";
const DOWN = "#ff4d8d";
const VB_W = 960;
const VB_H = 460;
const PAD = { l: 8, r: 72, t: 16, b: 26 };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function defaultSpan(frame: string) {
  return DEFAULT_BARS[frame] ?? 120;
}

export type ChartHover = { o: number; h: number; l: number; c: number; label: string };

export function CandleChart({
  seed,
  last,
  frame = "5m",
  compact = false,
  live,
  series,
  historyEnded = false,
  historyTick = 0,
  onHover,
  onNeedHistory,
}: {
  seed: string;
  last: number;
  frame?: string;
  compact?: boolean;
  live?: number;
  series?: Candle[];
  historyEnded?: boolean;
  historyTick?: number;
  onHover?: (hover: ChartHover | null) => void;
  onNeedHistory?: () => void;
}) {
  const all = series && series.length > 1 ? series : [];
  const [span, setSpan] = useState<number | null>(null);
  const [right, setRight] = useState<number | null>(null);
  const [seenSeed, setSeenSeed] = useState(seed);
  const [trackedFirst, setTrackedFirst] = useState<number | null>(null);
  const [yScale, setYScale] = useState(1);
  const [yShift, setYShift] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [crossY, setCrossY] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const spanRef = useRef(defaultSpan(frame));
  const rightRef = useRef<number | null>(null);
  const lenRef = useRef(all.length);
  const seriesRef = useRef(all);
  const endedRef = useRef(historyEnded);
  const yScaleRef = useRef(yScale);
  const yShiftRef = useRef(yShift);
  const drag = useRef<{ x: number; y: number; right: number; yScale: number; yShift: number; axis: boolean; first: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; span: number } | null>(null);
  const needRef = useRef(onNeedHistory);
  needRef.current = onNeedHistory;

  let viewSpan = span;
  let viewRight = right;
  const firstT = all[0]?.t ?? null;
  if (seed !== seenSeed) {
    viewSpan = null;
    viewRight = null;
    setSeenSeed(seed);
    setSpan(null);
    setRight(null);
    setTrackedFirst(firstT);
    setYScale(1);
    setYShift(0);
    setHover(null);
  } else if (firstT !== trackedFirst) {
    if (firstT != null && trackedFirst != null && firstT < trackedFirst && right != null) {
      let added = 0;
      while (added < all.length && (all[added]?.t ?? 0) < trackedFirst) added++;
      viewRight = right + added;
      setRight(viewRight);
    }
    setTrackedFirst(firstT);
  }

  const wanted = clamp(viewSpan ?? defaultSpan(frame), MIN_SPAN, MAX_SPAN);
  lenRef.current = all.length;
  seriesRef.current = all;
  spanRef.current = wanted;
  rightRef.current = viewRight;
  endedRef.current = historyEnded;
  yScaleRef.current = yScale;
  yShiftRef.current = yShift;

  function limits(spanNext: number, len: number) {
    const liveEdge = len + RIGHT_GAP;
    const maxRight = liveEdge + Math.floor(spanNext * 0.4);
    const minRight = endedRef.current ? Math.min(spanNext, Math.max(liveEdge, 1)) : Math.min(liveEdge, Math.max(8, spanNext - 40));
    return { liveEdge, maxRight, minRight };
  }

  function commit(nextSpan: number, nextRight: number | null, pin = true) {
    const len = lenRef.current;
    const spanNext = clamp(Math.round(nextSpan), MIN_SPAN, MAX_SPAN);
    const { liveEdge, maxRight, minRight } = limits(spanNext, len);
    spanRef.current = spanNext;
    setSpan(spanNext === defaultSpan(frame) ? null : spanNext);
    if (nextRight == null || (pin && nextRight >= liveEdge)) {
      rightRef.current = null;
      setRight(null);
      return;
    }
    const clamped = clamp(Math.round(nextRight), minRight, maxRight);
    rightRef.current = clamped;
    setRight(clamped);
  }

  function zoomBy(factor: number, focus: number) {
    const len = lenRef.current;
    const current = spanRef.current || defaultSpan(frame);
    const next = clamp(Math.round(current * factor), MIN_SPAN, MAX_SPAN);
    const edge = rightRef.current == null ? len + RIGHT_GAP : rightRef.current;
    const left = edge - current;
    const at = clamp(focus, 0, 1);
    commit(next, left + at * current + (1 - at) * next);
  }

  const zoomRef = useRef(zoomBy);
  zoomRef.current = zoomBy;

  useEffect(() => {
    const node = frameRef.current;
    if (!node || all.length < 2) return;
    const onWheel = (event: WheelEvent) => {
      if (event.target instanceof Element && event.target.closest("button")) return;
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const spanNow = spanRef.current || defaultSpan(frame);
      const len = lenRef.current;
      const edge = rightRef.current == null ? len + RIGHT_GAP : rightRef.current;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && event.deltaX !== 0) {
        commit(spanNow, edge + (event.deltaX / Math.max(rect.width, 1)) * spanNow, false);
        return;
      }
      const px = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * VB_W;
      const plotW = VB_W - PAD.l - PAD.r;
      const focus = clamp((px - PAD.l) / plotW, 0, 1);
      if (event.shiftKey) {
        setYScale((value) => clamp(value * (event.deltaY > 0 ? 0.85 : 1.18), 0.4, 12));
        return;
      }
      zoomRef.current(event.deltaY > 0 ? 1.18 : 1 / 1.18, focus);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [all.length, frame]);

  useEffect(() => {
    if (historyEnded || all.length < 2) return;
    const near = () => {
      const len = seriesRef.current.length;
      if (len < 2) return false;
      const spanNow = spanRef.current || defaultSpan(frame);
      const edge = rightRef.current == null ? len + RIGHT_GAP : rightRef.current;
      return edge - spanNow < 160;
    };
    if (!near()) return;
    needRef.current?.();
    const timer = window.setInterval(() => {
      if (near()) needRef.current?.();
    }, 700);
    return () => window.clearInterval(timer);
  }, [all.length, viewRight, wanted, frame, historyEnded, historyTick]);

  const { liveEdge, maxRight, minRight } = limits(wanted, all.length);
  const rightEdge = viewRight == null ? liveEdge : clamp(viewRight, minRight, maxRight);
  const start = rightEdge - wanted;
  const from = Math.max(0, Math.floor(start));
  const to = Math.min(all.length, Math.ceil(rightEdge));
  const data = all.slice(from, to);
  const width = VB_W;
  const height = VB_H;
  const pad = PAD;
  const rawMax = data.length ? Math.max(...data.map((candle) => candle.h)) : last || 1;
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
  const slot = plotW / wanted;
  const bodyW = Math.min(Math.max(slot * 0.62, 0.45), Math.max(slot - 0.12, 0.45));
  const y = (price: number) => pad.t + ((max - price) / priceSpan) * priceH;
  const vols = data.map((candle) => Math.abs(candle.c - candle.o) + (candle.h - candle.l) * 0.35);
  const maxVol = Math.max(...vols, 1);
  const volTop = pad.t + priceH + 10;
  const volH = height - pad.b - volTop;
  const lastCandle = data[data.length - 1] ?? all[all.length - 1] ?? { o: last, h: last, l: last, c: last };
  const lastUp = lastCandle.c >= lastCandle.o;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((step) => max - priceSpan * step);
  const label = (n: number) => (compact || Math.abs(n) >= 100_000 ? money(n) : fmt(n, Math.abs(n) >= 1 ? 4 : 6));
  const quote = live ?? lastCandle.c;
  const changed = viewSpan != null || viewRight != null || yScale !== 1 || Math.abs(yShift) > 0.001;
  const plotRight = pad.l + plotW;
  const stepSec = (FRAME_MIN[frame] ?? 5) * 60;

  function timeAt(seriesIndex: number) {
    if (!all.length) return 0;
    const i = clamp(Math.round(seriesIndex), 0, all.length - 1);
    const base = all[i]?.t ?? 0;
    return base + (seriesIndex - i) * stepSec;
  }

  const spanSec = Math.abs(timeAt(rightEdge - RIGHT_GAP) - timeAt(Math.max(0, start)));

  function clock(ts?: number) {
    if (!ts) return "";
    const ms = ts > 1e12 ? ts : ts * 1000;
    const date = new Date(ms);
    if (spanSec >= 86400 * 370) return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    if (spanSec >= 86400 * 1.1) return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function priceAt(py: number) {
    return max - ((py - pad.t) / priceH) * priceSpan;
  }

  function xAt(seriesIndex: number) {
    return pad.l + (seriesIndex - start + 0.5) * slot;
  }

  function indexAt(px: number) {
    if (px < pad.l || px > plotRight) return null;
    const seriesIndex = Math.floor(start + (px - pad.l) / slot);
    if (seriesIndex < from || seriesIndex >= to) return null;
    return seriesIndex - from;
  }

  function publish(index: number | null) {
    setHover(index);
    if (!onHover) return;
    if (index === null || !data[index]) {
      onHover(null);
      return;
    }
    const candle = data[index];
    onHover({ o: candle.o, h: candle.h, l: candle.l, c: candle.c, label: clock(candle.t) || "now" });
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
      const len = lenRef.current;
      const edge = rightRef.current == null ? len + RIGHT_GAP : rightRef.current;
      commit(pinch.current.span * (pinch.current.dist / dist), edge, false);
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
        const shift = (-dx / Math.max(rect.width, 1)) * spanRef.current;
        let extra = 0;
        const seriesNow = seriesRef.current;
        if (seriesNow.length && (seriesNow[0]?.t ?? 0) < drag.current.first) {
          while (extra < seriesNow.length && (seriesNow[extra]?.t ?? 0) < drag.current.first) extra++;
        }
        commit(spanRef.current, drag.current.right + extra + shift, false);
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
    const len = lenRef.current;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      right: rightRef.current == null ? len + RIGHT_GAP : rightRef.current,
      yScale: yScaleRef.current,
      yShift: yShiftRef.current,
      axis: point.px > plotRight,
      first: seriesRef.current[0]?.t ?? 0,
    };
    setDragging(true);
  }

  function release(event: PointerEvent<SVGSVGElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      const active = drag.current;
      drag.current = null;
      setDragging(false);
      if (active && !active.axis) {
        const len = lenRef.current;
        if (rightRef.current != null && rightRef.current >= len + RIGHT_GAP - 0.5) {
          rightRef.current = null;
          setRight(null);
        }
      }
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
    const len = lenRef.current;
    const spanNow = spanRef.current || defaultSpan(frame);
    const edge = rightRef.current == null ? len + RIGHT_GAP : rightRef.current;
    const step = Math.max(1, Math.round(spanNow / 8));
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      commit(spanNow, edge - step, false);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      commit(spanNow, edge + step);
    } else if (event.key === "ArrowUp" || event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(1 / 1.2, 1);
    } else if (event.key === "ArrowDown" || event.key === "-" || event.key === "_") {
      event.preventDefault();
      zoomBy(1.2, 1);
    } else if (event.key === "0") {
      reset();
    }
  }

  function reset() {
    setSpan(null);
    setRight(null);
    setYScale(1);
    setYShift(0);
    spanRef.current = defaultSpan(frame);
    rightRef.current = null;
    yScaleRef.current = 1;
    yShiftRef.current = 0;
  }

  if (all.length < 2) {
    return <div className="grid h-80 place-items-center px-6 text-center text-sm text-muted">Loading price history…</div>;
  }

  const timeMarks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div
      ref={frameRef}
      className="chart-frame relative h-80 touch-none overflow-hidden outline-none select-none sm:h-[28rem]"
      onKeyDown={key}
      onPointerLeave={leave}
      tabIndex={0}
      data-span={data.length}
      data-loaded={all.length}
      data-start={Math.round(start)}
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
        aria-label="Price chart. Drag to move through earlier candles, scroll to resize, drag the price scale to zoom price."
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
          const x = xAt(from + index);
          const bodyTop = y(Math.max(candle.o, candle.c));
          const bodyBot = y(Math.min(candle.o, candle.c));
          const bodyH = Math.max(0.8, bodyBot - bodyTop);
          const bar = Math.max(1, (vols[index] / maxVol) * volH);
          return (
            <g key={`${candle.t ?? index}-${index}`}>
              <line x1={x} x2={x} y1={y(candle.h)} y2={y(candle.l)} stroke={color} strokeWidth={Math.max(1, bodyW * 0.18)} />
              <rect x={x - bodyW / 2} y={bodyTop} width={bodyW} height={bodyH} fill={color} />
              <rect x={x - bodyW / 2} y={volTop + volH - bar} width={bodyW} height={bar} fill={color} opacity="0.85" />
            </g>
          );
        })}
        <line x1={pad.l} x2={plotRight} y1={y(quote)} y2={y(quote)} stroke={lastUp ? UP : DOWN} strokeDasharray="3 3" strokeOpacity="0.85" />
        {hover !== null && data[hover] && (
          <line x1={xAt(from + hover)} x2={xAt(from + hover)} y1={pad.t} y2={height - pad.b} stroke="rgba(255,255,255,0.45)" strokeDasharray="2 3" />
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
      {timeMarks.map((step) => {
        const seriesIndex = start + step * Math.max(wanted - 1, 1);
        return (
          <span
            key={step}
            className="pointer-events-none absolute bottom-1 -translate-x-1/2 font-mono text-[10px] text-[#8b8b8b]"
            style={{ left: `${(xAt(seriesIndex) / width) * 100}%` }}
          >
            {clock(timeAt(seriesIndex))}
          </span>
        );
      })}
    </div>
  );
}
