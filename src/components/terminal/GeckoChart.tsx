import { geckoNetwork } from "@/lib/live";
import type { Token } from "@/lib/market";

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
  const network = geckoNetwork(token.chain);
  const address = geckoAddress(token.address ?? "");
  const resolution = RESOLUTION[frame] ?? "15m";
  const src =
    network && address
      ? `https://www.geckoterminal.com/${network}/tokens/${encodeURIComponent(address)}?embed=1&info=0&swaps=0&light_chart=0&chart_type=price&resolution=${resolution}&bg_color=000000`
      : "";

  if (!src) {
    return (
      <div className="grid h-[304px] place-items-center bg-black px-4 text-center text-sm text-muted sm:h-[404px] lg:h-[524px]">
        No GeckoTerminal chart for {token.symbol} yet.
      </div>
    );
  }

  return (
    <div className="relative h-[304px] overflow-hidden bg-black sm:h-[404px] lg:h-[524px]">
      <iframe
        key={src}
        title={`${token.symbol} price on GeckoTerminal`}
        src={src}
        className="absolute left-0 top-0 w-full border-0 bg-black"
        style={{ height: "calc(100% + 41px)" }}
        loading="eager"
        allow="clipboard-write; fullscreen"
      />
    </div>
  );
}
