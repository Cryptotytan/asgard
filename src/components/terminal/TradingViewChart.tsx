import { useEffect, useRef, useState } from "react";
import { tradingViewPerp, tradingViewSpot } from "@/lib/tv";

const SCRIPT = "https://widgets.tradingview-widget.com/w/en/tv-advanced-chart.js";

function ensureScript() {
  if (document.querySelector("script[data-asgard-tv]")) return;
  const script = document.createElement("script");
  script.type = "module";
  script.src = SCRIPT;
  script.dataset.asgardTv = "1";
  document.head.append(script);
}

export function TradingViewChart({ symbol, market = "perp" }: { symbol: string; market?: "spot" | "perp" }) {
  const host = useRef<HTMLDivElement>(null);
  const plotted = market === "spot" ? tradingViewSpot(symbol) : tradingViewPerp(symbol);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const apply = () => setDesktop(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!plotted) return;
    ensureScript();
    const node = host.current;
    if (!node) return;
    const chart = document.createElement("tv-advanced-chart");
    chart.setAttribute("symbol", plotted);
    chart.setAttribute("interval", "15");
    chart.setAttribute("theme", "dark");
    chart.setAttribute("chart-type", "candles");
    chart.setAttribute("timezone", "Etc/UTC");
    chart.setAttribute("allow-symbol-change", "false");
    chart.setAttribute("autosize", "");
    chart.setAttribute("hide-legend", "");
    if (desktop) {
      chart.setAttribute("show-drawing-toolbar", "");
      chart.setAttribute("show-date-ranges", "");
    } else {
      chart.setAttribute("hide-side-toolbar", "");
    }
    chart.style.display = "block";
    chart.style.position = "absolute";
    chart.style.inset = "0";
    chart.style.width = "100%";
    chart.style.height = "100%";
    node.replaceChildren(chart);
    return () => node.replaceChildren();
  }, [plotted, desktop]);

  if (!plotted) {
    return <p className="px-3 py-8 text-sm text-muted sm:px-4">{symbol} is not on TradingView.</p>;
  }

  return (
    <div className="w-full">
      <div ref={host} className="relative h-[340px] min-h-[340px] w-full bg-black sm:h-[440px] lg:h-[560px]" />
    </div>
  );
}