import { chainByLabel } from "@/lib/chains";
import { sendIntentDeposit, syncWallet } from "@/lib/near-wallet";
import { sendOriginDeposit } from "@/lib/foreign-wallet";
import { TOKENS } from "@/lib/market";
import { useDesk } from "@/lib/store";

const BASE = "https://1click.chaindefuser.com";
const PENDING_KEY = "asgard-intent";

export type IntentAsset = {
  assetId: string;
  symbol: string;
  decimals: number;
  blockchain: string;
  contractAddress: string | null;
  price?: number;
  coingeckoId?: string;
};

export type IntentQuote = {
  amountIn: string;
  amountOut: string;
  amountInHuman: number;
  amountOutHuman: number;
  amountInUsd: number;
  amountOutUsd: number;
  depositAddress?: string;
  depositMemo?: string | null;
  timeEstimate: number;
};

type Purpose = "Swap" | "Spot" | "Vault deposit" | "Vault withdraw" | "Supply" | "Withdraw supply";

const ALIAS: Record<string, string> = {
  NEAR: "wNEAR",
  STNEAR: "stNEAR",
  WBTC: "wBTC",
};

let assets: IntentAsset[] | null = null;

export function parseUnits(amount: string, decimals: number): string | null {
  const cleaned = amount.trim();
  if (!/^\d+(\.\d*)?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const units = `${whole}${frac.slice(0, decimals).padEnd(decimals, "0")}`.replace(/^0+/, "");
  return units || null;
}

export function formatUnits(units: string, decimals: number): number {
  if (!units) return 0;
  const padded = units.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const frac = padded.slice(-decimals, -decimals + 8);
  return Number(`${whole}.${frac}`);
}

export async function loadIntentAssets(): Promise<IntentAsset[]> {
  if (assets) return assets;
  const response = await fetch(`${BASE}/v0/tokens`);
  if (!response.ok) throw new Error("NEAR Intents token list is unavailable.");
  const body = (await response.json()) as IntentAsset[];
  assets = body.filter((asset) => asset.assetId && asset.symbol);
  return assets;
}

export async function loadNearAssets(): Promise<IntentAsset[]> {
  const list = await loadIntentAssets();
  return list.filter((asset) => asset.blockchain === "near" && asset.contractAddress && Number(asset.price) > 0);
}

export async function tradableNearAssets(): Promise<IntentAsset[]> {
  return loadNearAssets();
}

export async function resolveAsset(symbol: string, chain?: string): Promise<IntentAsset | null> {
  const list = await loadIntentAssets();
  const token = TOKENS.find((item) => item.symbol === symbol && (!chain || item.chain === chain)) ?? (!chain ? TOKENS.find((item) => item.symbol === symbol) : undefined);
  const chainId = (chain ? chainByLabel(chain)?.id : token ? chainByLabel(token.chain)?.id : "") ?? "";
  const onChain = (asset: IntentAsset) => !chainId || asset.blockchain === chainId;
  if (token?.assetId && (!chain || token.chain === chain)) {
    const exact = list.find((asset) => asset.assetId === token.assetId);
    if (exact && onChain(exact)) return exact;
  }
  const address = token && (!chain || token.chain === chain) ? token.address?.toLowerCase() : "";
  if (address) {
    const byAddress = list.find((asset) => asset.contractAddress?.toLowerCase() === address && onChain(asset));
    if (byAddress) return byAddress;
    const byId = list.find((asset) => asset.assetId.toLowerCase() === address && onChain(asset));
    if (byId) return byId;
  }
  const base = (ALIAS[symbol.split(".")[0] ?? symbol] ?? symbol.split(".")[0] ?? symbol).toLowerCase();
  const named = list.filter((asset) => asset.symbol.toLowerCase() === base && onChain(asset));
  if (chainId === "near") return named.find((asset) => asset.contractAddress === "wrap.near") ?? named.find((asset) => asset.contractAddress && Number(asset.price) > 0) ?? named[0] ?? null;
  return named.find((asset) => Number(asset.price) > 0) ?? named[0] ?? null;
}

export async function quoteIntent(input: {
  from: string;
  to: string;
  fromChain?: string;
  toChain?: string;
  amount: string;
  accountId: string;
  refundTo?: string;
  recipient?: string;
  swapType?: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageBps?: number;
  dry?: boolean;
}): Promise<IntentQuote> {
  const origin = await resolveAsset(input.from, input.fromChain);
  const destination = await resolveAsset(input.to, input.toChain);
  if (!origin || !destination) throw new Error(`${input.from} on ${input.fromChain || "its chain"} to ${input.to} on ${input.toChain || "its chain"} is not listed on NEAR Intents.`);
  const refundTo = (input.refundTo || input.accountId).trim();
  const recipient = (input.recipient || input.accountId).trim();
  if (!refundTo || !recipient) throw new Error("A refund address and a receive address are required. Nothing was sent.");
  const units = parseUnits(input.amount, input.swapType === "EXACT_OUTPUT" ? destination.decimals : origin.decimals);
  if (!units) throw new Error("Enter an amount.");
  const response = await fetch(`${BASE}/v0/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      dry: input.dry ?? false,
      swapType: input.swapType ?? "EXACT_INPUT",
      slippageTolerance: input.slippageBps ?? 100,
      originAsset: origin.assetId,
      depositType: "ORIGIN_CHAIN",
      destinationAsset: destination.assetId,
      amount: units,
      refundTo,
      refundType: "ORIGIN_CHAIN",
      recipient,
      recipientType: "DESTINATION_CHAIN",
      deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      referral: "asgard",
      quoteWaitingTimeMs: input.dry ? 7000 : 5000,
    }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const body = (await response.json()) as {
    quote?: {
      depositAddress?: string;
      depositMemo?: string | null;
      amountIn: string;
      amountOut: string;
      amountInFormatted: string;
      amountOutFormatted: string;
      amountInUsd: string;
      amountOutUsd: string;
      timeEstimate: number;
    };
  };
  const quote = body.quote;
  if (!quote) throw new Error("NEAR Intents returned no quote.");
  if (!input.dry && !quote.depositAddress) throw new Error("Quote is missing a deposit address.");
  return {
    amountIn: quote.amountIn,
    amountOut: quote.amountOut,
    amountInHuman: Number(quote.amountInFormatted),
    amountOutHuman: Number(quote.amountOutFormatted),
    amountInUsd: Number(quote.amountInUsd),
    amountOutUsd: Number(quote.amountOutUsd),
    depositAddress: quote.depositAddress,
    depositMemo: quote.depositMemo,
    timeEstimate: quote.timeEstimate,
  };
}

export async function executeIntent(input: {
  from: string;
  to: string;
  fromChain?: string;
  toChain?: string;
  amount: string;
  accountId: string;
  refundTo?: string;
  recipient?: string;
  purpose: Purpose;
  swapType?: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageBps?: number;
  maxPay?: number;
  maxImpactPct?: number;
}): Promise<IntentQuote & { status: string }> {
  const origin = await resolveAsset(input.from, input.fromChain);
  if (!origin) throw new Error(`${input.from} is not listed on NEAR Intents.`);
  const quote = await quoteIntent({ ...input, dry: false });
  if (input.maxImpactPct != null && quote.amountInUsd > 0 && quote.amountOutUsd > 0) {
    const gap = Math.max(0, (1 - quote.amountOutUsd / quote.amountInUsd) * 100);
    if (gap > input.maxImpactPct) throw new Error("This quote fails slippage. Nothing was sent.");
  }
  if (input.maxPay != null && quote.amountInHuman > input.maxPay + 1e-8) {
    throw new Error(`That needs ${quote.amountInHuman} ${input.from}, more than you have parked.`);
  }
  if (!quote.depositAddress) throw new Error("Quote is missing a deposit address. Nothing was sent.");
  sessionStorage.setItem(
    PENDING_KEY,
    JSON.stringify({
      depositAddress: quote.depositAddress,
      depositMemo: quote.depositMemo ?? null,
      from: input.from,
      to: input.to,
      purpose: input.purpose,
      amountOutHuman: quote.amountOutHuman,
    }),
  );
  const txHash =
    origin.blockchain === "near"
      ? await sendIntentDeposit({
          accountId: input.accountId,
          contractId: origin.contractAddress ?? "",
          depositAddress: quote.depositAddress,
          amount: quote.amountIn,
          wrap: origin.contractAddress === "wrap.near",
        })
      : await sendOriginDeposit({
          blockchain: origin.blockchain,
          contract: origin.contractAddress,
          depositAddress: quote.depositAddress,
          amount: quote.amountIn,
        });
  const status = await finishDeposit(quote, txHash, input.purpose, input.from, input.to);
  return { ...quote, status };
}

export async function resumeIntent() {
  if (typeof window === "undefined") return;
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return;
  const hash = new URLSearchParams(window.location.search).get("transactionHashes")?.split(",")[0];
  if (!hash) return;
  const pending = JSON.parse(raw) as { depositAddress: string; depositMemo?: string | null; from: string; to: string; purpose: Purpose; amountOutHuman: number };
  window.history.replaceState({}, "", window.location.pathname);
  await finishDeposit(
    { ...pending, amountIn: "0", amountOut: "0", amountInHuman: 0, amountInUsd: 0, amountOutUsd: 0, timeEstimate: 0 },
    hash,
    pending.purpose,
    pending.from,
    pending.to,
  );
}

async function finishDeposit(quote: IntentQuote, txHash: string | null, purpose: Purpose, from: string, to: string) {
  if (quote.depositAddress && txHash) {
    void fetch(`${BASE}/v0/deposit/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txHash, depositAddress: quote.depositAddress, depositMemo: quote.depositMemo || undefined }),
    }).catch(() => undefined);
  }
  const status = quote.depositAddress ? await pollStatus(quote.depositAddress, quote.depositMemo) : "SUBMITTED";
  sessionStorage.removeItem(PENDING_KEY);
  const accountId = useDesk.getState().accountId;
  if (accountId) await syncWallet(accountId);
  const value = quote.amountInUsd || quote.amountOutUsd;
  useDesk.getState().log(`${purpose} · NEAR Intents`, `${from} → ${to} · ${status}`, value);
  if (status !== "SUCCESS") {
    throw new Error(
      status === "REFUNDED" || status === "FAILED"
        ? `NEAR Intents ${status.toLowerCase()} this swap. Funds were not delivered.`
        : `Bridge is ${status}. Do not send the deposit again. It refunds to your origin address if it cannot finish.`,
    );
  }
  return status;
}

async function pollStatus(depositAddress: string, depositMemo?: string | null) {
  const url = new URL(`${BASE}/v0/status`);
  url.searchParams.set("depositAddress", depositAddress);
  if (depositMemo) url.searchParams.set("depositMemo", depositMemo);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await wait(attempt === 0 ? 2000 : 3000);
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const body = (await response.json()) as { status?: string };
      if (!body.status || body.status === "PENDING_DEPOSIT" || body.status === "KNOWN_DEPOSIT_TX" || body.status === "PROCESSING" || body.status === "INCOMPLETE_DEPOSIT") continue;
      return body.status;
    } catch {
      /* Keep polling until the deadline window closes. */
    }
  }
  return "SUBMITTED";
}

async function readError(response: Response) {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { message?: string };
    return body.message || "NEAR Intents rejected the quote.";
  } catch {
    return "NEAR Intents rejected the quote.";
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
