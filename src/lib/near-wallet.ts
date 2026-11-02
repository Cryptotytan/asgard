import { actionCreators } from "@near-js/transactions";
import { installBrowserGlobals } from "@/lib/node-globals";
import { ensureToken, TOKENS } from "@/lib/market";
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
        network: {
          networkId: "mainnet",
          nodeUrl: "https://rpc.mainnet.near.org",
          helperUrl: "https://helper.mainnet.near.org",
          explorerUrl: "https://nearblocks.io",
          indexerUrl: "https://api.fastnear.com/v1",
        },
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

let hotWallet: WalletApi | null = null;

export function warmNearSigner() {
  void boot()
    .then(async () => {
      const selector = await selectorPromise;
      if (!selector) return;
      hotWallet = await selector.wallet().catch(() => null);
    })
    .catch(() => undefined);
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
  warmNearSigner();
  return boot();
}

let signAbort: (() => void) | null = null;
let redirectTimer = 0;
let nativeOpen: typeof window.open | null = null;
let primed: Window | null = null;
let primedUsed = false;
let restoreTimer = 0;
let abandonSign = false;

function hasInjectedSigner() {
  const host = window as Window & {
    meteor_wallet?: unknown;
    hotWallet?: unknown;
    nightly?: { near?: unknown };
    near?: { isSender?: boolean };
  };
  return Boolean(host.meteor_wallet || host.hotWallet || host.nightly?.near || host.near?.isSender);
}

export function armWalletPopup() {
  if (typeof window === "undefined") return;
  abandonSign = false;
  if (hasInjectedSigner()) return;
  disarmWalletPopup();
  primedUsed = false;
  const native = (nativeOpen ?? window.open).bind(window);
  nativeOpen = native;
  const name = `asgard-${Date.now()}`;
  primed = native("about:blank", name, "popup=1,width=440,height=760");
  if (!primed) return;
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const href = url == null ? "" : String(url);
    const reserved = primed;
    if (!primedUsed && reserved && !reserved.closed && href && !href.startsWith("about:") && !href.startsWith("blob:")) {
      try {
        reserved.location.replace(href);
        primedUsed = true;
        window.open = native;
        return reserved;
      } catch {
        /* The reserved window is no longer ours. Open a real one. */
      }
    }
    return native(url as string, target, features);
  }) as typeof window.open;
  restoreTimer = window.setTimeout(() => disarmWalletPopup(), 45000);
}

export function disarmWalletPopup() {
  if (typeof window === "undefined") return;
  if (restoreTimer) window.clearTimeout(restoreTimer);
  restoreTimer = 0;
  if (nativeOpen) window.open = nativeOpen;
  nativeOpen = null;
  if (primed && !primedUsed && !primed.closed) primed.close();
  primed = null;
  primedUsed = false;
}

export function closeSparePopup() {
  if (primed && !primedUsed && !primed.closed) primed.close();
}

export function cancelNearSigning() {
  abandonSign = true;
  hideWalletFrame();
  signAbort?.();
  signAbort = null;
  if (redirectTimer) window.clearInterval(redirectTimer);
  redirectTimer = 0;
  disarmWalletPopup();
}

function walletSurfaceOpen() {
  if (visibleWalletFrame()) return true;
  if (document.querySelector("#near-wallet-selector-modal .nws-modal-wrapper.open")) return true;
  for (const node of document.querySelectorAll("body > div, body > iframe")) {
    if (!(node instanceof HTMLElement)) continue;
    const z = Number(node.style.zIndex || getComputedStyle(node).zIndex);
    if (z >= 10000 && getComputedStyle(node).position === "fixed" && getComputedStyle(node).display !== "none") return true;
  }
  return false;
}

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
  document.querySelectorAll('iframe[src*="herewallet.app"], iframe[src*="intear.tech"], iframe[src*="intear"]').forEach((frame) => {
    if (!(frame instanceof HTMLIFrameElement)) return;
    frame.dataset.asgardHold = "1";
    frame.style.display = "none";
  });
  document.getElementById("asgard-here-close")?.remove();
  cancelPending?.();
}

function releaseHeldFrames() {
  document.querySelectorAll("iframe[data-asgard-hold='1']").forEach((frame) => {
    if (!(frame instanceof HTMLIFrameElement)) return;
    frame.style.display = "block";
    frame.style.zIndex = "200001";
    delete frame.dataset.asgardHold;
  });
}

function placeWalletClose() {
  if (walletSurfaceOpen()) closeSparePopup();
  const frame = visibleWalletFrame();
  let button = document.getElementById("asgard-here-close") as HTMLButtonElement | null;
  if (!frame) {
    button?.remove();
    return;
  }
  closeSparePopup();
  if (!button) {
    button = document.createElement("button");
    button.id = "asgard-here-close";
    button.type = "button";
    button.setAttribute("aria-label", "Close wallet");
    button.textContent = "Close";
    button.style.cssText = [
      "position:fixed",
      "z-index:200002",
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
  closeSparePopup();
}

let hereCancelWired = false;

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

const pendingBalances = new Map<string, { target: number; dir: 1 | -1; until: number }>();

function overlayBalances(book: Record<string, number>) {
  const now = Date.now();
  for (const [symbol, item] of pendingBalances) {
    if (item.until < now) {
      pendingBalances.delete(symbol);
      continue;
    }
    const got = book[symbol] ?? 0;
    if (item.dir > 0) {
      if (got + 1e-8 >= item.target * 0.8 && got > 0) pendingBalances.delete(symbol);
      else if (item.target > got) book[symbol] = item.target;
    } else if (got <= item.target + 1e-8) {
      pendingBalances.delete(symbol);
    } else {
      book[symbol] = item.target;
    }
  }
  return book;
}

export function settleHoldings(accountId: string, moves: { symbol: string; delta: number }[]) {
  const state = useDesk.getState();
  if (!accountId || state.accountId !== accountId.trim().toLowerCase()) return;
  const chain = { ...state.chain };
  const focus: string[] = [];
  for (const move of moves) {
    if (!move.symbol || !Number.isFinite(move.delta) || move.delta === 0) continue;
    const target = Math.max(0, (chain[move.symbol] ?? 0) + move.delta);
    chain[move.symbol] = target;
    pendingBalances.set(move.symbol, { target, dir: move.delta > 0 ? 1 : -1, until: Date.now() + 180_000 });
    focus.push(move.symbol);
  }
  state.applyChain(chain);
  const pull = () => {
    if (useDesk.getState().accountId === accountId.trim().toLowerCase()) void syncWallet(accountId, focus);
  };
  pull();
  for (const delay of [2000, 5000, 12000, 25000]) window.setTimeout(pull, delay);
}

const FT_META: Record<string, { symbol: string; decimals: number }> = {
  "wrap.near": { symbol: "NEAR", decimals: 24 },
  "meta-pool.near": { symbol: "STNEAR", decimals: 24 },
  "usdt.tether-token.near": { symbol: "USDT", decimals: 6 },
  "dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near": { symbol: "USDT", decimals: 6 },
  "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1": { symbol: "USDC", decimals: 6 },
  "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near": { symbol: "USDC", decimals: 6 },
  "eth.bridge.near": { symbol: "ETH", decimals: 18 },
  "2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near": { symbol: "wBTC", decimals: 8 },
  "aaaaaa20d9e0e2461697782ef11675f668207961.factory.bridge.near": { symbol: "AURORA", decimals: 18 },
  "token.sweat": { symbol: "SWEAT", decimals: 18 },
  "token.rhealab.near": { symbol: "RHEA", decimals: 18 },
};

let refMeta: Map<string, { symbol: string; decimals: number }> | null = null;
let refMetaFlight: Promise<Map<string, { symbol: string; decimals: number }>> | null = null;

function refMetadata() {
  if (refMeta) return Promise.resolve(refMeta);
  if (refMetaFlight) return refMetaFlight;
  refMetaFlight = fetch("https://indexer.ref.finance/list-token")
    .then(async (response) => {
      const map = new Map<string, { symbol: string; decimals: number }>();
      if (response.ok) {
        const data = (await response.json()) as Record<string, { symbol?: string; decimals?: number }>;
        for (const [id, row] of Object.entries(data)) {
          if (!row?.symbol || !(Number(row.decimals) > 0)) continue;
          map.set(id.toLowerCase(), { symbol: row.symbol.replace(/\s/g, ""), decimals: Number(row.decimals) });
        }
      }
      refMeta = map;
      return map;
    })
    .catch(() => {
      refMeta = new Map();
      return refMeta;
    })
    .finally(() => {
      refMetaFlight = null;
    });
  return refMetaFlight;
}

function metaFor(contract: string, meta: Map<string, { symbol: string; decimals: number }>) {
  return FT_META[contract] ?? meta.get(contract) ?? null;
}

const HOLDING_CACHE = "asgard-holdings-v1";
let syncFlight: Promise<void> | null = null;
let syncFor = "";

function peekHoldings(key: string) {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${HOLDING_CACHE}:${key}`);
    if (!raw) return null;
    const book = JSON.parse(raw) as Record<string, number>;
    return book && typeof book === "object" ? book : null;
  } catch {
    return null;
  }
}

function storeHoldings(key: string, book: Record<string, number>) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(`${HOLDING_CACHE}:${key}`, JSON.stringify(book));
  } catch {
    /* private mode */
  }
}

function publishHoldings(key: string, book: Record<string, number>) {
  if (useDesk.getState().accountId !== key) return;
  const next = overlayBalances(book);
  useDesk.getState().applyChain(next);
  storeHoldings(key, next);
}

type FastAccount = { tokens?: { contract_id?: string; balance?: string }[]; state?: { balance?: string } };
type InventoryAccount = { inventory?: { fts?: { contract?: string; amount?: string; ft_meta?: { symbol?: string; decimals?: number } }[] } };

function assembleWallet(fast: FastAccount | null, inventory: InventoryAccount | null, meta: Map<string, { symbol: string; decimals: number }>) {
  const book: Record<string, number> = {};
  const nearRaw = fast?.state?.balance ?? "";
  if (/^\d+$/.test(nearRaw) && nearRaw !== "0") {
    const native = Number(nearRaw) / 1e24;
    if (native > 0) book.NEAR = native;
  }
  const seen = new Set<string>();
  for (const row of fast?.tokens ?? []) {
    const contract = (row.contract_id ?? "").toLowerCase();
    const raw = row.balance ?? "";
    if (!contract || contract === "wrap.near" || !/^\d+$/.test(raw)) continue;
    if (raw === "0") {
      seen.add(contract);
      continue;
    }
    const known = metaFor(contract, meta);
    const decimals = known?.decimals ?? 0;
    if (decimals <= 0) continue;
    seen.add(contract);
    const amount = human(raw, decimals);
    if (amount > 0) addBalance(book, contract, known?.symbol ?? "", amount);
  }
  for (const row of inventory?.inventory?.fts ?? []) {
    const contract = (row.contract ?? "").toLowerCase();
    if (!contract || contract === "wrap.near" || seen.has(contract)) continue;
    const decimals = row.ft_meta?.decimals || metaFor(contract, meta)?.decimals || 0;
    const amount = human(row.amount ?? "0", decimals);
    if (amount > 0) addBalance(book, contract, row.ft_meta?.symbol || metaFor(contract, meta)?.symbol || "", amount);
  }
  return book;
}

export async function syncWallet(accountId: string, _focus: string[] = [], fresh = false) {
  const key = accountId.trim().toLowerCase();
  if (useDesk.getState().accountId !== key) return;
  if (!Object.keys(useDesk.getState().chain).length) {
    const cached = peekHoldings(key);
    if (cached) publishHoldings(key, cached);
  }
  if (!fresh && syncFlight && syncFor === key) return syncFlight;
  syncFor = key;
  const run = loadWallet(key);
  syncFlight = run.finally(() => {
    if (syncFlight === run) syncFlight = null;
  });
  return run;
}

async function loadWallet(key: string) {
  const fastP = fetch(`https://api.fastnear.com/v1/account/${encodeURIComponent(key)}/full`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  const invP = fetch(`https://api.nearblocks.io/v1/account/${encodeURIComponent(key)}/inventory`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  const meta = refMeta ?? new Map<string, { symbol: string; decimals: number }>();
  const winner = await Promise.race([
    fastP.then((res) => ({ which: "fast" as const, res })),
    invP.then((res) => ({ which: "inv" as const, res })),
  ]);
  let fast: FastAccount | null = null;
  let inventory: InventoryAccount | null = null;
  if (winner.res?.ok) {
    const body = (await winner.res.json()) as FastAccount & InventoryAccount;
    if (winner.which === "fast") fast = body;
    else inventory = body;
    const early = assembleWallet(fast, inventory, meta);
    if (early.NEAR || Object.keys(early).length) publishHoldings(key, early);
  }
  const [fastRes, invRes] = await Promise.all([fastP, invP]);
  if (useDesk.getState().accountId !== key) return;
  if (!fast && fastRes?.ok) fast = (await fastRes.json()) as FastAccount;
  if (!inventory && invRes?.ok) inventory = (await invRes.json()) as InventoryAccount;
  const book = assembleWallet(fast, inventory, refMeta ?? meta);
  if (book.NEAR || Object.keys(book).length) publishHoldings(key, book);
  void accountAmount(key).then((amount) => {
    if (amount && useDesk.getState().accountId === key) useDesk.getState().setNearYocto(amount);
  });
  void metaStakeOf(key)
    .then((staked) => {
      if (!(staked > 0) || useDesk.getState().accountId !== key) return;
      const current = { ...useDesk.getState().chain };
      if (staked > (current.STNEAR ?? 0)) current.STNEAR = staked;
      publishHoldings(key, current);
    })
    .catch(() => undefined);
  void import("@/lib/burrow").then(({ readBurrow }) =>
    readBurrow(key)
      .then((lending) => {
        if (lending && useDesk.getState().accountId === key) useDesk.getState().setLending(lending.supplied, lending.borrowed);
      })
      .catch(() => undefined),
  );
  if (!refMeta) {
    void refMetadata().then((full) => {
      if (useDesk.getState().accountId !== key) return;
      const richer = assembleWallet(fast, inventory, full);
      if (richer.NEAR || Object.keys(richer).length) publishHoldings(key, richer);
    });
  }
}

if (typeof window !== "undefined") void refMetadata();

function addBalance(book: Record<string, number>, contract: string, raw: string, amount: number) {
  const symbol = terminalSymbol(contract, raw);
  if (!symbol) return;
  book[symbol] = (book[symbol] ?? 0) + amount;
  const known = TOKENS.find((item) => item.symbol === symbol || item.address?.toLowerCase() === contract);
  if (known) {
    if (amount > 0) known.listed = true;
    return;
  }
  if (amount > 0 && symbol) ensureToken({ symbol, name: raw || symbol, price: 0, chain: "NEAR", address: contract }).listed = true;
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
  if (!/^\d+$/.test(raw) || raw === "0" || decimals <= 0) return 0;
  const pad = raw.padStart(decimals + 1, "0");
  const whole = pad.slice(0, -decimals) || "0";
  const frac = pad.slice(-decimals).slice(0, 8).replace(/0+$/, "");
  const value = Number(frac ? `${whole}.${frac}` : whole);
  return Number.isFinite(value) ? value : 0;
}

function terminalSymbol(contract: string, raw: string) {
  if (FT_META[contract]) return FT_META[contract].symbol;
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
  if (BigInt(yocto) < 1_000_000_000_000_000_000_000_000n) {
    await stakeOnMarket(accountId, yocto);
    return null;
  }
  const outcome = await sendNearTransactions(accountId, [
    {
      receiverId: "meta-pool.near",
      actions: [call("deposit_and_stake", {}, 150_000_000_000_000n, BigInt(yocto))],
    },
  ]);
  return hashOf(outcome);
}

const REF_STORAGE = 10_000_000_000_000_000_000_000n;
const wrappedCache = new Map<string, Promise<string>>();

function wrappedBalance(accountId: string) {
  const hit = wrappedCache.get(accountId);
  if (hit) return hit;
  const job = ftBalance(accountId, "wrap.near").then((value) => value || "0");
  wrappedCache.set(accountId, job);
  void job.finally(() => {
    window.setTimeout(() => wrappedCache.delete(accountId), 20_000);
  });
  return job;
}

export function warmSmallStake(accountId: string) {
  void isRegistered("wrap.near", accountId);
  void isRegistered("v2.ref-finance.near", accountId);
  void isRegistered("meta-pool.near", accountId);
  void wrappedBalance(accountId);
  void storageDepositAmount("v2.ref-finance.near", REF_STORAGE);
  void storageDepositAmount("meta-pool.near", 1_250_000_000_000_000_000_000n);
  void storageDepositAmount("wrap.near", 1_250_000_000_000_000_000_000n);
}

async function stakeOnMarket(accountId: string, yocto: string) {
  const ready = await (vaultQuotes.get(`market:${yocto}`) ?? findRef("wrap.near", "meta-pool.near", yocto));
  if (!ready) throw new Error("No stNEAR market can take that size right now.");
  const spend = BigInt(ready.hops[0]?.amount_in || yocto);
  const [onWrap, onRef, onSt, wrappedRaw, refStorage, stStorage, wrapStorage] = await Promise.all([
    isRegistered("wrap.near", accountId),
    isRegistered("v2.ref-finance.near", accountId),
    isRegistered("meta-pool.near", accountId),
    wrappedBalance(accountId),
    storageDepositAmount("v2.ref-finance.near", REF_STORAGE),
    storageDepositAmount("meta-pool.near", 1_250_000_000_000_000_000_000n),
    storageDepositAmount("wrap.near", 1_250_000_000_000_000_000_000n),
  ]);
  const txs: { receiverId: string; actions: Call[] }[] = [];
  if (!onRef) {
    txs.push({
      receiverId: "v2.ref-finance.near",
      actions: [call("storage_deposit", { account_id: accountId, registration_only: true }, 30_000_000_000_000n, refStorage)],
    });
  }
  if (!onSt) txs.push({ receiverId: "meta-pool.near", actions: [call("storage_deposit", { account_id: accountId, registration_only: true }, 30_000_000_000_000n, stStorage)] });
  const wrapCalls: Call[] = [];
  if (!onWrap) wrapCalls.push(call("storage_deposit", { account_id: accountId, registration_only: true }, 30_000_000_000_000n, wrapStorage));
  const wrapped = BigInt(wrappedRaw || "0");
  if (wrapped < spend) wrapCalls.push(call("near_deposit", {}, 20_000_000_000_000n, spend - wrapped));
  if (wrapCalls.length) txs.push({ receiverId: "wrap.near", actions: wrapCalls });
  txs.push({
    receiverId: "wrap.near",
    actions: [
      call(
        "ft_transfer_call",
        {
          receiver_id: "v2.ref-finance.near",
          amount: ready.hops[0]?.amount_in || yocto,
          msg: JSON.stringify({ force: 0, actions: ready.hops }),
        },
        280_000_000_000_000n,
        1n,
      ),
    ],
  });
  await sendNearTransactions(accountId, txs);
}

const VAULT_IN: Record<string, { contract: string; decimals: number }> = {
  USDC: { contract: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", decimals: 6 },
  ETH: { contract: "eth.bridge.near", decimals: 18 },
};

type RefHop = { pool_id?: string; token_in?: string; token_out?: string; amount_in?: string; min_amount_out?: string };
type RefReady = { tokenIn: string; hops: { pool_id: number; token_in: string; token_out: string; amount_in: string; min_amount_out: string }[]; unwrap?: string };

const vaultQuotes = new Map<string, Promise<RefReady | null>>();

function unitsOf(amount: string, decimals: number) {
  const cleaned = amount.trim();
  if (!/^\d+(\.\d*)?$/.test(cleaned)) return "";
  const [whole, frac = ""] = cleaned.split(".");
  return `${whole}${frac.slice(0, decimals).padEnd(decimals, "0")}`.replace(/^0+/, "") || "0";
}

async function findRef(tokenIn: string, tokenOut: string, units: string): Promise<RefReady | null> {
  if (!units || units === "0") return null;
  const response = await fetch(
    `https://smartrouter.ref.finance/findPath?amountIn=${units}&tokenIn=${encodeURIComponent(tokenIn)}&tokenOut=${encodeURIComponent(tokenOut)}&pathDeep=3&slippage=0.05`,
  );
  if (!response.ok) return null;
  const body = (await response.json()) as { result_code?: number; result_data?: { routes?: { pools?: RefHop[] }[] } };
  const hops = (body.result_data?.routes?.[0]?.pools ?? [])
    .map((pool) => ({
      pool_id: Number(pool.pool_id),
      token_in: pool.token_in || "",
      token_out: pool.token_out || "",
      amount_in: pool.amount_in || "",
      min_amount_out: pool.min_amount_out || "",
    }))
    .filter((pool) => pool.pool_id > 0 && pool.token_in && pool.token_out && pool.amount_in && pool.min_amount_out);
  if (body.result_code !== 0 || !hops.length) return null;
  const last = hops[hops.length - 1];
  return { tokenIn, hops, unwrap: tokenOut === "wrap.near" ? last.min_amount_out : undefined };
}

export function primeVaultMove(symbol: string, amount: string, direction: "in" | "out") {
  const key = `${direction}:${symbol}:${amount}`;
  if (vaultQuotes.has(key)) return;
  if (direction === "in" && symbol === "NEAR") {
    const units = unitsOf(amount, 24);
    const yocto = units && /^\d+$/.test(units) ? BigInt(units) : 0n;
    if (yocto > 0n && yocto < 1_000_000_000_000_000_000_000_000n && !vaultQuotes.has(`market:${units}`)) {
      const job = findRef("wrap.near", "meta-pool.near", units);
      vaultQuotes.set(`market:${units}`, job);
      void job.finally(() => {
        window.setTimeout(() => vaultQuotes.delete(`market:${units}`), 20_000);
      });
    }
    return;
  }
  const job =
    direction === "in"
      ? (() => {
          const spec = VAULT_IN[symbol];
          return spec ? findRef(spec.contract, "meta-pool.near", unitsOf(amount, spec.decimals)) : Promise.resolve(null);
        })()
      : findRef("meta-pool.near", "wrap.near", unitsOf(amount, 24));
  vaultQuotes.set(key, job);
  void job.finally(() => {
    window.setTimeout(() => vaultQuotes.delete(key), 20_000);
  });
}

async function sendRef(accountId: string, ready: RefReady) {
  const storage = await storageDepositAmount("v2.ref-finance.near", REF_STORAGE);
  const txs: { receiverId: string; actions: Call[] }[] = [
    {
      receiverId: "v2.ref-finance.near",
      actions: [call("storage_deposit", { account_id: accountId, registration_only: true }, 30_000_000_000_000n, storage)],
    },
    {
      receiverId: ready.tokenIn,
      actions: [
        call(
          "ft_transfer_call",
          {
            receiver_id: "v2.ref-finance.near",
            amount: ready.hops[0]?.amount_in,
            msg: JSON.stringify({ force: 0, actions: ready.hops }),
          },
          280_000_000_000_000n,
          1n,
        ),
      ],
    },
  ];
  if (ready.unwrap && ready.unwrap !== "0") {
    txs.push({
      receiverId: "wrap.near",
      actions: [call("near_withdraw", { amount: ready.unwrap }, 30_000_000_000_000n, 1n)],
    });
  }
  await sendNearTransactions(accountId, txs);
}

let metaYocto = 0n;
let metaLiquidity = 0n;
let stNearPriceYocto = 0n;
let metaFlight: Promise<void> | null = null;

async function metaView(method: string, args: object) {
  const result = (await rpc({
    request_type: "call_function",
    finality: "optimistic",
    account_id: "meta-pool.near",
    method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  })) as { result?: number[] };
  const text = new TextDecoder().decode(new Uint8Array(result.result ?? [])).trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.replace(/^"|"$/g, "");
  }
}

export function warmMetaPool(accountId: string) {
  if (metaFlight) return metaFlight;
  metaFlight = (async () => {
    const [info, price, state] = await Promise.all([
      metaView("get_account_info", { account_id: accountId }).catch(() => null),
      metaView("get_st_near_price", {}).catch(() => null),
      metaView("get_contract_state", {}).catch(() => null),
    ]);
    const st = (info as { st_near?: string } | null)?.st_near;
    const available = (state as { total_available?: string } | null)?.total_available;
    if (typeof st === "string" && /^\d+$/.test(st)) metaYocto = BigInt(st);
    if (typeof price === "string" && /^\d+$/.test(price.replace(/"/g, ""))) stNearPriceYocto = BigInt(price.replace(/"/g, ""));
    if (typeof available === "string" && /^\d+$/.test(available)) metaLiquidity = BigInt(available);
  })().finally(() => {
    metaFlight = null;
  });
  return metaFlight;
}

export async function metaStakeOf(accountId: string) {
  const info = (await metaView("get_account_info", { account_id: accountId }).catch(() => null)) as { st_near?: string } | null;
  const raw = info?.st_near && /^\d+$/.test(info.st_near) ? BigInt(info.st_near) : 0n;
  metaYocto = raw;
  return Number(raw) / 1e24;
}

export function stakeMintEstimate(near: number) {
  const rate = stNearPriceYocto > 0n ? Number(stNearPriceYocto) / 1e24 : 0;
  return rate > 0 ? near / rate : near;
}

export function nearFromStnear(stnear: number) {
  const rate = stNearPriceYocto > 0n ? Number(stNearPriceYocto) / 1e24 : 0;
  return rate > 0 ? stnear * rate : stnear;
}

export function applyStake(nearSpent: number, stNearMinted: number, paid?: { symbol: string; amount: number }) {
  const state = useDesk.getState();
  const chain = { ...state.chain };
  chain.NEAR = Math.max(0, (chain.NEAR ?? 0) - nearSpent);
  chain.STNEAR = Math.max(0, (chain.STNEAR ?? 0) + stNearMinted);
  if (paid && paid.symbol !== "NEAR") chain[paid.symbol] = Math.max(0, (chain[paid.symbol] ?? 0) - paid.amount);
  if (nearSpent !== 0) pendingBalances.set("NEAR", { target: chain.NEAR ?? 0, dir: nearSpent > 0 ? -1 : 1, until: Date.now() + 180_000 });
  if (stNearMinted !== 0) pendingBalances.set("STNEAR", { target: chain.STNEAR ?? 0, dir: stNearMinted > 0 ? 1 : -1, until: Date.now() + 180_000 });
  if (paid && paid.symbol !== "NEAR") pendingBalances.set(paid.symbol, { target: chain[paid.symbol] ?? 0, dir: -1, until: Date.now() + 180_000 });
  state.applyChain(chain);
  if (stNearMinted > 0) metaYocto += BigInt(Math.round(stNearMinted * 1e6)) * 10n ** 18n;
  if (stNearMinted < 0) metaYocto = metaYocto > BigInt(Math.round(-stNearMinted * 1e6)) * 10n ** 18n ? metaYocto - BigInt(Math.round(-stNearMinted * 1e6)) * 10n ** 18n : 0n;
}

export async function moveVault(accountId: string, symbol: string, amount: string, direction: "in" | "out") {
  if (direction === "out") {
    const units = unitsOf(amount, 24);
    const yocto = units && /^\d+$/.test(units) ? BigInt(units) : 0n;
    if (metaFlight) await metaFlight;
    const expected = stNearPriceYocto > 0n ? (yocto * stNearPriceYocto) / 10n ** 24n : 0n;
    if (yocto > 0n && metaYocto + 1n >= yocto && expected > 0n && metaLiquidity >= expected) {
      const min = expected > 0n ? (expected * 97n) / 100n : 1n;
      await sendNearTransactions(accountId, [
        {
          receiverId: "meta-pool.near",
          actions: [call("liquid_unstake", { st_near_to_burn: units, min_expected_near: min.toString() }, 180_000_000_000_000n, 1n)],
        },
      ]);
      metaYocto -= yocto;
      return;
    }
  }
  const key = `${direction}:${symbol}:${amount}`;
  const ready = await (vaultQuotes.get(key) ??
    (direction === "in"
      ? findRef(VAULT_IN[symbol]?.contract ?? "", "meta-pool.near", unitsOf(amount, VAULT_IN[symbol]?.decimals ?? 0))
      : findRef("meta-pool.near", "wrap.near", unitsOf(amount, 24))));
  if (!ready) throw new Error(direction === "out" ? "Meta Pool has no instant NEAR for that size, and Ref has no stNEAR route." : "No stNEAR pool can take that size right now.");
  await sendRef(accountId, ready);
}

export async function sendNearTransactions(accountId: string, transactions: { receiverId: string; actions: Call[] }[]) {
  if (localStorage.getItem(READONLY_STORE)) {
    await boot();
    modalShow?.();
    throw new Error("This account is view-only. Choose a wallet that can sign.");
  }
  let wallet = hotWallet;
  if (!wallet) {
    await boot();
    if (abandonSign) throw new Error("Cancelled.");
    const selector = await selectorPromise;
    if (!selector) throw new Error("Wallet is not ready.");
    try {
      wallet = await selector.wallet();
      hotWallet = wallet;
    } catch {
      modalShow?.();
      throw new Error("Choose a NEAR wallet to sign this transaction.");
    }
  }
  if (abandonSign) throw new Error("Cancelled.");
  releaseHeldFrames();
  const built = transactions.map((tx) => ({ signerId: accountId, receiverId: tx.receiverId, actions: tx.actions }));
  const before = new URL(window.location.href).searchParams.get("transactionHashes");
  const sent = built.length > 1 && wallet.signAndSendTransactions ? wallet.signAndSendTransactions({ transactions: built }) : sendOneByOne(wallet, built);
  const cancelled = new Promise<never>((_, reject) => {
    signAbort = () => reject(new Error("Cancelled."));
  });
  try {
    return await Promise.race([sent, redirectHash(before), cancelled]);
  } catch (error) {
    const hash = new URL(window.location.href).searchParams.get("transactionHashes");
    if (hash && hash !== before) return hash.split(",")[0] ?? hash;
    throw error instanceof Error ? error : new Error("The NEAR wallet rejected the transaction.");
  } finally {
    signAbort = null;
    if (redirectTimer) window.clearInterval(redirectTimer);
    redirectTimer = 0;
    disarmWalletPopup();
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
    if (redirectTimer) window.clearInterval(redirectTimer);
    redirectTimer = window.setInterval(() => {
      const hash = new URL(window.location.href).searchParams.get("transactionHashes");
      if (hash && hash !== before) {
        window.clearInterval(redirectTimer);
        redirectTimer = 0;
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
      finality: "optimistic",
      account_id: contractId,
      method_name: "ft_balance_of",
      args_base64: btoa(JSON.stringify({ account_id: accountId })),
    })) as { result?: number[] };
    const text = new TextDecoder().decode(new Uint8Array(result.result ?? []));
    const parsed = JSON.parse(text) as string;
    return typeof parsed === "string" ? parsed || "0" : String(parsed ?? "0");
  } catch {
    return null;
  }
}

async function rpc(params: object) {
  const urls = ["https://rpc.mainnet.near.org", "https://near.drpc.org", "https://free.rpc.fastnear.com"];
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
        const message = body.error.message ?? last;
        last = /rate limit/i.test(message) ? "NEAR RPC is busy. Retry in a moment." : message;
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

export async function intearSetup(accountId: string, assetIds: string[]) {
  const ids = [...new Set(assetIds.filter(Boolean))];
  const contract = "dex.intear.near";
  const [storage, registered, storagePay] = await Promise.all([
    viewJson(contract, "storage_balance_of", { account_id: accountId }),
    ids.length ? viewJson(contract, "are_assets_registered", { asset_ids: ids, for: { Account: accountId } }) : Promise.resolve(true),
    storageDepositAmount(contract, 20_000_000_000_000_000_000_000n),
  ]);
  const available = BigInt((storage as { available?: string } | null)?.available ?? "0");
  const deposit = storagePay > 20_000_000_000_000_000_000_000n ? storagePay : 20_000_000_000_000_000_000_000n;
  const actions: Call[] = [];
  if (!storage || available < deposit) {
    actions.push(call("storage_deposit", { account_id: accountId, registration_only: false }, 30_000_000_000_000n, deposit));
  }
  if (ids.length && registered !== true) {
    actions.push(call("register_assets", { asset_ids: ids, for: null }, 50_000_000_000_000n, 1n));
  }
  return actions;
}

const storageBounds = new Map<string, Promise<{ min: bigint; max: bigint | null }>>();

function coveredStorage(min: bigint, max: bigint | null, fallback: bigint) {
  const base = min > 0n ? min : fallback;
  let amount = max == null ? base + 1_000_000_000_000_000_000_000n : base;
  if (max != null && amount > max) amount = max;
  if (amount < base) amount = base;
  return amount;
}

export function storageDepositAmount(contractId: string, fallback: bigint) {
  const cached = storageBounds.get(contractId);
  const job = cached ?? viewJson(contractId, "storage_balance_bounds", {}).then((row) => {
    const minRaw = (row as { min?: string } | null)?.min;
    const maxRaw = (row as { max?: string | null } | null)?.max;
    return {
      min: minRaw && /^\d+$/.test(minRaw) ? BigInt(minRaw) : 0n,
      max: maxRaw && /^\d+$/.test(maxRaw) ? BigInt(maxRaw) : null,
    };
  }).catch(() => ({ min: 0n, max: null as bigint | null }));
  if (!cached) storageBounds.set(contractId, job);
  return job.then((bounds) => coveredStorage(bounds.min, bounds.max, fallback));
}

async function viewJson(contractId: string, method: string, args: object) {
  try {
    const result = (await rpc({
      request_type: "call_function",
      finality: "optimistic",
      account_id: contractId,
      method_name: method,
      args_base64: btoa(JSON.stringify(args)),
    })) as { result?: number[] };
    const text = new TextDecoder().decode(new Uint8Array(result.result ?? [])).trim();
    if (!text || text === "null") return null;
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function isRegisteredOn(contractId: string, accountId: string) {
  return isRegistered(contractId, accountId);
}

export function registrationCached(contractId: string, accountId: string) {
  return registeredYes.has(`${contractId}:${accountId}`);
}

const registeredYes = new Set<string>();
const registeredFlight = new Map<string, Promise<boolean>>();

async function isRegistered(contractId: string, accountId: string) {
  const key = `${contractId}:${accountId}`;
  if (registeredYes.has(key)) return true;
  const pending = registeredFlight.get(key);
  if (pending) return pending;
  const job = (async () => {
    try {
      const result = (await rpc({
        request_type: "call_function",
        finality: "optimistic",
        account_id: contractId,
        method_name: "storage_balance_of",
        args_base64: btoa(JSON.stringify({ account_id: accountId })),
      })) as { result?: number[] };
      const text = new TextDecoder().decode(new Uint8Array(result.result ?? [])).trim();
      const yes = text !== "" && text !== "null";
      if (yes) registeredYes.add(key);
      return yes;
    } catch {
      return false;
    }
  })();
  registeredFlight.set(key, job);
  try {
    return await job;
  } finally {
    registeredFlight.delete(key);
  }
}

function transferActions(depositAddress: string, amount: string, registerRecipient: boolean): Call[] {
  const actions = registerRecipient ? [register(depositAddress)] : [];
  actions.push(transfer(depositAddress, amount));
  return actions;
}

async function wrapActions(accountId: string, depositAddress: string, amount: string, registerRecipient: boolean): Promise<Call[]> {
  const wrapped = BigInt((await ftBalance(accountId, "wrap.near")) || "0");
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
