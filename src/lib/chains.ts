export type ChainKind = "near" | "evm" | "sol" | "btc" | "other";

export type ChainMeta = {
  id: string;
  label: string;
  kind: ChainKind;
  chainId?: number;
  rpc?: string;
  icon: string;
};

export const CHAINS_META: ChainMeta[] = [
  { id: "near", label: "NEAR", kind: "near", icon: "/tokens/near.svg" },
  { id: "eth", label: "Ethereum", kind: "evm", chainId: 1, rpc: "https://cloudflare-eth.com", icon: "/tokens/eth.png" },
  { id: "base", label: "Base", kind: "evm", chainId: 8453, rpc: "https://mainnet.base.org", icon: "https://assets.coingecko.com/coins/images/31164/small/base.png" },
  { id: "arb", label: "Arbitrum", kind: "evm", chainId: 42161, rpc: "https://arb1.arbitrum.io/rpc", icon: "https://assets.coingecko.com/coins/images/16547/small/arb.jpg" },
  { id: "op", label: "Optimism", kind: "evm", chainId: 10, rpc: "https://mainnet.optimism.io", icon: "https://assets.coingecko.com/coins/images/25244/small/Optimism.png" },
  { id: "bsc", label: "BNB", kind: "evm", chainId: 56, rpc: "https://bsc-dataseed.binance.org", icon: "https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png" },
  { id: "pol", label: "Polygon", kind: "evm", chainId: 137, rpc: "https://polygon-rpc.com", icon: "https://assets.coingecko.com/coins/images/4713/small/polygon.png" },
  { id: "avax", label: "Avalanche", kind: "evm", chainId: 43114, rpc: "https://api.avax.network/ext/bc/C/rpc", icon: "https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png" },
  { id: "gnosis", label: "Gnosis", kind: "evm", chainId: 100, rpc: "https://rpc.gnosischain.com", icon: "https://assets.coingecko.com/coins/images/11062/small/GNOSIS.png" },
  { id: "scroll", label: "Scroll", kind: "evm", chainId: 534352, rpc: "https://rpc.scroll.io", icon: "https://assets.coingecko.com/coins/images/50571/small/scroll.png" },
  { id: "bera", label: "Berachain", kind: "evm", chainId: 80094, rpc: "https://rpc.berachain.com", icon: "https://assets.coingecko.com/coins/images/25235/small/BERA.png" },
  { id: "xlayer", label: "X Layer", kind: "evm", chainId: 196, rpc: "https://rpc.xlayer.tech", icon: "https://assets.coingecko.com/coins/images/4463/small/okb.png" },
  { id: "sol", label: "Solana", kind: "sol", icon: "https://assets.coingecko.com/coins/images/4128/small/solana.png" },
  { id: "btc", label: "Bitcoin", kind: "btc", icon: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png" },
  { id: "tron", label: "Tron", kind: "other", icon: "https://assets.coingecko.com/coins/images/1094/small/tron-logo.png" },
  { id: "ton", label: "TON", kind: "other", icon: "https://assets.coingecko.com/coins/images/17980/small/ton_symbol.png" },
  { id: "sui", label: "Sui", kind: "other", icon: "https://assets.coingecko.com/coins/images/26375/small/sui_asset.jpeg" },
  { id: "aptos", label: "Aptos", kind: "other", icon: "https://assets.coingecko.com/coins/images/26455/small/aptos_round.png" },
  { id: "doge", label: "Dogecoin", kind: "other", icon: "https://assets.coingecko.com/coins/images/5/small/dogecoin.png" },
  { id: "xrp", label: "XRP", kind: "other", icon: "https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png" },
  { id: "ltc", label: "Litecoin", kind: "other", icon: "https://assets.coingecko.com/coins/images/2/small/litecoin.png" },
  { id: "bch", label: "Bitcoin Cash", kind: "other", icon: "https://assets.coingecko.com/coins/images/780/small/bitcoin-cash-circle.png" },
  { id: "zec", label: "Zcash", kind: "other", icon: "https://assets.coingecko.com/coins/images/486/small/circle-zcash-color.png" },
  { id: "cardano", label: "Cardano", kind: "other", icon: "https://assets.coingecko.com/coins/images/975/small/cardano.png" },
  { id: "aurora", label: "Aurora", kind: "evm", chainId: 1313161554, rpc: "https://mainnet.aurora.dev", icon: "/tokens/aurora.jpg" },
];

const BY_ID = new Map(CHAINS_META.map((chain) => [chain.id, chain]));
const BY_LABEL = new Map(CHAINS_META.map((chain) => [chain.label, chain]));

export function chainById(id: string) {
  return BY_ID.get(id) ?? null;
}

export function chainByLabel(label: string) {
  return BY_LABEL.get(label) ?? null;
}

export function chainLabel(id: string) {
  return BY_ID.get(id)?.label ?? id.toUpperCase();
}

export function chainIcon(label: string) {
  return BY_LABEL.get(label)?.icon ?? "";
}

export function canSign(label: string) {
  const kind = BY_LABEL.get(label)?.kind;
  return kind === "near" || kind === "evm" || kind === "sol" || kind === "btc";
}

export function validAddress(label: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const kind = BY_LABEL.get(label)?.kind ?? "other";
  if (kind === "evm") return /^0x[a-fA-F0-9]{40}$/.test(trimmed);
  if (kind === "near") return /^[a-f0-9]{64}$/.test(trimmed) || /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]{2,64}$/.test(trimmed);
  if (kind === "sol") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);
  if (kind === "btc") return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,80}$/.test(trimmed);
  return trimmed.length >= 8 && trimmed.length < 120 && !/\s/.test(trimmed);
}

const DEX_SLUG: Record<string, string> = {
  eth: "ethereum",
  base: "base",
  arb: "arbitrum",
  op: "optimism",
  bsc: "bsc",
  pol: "polygon",
  avax: "avalanche",
  gnosis: "gnosis",
  scroll: "scroll",
  sol: "solana",
  aurora: "aurora",
};

export function foreignIcon(blockchain: string, address?: string | null) {
  const slug = DEX_SLUG[blockchain];
  if (slug && address && /^0x[a-fA-F0-9]{40}$/.test(address)) return `https://cdn.dexscreener.com/tokens/${slug}/${address.toLowerCase()}.png`;
  if (slug === "solana" && address) return `https://cdn.dexscreener.com/tokens/solana/${address}.png`;
  return "";
}
