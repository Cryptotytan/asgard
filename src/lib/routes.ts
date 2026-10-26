import { chainByLabel, validAddress } from "@/lib/chains";
import { sendEvmCall, sendSolanaSerialized } from "@/lib/foreign-wallet";
import { executeIntent, parseUnits, quoteIntent } from "@/lib/intents";
import type { Token } from "@/lib/market";

const LIFI = "https://li.quest/v1/advanced";
const JUP = "https://lite-api.jup.ag/swap/v1";
const SOL_CHAIN = 1151111081099710;
const SOL_MINT = "So11111111111111111111111111111111111111112";
const EVM_NATIVE = "0x0000000000000000000000000000000000000000";

export type LiveRoute = {
  id: string;
  name: string;
  kind: "Swap" | "Bridge";
  feeBps: number;
  impact: number;
  receive: number;
  eta: string;
  execute: () => Promise<{ status: string; amountOutHuman: number }>;
};

type LifiStep = {
  id?: string;
  tool?: string;
  action?: { fromChainId?: number; fromAmount?: string };
  estimate?: { toAmount?: string; toAmountUSD?: string; feeCosts?: { amountUSD?: string }[]; gasCosts?: { amountUSD?: string }[] };
};

type LifiRoute = {
  id?: string;
  toAmount?: string;
  toAmountUSD?: string;
  fromAmountUSD?: string;
  steps?: LifiStep[];
};

function timeout<T>(promise: Promise<T>, ms: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function gap(inUsd: number, outUsd: number) {
  if (!(inUsd > 0) || !(outUsd > 0)) return 0;
  return Math.max(0, (1 - outUsd / inUsd) * 100);
}

function toolName(tool: string) {
  const known: Record<string, string> = {
    across: "Across",
    mayanFastMCTP: "Mayan",
    mayanMCTP: "Mayan",
    polymer: "Polymer",
    polymerStandard: "Polymer",
    relaydepository: "Relay",
    stargateV2: "Stargate",
    hop: "Hop",
    symbiosis: "Symbiosis",
    allbridge: "Allbridge",
    debridge: "deBridge",
  };
  return known[tool] ?? tool;
}

function lifiAsset(token: Token) {
  const meta = chainByLabel(token.chain);
  if (!meta || token.decimals == null) return null;
  if (meta.kind === "evm" && meta.chainId) {
    const address = token.address && /^0x[a-fA-F0-9]{40}$/.test(token.address) ? token.address : EVM_NATIVE;
    return { chainId: meta.chainId, address, decimals: token.decimals };
  }
  if (meta.kind === "sol") {
    const address = token.address && token.address.length >= 32 && !token.address.startsWith("0x") ? token.address : SOL_MINT;
    return { chainId: SOL_CHAIN, address, decimals: token.decimals };
  }
  return null;
}

function chainOf(chainId?: number) {
  if (chainId === SOL_CHAIN) return "Solana";
  const meta = chainId ? [...documentChains()].find((chain) => chain.chainId === chainId) : null;
  return meta?.label ?? "";
}

function documentChains() {
  return [
    { chainId: 1, label: "Ethereum" },
    { chainId: 8453, label: "Base" },
    { chainId: 42161, label: "Arbitrum" },
    { chainId: 10, label: "Optimism" },
    { chainId: 56, label: "BNB" },
    { chainId: 137, label: "Polygon" },
    { chainId: 43114, label: "Avalanche" },
    { chainId: 100, label: "Gnosis" },
    { chainId: 534352, label: "Scroll" },
    { chainId: 80094, label: "Berachain" },
    { chainId: 196, label: "X Layer" },
    { chainId: 1313161554, label: "Aurora" },
  ];
}

async function runLifi(steps: LifiStep[], fallback: string) {
  let hash = "";
  for (const step of steps) {
    const response = await fetch(`${LIFI}/stepTransaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(step),
    });
    if (!response.ok) throw new Error("That route expired. Nothing was sent.");
    const body = (await response.json()) as { transactionRequest?: { to?: string; data?: string; value?: string } };
    const tx = body.transactionRequest;
    if (!tx?.data) throw new Error("The route did not return a transaction. Nothing was sent.");
    const fromChain = step.action?.fromChainId;
    if (fromChain === SOL_CHAIN) hash = await sendSolanaSerialized(tx.data);
    else {
      if (!tx.to) throw new Error("The route did not return a transaction. Nothing was sent.");
      hash = await sendEvmCall(chainOf(fromChain) || fallback, { to: tx.to, data: tx.data, value: tx.value });
    }
  }
  return hash || "SENT";
}

async function reloadLifiSteps(from: Token, to: Token, amount: string, sender: string, recipient: string, name: string) {
  const origin = lifiAsset(from);
  const destination = lifiAsset(to);
  if (!origin || !destination) return null;
  const units = parseUnits(amount, origin.decimals);
  if (!units) return null;
  const response = await fetch(`${LIFI}/routes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fromChainId: origin.chainId,
      toChainId: destination.chainId,
      fromTokenAddress: origin.address,
      toTokenAddress: destination.address,
      fromAmount: units,
      fromAddress: sender,
      toAddress: recipient,
      options: { slippage: 0.01, maxPriceImpact: 0.05, order: "CHEAPEST" },
    }),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { routes?: LifiRoute[] };
  for (const route of body.routes ?? []) {
    const steps = route.steps ?? [];
    const tool = steps.map((step) => step.tool).filter(Boolean).join(" + ") || "Li.Fi";
    if (toolName(tool) === name) return steps;
  }
  return body.routes?.[0]?.steps ?? null;
}

async function lifiRoutes(from: Token, to: Token, amount: string, sender: string, recipient: string): Promise<LiveRoute[]> {
  const origin = lifiAsset(from);
  const destination = lifiAsset(to);
  if (!origin || !destination) return [];
  if (!validAddress(from.chain, sender) || !validAddress(to.chain, recipient)) return [];
  const units = parseUnits(amount, origin.decimals);
  if (!units) return [];
  const response = await fetch(`${LIFI}/routes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fromChainId: origin.chainId,
      toChainId: destination.chainId,
      fromTokenAddress: origin.address,
      toTokenAddress: destination.address,
      fromAmount: units,
      fromAddress: sender,
      toAddress: recipient,
      options: { slippage: 0.01, maxPriceImpact: 0.05, order: "CHEAPEST" },
    }),
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { routes?: LifiRoute[] };
  const seen = new Set<string>();
  const routes: LiveRoute[] = [];
  for (const route of body.routes ?? []) {
    const steps = route.steps ?? [];
    const tool = steps.map((step) => step.tool).filter(Boolean).join(" + ") || "Li.Fi";
    if (seen.has(tool)) continue;
    seen.add(tool);
    const outUsd = Number(route.toAmountUSD);
    const inUsd = Number(route.fromAmountUSD) || from.price * (Number(amount) || 0);
    const cost = gap(inUsd, outUsd);
    const receive = to.price > 0 && outUsd > 0 ? outUsd / to.price : Number(route.toAmount) / 10 ** destination.decimals;
    if (!(receive > 0)) continue;
    const stepsCopy = steps.map((step) => ({ ...step }));
    const label = toolName(tool);
    routes.push({
      id: `lifi:${route.id ?? tool}`,
      name: label,
      kind: from.chain === to.chain ? "Swap" : "Bridge",
      feeBps: Math.round(cost * 100),
      impact: cost,
      receive,
      eta: "live",
      execute: async () => {
        try {
          const hash = await runLifi(stepsCopy, from.chain);
          return { status: hash, amountOutHuman: receive };
        } catch (error) {
          const again = await reloadLifiSteps(from, to, amount, sender, recipient, label);
          if (!again?.length) throw error;
          const hash = await runLifi(again, from.chain);
          return { status: hash, amountOutHuman: receive };
        }
      },
    });
    if (routes.length >= 4) break;
  }
  return routes;
}

async function jupiterRoute(from: Token, to: Token, amount: string, sender: string): Promise<LiveRoute | null> {
  if (from.chain !== "Solana" || to.chain !== "Solana") return null;
  const origin = lifiAsset(from);
  const destination = lifiAsset(to);
  if (!origin || !destination || !validAddress(from.chain, sender)) return null;
  const units = parseUnits(amount, origin.decimals);
  if (!units) return null;
  const quoteUrl = `${JUP}/quote?inputMint=${origin.address}&outputMint=${destination.address}&amount=${units}&slippageBps=50`;
  const response = await fetch(quoteUrl);
  if (!response.ok) return null;
  const quote = (await response.json()) as { outAmount?: string; priceImpactPct?: string; routePlan?: { swapInfo?: { label?: string } }[] };
  const out = Number(quote.outAmount);
  if (!(out > 0)) return null;
  const receive = out / 10 ** destination.decimals;
  const raw = Math.abs(Number(quote.priceImpactPct) || 0);
  const impact = raw > 0 && raw < 1 ? raw * 100 : raw;
  const name = quote.routePlan?.[0]?.swapInfo?.label || "Jupiter";
  return {
    id: `jup:${name}`,
    name,
    kind: "Swap",
    feeBps: Math.round(impact * 100),
    impact,
    receive,
    eta: "live",
    execute: async () => {
      const fresh = await fetch(quoteUrl);
      if (!fresh.ok) throw new Error("Jupiter did not return a quote. Nothing was sent.");
      const freshQuote = (await fresh.json()) as { outAmount?: string };
      const swap = await fetch(`${JUP}/swap`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteResponse: freshQuote, userPublicKey: sender, wrapAndUnwrapSol: true }),
      });
      if (!swap.ok) throw new Error("Jupiter did not return a transaction. Nothing was sent.");
      const body = (await swap.json()) as { swapTransaction?: string };
      if (!body.swapTransaction) throw new Error("Jupiter did not return a transaction. Nothing was sent.");
      const hash = await sendSolanaSerialized(body.swapTransaction);
      const out = Number(freshQuote.outAmount);
      return { status: hash, amountOutHuman: out > 0 ? out / 10 ** destination.decimals : receive };
    },
  };
}

async function intentsRoute(from: Token, to: Token, amount: string, accountId: string, refundTo: string, recipient: string, slippageBps: number, purpose: "Swap" | "Spot"): Promise<LiveRoute | null> {
  const quote = await quoteIntent({
    from: from.symbol,
    to: to.symbol,
    fromChain: from.chain,
    toChain: to.chain,
    amount,
    accountId,
    refundTo,
    recipient,
    dry: true,
    slippageBps,
  });
  const cost = gap(quote.amountInUsd, quote.amountOutUsd);
  return {
    id: "intents",
    name: "NEAR Intents",
    kind: from.chain === to.chain ? "Swap" : "Bridge",
    feeBps: Math.round(cost * 100),
    impact: cost,
    receive: quote.amountOutHuman,
    eta: `${quote.timeEstimate}s`,
    execute: async () => {
      const result = await executeIntent({
        from: from.symbol,
        to: to.symbol,
        fromChain: from.chain,
        toChain: to.chain,
        amount,
        accountId,
        refundTo,
        recipient,
        purpose,
        slippageBps,
        maxImpactPct: Math.max(5, cost + 0.5),
      });
      return { status: result.status, amountOutHuman: result.amountOutHuman };
    },
  };
}

export async function quoteRoutes(input: {
  from: Token;
  to: Token;
  amount: string;
  accountId: string;
  refundTo: string;
  recipient: string;
  slippageBps?: number;
  purpose?: "Swap" | "Spot";
}) {
  const slip = input.slippageBps ?? 100;
  const purpose = input.purpose ?? "Swap";
  const jobs = [
    timeout(intentsRoute(input.from, input.to, input.amount, input.accountId || input.refundTo, input.refundTo, input.recipient, slip, purpose), 8000).catch(() => null),
    timeout(lifiRoutes(input.from, input.to, input.amount, input.refundTo, input.recipient), 8000).catch(() => []),
    timeout(jupiterRoute(input.from, input.to, input.amount, input.refundTo), 8000).catch(() => null),
  ] as const;
  const [intents, lifi, jupiter] = await Promise.all(jobs);
  const routes = [...(intents ? [intents] : []), ...(lifi ?? []), ...(jupiter ? [jupiter] : [])];
  return routes.sort((a, b) => a.impact - b.impact || b.receive - a.receive);
}
