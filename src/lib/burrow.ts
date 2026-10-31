import { parseUnits } from "@/lib/intents";
import { TOKENS } from "@/lib/market";
import { isRegisteredOn, nearFunctionCall, sendNearTransactions, type NearCall } from "@/lib/near-wallet";

const BURROW = "contract.main.burrow.near";
const MIN_STORAGE = 100_000_000_000_000_000_000_000n;

export async function readBurrow(accountId: string) {
  const [result, extra] = await Promise.all([
    view(BURROW, "get_account", { account_id: accountId }) as Promise<{
      supplied?: { token_id?: string; balance?: string }[];
      collateral?: { token_id?: string; balance?: string }[];
      borrowed?: { token_id?: string; balance?: string }[];
    } | null>,
    extraDecimals(),
  ]);
  const supplied: Record<string, number> = {};
  const borrowed: Record<string, number> = {};
  for (const row of [...(result?.supplied ?? []), ...(result?.collateral ?? [])]) add(supplied, row.token_id, row.balance, extra);
  for (const row of result?.borrowed ?? []) add(borrowed, row.token_id, row.balance, extra);
  return { supplied, borrowed };
}

export async function supplyOnBurrow(accountId: string, token: string, amount: string, decimals: number) {
  const units = parseUnits(amount, decimals);
  if (!units) throw new Error("Enter an amount.");
  const inner = await innerAmount(token, units);
  const msg = JSON.stringify({ Execute: { actions: [{ IncreaseCollateral: { token_id: token, max_amount: inner } }] } });
  await sendToken(accountId, token, units, msg);
}

export async function withdrawFromBurrow(accountId: string, token: string, amount: string, decimals: number) {
  const units = parseUnits(amount, decimals);
  if (!units) throw new Error("Enter an amount.");
  const inner = await innerAmount(token, units);
  const actions = [
    nearCall("execute", {
      actions: [
        { DecreaseCollateral: { token_id: token, amount: inner } },
        { Withdraw: { token_id: token, max_amount: inner } },
      ],
    }, 220_000_000_000_000n, 1n),
  ];
  await sendNearTransactions(accountId, [{ receiverId: BURROW, actions }]);
}

export async function borrowFromBurrow(accountId: string, token: string, amount: string, decimals: number) {
  const units = parseUnits(amount, decimals);
  if (!units) throw new Error("Enter an amount.");
  const inner = await innerAmount(token, units);
  await sendNearTransactions(accountId, [
    {
      receiverId: BURROW,
      actions: [nearCall("execute", { actions: [{ Borrow: { token_id: token, amount: inner } }] }, 150_000_000_000_000n, 1n)],
    },
  ]);
}

export async function repayOnBurrow(accountId: string, token: string, amount: string, decimals: number) {
  const units = parseUnits(amount, decimals);
  if (!units) throw new Error("Enter an amount.");
  const inner = await innerAmount(token, units);
  const msg = JSON.stringify({ Execute: { actions: [{ Repay: { token_id: token, max_amount: inner } }] } });
  await sendToken(accountId, token, units, msg);
}

async function sendToken(accountId: string, token: string, units: string, msg: string) {
  const txs: { receiverId: string; actions: NearCall[] }[] = [];
  const [onBurrow, onToken, raw] = await Promise.all([
    isRegisteredOn(BURROW, accountId),
    isRegisteredOn(token, accountId),
    token === "wrap.near" ? ftRaw(accountId, token) : Promise.resolve("0"),
  ]);
  if (!onBurrow) {
    txs.push({ receiverId: BURROW, actions: [nearCall("storage_deposit", { account_id: accountId, registration_only: true }, 30_000_000_000_000n, MIN_STORAGE)] });
  }
  if (token === "wrap.near") {
    const wrapped = BigInt(raw || "0");
    const need = BigInt(units);
    const prep: NearCall[] = [];
    if (!onToken) prep.push(nearCall("storage_deposit", { account_id: accountId, registration_only: true }, 30_000_000_000_000n, MIN_STORAGE));
    if (wrapped < need) prep.push(nearCall("near_deposit", {}, 30_000_000_000_000n, need - wrapped));
    if (prep.length) txs.push({ receiverId: token, actions: prep });
  } else if (!onToken) {
    txs.push({ receiverId: token, actions: [nearCall("storage_deposit", { account_id: accountId, registration_only: true }, 30_000_000_000_000n, MIN_STORAGE)] });
  }
  txs.push({
    receiverId: token,
    actions: [nearCall("ft_transfer_call", { receiver_id: BURROW, amount: units, msg }, 180_000_000_000_000n, 1n)],
  });
  await sendNearTransactions(accountId, txs);
}

async function innerAmount(token: string, units: string) {
  const extra = (await extraDecimals())[token.toLowerCase()] ?? 0;
  if (!/^\d+$/.test(units)) throw new Error("Enter an amount.");
  if (extra <= 0) return units;
  return (BigInt(units) * 10n ** BigInt(extra)).toString();
}

const TOKEN_DECIMALS: Record<string, number> = {
  "wrap.near": 24,
  "meta-pool.near": 24,
  "usdt.tether-token.near": 6,
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": 6,
  "eth.bridge.near": 18,
  "2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near": 8,
  "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near": 18,
};

let extraCache: Record<string, number> | null = null;
let configCache: Record<string, MarketConfig> | null = null;

export type RatePoint = { util: number; supply: number; borrow: number };

export type MarketConfig = {
  token: string;
  decimals: number;
  ltv: number;
  reserve: number;
  target: number;
  collateral: boolean;
  borrowable: boolean;
  deposit: boolean;
  withdraw: boolean;
  supplyCap: number;
  borrowCap: number;
  name: string;
  curve: RatePoint[];
};

export function lendDecimals(token: string) {
  const id = token.toLowerCase();
  return TOKEN_DECIMALS[id] ?? TOKENS.find((item) => item.address?.toLowerCase() === id)?.decimals ?? (id === "wrap.near" || id === "meta-pool.near" ? 24 : 18);
}

export async function readMarketConfigs() {
  if (configCache) return configCache;
  const rows = (await view("contract.main.burrow.near", "get_assets_paged", { from_index: 0, limit: 200 })) as
    | [string, { config?: AssetConfig }][]
    | null;
  const book: Record<string, MarketConfig> = {};
  const pending: Promise<void>[] = [];
  for (const row of rows ?? []) {
    const id = row?.[0];
    const config = row?.[1]?.config;
    if (!id || !config) continue;
    const key = id.toLowerCase();
    const extra = Number(config.extra_decimals) || 0;
    const base = TOKEN_DECIMALS[key] ?? TOKENS.find((item) => item.address?.toLowerCase() === key)?.decimals ?? 18;
    const ltv = (Number(config.volatility_ratio) || 0) / 100;
    const reserve = (Number(config.reserve_ratio) || 0) / 100;
    const target = (Number(config.target_utilization) || 0) / 100;
    book[key] = {
      token: id,
      decimals: base,
      ltv,
      reserve,
      target,
      collateral: Boolean(config.can_use_as_collateral),
      borrowable: Boolean(config.can_borrow),
      deposit: config.can_deposit !== false,
      withdraw: config.can_withdraw !== false,
      supplyCap: humanUnits(config.supplied_limit, base + extra),
      borrowCap: humanUnits(config.borrowed_limit, base + extra),
      name: "",
      curve: rateCurve(config, target, reserve),
    };
    pending.push(
      view(id, "ft_metadata", {})
        .then((meta) => {
          const body = meta as { decimals?: number; name?: string } | null;
          const decimals = Number(body?.decimals);
          if (Number.isFinite(decimals) && decimals >= 0 && decimals <= 24) {
            TOKEN_DECIMALS[key] = decimals;
            book[key].decimals = decimals;
            book[key].supplyCap = humanUnits(config.supplied_limit, decimals + extra);
            book[key].borrowCap = humanUnits(config.borrowed_limit, decimals + extra);
          }
          if (body?.name) book[key].name = body.name;
        })
        .catch(() => undefined),
    );
  }
  await Promise.all(pending);
  configCache = book;
  return book;
}

type AssetConfig = {
  reserve_ratio?: number;
  target_utilization?: number;
  target_utilization_rate?: string;
  max_utilization_rate?: string;
  volatility_ratio?: number;
  extra_decimals?: number;
  can_deposit?: boolean;
  can_withdraw?: boolean;
  can_use_as_collateral?: boolean;
  can_borrow?: boolean;
  supplied_limit?: string | null;
  borrowed_limit?: string | null;
};

function humanUnits(raw: string | null | undefined, decimals: number) {
  if (!raw || !/^\d+$/.test(raw) || raw === "0") return 0;
  if (decimals <= 0) {
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  }
  const pad = raw.padStart(decimals + 1, "0");
  const whole = pad.slice(0, -decimals) || "0";
  const frac = pad.slice(-decimals).slice(0, 6).replace(/0+$/, "");
  const value = Number(frac ? `${whole}.${frac}` : whole);
  return Number.isFinite(value) ? value : 0;
}

function rateCurve(config: AssetConfig, targetPct: number, reservePct: number) {
  const target = targetPct / 100;
  const reserve = reservePct / 100;
  const low = BigInt(config.target_utilization_rate || "0");
  const high = BigInt(config.max_utilization_rate || "0");
  const scale = 10n ** 27n;
  if (low <= scale || high <= scale || !(target > 0 && target < 1)) return [];
  const marks = new Set<number>([0, 100, Math.round(targetPct)]);
  for (let step = 0; step <= 100; step += 4) marks.add(step);
  return [...marks]
    .sort((a, b) => a - b)
    .map((util) => {
      const borrow = aprAt(util / 100, target, low, high, scale) * 100;
      const supply = borrow * (util / 100) * (1 - reserve);
      return { util, borrow, supply };
    });
}

function aprAt(util: number, target: number, low: bigint, high: bigint, scale: bigint) {
  const rate = util <= target ? mix(scale, low, target <= 0 ? 0 : util / target) : mix(low, high, (util - target) / (1 - target));
  if (rate <= scale) return 0;
  const product = (rate - scale) * 31_536_000_000n;
  const span = Number(product / scale) + Number(product % scale) / 1e27;
  const apr = Math.exp(span) - 1;
  return Number.isFinite(apr) && apr > 0 ? apr : 0;
}

function mix(from: bigint, to: bigint, t: number) {
  const clamped = Math.max(0, Math.min(1, t));
  const parts = 1_000_000n;
  const weight = BigInt(Math.round(clamped * 1_000_000));
  return from + ((to - from) * weight) / parts;
}

export function warmBurrow(accountId: string, tokens: string[]) {
  void extraDecimals().catch(() => undefined);
  const ids = new Set([BURROW, ...tokens.filter(Boolean)]);
  for (const id of ids) void isRegisteredOn(id, accountId).catch(() => undefined);
}

if (typeof window !== "undefined") void extraDecimals().catch(() => undefined);

async function extraDecimals() {
  if (extraCache) return extraCache;
  const rows = (await view(BURROW, "get_assets_paged", { from_index: 0, limit: 200 })) as
    | [string, { config?: { extra_decimals?: number } }][]
    | null;
  const book: Record<string, number> = {};
  for (const row of rows ?? []) {
    const id = row?.[0]?.toLowerCase();
    if (!id) continue;
    book[id] = Number(row[1]?.config?.extra_decimals) || 0;
  }
  extraCache = book;
  return book;
}

function add(book: Record<string, number>, tokenId: string | undefined, balance: string | undefined, extra: Record<string, number>) {
  if (!tokenId || !balance) return;
  const id = tokenId.toLowerCase();
  const token = TOKENS.find((item) => item.address?.toLowerCase() === id);
  const base = TOKEN_DECIMALS[id] ?? token?.decimals ?? 18;
  const decimals = base + (extra[id] ?? 0);
  const pad = balance.padStart(decimals + 1, "0");
  const whole = pad.slice(0, -decimals) || "0";
  const frac = pad.slice(-decimals).slice(0, 8).replace(/0+$/, "");
  const amount = Number(frac ? `${whole}.${frac}` : whole);
  if (!(amount > 0)) return;
  const symbol = token?.symbol ?? (id === "wrap.near" ? "NEAR" : tokenId);
  book[symbol] = (book[symbol] ?? 0) + amount;
}

function nearCall(methodName: string, args: object, gas: bigint, deposit: bigint): NearCall {
  return nearFunctionCall(methodName, args, gas, deposit);
}

async function ftRaw(accountId: string, contractId: string) {
  const result = (await view(contractId, "ft_balance_of", { account_id: accountId })) as string | null;
  return result || "0";
}

async function view(contractId: string, method: string, args: object) {
  const urls = ["https://rpc.mainnet.near.org", "https://near.drpc.org", "https://free.rpc.fastnear.com"];
  let last = "NEAR RPC is unreachable.";
  for (const url of urls) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "asgard",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: contractId,
          method_name: method,
          args_base64: btoa(JSON.stringify(args)),
        },
      }),
    }).catch(() => null);
    if (!response?.ok) continue;
    const body = (await response.json()) as { result?: { result?: number[] }; error?: { message?: string } };
    if (body.error) {
      last = /rate limit/i.test(body.error.message ?? "") ? "NEAR RPC is busy. Retry in a moment." : body.error.message ?? last;
      continue;
    }
    const text = new TextDecoder().decode(new Uint8Array(body.result?.result ?? [])).trim();
    if (!text || text === "null") return null;
    return JSON.parse(text) as unknown;
  }
  throw new Error(last);
}
