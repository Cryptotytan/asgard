import { useEffect, useState } from "react";
import type { Token } from "@/lib/market";

const CHAIN: Record<string, string> = {
  ethereum: "ether",
  bsc: "bnb",
  polygon: "polygon",
  arbitrum: "arbitrum",
  optimism: "optimism",
  base: "base",
  avalanche: "avalanche",
  solana: "solana",
  fantom: "fantom",
  cronos: "cronos",
  gnosis: "gnosis",
  scroll: "scroll",
  blast: "blast",
  linea: "linea",
  zksync: "zksync",
  mantle: "mantle",
  pulse: "pulse",
  near: "near",
  ton: "ton",
  sui: "sui",
  aptos: "aptos",
  tron: "tron",
  berachain: "berachain",
  abstract: "abstract",
  monad: "monad",
  aurora: "aurora",
  xlayer: "xlayer",
};

type Pair = { chainId?: string; pairAddress?: string; baseToken?: { address?: string; symbol?: string }; liquidity?: { usd?: number } };

export function DexToolsChart({ token }: { token: Token }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let cancel = false;
    const key = `asgard-dextools:${token.chain}:${token.address || token.symbol}`;
    const cached = sessionStorage.getItem(key);
    if (cached) {
      setSrc(cached);
      return;
    }
    setSrc("");
    void (async () => {
      const address = token.address && !token.address.includes(":") ? token.address : "";
      const url = address
        ? `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`
        : `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(token.symbol.split(".")[0] || token.symbol)}`;
      const response = await fetch(url).catch(() => null);
      if (!response?.ok) return;
      const body = (await response.json()) as { pairs?: Pair[] } | Pair[];
      const pairs = Array.isArray(body) ? body : body.pairs ?? [];
      const wanted = (token.symbol.split(".")[0] || token.symbol).toUpperCase();
      const ranked = pairs
        .filter((pair) => pair.pairAddress && CHAIN[pair.chainId ?? ""])
        .filter((pair) => !address || pair.baseToken?.address?.toLowerCase() === address.toLowerCase() || pair.baseToken?.symbol?.toUpperCase() === wanted)
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
      const pair = ranked[0];
      if (!pair?.pairAddress || !pair.chainId) return;
      const frame = `https://www.dextools.io/widget-chart/en/${CHAIN[pair.chainId]}/pe-${pair.pairAddress}?theme=dark&chartType=1&chartResolution=15&drawingToolbars=false`;
      sessionStorage.setItem(key, frame);
      if (!cancel) setSrc(frame);
    })();
    return () => {
      cancel = true;
    };
  }, [token.address, token.chain, token.symbol]);

  if (!src) {
    return <div className="grid h-[340px] place-items-center bg-black text-sm text-muted sm:h-[440px] lg:h-[560px]">Loading chart…</div>;
  }

  return (
    <iframe
      title={`${token.symbol} chart`}
      src={src}
      className="h-[340px] w-full border-0 bg-black sm:h-[440px] lg:h-[560px]"
      loading="eager"
    />
  );
}
