import { useEffect, useRef } from "react";

const SCRIPT = "https://widgets.tradingview-widget.com/w/en/tv-advanced-chart.js";

const LISTED: Record<string, string> = {
  NEAR: "BINANCE:NEARUSDT",
  WNEAR: "BINANCE:NEARUSDT",
  ETH: "BINANCE:ETHUSDT",
  WETH: "BINANCE:ETHUSDT",
  WBTC: "BINANCE:BTCUSDT",
  BTC: "BINANCE:BTCUSDT",
  USDC: "BINANCE:USDCUSDT",
  USDT: "CRYPTOCAP:USDT",
  AURORA: "BYBIT:AURORAUSDT",
  SWEAT: "BYBIT:SWEATUSDT",
};

export function tradingViewSymbol(symbol: string) {
  return LISTED[symbol.toUpperCase()] ?? "";
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
  const listed = tradingViewSymbol(symbol);
  const plotted = listed || "BINANCE:NEARUSDT";

  useEffect(() => {
    ensureScript();
    const node = host.current;
    if (!node) return;
    const chart = document.createElement("tv-advanced-chart");
    chart.setAttribute("symbol", plotted);
    chart.setAttribute("interval", "1D");
    chart.setAttribute("theme", "dark");
    chart.setAttribute("chart-type", "candles");
    chart.setAttribute("timezone", "Etc/UTC");
    chart.setAttribute("allow-symbol-change", "true");
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

  return (
    <div className="w-full">
      {!listed && (
        <p className="px-3 pb-1 text-[11px] text-muted sm:px-4">{symbol} is not listed on TradingView. The terminal is open on NEAR so you can search a listed market.</p>
      )}
      <div ref={host} className="h-[480px] w-full sm:h-[560px]" />
      <p className="px-3 py-1 text-[10px] text-muted sm:px-4">
        <a className="underline" href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(plotted)}`} target="_blank" rel="noreferrer">
          Chart
        </a>{" "}
        by TradingView
      </p>
    </div>
  );
}
