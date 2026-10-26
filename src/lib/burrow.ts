import { parseUnits } from "@/lib/intents";
import { TOKENS } from "@/lib/market";
import { isRegisteredOn, nearFunctionCall, sendNearTransactions, type NearCall } from "@/lib/near-wallet";

const BURROW = "contract.main.burrow.near";
const MIN_STORAGE = 100_000_000_000_000_000_000_000n;

export async function readBurrow(accountId: string) {
  const result = (await view(BURROW, "get_account", { account_id: accountId })) as {
    supplied?: { token_id?: string; balance?: string }[];
    collateral?: { token_id?: string; balance?: string }[];
    borrowed?: { token_id?: string; balance?: string }[];
  } | null;
  const supplied: Record<string, number> = {};
  const borrowed: Record<string, number> = {};
  for (const row of [...(result?.supplied ?? []), ...(result?.collateral ?? [])]) add(supplied, row.token_id, row.balance);
  for (const row of result?.borrowed ?? []) add(borrowed, row.token_id, row.balance);
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
    }, 180_000_000_000_000n, 0n),
  ];
  await sendNearTransactions(accountId, [{ receiverId: BURROW, actions }]);
}

export async function borrowFromBurrow(accountId: string, token: string, amount: string, decimals: number) {
  const units = parseUnits(amount, decimals);
  if (!units) throw new Error("Enter an amount.");
  await sendNearTransactions(accountId, [
    {
      receiverId: BURROW,
      actions: [nearCall("execute", { actions: [{ Borrow: { token_id: token, amount: units, max_amount: units } }] }, 120_000_000_000_000n, 0n)],
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

function add(book: Record<string, number>, tokenId: string | undefined, balance: string | undefined) {
  if (!tokenId || !balance) return;
  const token = TOKENS.find((item) => item.address?.toLowerCase() === tokenId.toLowerCase());
  const decimals = token?.decimals ?? (tokenId === "wrap.near" || tokenId === "meta-pool.near" ? 24 : 18);
  const pad = balance.padStart(decimals + 1, "0");
  const whole = pad.slice(0, -decimals) || "0";
  const frac = pad.slice(-decimals).slice(0, 8).replace(/0+$/, "");
  const amount = Number(frac ? `${whole}.${frac}` : whole);
  if (!(amount > 0)) return;
  const symbol = token?.symbol ?? (tokenId === "wrap.near" ? "NEAR" : tokenId);
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
  const response = await fetch("https://free.rpc.fastnear.com", {
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
  });
  const body = (await response.json()) as { result?: { result?: number[] }; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "NEAR RPC error");
  const text = new TextDecoder().decode(new Uint8Array(body.result?.result ?? [])).trim();
  if (!text || text === "null") return null;
  return JSON.parse(text) as unknown;
}
