import { useCallback, useEffect } from "react";
import { CandleChart } from "@/components/terminal/CandleChart";
import { candleMeta, geckoNetwork, liveCandles, loadOlderCandles, watchCandles } from "@/lib/live";
import type { Token } from "@/lib/market";
import { useDesk } from "@/lib/store";

const RESOLUTION: Record<string, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1H": "1h",
  "4H": "4h",
  "1D": "1d",
};

function geckoAddress(raw: string) {
  const bare = raw.trim().replace(/^(nep141:|nep245:)/i, "");
  if (!bare || bare.includes(" ") || bare.includes(":")) return "";
  return bare.startsWith("0x") ? bare.toLowerCase() : bare;
}

export function GeckoChart({ token, frame }: { token: Token; frame: string }) {
  useDesk((state) => state.clock);
  const network = geckoNetwork(token.chain);
  const address = geckoAddress(token.address ?? "");
  const resolution = RESOLUTION[frame] ?? "15m";
  const src =
    network && address
      ? `https://www.geckoterminal.com/${network}/tokens/${encodeURIComponent(address)}?embed=1&info=0&swaps=0&light_chart=0&chart_type=price&resolution=${resolution}`
      : "";
  const series = liveCandles(token.symbol, frame);
  const history = candleMeta(token.symbol, frame);
  const last = token.price > 0 ? token.price : (series?.[series.length - 1]?.c ?? 0);
  useEffect(() => {
    if (!src) watchCandles(token.symbol, frame);
  }, [src, token.symbol, frame]);
  const needOlder = useCallback(() => {
    void loadOlderCandles(token.symbol, frame);
  }, [token.symbol, frame]);

  if (src) {
    return (
      <div className="relative h-[304px] overflow-hidden bg-black sm:h-[404px] lg:h-[524px]">
        <svg className="pointer-events-none absolute h-0 w-0" aria-hidden>
          <filter id="gt-axis-white" colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              result="luma"
              values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"
            />
            <feComposite in="SourceGraphic" in2="luma" operator="difference" result="diff" />
            <feColorMatrix in="diff" type="matrix" result="sat" values="1 1 1 0 0  1 1 1 0 0  1 1 1 0 0  0 0 0 1 0" />
            <feComponentTransfer in="sat" result="gray">
              <feFuncR type="linear" slope="-3" intercept="1" />
              <feFuncG type="linear" slope="-3" intercept="1" />
              <feFuncB type="linear" slope="-3" intercept="1" />
            </feComponentTransfer>
            <feComponentTransfer in="luma" result="mid">
              <feFuncR type="gamma" amplitude="80" exponent="2" offset="0" />
              <feFuncG type="gamma" amplitude="80" exponent="2" offset="0" />
              <feFuncB type="gamma" amplitude="80" exponent="2" offset="0" />
            </feComponentTransfer>
            <feComposite in="gray" in2="mid" operator="arithmetic" k1="1" k2="0" k3="0" k4="0" result="mask" />
            <feColorMatrix in="mask" type="matrix" result="maskA" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.333 0.333 0.333 0 0" />
            <feComposite in="maskA" in2="SourceGraphic" operator="over" />
          </filter>
        </svg>
        <iframe
          key={src}
          title={`${token.symbol} price`}
          src={src}
          className="absolute left-0 top-0 w-full border-0 bg-black"
          style={{ height: "calc(100% + 41px)", filter: "url(#gt-axis-white)" }}
          loading="eager"
        />
      </div>
    );
  }

  return (
    <CandleChart
      seed={`${token.symbol}-${frame}`}
      last={last}
      frame={frame}
      series={series}
      live={last}
      historyEnded={history.exhausted}
      historyTick={history.from}
      onNeedHistory={needOlder}
      className="h-[304px] sm:h-[404px] lg:h-[524px]"
    />
  );
}