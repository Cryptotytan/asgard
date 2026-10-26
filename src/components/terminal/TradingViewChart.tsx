import { useEffect, useRef } from "react";

const SCRIPT = "https://widgets.tradingview-widget.com/w/en/tv-advanced-chart.js";

/** USDT-margined perpetuals. Spot pairs stay off this terminal. */
const PERPS: Record<string, string> = {
  NEAR: "BINANCE:NEARUSDT.P",
  WNEAR: "BINANCE:NEARUSDT.P",
  ETH: "BINANCE:ETHUSDT.P",
  WETH: "BINANCE:ETHUSDT.P",
};

export function tradingViewPerp(symbol: string) {
  const base = symbol.split(".")[0]?.toUpperCase() ?? "";
  return PERPS[base] ?? PERPS[symbol.toUpperCase()] ?? "";
}

function ensureScript() {
  if (document.querySelector("script[data-asgard-tv]")) return;
  const script = document.createElement("script");
  script.type = "module";
  script.src = SCRIPT;
  script.dataset.asgardTv = "1";
  document.head.append(script);
}

export function TradingViewChart({ symbol }: { symbol: string }) {
  const host = useRef<HTMLDivElement>(null);
  const plotted = tradingViewPerp(symbol);

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
    chart.setAttribute("show-details", "true");
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
      <div ref={host} className="h-[480px] w-full bg-black sm:h-[560px]" />
      <p className="px-3 py-1 text-[10px] text-muted sm:px-4">
        <a className="underline" href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(plotted)}`} target="_blank" rel="noreferrer">
          Chart
        </a>{" "}
        by TradingView · {plotted}
      </p>
    </div>
  );
}
