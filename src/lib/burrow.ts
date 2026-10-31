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
  const msg = JSON.stringify({ Execute: { actions: [{ IncreaseCollateral: { token_id: token, amount: units, max_amount: units } }] } });
  await sendToken(accountId, token, units, msg);
}

export async function withdrawFromBurrow(accountId: string, token: string, amount: string, decimals: number) {
  const units = parseUnits(amount, decimals);
  if (!units) throw new Error("Enter an amount.");
  const actions = [
    nearCall("execute", {
      actions: [
        { DecreaseCollateral: { token_id: token, amount: units, max_amount: units } },
        { Withdraw: { token_id: token, amount: units, max_amount: units } },
      ],
    }, 180_000_000_000_000n, 1n),
  ];
  await sendNearTransactions(accountId, [{ receiverId: BURROW, actions }]);
}

export async function borrowFromBurrow(accountId: string, token: string, amount: string, decimals: number) {
  const units = parseUnits(amount, decimals);
  if (!units) throw new Error("Enter an amount.");
  await sendNearTransactions(accountId, [
    {
      receiverId: BURROW,
      actions: [nearCall("execute", { actions: [{ Borrow: { token_id: token, amount: units, max_amount: units } }] }, 120_000_000_000_000n, 1n)],
    },
  ]);
}

export async function repayOnBurrow(accountId: string, token: string, amount: string, decimals: number) {
  const units = parseUnits(amount, decimals);
  if (!units) throw new Error("Enter an amount.");
  const msg = JSON.stringify({ Execute: { actions: [{ Repay: { token_id: token, amount: units, max_amount: units } }] } });
  await sendToken(accountId, token, units, msg);
}

async function sendToken(accountId: string, token: string, units: string, msg: string) {
  const txs: { receiverId: string; actions: NearCall[] }[] = [];
  if (!(await isRegisteredOn(BURROW, accountId))) {
    txs.push({ receiverId: BURROW, actions: [nearCall("storage_deposit", { account_id: accountId, registration_only: true }, 30_000_000_000_000n, MIN_STORAGE)] });
  }
  if (token === "wrap.near") {
    const wrapped = BigInt(await ftRaw(accountId, token));
    const need = BigInt(units);
    const prep: NearCall[] = [];
    if (!(await isRegisteredOn(token, accountId))) prep.push(nearCall("storage_deposit", { account_id: accountId, registration_only: true }, 30_000_000_000_000n, MIN_STORAGE));
    if (wrapped < need) prep.push(nearCall("near_deposit", {}, 30_000_000_000_000n, need - wrapped));
    if (prep.length) txs.push({ receiverId: token, actions: prep });
  } else if (!(await isRegisteredOn(token, accountId))) {
    txs.push({ receiverId: token, actions: [nearCall("storage_deposit", { account_id: accountId, registration_only: true }, 30_000_000_000_000n, MIN_STORAGE)] });
  }
  txs.push({
    receiverId: token,
    actions: [nearCall("ft_transfer_call", { receiver_id: BURROW, amount: units, msg }, 180_000_000_000_000n, 1n)],
  });
  await sendNearTransactions(accountId, txs);
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
