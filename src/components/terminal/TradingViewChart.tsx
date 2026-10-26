import { useEffect, useRef } from "react";

const SCRIPT = "https://widgets.tradingview-widget.com/w/en/tv-advanced-chart.js";

const PERPS: Record<string, string> = {
  NEAR: "BINANCE:NEARUSDT.P",
  WNEAR: "BINANCE:NEARUSDT.P",
  ETH: "BINANCE:ETHUSDT.P",
  WETH: "BINANCE:ETHUSDT.P",
  BTC: "BINANCE:BTCUSDT.P",
  WBTC: "BINANCE:BTCUSDT.P",
};

const SKIP = new Set(["SPX500", "NAS100", "XAU", "XAG", "CL", "EURUSD", "USDJPY", "NVDA", "TSLA", "GOOGL"]);

export function tradingViewPerp(symbol: string) {
  const base = symbol.split(".")[0]?.toUpperCase() ?? "";
  if (!base || SKIP.has(base)) return "";
  if (PERPS[base]) return PERPS[base];
  if (!/^[A-Z0-9]{2,15}$/.test(base)) return "";
  return `BINANCE:${base}USDT.P`;
}

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
  const perp = tradingViewPerp(symbol);
  const plotted = market === "spot" ? perp.replace(/\.P$/, "") : perp;

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
    chart.setAttribute("show-drawing-toolbar", "true");
    chart.setAttribute("show-date-ranges", "true");
    chart.setAttribute("hide-top-toolbar", "false");
    chart.style.display = "block";
    chart.style.width = "100%";
    chart.style.height = "100%";
    node.replaceChildren(chart);
    return () => node.replaceChildren();
  }, [plotted]);

  if (!plotted) {
    return <p className="px-3 py-8 text-sm text-muted sm:px-4">{symbol} has no perpetual chart.</p>;
  }

  return (
    <div className="w-full">
      <div ref={host} className="h-[220px] w-full bg-black sm:h-[420px] lg:h-[560px]" />
      <p className="hidden px-3 py-1 text-[10px] text-muted sm:block sm:px-4">
        <a className="underline" href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(plotted)}`} target="_blank" rel="noreferrer">
          Chart
        </a>{" "}
        by TradingView · {plotted}
      </p>
    </div>
  );
}
