import "@/lib/node-globals";
import { setupWalletSelector } from "@near-wallet-selector/core";
import { setupModal } from "@near-wallet-selector/modal-ui";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupHotWallet } from "@near-wallet-selector/hot-wallet";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupNightly } from "@near-wallet-selector/nightly";
import { setupSender } from "@near-wallet-selector/sender";
import { setupIntearWallet } from "@near-wallet-selector/intear-wallet";
import "@near-wallet-selector/modal-ui/styles.css";
import { useDesk } from "@/lib/store";

const CONTRACT_ID = "social.near";

let booted: Promise<void> | null = null;
let modalShow: (() => void) | null = null;

export function openNearWallets() {
  return boot().then(() => modalShow?.());
}

export async function signOutNear() {
  await boot();
  const walletId = useDesk.getState().accountId;
  if (!walletId) {
    useDesk.getState().setAccount(null);
    return;
  }
  const selector = await selectorPromise;
  if (!selector) return;
  const wallet = await selector.wallet();
  await wallet.signOut();
  useDesk.getState().setAccount(null);
}

export function restoreNearSession() {
  return boot();
}

type Selector = Awaited<ReturnType<typeof setupWalletSelector>>;
let selectorPromise: Promise<Selector> | null = null;

function boot() {
  if (typeof window === "undefined") return Promise.resolve();
  if (!booted) {
    selectorPromise = setupWalletSelector({
      network: "mainnet",
      modules: [
        setupMeteorWallet(),
        setupHotWallet(),
        setupHereWallet(),
        setupMyNearWallet(),
        setupNightly(),
        setupSender(),
        setupIntearWallet(),
      ],
    });
    booted = selectorPromise.then((selector) => {
      const apply = () => {
        const id = selector.store.getState().accounts[0]?.accountId ?? null;
        useDesk.getState().setAccount(id);
        if (id) {
          void readNearBalance(id);
          void syncWallet(id);
          void import("@/lib/intents").then((mod) => mod.resumeIntent());
        }
      };
      selector.on("signedIn", apply);
      selector.on("signedOut", apply);
      const modal = setupModal(selector, {
        contractId: CONTRACT_ID,
        methodNames: ["asgard:connect"],
        theme: "dark",
        description: "Meteor, HOT, MyNearWallet, Nightly, Sender, Intear, and HERE on NEAR mainnet.",
      });
      modalShow = () => modal.show();
      apply();
    });
  }
  return booted;
}

async function readNearBalance(accountId: string) {
  try {
    const amount = await accountAmount(accountId);
    if (useDesk.getState().accountId === accountId) useDesk.getState().setNearYocto(amount);
  } catch {
    /* Account still shows if mainnet RPC is unreachable. */
  }
}

export async function syncWallet(accountId: string) {
  const { loadNearAssets, formatUnits, resolveAsset } = await import("@/lib/intents");
  await loadNearAssets();
  const book: Record<string, number> = {};
  const near = await accountAmount(accountId);
  const wrapped = await ftBalance(accountId, "wrap.near");
  const native = near == null ? 0 : Math.max(0, formatUnits(near, 24) - 0.06);
  book.NEAR = native + formatUnits(wrapped, 24);
  if (near && useDesk.getState().accountId === accountId) useDesk.getState().setNearYocto(near);
  const symbols = ["USDC", "ETH", "wBTC", "AURORA", "RHEA", "SWEAT", "STNEAR", "USDT"];
  await Promise.all(
    symbols.map(async (symbol) => {
      const asset = await resolveAsset(symbol);
      if (!asset?.contractAddress) return;
      const units = await ftBalance(accountId, asset.contractAddress);
      book[symbol] = formatUnits(units, asset.decimals);
    }),
  );
  if (useDesk.getState().accountId === accountId) useDesk.getState().applyChain(book);
}

export async function sendIntentDeposit(input: {
  accountId: string;
  contractId: string;
  depositAddress: string;
  amount: string;
  wrap: boolean;
}): Promise<string | null> {
  await boot();
  const selector = await selectorPromise;
  if (!selector) throw new Error("Wallet is not ready.");
  const wallet = await selector.wallet();
  const actions = input.wrap ? await wrapActions(input.accountId, input.depositAddress, input.amount) : transferActions(input.depositAddress, input.amount);
  const outcome = await wallet.signAndSendTransaction({
    signerId: input.accountId,
    receiverId: input.contractId,
    callbackUrl: window.location.href,
    actions,
  } as never);
  return hashOf(outcome);
}

async function accountAmount(accountId: string) {
  try {
    const result = (await rpc({ request_type: "view_account", finality: "final", account_id: accountId })) as { amount?: string };
    return result.amount ?? null;
  } catch {
    return null;
  }
}

async function ftBalance(accountId: string, contractId: string) {
  try {
    const result = (await rpc({
      request_type: "call_function",
      finality: "final",
      account_id: contractId,
      method_name: "ft_balance_of",
      args_base64: btoa(JSON.stringify({ account_id: accountId })),
    })) as { result?: number[] };
    const text = new TextDecoder().decode(new Uint8Array(result.result ?? []));
    const parsed = JSON.parse(text) as string;
    return parsed || "0";
  } catch {
    return "0";
  }
}

async function rpc(params: object) {
  const response = await fetch("https://rpc.mainnet.near.org", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "asgard", method: "query", params }),
  });
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "RPC error");
  return body.result;
}

type Call = {
  type: "FunctionCall";
  params: { methodName: string; args: Record<string, unknown>; gas: string; deposit: string };
};

function transferActions(depositAddress: string, amount: string): Call[] {
  return [register(depositAddress), transfer(depositAddress, amount)];
}

async function wrapActions(accountId: string, depositAddress: string, amount: string): Promise<Call[]> {
  const wrapped = BigInt(await ftBalance(accountId, "wrap.near"));
  const need = BigInt(amount);
  const actions = [register(depositAddress)];
  if (wrapped < need) {
    actions.push({
      type: "FunctionCall",
      params: {
        methodName: "near_deposit",
        args: {},
        gas: "15000000000000",
        deposit: (need - wrapped).toString(),
      },
    });
  }
  actions.push(transfer(depositAddress, amount));
  return actions;
}

function register(accountId: string): Call {
  return {
    type: "FunctionCall",
    params: {
      methodName: "storage_deposit",
      args: { account_id: accountId, registration_only: true },
      gas: "30000000000000",
      deposit: "1250000000000000000000",
    },
  };
}

function transfer(receiverId: string, amount: string): Call {
  return {
    type: "FunctionCall",
    params: {
      methodName: "ft_transfer",
      args: { receiver_id: receiverId, amount, memo: null },
      gas: "30000000000000",
      deposit: "1",
    },
  };
}

function hashOf(outcome: unknown) {
  if (!outcome || typeof outcome !== "object") return null;
  return (outcome as { transaction?: { hash?: string } }).transaction?.hash ?? null;
}
