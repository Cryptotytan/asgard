import { chainByLabel, validAddress } from "@/lib/chains";
import { evmDexRoutes } from "@/lib/evm-dex";
import { ensureEvmAllowance, sendEvmCall, sendSolanaSerialized } from "@/lib/foreign-wallet";
import { executeIntent, parseUnits, quoteIntent } from "@/lib/intents";
import { net } from "@/lib/net";
import { nearFunctionCall, sendNearTransactions, sendRefSwap, settleHoldings } from "@/lib/near-wallet";
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
  action?: { fromChainId?: number; fromAmount?: string; fromToken?: { address?: string } };
  estimate?: { approvalAddress?: string; toAmount?: string; toAmountUSD?: string; feeCosts?: { amountUSD?: string }[]; gasCosts?: { amountUSD?: string }[] };
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

function bookTrade(from: Token, to: Token, amountIn: number, amountOut: number, accountId?: string) {
  if (!(amountIn > 0) && !(amountOut > 0)) return;
  if (from.chain === "NEAR" && accountId) {
    const moves = [{ symbol: from.symbol, delta: -amountIn }];
    if (to.chain === "NEAR") moves.push({ symbol: to.symbol, delta: amountOut });
    settleHoldings(accountId, moves);
  }
  if (from.chain !== "NEAR" || to.chain !== "NEAR") {
    void import("@/lib/wallet-holdings").then(({ expectHolding }) => {
      if (from.chain !== "NEAR" && amountIn > 0) expectHolding(from.chain, from.symbol, -amountIn);
      if (to.chain !== "NEAR" && amountOut > 0) expectHolding(to.chain, to.symbol, amountOut);
    });
  }
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

function decimalsOf(token: Token) {
  if (token.decimals != null) return token.decimals;
  const kind = chainByLabel(token.chain)?.kind;
  if (kind === "sol") return token.symbol.split(".")[0]?.toUpperCase() === "SOL" ? 9 : 6;
  if (kind === "evm") return token.symbol.split(".")[0]?.toUpperCase() === "USDT" || token.symbol.split(".")[0]?.toUpperCase() === "USDC" ? 6 : 18;
  if (kind === "near") return 24;
  return null;
}

function lifiAsset(token: Token) {
  const meta = chainByLabel(token.chain);
  const decimals = decimalsOf(token);
  if (!meta || decimals == null) return null;
  if (meta.kind === "evm" && meta.chainId) {
    const native = ["ETH", "BNB", "POL", "MATIC", "AVAX"].includes(token.symbol.split(".")[0]?.toUpperCase() ?? "");
    const address = token.address && /^0x[a-fA-F0-9]{40}$/.test(token.address) ? token.address : native ? EVM_NATIVE : "";
    if (!address) return null;
    return { chainId: meta.chainId, address, decimals };
  }
  if (meta.kind === "sol") {
    const native = token.symbol.split(".")[0]?.toUpperCase() === "SOL";
    const address = token.address && token.address.length >= 32 && !token.address.startsWith("0x") ? token.address : native ? SOL_MINT : "";
    if (!address) return null;
    return { chainId: SOL_CHAIN, address, decimals };
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
    const response = await net(`${LIFI}/stepTransaction`, {
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
      const chain = chainOf(fromChain) || fallback;
      const spender = step.estimate?.approvalAddress;
      const token = step.action?.fromToken?.address;
      const amount = step.action?.fromAmount;
      if (spender && token && amount) await ensureEvmAllowance(chain, token, spender, amount);
      hash = await sendEvmCall(chain, { to: tx.to, data: tx.data, value: tx.value });
    }
  }
  return hash || "SENT";
}

async function reloadLifiSteps(from: Token, to: Token, amount: string, sender: string, recipient: string, name: string, slip = 0.15) {
  const origin = lifiAsset(from);
  const destination = lifiAsset(to);
  if (!origin || !destination) return null;
  const units = parseUnits(amount, origin.decimals);
  if (!units) return null;
  const response = await net(`${LIFI}/routes`, {
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
      options: { slippage: slip, maxPriceImpact: 0.9, order: "CHEAPEST" },
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

async function lifiRoutes(from: Token, to: Token, amount: string, sender: string, recipient: string, slip = 0.15): Promise<LiveRoute[]> {
  const origin = lifiAsset(from);
  const destination = lifiAsset(to);
  if (!origin || !destination) return [];
  if (!validAddress(from.chain, sender) || !validAddress(to.chain, recipient)) return [];
  const units = parseUnits(amount, origin.decimals);
  if (!units) return [];
  const response = await net(`${LIFI}/routes`, {
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
      options: { slippage: slip, maxPriceImpact: 0.9, order: "CHEAPEST" },
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
          bookTrade(from, to, Number(amount) || 0, receive, sender);
          return { status: hash, amountOutHuman: receive };
        } catch (error) {
          const again = await reloadLifiSteps(from, to, amount, sender, recipient, label, slip);
          if (!again?.length) throw error;
          const hash = await runLifi(again, from.chain);
          bookTrade(from, to, Number(amount) || 0, receive, sender);
          return { status: hash, amountOutHuman: receive };
        }
      },
    });
    if (routes.length >= 4) break;
  }
  return routes;
}

async function jupiterRoute(from: Token, to: Token, amount: string, sender: string, slippageBps = 1500): Promise<LiveRoute | null> {
  if (from.chain !== "Solana" || to.chain !== "Solana") return null;
  const origin = lifiAsset(from);
  const destination = lifiAsset(to);
  if (!origin || !destination || !validAddress(from.chain, sender)) return null;
  const units = parseUnits(amount, origin.decimals);
  if (!units) return null;
  const quoteUrl = `${JUP}/quote?inputMint=${origin.address}&outputMint=${destination.address}&amount=${units}&slippageBps=${slippageBps}`;
  const response = await net(quoteUrl);
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
      const fresh = await net(quoteUrl);
      if (!fresh.ok) throw new Error("Jupiter did not return a quote. Nothing was sent.");
      const freshQuote = (await fresh.json()) as { outAmount?: string };
      const swap = await net(`${JUP}/swap`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteResponse: freshQuote, userPublicKey: sender, wrapAndUnwrapSol: true }),
      });
      if (!swap.ok) throw new Error("Jupiter did not return a transaction. Nothing was sent.");
      const body = (await swap.json()) as { swapTransaction?: string };
      if (!body.swapTransaction) throw new Error("Jupiter did not return a transaction. Nothing was sent.");
      const hash = await sendSolanaSerialized(body.swapTransaction);
      const out = Number(freshQuote.outAmount);
      const received = out > 0 ? out / 10 ** destination.decimals : receive;
      bookTrade(from, to, Number(amount) || 0, received, sender);
      return { status: hash, amountOutHuman: received };
    },
  };
}

const DEBRIDGE = "https://deswap.debridge.finance/v1.0/dln/order";
const DEBRIDGE_CHAIN: Record<string, number> = {
  Ethereum: 1,
  BNB: 56,
  Polygon: 137,
  Arbitrum: 42161,
  Optimism: 10,
  Base: 8453,
  Avalanche: 43114,
  Gnosis: 100,
  Linea: 59144,
  Scroll: 534352,
  Solana: 7565164,
};

function debridgeAsset(token: Token) {
  const chainId = DEBRIDGE_CHAIN[token.chain];
  const decimals = decimalsOf(token);
  if (!chainId || decimals == null) return null;
  if (chainId === 7565164) {
    const native = token.symbol.split(".")[0]?.toUpperCase() === "SOL";
    const address = token.address && token.address.length >= 32 && !token.address.startsWith("0x") ? token.address : native ? "11111111111111111111111111111111" : "";
    if (!address) return null;
    return { chainId, address, decimals };
  }
  const native = ["ETH", "BNB", "POL", "MATIC", "AVAX"].includes(token.symbol.split(".")[0]?.toUpperCase() ?? "");
  const address = token.address && /^0x[a-fA-F0-9]{40}$/.test(token.address) ? token.address : native ? EVM_NATIVE : "";
  if (!address) return null;
  return { chainId, address, decimals };
}

async function debridgeRoute(from: Token, to: Token, amount: string, sender: string, recipient: string): Promise<LiveRoute | null> {
  const origin = debridgeAsset(from);
  const destination = debridgeAsset(to);
  if (!origin || !destination) return null;
  if (origin.chainId === destination.chainId && origin.address.toLowerCase() === destination.address.toLowerCase()) return null;
  if (!validAddress(from.chain, sender) || !validAddress(to.chain, recipient)) return null;
  const units = parseUnits(amount, origin.decimals);
  if (!units) return null;
  const query = new URLSearchParams({
    srcChainId: String(origin.chainId),
    srcChainTokenIn: origin.address,
    srcChainTokenInAmount: units,
    dstChainId: String(destination.chainId),
    dstChainTokenOut: destination.address,
    prependOperatingExpenses: "false",
  });
  const quoted = await net(`${DEBRIDGE}/quote?${query}`);
  if (!quoted.ok) return null;
  const quote = (await quoted.json()) as { estimation?: { dstChainTokenOut?: { amount?: string; approximateUsdValue?: number } } };
  const out = Number(quote.estimation?.dstChainTokenOut?.amount);
  if (!(out > 0)) return null;
  const receive = out / 10 ** destination.decimals;
  const impact = gap(Number(amount) * (from.price || 0), Number(quote.estimation?.dstChainTokenOut?.approximateUsdValue) || receive * (to.price || 0));
  return {
    id: "debridge",
    name: "deBridge",
    kind: from.chain === to.chain ? "Swap" : "Bridge",
    feeBps: Math.round(impact * 100),
    impact,
    receive,
    eta: "live",
    execute: async () => {
      const create = new URLSearchParams(query);
      create.set("dstChainTokenOutRecipient", recipient);
      create.set("srcChainOrderAuthorityAddress", sender);
      create.set("dstChainOrderAuthorityAddress", recipient);
      const response = await net(`${DEBRIDGE}/create-tx?${create}`);
      if (!response.ok) throw new Error("deBridge did not return a transaction. Nothing was sent.");
      const body = (await response.json()) as { tx?: { to?: string; data?: string; value?: string }; errorMessage?: string };
      if (origin.chainId === 7565164) {
        if (!body.tx?.data) throw new Error(body.errorMessage || "deBridge did not return a Solana transaction.");
        const hash = await sendSolanaSerialized(body.tx.data);
        bookTrade(from, to, Number(amount) || 0, receive, sender);
        return { status: hash, amountOutHuman: receive };
      }
      if (!body.tx?.to || !body.tx.data) throw new Error(body.errorMessage || "deBridge did not return a transaction. Nothing was sent.");
      const hash = await sendEvmCall(from.chain, { to: body.tx.to, data: body.tx.data, value: body.tx.value });
      bookTrade(from, to, Number(amount) || 0, receive, sender);
      return { status: hash, amountOutHuman: receive };
    },
  };
}

function intearId(token: Token) {
  if (token.chain !== "NEAR") return "";
  const base = token.symbol.split(".")[0]?.toUpperCase() ?? "";
  if (base === "NEAR" || base === "WNEAR") return "near";
  const raw = (token.address ?? "").trim().replace(/^nep141:/i, "");
  return raw ? `nep141:${raw}` : "";
}

function decodeCallArgs(args: string) {
  const text = atob(args);
  return JSON.parse(text) as object;
}

async function intearRoute(from: Token, to: Token, amount: string, accountId: string, slippageBps = 1500): Promise<LiveRoute | null> {
  const tokenIn = intearId(from);
  const tokenOut = intearId(to);
  const decimals = decimalsOf(from);
  const outDecimals = decimalsOf(to);
  if (!tokenIn || !tokenOut || tokenIn === tokenOut || decimals == null || outDecimals == null) return null;
  const units = parseUnits(amount, decimals);
  if (!units) return null;
  const slip = Math.min(0.5, Math.max(0.005, slippageBps / 10_000));
  const trader = accountId ? `&trader_account_id=${encodeURIComponent(accountId)}` : "";
  const url = `https://router.intear.tech/route?token_in=${encodeURIComponent(tokenIn)}&token_out=${encodeURIComponent(tokenOut)}&amount_in=${units}&max_wait_ms=4000&slippage_type=Fixed&slippage=${slip}${trader}`;
  const response = await net(url);
  if (!response.ok) return null;
  const routes = (await response.json()) as {
    estimated_amount?: { amount_out?: string };
    dex_id?: string;
    execution_instructions?: { NearTransaction?: { receiver_id?: string; actions?: { FunctionCall?: { method_name?: string; args?: string; gas?: number | string; deposit?: string } }[] } }[];
  }[];
  const best = Array.isArray(routes) ? routes.find((route) => Number(route.estimated_amount?.amount_out) > 0) : undefined;
  if (!best?.execution_instructions?.length) return null;
  const receive = Number(best.estimated_amount?.amount_out) / 10 ** outDecimals;
  if (!(receive > 0)) return null;
  return {
    id: `intear:${best.dex_id || "rhea"}`,
    name: best.dex_id || "Rhea",
    kind: "Swap",
    feeBps: 30,
    impact: gap(Number(amount) * (from.price || 0), receive * (to.price || 0)),
    receive,
    eta: "live",
    execute: async () => {
      const fresh = await net(url);
      if (!fresh.ok) throw new Error("Rhea did not return a route. Nothing was sent.");
      const next = (await fresh.json()) as typeof routes;
      const picked = (Array.isArray(next) ? next.find((route) => route.execution_instructions?.length) : undefined) ?? best;
      const transactions = (picked.execution_instructions ?? []).flatMap((step) => {
        const tx = step.NearTransaction;
        if (!tx?.receiver_id || !tx.actions?.length) return [];
        const actions = tx.actions.flatMap((action) => {
          const call = action.FunctionCall;
          if (!call?.method_name || !call.args) return [];
          return [nearFunctionCall(call.method_name, decodeCallArgs(call.args), BigInt(call.gas ?? 30_000_000_000_000), BigInt(call.deposit || "0"))];
        });
        return actions.length ? [{ receiverId: tx.receiver_id, actions }] : [];
      });
      if (!transactions.length) throw new Error("Rhea did not return a transaction. Nothing was sent.");
      const hash = await sendNearTransactions(accountId, transactions);
      bookTrade(from, to, Number(amount) || 0, receive, accountId);
      return { status: typeof hash === "string" ? hash : "SENT", amountOutHuman: receive };
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

function nearContract(token: Token) {
  const base = token.symbol.split(".")[0]?.toUpperCase() ?? "";
  if (base === "NEAR" || base === "WNEAR") return "wrap.near";
  return (token.address ?? "").trim().replace(/^nep141:/i, "");
}

async function refRoute(from: Token, to: Token, amount: string, accountId: string, slippageBps = 1500): Promise<LiveRoute | null> {
  const tokenIn = nearContract(from);
  const tokenOut = nearContract(to);
  const decimals = decimalsOf(from);
  const outDecimals = decimalsOf(to);
  if (!tokenIn || !tokenOut || tokenIn === tokenOut || decimals == null || outDecimals == null) return null;
  const units = parseUnits(amount, decimals);
  if (!units) return null;
  const slip = Math.min(0.5, Math.max(0.005, slippageBps / 10_000));
  const quoted = `https://smartrouter.ref.finance/findPath?amountIn=${units}&tokenIn=${encodeURIComponent(tokenIn)}&tokenOut=${encodeURIComponent(tokenOut)}&pathDeep=3&slippage=${slip}`;
  const response = await net(quoted);
  if (!response.ok) return null;
  const body = (await response.json()) as {
    result_code?: number;
    result_data?: { amount_out?: string; routes?: { pools?: { pool_id?: string; token_in?: string; token_out?: string; amount_in?: string; min_amount_out?: string }[] }[] };
  };
  const pools = body.result_data?.routes?.[0]?.pools?.filter((pool) => pool.pool_id && pool.token_in && pool.token_out && pool.min_amount_out) ?? [];
  const out = Number(body.result_data?.amount_out);
  if (body.result_code !== 0 || !pools.length || !(out > 0)) return null;
  const receive = out / 10 ** outDecimals;
  return {
    id: "ref",
    name: "Ref Finance",
    kind: "Swap",
    feeBps: 30,
    impact: gap(Number(amount) * (from.price || 0), receive * (to.price || 0)),
    receive,
    eta: "live",
    execute: async () => {
      const fresh = await net(quoted);
      if (!fresh.ok) throw new Error("Ref Finance did not return a route. Nothing was sent.");
      const next = (await fresh.json()) as typeof body;
      const nextPools = next.result_data?.routes?.[0]?.pools?.filter((pool) => pool.pool_id && pool.min_amount_out) ?? pools;
      const hops = nextPools.map((pool, index) => ({
        pool_id: Number(pool.pool_id),
        token_in: pool.token_in || tokenIn,
        token_out: pool.token_out || tokenOut,
        amount_in: index === 0 ? pool.amount_in || units : pool.amount_in && pool.amount_in !== "0" ? pool.amount_in : "",
        min_amount_out: pool.min_amount_out || "1",
      }));
      const last = hops[hops.length - 1];
      const hash = await sendRefSwap(accountId, {
        tokenIn,
        hops,
        unwrap: tokenOut === "wrap.near" ? last?.min_amount_out : undefined,
      });
      const got = Number(next.result_data?.amount_out) || 0;
      const received = got > 0 ? got / 10 ** outDecimals : receive;
      bookTrade(from, to, Number(amount) || 0, received, accountId);
      return { status: typeof hash === "string" ? hash : "SENT", amountOutHuman: received };
    },
  };
}

async function collectRoutes(input: {
  from: Token;
  to: Token;
  amount: string;
  accountId: string;
  refundTo: string;
  recipient: string;
  slippageBps: number;
  purpose: "Swap" | "Spot";
}) {
  const cross = input.from.chain !== input.to.chain;
  const asked = input.slippageBps;
  const slip = cross ? Math.max(asked, 300) : asked;
  const intentsJob = () =>
    timeout(intentsRoute(input.from, input.to, input.amount, input.accountId || input.refundTo, input.refundTo, input.recipient, slip, input.purpose), 16000)
      .then((route) => ({ route, error: "" }))
      .catch((error: unknown) => ({ route: null, error: error instanceof Error && error.message !== "timeout" ? error.message : "NEAR Intents has no quote for this pair." }));
  const sameKind = chainByLabel(input.from.chain)?.kind;
  const usd = Number(input.amount) * (input.from.price || 0);
  const nearPair = input.from.chain === "NEAR" && input.to.chain === "NEAR";
  const [intents, evm, lifi, jupiter, debridge, intear, ref] = await Promise.all([
    cross || input.from.chain === "NEAR" || input.to.chain === "NEAR" || usd >= 1000 ? intentsJob() : Promise.resolve({ route: null as LiveRoute | null, error: "" }),
    !cross && sameKind === "evm"
      ? timeout(evmDexRoutes(input.from, input.to, input.amount, input.refundTo, input.recipient, slip), 8000).catch(() => [] as LiveRoute[])
      : Promise.resolve([] as LiveRoute[]),
    timeout(lifiRoutes(input.from, input.to, input.amount, input.refundTo, input.recipient, slip / 10_000), cross ? 12000 : 8000).catch(() => [] as LiveRoute[]),
    !cross && sameKind === "sol" ? timeout(jupiterRoute(input.from, input.to, input.amount, input.refundTo, slip), 8000).catch(() => null) : Promise.resolve(null),
    timeout(debridgeRoute(input.from, input.to, input.amount, input.refundTo, input.recipient), 10000).catch(() => null),
    nearPair ? timeout(intearRoute(input.from, input.to, input.amount, input.accountId || input.refundTo, slip), 8000).catch(() => null) : Promise.resolve(null),
    nearPair ? timeout(refRoute(input.from, input.to, input.amount, input.accountId || input.refundTo, slip), 8000).catch(() => null) : Promise.resolve(null),
  ]);
  const routes = [...(intents.route ? [intents.route] : []), ...evm, ...lifi, ...(jupiter ? [jupiter] : []), ...(debridge ? [debridge] : []), ...(intear ? [intear] : []), ...(ref ? [ref] : [])];
  const minimum = /1,000|minimum swap/i.test(intents.error);
  const error = minimum
    ? "No venue quoted this size. NEAR Intents currently requires $1,000, and the other exchanges did not return a route."
    : cross && (input.from.chain === "NEAR" || input.to.chain === "NEAR")
      ? intents.error || "NEAR Intents did not return a bridge for this pair."
      : intents.error || (cross ? "No route for this pair." : "No live route for this pair.");
  return { routes, error };
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
  const asked = input.slippageBps ?? 100;
  const purpose = input.purpose ?? "Swap";
  const bands = purpose === "Spot" ? [...new Set([Math.max(asked, 1500), 5000])] : [asked];
  let last = "";
  for (const slippageBps of bands) {
    const found = await collectRoutes({ ...input, slippageBps, purpose });
    if (found.routes.length) return found.routes.sort((a, b) => a.impact - b.impact || b.receive - a.receive);
    last = found.error;
  }
  throw new Error(last || "No live route for this pair.");
}
