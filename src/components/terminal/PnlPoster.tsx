import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { px } from "@/lib/market";

const GODS = [
  { name: "Thor", src: "/gods/thor.jpg" },
  { name: "Loki", src: "/gods/loki.jpg" },
] as const;

let godCache: Promise<HTMLImageElement[]> | null = null;

function loadGods() {
  if (!godCache) {
    godCache = Promise.all(
      GODS.map(
        (god) =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error(god.name));
            image.src = god.src;
          }),
      ),
    );
  }
  return godCache;
}

export type PosterData = {
  market: string;
  side: "long" | "short";
  leverage: number;
  pnl: number;
  roe: number;
  entry: number;
  mark: number;
};

export function PnlPoster({ data, onClose }: { data: PosterData; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [showPnl, setShowPnl] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    setReady(false);
    void Promise.all([document.fonts.ready, loadGods().catch(() => [] as HTMLImageElement[])]).then(([, gods]) => {
      if (cancelled || !canvasRef.current) return;
      paint(canvasRef.current, data, showPnl, gods);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [data, showPnl]);

  function download() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `asgard-${data.market.toLowerCase()}-pnl.png`;
    link.click();
  }

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-bg/80 p-3" onClick={onClose}>
      <div className="poster-turn panel w-full max-w-sm p-3" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="PnL card">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold">Share PnL</p>
          <button type="button" onClick={onClose} className="h-8 px-2 text-xs text-muted">
            Close
          </button>
        </div>
        <canvas ref={canvasRef} className="mx-auto block h-auto w-full max-w-[280px] rounded-xl" />
        <label className="mt-3 flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={showPnl} onChange={(event) => setShowPnl(event.target.checked)} className="size-4" />
          Show profit amount
        </label>
        <button
          type="button"
          disabled={!ready}
          onClick={download}
          className="mt-3 h-11 w-full rounded-xl bg-primary font-semibold text-primary-fg disabled:opacity-40"
        >
          Download
        </button>
      </div>
    </div>,
    document.body,
  );
}

function paint(canvas: HTMLCanvasElement, data: PosterData, showPnl: boolean, gods: HTMLImageElement[]) {
  const w = 1080;
  const h = 1440;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const up = data.pnl >= 0;
  const accent = up ? "#00ec97" : "#ff7966";

  ctx.fillStyle = "#050806";
  ctx.fillRect(0, 0, w, h);

  const glow = ctx.createRadialGradient(920, 260, 20, 920, 260, 640);
  glow.addColorStop(0, up ? "rgba(0,236,151,0.38)" : "rgba(255,121,102,0.34)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(242,241,233,0.045)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 72) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += 72) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const featured = gods[up ? 0 : 1];
  if (featured) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.9;
    ctx.drawImage(fadeFigure(featured, 680, 920), 460, 40);
    ctx.restore();
  }

  ctx.save();
  ctx.translate(96, 128);
  ctx.transform(1, 0, -0.24, 1, 0, 0);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 26, 62);
  ctx.restore();

  ctx.fillStyle = "#f2f1e9";
  ctx.font = "700 52px 'Schibsted Grotesk', sans-serif";
  ctx.fillText("Asgard", 156, 176);
  ctx.textAlign = "right";
  ctx.font = "500 28px 'IBM Plex Mono', monospace";
  const perp = "PERP";
  const perpW = ctx.measureText(perp).width;
  round(ctx, 984 - perpW - 18, 134, perpW + 32, 46, 14);
  ctx.fillStyle = "rgba(5,8,6,0.78)";
  ctx.fill();
  ctx.fillStyle = "#d5dbd4";
  ctx.fillText(perp, 978, 166);
  ctx.textAlign = "left";

  ctx.fillStyle = "#f2f1e9";
  ctx.font = "600 64px 'Schibsted Grotesk', sans-serif";
  ctx.fillText(data.market, 88, 360);

  const side = `${data.side.toUpperCase()}  ${data.leverage}X`;
  ctx.font = "600 32px 'Schibsted Grotesk', sans-serif";
  const pillW = ctx.measureText(side).width + 56;
  round(ctx, 88, 396, pillW, 68, 34);
  ctx.fillStyle = up ? "rgba(0,236,151,0.16)" : "rgba(255,121,102,0.16)";
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillText(side, 116, 442);

  const roe = `${data.roe >= 0 ? "+" : ""}${data.roe.toFixed(2)}%`;
  let size = 148;
  ctx.font = `700 ${size}px 'Schibsted Grotesk', sans-serif`;
  while (ctx.measureText(roe).width > 900 && size > 72) {
    size -= 6;
    ctx.font = `700 ${size}px 'Schibsted Grotesk', sans-serif`;
  }
  ctx.fillStyle = accent;
  ctx.fillText(roe, 84, 680);

  if (showPnl) {
    const amount = Math.abs(data.pnl).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    ctx.fillStyle = "#f2f1e9";
    ctx.font = "500 42px 'IBM Plex Mono', monospace";
    ctx.fillText(`PnL   ${data.pnl < 0 ? "-" : "+"}$${amount}`, 88, 770);
  }

  ctx.strokeStyle = "#2a302b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(88, 880);
  ctx.lineTo(992, 880);
  ctx.stroke();

  line(ctx, "Entry price", px(data.entry), 980);
  line(ctx, "Mark price", px(data.mark), 1080);

  const stamp = new Date().toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  ctx.fillStyle = "#8d938c";
  ctx.font = "400 28px 'IBM Plex Mono', monospace";
  ctx.fillText(stamp, 88, 1288);
  ctx.fillStyle = "#f2f1e9";
  ctx.font = "600 32px 'Schibsted Grotesk', sans-serif";
  ctx.fillText("Trade on Asgard", 88, 1348);
}

function fadeFigure(image: HTMLImageElement, w: number, h: number) {
  const board = document.createElement("canvas");
  board.width = w;
  board.height = h;
  const g = board.getContext("2d");
  if (!g) return board;
  const scale = Math.max(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  g.drawImage(image, (w - dw) / 2, 0, dw, dh);
  g.globalCompositeOperation = "destination-in";
  const side = g.createLinearGradient(0, 0, w * 0.55, 0);
  side.addColorStop(0, "transparent");
  side.addColorStop(1, "#000");
  g.fillStyle = side;
  g.fillRect(0, 0, w, h);
  const bottom = g.createLinearGradient(0, h * 0.58, 0, h);
  bottom.addColorStop(0, "#000");
  bottom.addColorStop(1, "transparent");
  g.fillStyle = bottom;
  g.fillRect(0, 0, w, h);
  return board;
}

function line(ctx: CanvasRenderingContext2D, label: string, value: string, y: number) {
  ctx.fillStyle = "#8d938c";
  ctx.font = "500 30px 'Schibsted Grotesk', sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(label, 88, y);
  ctx.fillStyle = "#f2f1e9";
  ctx.font = "500 40px 'IBM Plex Mono', monospace";
  ctx.textAlign = "right";
  ctx.fillText(value, 992, y);
  ctx.textAlign = "left";
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
