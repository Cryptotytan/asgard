import { useEffect, useRef, useState } from "react";
import { loadDexPair } from "@/lib/dex";

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

type ChartToken = { symbol: string; address?: string; pair?: string };

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

function TvChart({ symbol }: { symbol: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensureScript();
    const node = host.current;
    if (!node) return;
    const chart = document.createElement("tv-advanced-chart");
    chart.setAttribute("symbol", symbol);
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
  }, [symbol]);

  return (
    <div className="w-full">
      <div ref={host} className="h-[480px] w-full sm:h-[560px]" />
      <p className="px-3 py-1 text-[10px] text-muted sm:px-4">
        <a className="underline" href={`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(symbol)}`} target="_blank" rel="noreferrer">
          Chart
        </a>{" "}
        by TradingView
      </p>
    </div>
  );
}

function dexSrc(pair: string) {
  const query = new URLSearchParams({
    embed: "1",
    loadChartSettings: "0",
    trades: "0",
    tabs: "0",
    info: "0",
    chartLeftToolbar: "0",
    chartDefaultOnMobile: "1",
    chartTheme: "dark",
    theme: "dark",
    chartStyle: "1",
    chartType: "usd",
    interval: "15",
  });
  return `https://dexscreener.com/near/${pair}?${query.toString()}`;
}

function DexChart({ token }: { token: ChartToken }) {
  const [pair, setPair] = useState(token.pair ?? "");
  const [miss, setMiss] = useState(false);

  useEffect(() => {
    let cancel = false;
    if (token.pair) {
      setPair(token.pair);
      setMiss(false);
      return;
    }
    setPair("");
    setMiss(false);
    if (!token.address) {
      setMiss(true);
      return;
    }
    void loadDexPair(token.address)
      .then((id) => {
        if (cancel) return;
        if (!id) setMiss(true);
        else setPair(id);
      })
      .catch(() => {
        if (!cancel) setMiss(true);
      });
    return () => {
      cancel = true;
    };
  }, [token.address, token.pair, token.symbol]);

  if (miss) {
    return <p className="px-3 py-8 text-sm text-muted sm:px-4">DexScreener has no NEAR chart for {token.symbol}.</p>;
  }
  if (!pair) {
    return <p className="px-3 py-8 text-sm text-muted sm:px-4">Loading the DexScreener chart…</p>;
  }
  return (
    <iframe
      title={`${token.symbol} chart`}
      src={dexSrc(pair)}
      className="h-[480px] w-full border-0 bg-black sm:h-[560px]"
      loading="eager"
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}

export function TradingViewChart({ token }: { token: ChartToken }) {
  const listed = tradingViewSymbol(token.symbol);
  if (listed) return <TvChart symbol={listed} />;
  return <DexChart token={token} />;
}
