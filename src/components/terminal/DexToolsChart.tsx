import { useEffect, useState } from "react";
import { knownPool } from "@/lib/dex";
import type { Token } from "@/lib/market";

const FROM_LABEL: Record<string, string> = {
  Ethereum: "ether",
  BNB: "bnb",
  Polygon: "polygon",
  Arbitrum: "arbitrum",
  Optimism: "optimism",
  Base: "base",
  Avalanche: "avalanche",
  Solana: "solana",
  Gnosis: "gnosis",
  Aurora: "aurora",
  Berachain: "berachain",
  Abstract: "abstract",
  Monad: "monad",
  Plasma: "plasma",
  NEAR: "near",
  TON: "ton",
  Sui: "sui",
  Aptos: "aptos",
  Tron: "tron",
  "X Layer": "xlayer",
};

const FROM_SLUG: Record<string, string> = {
  ethereum: "ether",
  bsc: "bnb",
  polygon: "polygon",
  arbitrum: "arbitrum",
  optimism: "optimism",
  base: "base",
  avalanche: "avalanche",
  solana: "solana",
  gnosis: "gnosis",
  aurora: "aurora",
  berachain: "berachain",
  abstract: "abstract",
  monad: "monad",
  plasma: "plasma",
  near: "near",
  ton: "ton",
  sui: "sui",
  aptos: "aptos",
  tron: "tron",
  xlayer: "xlayer",
};

type Pair = {
  chainId?: string;
  pairAddress?: string;
  baseToken?: { address?: string; symbol?: string };
  liquidity?: { usd?: number };
};

function frame(chain: string, pool: string) {
  return `https://www.dextools.io/widget-chart/en/${chain}/pe-light/${pool}?theme=dark&chartType=1&chartResolution=15&drawingToolbars=false&chartInUsd=true&tvPlatformColor=000000&tvPaneColor=000000&headerColor=000000`;
}

function sameAddress(left: string, right: string) {
  if (left.startsWith("0x") || right.startsWith("0x")) return left.toLowerCase() === right.toLowerCase();
  return left === right;
}

function bareAddress(raw: string) {
  return raw.trim().replace(/^(nep141:|nep245:)/i, "");
}

export function DexToolsChart({ token }: { token: Token }) {
  const chain = FROM_LABEL[token.chain] ?? "";
  const address = bareAddress(token.address ?? "");
  const pool = address ? knownPool(token.chain, address) : "";
  const [src, setSrc] = useState("");
  const [miss, setMiss] = useState(false);

  useEffect(() => {
    let cancel = false;
    const hinted = chain && address && pool ? frame(chain, pool) : "";
    setMiss(false);
    setSrc(hinted);
    if (!address || address.includes(" ") || address.includes(":")) {
      if (!hinted) setMiss(true);
      return;
    }
    const key = `asgard-dextools:v4:${token.chain}:${address}`;
    void (async () => {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`).catch(() => null);
      if (cancel) return;
      if (!response?.ok) {
        if (!hinted) setMiss(true);
        return;
      }
      const body = (await response.json()) as { pairs?: Pair[] } | Pair[];
      const pairs = Array.isArray(body) ? body : body.pairs ?? [];
      const ranked = pairs
        .filter((pair) => pair.pairAddress && FROM_SLUG[pair.chainId ?? ""])
        .filter((pair) => !chain || FROM_SLUG[pair.chainId ?? ""] === chain)
        .filter((pair) => sameAddress(pair.baseToken?.address ?? "", address))
        .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
      const pair = ranked[0];
      const nextChain = pair ? FROM_SLUG[pair.chainId ?? ""] : "";
      if (!pair?.pairAddress || !nextChain) {
        if (!hinted && !cancel) setMiss(true);
        return;
      }
      const next = frame(nextChain, pair.pairAddress);
      sessionStorage.setItem(key, next);
      if (!cancel) setSrc(next);
    })();
    return () => {
      cancel = true;
    };
  }, [address, chain, pool, token.symbol]);

  if (!src) {
    return (
      <div className="grid h-[340px] place-items-center bg-black px-4 text-center text-sm text-muted sm:h-[440px] lg:h-[560px]">
        {miss ? `No DexTools pool for ${token.symbol} yet.` : `Loading ${token.symbol} chart…`}
      </div>
    );
  }

  return (
    <div className="relative h-[340px] overflow-hidden bg-black sm:h-[440px] lg:h-[560px]">
      <iframe
        key={src}
        title={`${token.symbol} on DexTools`}
        src={src}
        className="absolute left-0 w-full border-0 bg-black"
        style={{ top: -52, height: "calc(100% + 52px)" }}
        loading="eager"
      />
    </div>
  );
}
