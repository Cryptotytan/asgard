import { chainByLabel } from "@/lib/chains";
import { ensureEvmAllowance, sendEvmCall } from "@/lib/foreign-wallet";
import { parseUnits } from "@/lib/intents";
import type { Token } from "@/lib/market";

const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const KYBER: Record<number, string> = {
  1: "ethereum",
  10: "optimism",
  56: "bsc",
  100: "gnosis",
  137: "polygon",
  8453: "base",
  42161: "arbitrum",
  43114: "avalanche",
  534352: "scroll",
  80094: "berachain",
};
const PARASWAP = new Set([1, 10, 56, 100, 137, 8453, 42161, 43114, 534352]);

export type BuiltSwap = {
  id: string;
  name: string;
  kind: "Swap";
  feeBps: number;
  impact: number;
  receive: number;
  eta: string;
  execute: () => Promise<{ status: string; amountOutHuman: number }>;
};

type Side = { chainId: number; address: string; decimals: number; chain: string; native: boolean };

function sideOf(token: Token): Side | null {
  const meta = chainByLabel(token.chain);
  if (!meta || meta.kind !== "evm" || !meta.chainId || token.decimals == null) return null;
  const raw = token.address && /^0x[a-fA-F0-9]{40}$/.test(token.address) ? token.address : "";
  const native = !raw || raw.toLowerCase() === "0x0000000000000000000000000000000000000000";
  return { chainId: meta.chainId, address: native ? NATIVE : raw, decimals: token.decimals, chain: token.chain, native };
}

function cost(inUsd: number, outUsd: number, gasUsd = 0) {
  if (!(inUsd > 0) || !(outUsd > 0)) return 0;
  return Math.max(0, ((inUsd - outUsd + Math.max(0, gasUsd)) / inUsd) * 100);
}

function label(exchange: string) {
  const clean = exchange.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
  return clean.replace(/V3/g, "v3").replace(/V2/g, "v2");
}

async function kyber(from: Side, to: Side, units: string, sender: string, recipient: string, amount: string): Promise<BuiltSwap | null> {
  const slug = KYBER[from.chainId];
  if (!slug) return null;
  const quote = async () => {
    const response = await fetch(`https://aggregator-api.kyberswap.com/${slug}/api/v1/routes?tokenIn=${from.address}&tokenOut=${to.address}&amountIn=${units}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { routeSummary?: KyberSummary } };
    return body.data?.routeSummary ?? null;
  };
  const summary = await quote();
  const out = Number(summary?.amountOut);
  if (!summary || !(out > 0)) return null;
  const receive = out / 10 ** to.decimals;
  const impact = cost(Number(summary.amountInUsd), Number(summary.amountOutUsd), Number(summary.gasUsd));
  const venue = summary.route?.[0]?.[0]?.exchange;
  return {
    id: `kyber:${venue ?? slug}`,
    name: venue ? `Kyber · ${label(venue)}` : "KyberSwap",
    kind: "Swap" as const,
    feeBps: Math.round(impact * 100),
    impact,
    receive,
    eta: "live",
    execute: async () => {
      const freshUnits = parseUnits(amount, from.decimals);
      const fresh = (freshUnits && (await quote())) || summary;
      const built = await fetch(`https://aggregator-api.kyberswap.com/${slug}/api/v1/route/build`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ routeSummary: fresh, sender, recipient, slippageTolerance: 50 }),
      });
      if (!built.ok) throw new Error("KyberSwap did not return a transaction. Nothing was sent.");
      const body = (await built.json()) as { data?: { routerAddress?: string; data?: string; transactionValue?: string; amountOut?: string } };
      const tx = body.data;
      if (!tx?.routerAddress || !tx.data) throw new Error("KyberSwap did not return a transaction. Nothing was sent.");
      if (!from.native) await ensureEvmAllowance(from.chain, from.address, tx.routerAddress, fresh.amountIn);
      const hash = await sendEvmCall(from.chain, { to: tx.routerAddress, data: tx.data, value: tx.transactionValue });
      const got = Number(tx.amountOut || fresh.amountOut);
      return { status: hash, amountOutHuman: got > 0 ? got / 10 ** to.decimals : receive };
    },
  };
}

async function paraswap(from: Side, to: Side, units: string, sender: string, recipient: string, amount: string): Promise<BuiltSwap | null> {
  if (!PARASWAP.has(from.chainId)) return null;
  const quote = async (nextUnits: string) => {
    const url = `https://apiv5.paraswap.io/prices?srcToken=${from.address}&destToken=${to.address}&amount=${nextUnits}&srcDecimals=${from.decimals}&destDecimals=${to.decimals}&side=SELL&network=${from.chainId}&userAddress=${sender}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const body = (await response.json()) as { priceRoute?: ParaRoute };
    return body.priceRoute ?? null;
  };
  const route = await quote(units);
  const out = Number(route?.destAmount);
  if (!route || !(out > 0)) return null;
  const receive = out / 10 ** to.decimals;
  const impact = cost(Number(route.srcUSD), Number(route.destUSD), Number(route.gasCostUSD));
  const venue = route.bestRoute?.[0]?.swaps?.[0]?.swapExchanges?.[0]?.exchange;
  return {
    id: `paraswap:${venue ?? from.chainId}`,
    name: venue ? `ParaSwap · ${label(venue)}` : "ParaSwap",
    kind: "Swap" as const,
    feeBps: Math.round(impact * 100),
    impact,
    receive,
    eta: "live",
    execute: async () => {
      const freshUnits = parseUnits(amount, from.decimals) || units;
      const fresh = (await quote(freshUnits)) || route;
      const response = await fetch(`https://apiv5.paraswap.io/transactions/${from.chainId}?ignoreChecks=true`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          srcToken: fresh.srcToken,
          destToken: fresh.destToken,
          srcAmount: fresh.srcAmount,
          priceRoute: fresh,
          userAddress: sender,
          receiver: recipient,
          srcDecimals: from.decimals,
          destDecimals: to.decimals,
          slippage: 100,
        }),
      });
      if (!response.ok) throw new Error("ParaSwap did not return a transaction. Nothing was sent.");
      const tx = (await response.json()) as { to?: string; data?: string; value?: string };
      if (!tx.to || !tx.data) throw new Error("ParaSwap did not return a transaction. Nothing was sent.");
      if (!from.native) {
        const contracts = await fetch(`https://apiv5.paraswap.io/adapters/contracts?network=${from.chainId}`);
        const proxy = contracts.ok ? ((await contracts.json()) as { TokenTransferProxy?: string }).TokenTransferProxy : "";
        if (!proxy) throw new Error("ParaSwap did not return an approval target. Nothing was sent.");
        await ensureEvmAllowance(from.chain, from.address, proxy, fresh.srcAmount);
      }
      const hash = await sendEvmCall(from.chain, { to: tx.to, data: tx.data, value: tx.value });
      const got = Number(fresh.destAmount);
      return { status: hash, amountOutHuman: got > 0 ? got / 10 ** to.decimals : receive };
    },
  };
}

export async function evmDexRoutes(from: Token, to: Token, amount: string, sender: string, recipient: string): Promise<BuiltSwap[]> {
  if (from.chain !== to.chain) return [];
  const origin = sideOf(from);
  const destination = sideOf(to);
  if (!origin || !destination || origin.chainId !== destination.chainId) return [];
  if (origin.address.toLowerCase() === destination.address.toLowerCase()) return [];
  const units = parseUnits(amount, origin.decimals);
  if (!units) return [];
  const found = await Promise.all([
    kyber(origin, destination, units, sender, recipient, amount).catch(() => null),
    paraswap(origin, destination, units, sender, recipient, amount).catch(() => null),
  ]);
  return found.filter((route): route is BuiltSwap => Boolean(route && route.receive > 0));
}

type KyberSummary = {
  amountIn: string;
  amountInUsd?: string;
  amountOut?: string;
  amountOutUsd?: string;
  gasUsd?: string;
  route?: { exchange?: string }[][];
};

type ParaRoute = {
  srcToken: string;
  destToken: string;
  srcAmount: string;
  destAmount?: string;
  srcUSD?: string;
  destUSD?: string;
  gasCostUSD?: string;
  bestRoute?: { swaps?: { swapExchanges?: { exchange?: string }[] }[] }[];
};
