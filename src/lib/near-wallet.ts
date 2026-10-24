import { installBrowserGlobals } from "@/lib/node-globals";
import { useDesk } from "@/lib/store";

const CONTRACT_ID = "social.near";
const KEY_STORE = "functionCallKey";
const ACCOUNT_STORE = "signedAccountId";
const READONLY_STORE = "asgardReadonly";

let booted: Promise<void> | null = null;
let modalShow: (() => void) | null = null;
let cancelPending: (() => void) | null = null;

type Selector = {
  store: { getState: () => { accounts: { accountId: string }[] } };
  on: (event: "signedIn" | "signedOut", cb: () => void) => void;
  wallet: (id?: string) => Promise<{
    signOut: () => Promise<void>;
    signIn: (args: { contractId: string; methodNames: string[] }) => Promise<unknown>;
    signAndSendTransaction: (tx: unknown) => Promise<unknown>;
  }>;
};
let selectorPromise: Promise<Selector> | null = null;

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
  await boot();
  localStorage.removeItem(ACCOUNT_STORE);
  localStorage.removeItem(KEY_STORE);
  localStorage.removeItem(READONLY_STORE);
  const walletId = useDesk.getState().accountId;
  if (!walletId) {
    useDesk.getState().setAccount(null);
    return;
  }
  const selector = await selectorPromise;
  if (!selector) return;
  try {
    const wallet = await selector.wallet();
    await wallet.signOut();
  } catch {
    /* Redirect sessions have no injected signer. */
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
  if (localStorage.getItem(READONLY_STORE)) throw new Error("This account is view-only. Connect Intear or HERE to sign.");
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
