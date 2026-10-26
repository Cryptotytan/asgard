import { actionCreators } from "@near-js/transactions";
import { installBrowserGlobals } from "@/lib/node-globals";
import { TOKENS } from "@/lib/market";
import { useDesk } from "@/lib/store";

const CONTRACT_ID = "social.near";
const KEY_STORE = "functionCallKey";
const ACCOUNT_STORE = "signedAccountId";
const READONLY_STORE = "asgardReadonly";

let booted: Promise<void> | null = null;
let modalShow: (() => void) | null = null;
let cancelPending: (() => void) | null = null;

type WalletApi = {
  signOut: () => Promise<void>;
  signIn: (args: { contractId: string; methodNames: string[] }) => Promise<unknown>;
  signAndSendTransaction: (tx: unknown) => Promise<unknown>;
  signAndSendTransactions?: (input: { transactions: { signerId: string; receiverId: string; actions: Call[] }[] }) => Promise<unknown>;
};
let selectorPromise: Promise<Selector> | null = null;

type Selector = {
  store: { getState: () => { accounts: { accountId: string }[] } };
  on: (event: "signedIn" | "signedOut", cb: () => void) => void;
  wallet: (id?: string) => Promise<WalletApi>;
};

function stashRedirectAccount() {
  if (typeof window === "undefined") return;
  const accountId = new URL(window.location.href).searchParams.get("account_id");
  if (accountId) localStorage.setItem(ACCOUNT_STORE, accountId);
}

export function completeNearRedirect() {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  const accountId = url.searchParams.get("account_id");
  if (!accountId) return false;
  localStorage.setItem(ACCOUNT_STORE, accountId);
  useDesk.getState().setAccount(accountId);
  void readNearBalance(accountId);
  void syncWallet(accountId);
  url.searchParams.delete("account_id");
  url.searchParams.delete("public_key");
  url.searchParams.delete("all_keys");
  url.searchParams.delete("errorCode");
  url.searchParams.delete("errorMessage");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  return true;
}

export async function connectIntearWallet() {
  await connectNamed("intear-wallet");
}

export async function connectHereWallet() {
  await connectNamed("here-wallet");
}

export async function connectSelectorWallet(id: "intear-wallet" | "here-wallet" | "meteor-wallet" | "hot-wallet" | "nightly" | "sender") {
  await connectNamed(id);
}

export async function connectReadOnly(raw: string) {
  const accountId = raw.trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,64}$/.test(accountId)) throw new Error("Enter a NEAR account such as name.near.");
  const amount = await accountAmount(accountId);
  if (amount == null) throw new Error("That account is not on NEAR mainnet.");
  localStorage.setItem(ACCOUNT_STORE, accountId);
  localStorage.setItem(READONLY_STORE, "1");
  useDesk.getState().setAccount(accountId);
  useDesk.getState().setNearYocto(amount);
  await syncWallet(accountId);
}

async function connectNamed(id: "intear-wallet" | "here-wallet" | "meteor-wallet" | "hot-wallet" | "nightly" | "sender") {
  await boot();
  const selector = await selectorPromise;
  if (!selector) throw new Error("Wallet selector did not start.");
  localStorage.removeItem(READONLY_STORE);
  const wallet = await selector.wallet(id);
  let rejectCancel: (error: Error) => void = () => undefined;
  const cancelled = new Promise<never>((_, reject) => {
    rejectCancel = reject;
  });
  const stop = () => rejectCancel(new Error("Wallet closed."));
  cancelPending = stop;
  try {
    await Promise.race([wallet.signIn({ contractId: CONTRACT_ID, methodNames: ["asgard:connect"] }), cancelled]);
  } finally {
    if (cancelPending === stop) cancelPending = null;
  }
}

function boot() {
  if (typeof window === "undefined") return Promise.resolve();
  hideWalletOnCancel();
  if (!booted) {
    booted = (async () => {
      installBrowserGlobals();
      const [{ setupWalletSelector }, { setupModal }, meteor, hot, here, nightly, sender, intear] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/modal-ui"),
        import("@near-wallet-selector/meteor-wallet"),
        import("@near-wallet-selector/hot-wallet"),
        import("@near-wallet-selector/here-wallet"),
        import("@near-wallet-selector/nightly"),
        import("@near-wallet-selector/sender"),
        import("@near-wallet-selector/intear-wallet"),
        import("@near-wallet-selector/modal-ui/styles.css"),
      ]);
      const selector = await setupWalletSelector({
        network: "mainnet",
        modules: [
          here.setupHereWallet(),
          intear.setupIntearWallet(),
          meteor.setupMeteorWallet(),
          hot.setupHotWallet(),
          nightly.setupNightly(),
          sender.setupSender(),
        ],
      });
      selectorPromise = Promise.resolve(selector as Selector);
      const apply = () => {
        const signed = selector.store.getState().accounts[0]?.accountId;
        if (signed) localStorage.removeItem(READONLY_STORE);
        const id = signed ?? localStorage.getItem(ACCOUNT_STORE);
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
        description: "HERE and Intear sign on this page. Meteor, HOT, Nightly, and Sender need their extension.",
      });
      modalShow = () => modal.show();
      apply();
      completeNearRedirect();
    })().catch((error) => {
      booted = null;
      selectorPromise = null;
      throw error;
    });
  }
  return booted;
}

export function openNearWallets() {
  return boot().then(() => {
    if (!modalShow) throw new Error("Wallet list did not open.");
    modalShow();
  });
}

export async function signOutNear() {
  await boot().catch(() => undefined);
  localStorage.removeItem(ACCOUNT_STORE);
  localStorage.removeItem(KEY_STORE);
  localStorage.removeItem(READONLY_STORE);
  const selector = await selectorPromise;
  if (selector) {
    try {
      const wallet = await selector.wallet();
      await wallet.signOut();
    } catch {
      /* Redirect sessions have no injected signer. */
    }
  }
  useDesk.getState().setAccount(null);
}

export function restoreNearSession() {
  stashRedirectAccount();
  return boot();
}

let hereCancelWired = false;

function visibleWalletFrame() {
  const frames = document.querySelectorAll("iframe");
  for (const frame of frames) {
    if (!(frame instanceof HTMLIFrameElement)) continue;
    const src = frame.src;
    if (!src.includes("herewallet.app") && !src.includes("intear.tech")) continue;
    if (frame.style.display === "none" || getComputedStyle(frame).display === "none") continue;
    return frame;
  }
  return null;
}

function hideWalletFrame() {
  document.querySelectorAll('iframe[src*="herewallet.app"], iframe[src*="intear.tech"]').forEach((frame) => {
    if (frame instanceof HTMLIFrameElement) frame.style.display = "none";
  });
  window.postMessage({ type: "close", message: "Wallet closed." }, window.location.origin);
  document.getElementById("asgard-here-close")?.remove();
  cancelPending?.();
}

function placeWalletClose() {
  const frame = visibleWalletFrame();
  let button = document.getElementById("asgard-here-close") as HTMLButtonElement | null;
  if (!frame) {
    button?.remove();
    return;
  }
  if (!button) {
    button = document.createElement("button");
    button.id = "asgard-here-close";
    button.type = "button";
    button.setAttribute("aria-label", "Close wallet");
    button.textContent = "Close";
    button.style.cssText = [
      "position:fixed",
      "z-index:100002",
      "height:36px",
      "padding:0 14px",
      "border:0",
      "border-radius:999px",
      "background:#ebdedc",
      "color:#2c3034",
      "font:600 13px/1 system-ui,sans-serif",
      "cursor:pointer",
    ].join(";");
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideWalletFrame();
    });
    document.body.appendChild(button);
  }
  const here = frame.src.includes("herewallet.app");
  if (!here) {
    button.style.top = "12px";
    button.style.right = "12px";
    return;
  }
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const narrow = viewportWidth <= 640;
  const cardWidth = Math.min(viewportWidth, 720);
  const cardHeight = Math.min(viewportHeight, 520);
  const inset = narrow ? 16 : 32;
  const right = (viewportWidth - cardWidth) / 2 + inset - 4;
  const top = (narrow ? viewportHeight - cardHeight : (viewportHeight - cardHeight) / 2) + inset - 4;
  button.style.right = `${Math.max(8, right)}px`;
  button.style.top = `${Math.max(8, top)}px`;
}

function hideWalletOnCancel() {
  if (hereCancelWired || typeof window === "undefined") return;
  hereCancelWired = true;
  window.addEventListener("message", (event) => {
    if (!event.origin.endsWith("herewallet.app")) return;
    let type = "";
    try {
      const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      type = data?.type ?? "";
    } catch {
      return;
    }
    if (type === "reject" || type === "close") {
      document.querySelectorAll('iframe[src*="herewallet.app"]').forEach((frame) => {
        if (frame instanceof HTMLIFrameElement) frame.style.display = "none";
      });
      document.getElementById("asgard-here-close")?.remove();
    }
  });
  window.setInterval(placeWalletClose, 300);
  window.addEventListener("resize", placeWalletClose);
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
  const key = accountId.trim().toLowerCase();
  if (useDesk.getState().accountId !== key) return;
  const [near, inventoryRes] = await Promise.all([
    accountAmount(key),
    fetch(`https://api.nearblocks.io/v1/account/${encodeURIComponent(key)}/inventory`).catch(() => null),
  ]);
  if (useDesk.getState().accountId !== key) return;
  const inventory = inventoryRes && inventoryRes.ok ? ((await inventoryRes.json()) as { inventory?: { fts?: { contract?: string; amount?: string; ft_meta?: { symbol?: string; decimals?: number } }[] } }) : {};
  const book: Record<string, number> = {};
  if (near) {
    const native = Math.max(0, Number(near) / 1e24);
    if (native > 0) book.NEAR = native;
    useDesk.getState().setNearYocto(near);
  }
  const seen = new Set<string>();
  for (const row of inventory.inventory?.fts ?? []) {
    const contract = (row.contract ?? "").toLowerCase();
    if (!contract) continue;
    seen.add(contract);
    const decimals = row.ft_meta?.decimals ?? decimalsOf(contract);
    const amount = human(row.amount ?? "0", decimals);
    if (amount <= 0) continue;
    addBalance(book, contract, row.ft_meta?.symbol ?? "", amount);
  }
  const extra = TOKENS.filter((token) => token.chain === "NEAR" && token.address && !seen.has(token.address.toLowerCase()));
  await Promise.all(
    extra.map(async (token) => {
      const contract = token.address ?? "";
      const raw = await ftBalance(key, contract);
      const amount = human(raw, token.decimals ?? decimalsOf(contract));
      if (amount <= 0) return;
      addBalance(book, contract, token.symbol, amount);
    }),
  );
  if (useDesk.getState().accountId !== key) return;
  useDesk.getState().applyChain(book);
  const { readBurrow } = await import("@/lib/burrow");
  const lending = await readBurrow(key).catch(() => null);
  if (lending && useDesk.getState().accountId === key) useDesk.getState().setLending(lending.supplied, lending.borrowed);
}

function addBalance(book: Record<string, number>, contract: string, raw: string, amount: number) {
  const symbol = terminalSymbol(contract, raw);
  if (!symbol) return;
  book[symbol] = (book[symbol] ?? 0) + amount;
  const token = TOKENS.find((item) => item.symbol === symbol);
  if (token && amount > 0) token.listed = true;
}

function decimalsOf(contract: string) {
  const known: Record<string, number> = {
    "wrap.near": 24,
    "meta-pool.near": 24,
    "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": 6,
    "usdt.tether-token.near": 6,
    "eth.bridge.near": 18,
    "2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near": 8,
    "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near": 18,
    "token.sweat": 18,
    "token.rhealab.near": 18,
  };
  return known[contract] ?? TOKENS.find((token) => token.address?.toLowerCase() === contract)?.decimals ?? 24;
}

function human(raw: string, decimals: number) {
  if (!/^\d+$/.test(raw) || raw === "0") return 0;
  const pad = raw.padStart(decimals + 1, "0");
  const whole = pad.slice(0, -decimals) || "0";
  const frac = pad.slice(-decimals).slice(0, 8).replace(/0+$/, "");
  const value = Number(frac ? `${whole}.${frac}` : whole);
  return Number.isFinite(value) ? value : 0;
}

function terminalSymbol(contract: string, raw: string) {
  const known: Record<string, string> = {
    "wrap.near": "NEAR",
    "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": "USDC",
    "usdt.tether-token.near": "USDT",
    "eth.bridge.near": "ETH",
    "2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near": "wBTC",
    "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near": "AURORA",
    "meta-pool.near": "STNEAR",
    "token.rhealab.near": "RHEA",
    "token.sweat": "SWEAT",
  };
  if (known[contract]) return known[contract];
  const mapped = TOKENS.find((token) => token.address?.toLowerCase() === contract);
  if (mapped) return mapped.symbol;
  const cleaned = raw.replace(/\s/g, "");
  const byName = TOKENS.find((token) => !token.address && token.symbol.toLowerCase() === cleaned.toLowerCase());
  return byName?.symbol ?? cleaned;
}

export async function sendIntentDeposit(input: {
  accountId: string;
  contractId: string;
  depositAddress: string;
  amount: string;
  wrap: boolean;
}): Promise<string | null> {
  if (localStorage.getItem(READONLY_STORE)) throw new Error("This account is view-only. Connect Intear or HERE to sign.");
  const registerRecipient = !(await isRegistered(input.contractId, input.depositAddress));
  const actions = input.wrap
    ? await wrapActions(input.accountId, input.depositAddress, input.amount, registerRecipient)
    : transferActions(input.depositAddress, input.amount, registerRecipient);
  const outcome = await sendNearTransactions(input.accountId, [{ receiverId: input.contractId, actions }]);
  return hashOf(outcome);
}

export async function stakeNear(accountId: string, yocto: string) {
  if (localStorage.getItem(READONLY_STORE)) throw new Error("This account is view-only. Connect a wallet to sign.");
  if (!/^\d+$/.test(yocto) || yocto === "0") throw new Error("Enter an amount.");
  const outcome = await sendNearTransactions(accountId, [
    {
      receiverId: "meta-pool.near",
      actions: [call("deposit_and_stake", {}, 80_000_000_000_000n, BigInt(yocto))],
    },
  ]);
  return hashOf(outcome);
}

export async function sendNearTransactions(accountId: string, transactions: { receiverId: string; actions: Call[] }[]) {
  if (localStorage.getItem(READONLY_STORE)) throw new Error("This account is view-only. Connect a wallet to sign.");
  await boot();
  const selector = await selectorPromise;
  if (!selector) throw new Error("Wallet is not ready.");
  const wallet = await selector.wallet();
  const built = transactions.map((tx) => ({ signerId: accountId, receiverId: tx.receiverId, actions: tx.actions }));
  const before = new URL(window.location.href).searchParams.get("transactionHashes");
  const sent = built.length > 1 && wallet.signAndSendTransactions ? wallet.signAndSendTransactions({ transactions: built }) : sendOneByOne(wallet, built);
  try {
    return await Promise.race([sent, redirectHash(before)]);
  } catch (error) {
    const hash = new URL(window.location.href).searchParams.get("transactionHashes");
    if (hash && hash !== before) return hash.split(",")[0] ?? hash;
    throw error instanceof Error ? error : new Error("The NEAR wallet rejected the transaction.");
  }
}

function sendOneByOne(wallet: WalletApi, built: { signerId: string; receiverId: string; actions: Call[] }[]) {
  return (async () => {
    let last: unknown = null;
    for (const tx of built) last = await wallet.signAndSendTransaction(tx);
    return last;
  })();
}

function redirectHash(before: string | null) {
  return new Promise<string>((resolve) => {
    const timer = window.setInterval(() => {
      const hash = new URL(window.location.href).searchParams.get("transactionHashes");
      if (hash && hash !== before) {
        window.clearInterval(timer);
        resolve(hash.split(",")[0] ?? hash);
      }
    }, 400);
  });
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
  const urls = ["https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org"];
  let last = "NEAR RPC is unreachable.";
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "asgard", method: "query", params }),
      });
      const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
      if (body.error) {
        last = body.error.message ?? last;
        continue;
      }
      if (body.result !== undefined) return body.result;
    } catch (error) {
      last = error instanceof Error ? error.message : last;
    }
  }
  throw new Error(last);
}

type Call = ReturnType<typeof actionCreators.functionCall>;
export type NearCall = Call;

function call(methodName: string, args: object, gas: bigint, deposit: bigint): Call {
  return actionCreators.functionCall(methodName, args, gas, deposit);
}

export function nearFunctionCall(methodName: string, args: object, gas: bigint, deposit: bigint): Call {
  return call(methodName, args, gas, deposit);
}

export async function isRegisteredOn(contractId: string, accountId: string) {
  return isRegistered(contractId, accountId);
}

async function isRegistered(contractId: string, accountId: string) {
  try {
    const result = (await rpc({
      request_type: "call_function",
      finality: "final",
      account_id: contractId,
      method_name: "storage_balance_of",
      args_base64: btoa(JSON.stringify({ account_id: accountId })),
    })) as { result?: number[] };
    const text = new TextDecoder().decode(new Uint8Array(result.result ?? [])).trim();
    return text !== "" && text !== "null";
  } catch {
    return false;
  }
}

function transferActions(depositAddress: string, amount: string, registerRecipient: boolean): Call[] {
  const actions = registerRecipient ? [register(depositAddress)] : [];
  actions.push(transfer(depositAddress, amount));
  return actions;
}

async function wrapActions(accountId: string, depositAddress: string, amount: string, registerRecipient: boolean): Promise<Call[]> {
  const wrapped = BigInt(await ftBalance(accountId, "wrap.near"));
  const need = BigInt(amount);
  const actions: Call[] = [];
  if (!(await isRegistered("wrap.near", accountId))) actions.push(register(accountId));
  if (registerRecipient && depositAddress !== accountId) actions.push(register(depositAddress));
  if (wrapped < need) {
    actions.push(call("near_deposit", {}, 30_000_000_000_000n, need - wrapped));
  }
  actions.push(transfer(depositAddress, amount));
  return actions;
}

function register(accountId: string): Call {
  return call("storage_deposit", { account_id: accountId, registration_only: true }, 30_000_000_000_000n, 1_250_000_000_000_000_000_000n);
}

function transfer(receiverId: string, amount: string): Call {
  return call("ft_transfer", { receiver_id: receiverId, amount }, 30_000_000_000_000n, 1n);
}

function hashOf(outcome: unknown): string | null {
  if (typeof outcome === "string" && outcome.length >= 20) return outcome;
  if (Array.isArray(outcome)) return hashOf(outcome[0]);
  if (!outcome || typeof outcome !== "object") return null;
  const row = outcome as { transaction?: { hash?: string }; transaction_outcome?: { id?: string }; txHash?: string; transactionHashes?: string[] | string };
  if (Array.isArray(row.transactionHashes)) return row.transactionHashes[0] ?? null;
  if (typeof row.transactionHashes === "string") return row.transactionHashes.split(",")[0] || null;
  return row.transaction?.hash ?? row.transaction_outcome?.id ?? row.txHash ?? null;
}
