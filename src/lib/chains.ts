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
  { id: "base", label: "Base", kind: "evm", chainId: 8453, rpc: "https://mainnet.base.org", icon: "/chains/base.png" },
  { id: "arb", label: "Arbitrum", kind: "evm", chainId: 42161, rpc: "https://arb1.arbitrum.io/rpc", icon: "/chains/arbitrum.png" },
  { id: "op", label: "Optimism", kind: "evm", chainId: 10, rpc: "https://mainnet.optimism.io", icon: "/chains/optimism.png" },
  { id: "bsc", label: "BNB", kind: "evm", chainId: 56, rpc: "https://bsc-dataseed.binance.org", icon: "/chains/bnb.png" },
  { id: "pol", label: "Polygon", kind: "evm", chainId: 137, rpc: "https://polygon-rpc.com", icon: "/chains/polygon.png" },
  { id: "avax", label: "Avalanche", kind: "evm", chainId: 43114, rpc: "https://api.avax.network/ext/bc/C/rpc", icon: "/chains/avalanche.png" },
  { id: "gnosis", label: "Gnosis", kind: "evm", chainId: 100, rpc: "https://rpc.gnosischain.com", icon: "/chains/gnosis.png" },
  { id: "scroll", label: "Scroll", kind: "evm", chainId: 534352, rpc: "https://rpc.scroll.io", icon: "/chains/scroll.png" },
  { id: "bera", label: "Berachain", kind: "evm", chainId: 80094, rpc: "https://rpc.berachain.com", icon: "/chains/bera.png" },
  { id: "xlayer", label: "X Layer", kind: "evm", chainId: 196, rpc: "https://rpc.xlayer.tech", icon: "/chains/xlayer.jpg" },
  { id: "sol", label: "Solana", kind: "sol", icon: "/chains/solana.png" },
  { id: "btc", label: "Bitcoin", kind: "btc", icon: "/chains/bitcoin.png" },
  { id: "tron", label: "Tron", kind: "other", icon: "/chains/tron.png" },
  { id: "sui", label: "Sui", kind: "other", icon: "/chains/sui.png" },
  { id: "aptos", label: "Aptos", kind: "other", icon: "/chains/aptos.png" },
  { id: "doge", label: "Dogecoin", kind: "other", icon: "/chains/doge.png" },
  { id: "xrp", label: "XRP", kind: "other", icon: "/chains/xrp.png" },
  { id: "ltc", label: "Litecoin", kind: "other", icon: "/chains/ltc.png" },
  { id: "bch", label: "Bitcoin Cash", kind: "other", icon: "/chains/bch.png" },
  { id: "zec", label: "Zcash", kind: "other", icon: "/chains/zec.png" },
  { id: "cardano", label: "Cardano", kind: "other", icon: "/chains/cardano.png" },
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
