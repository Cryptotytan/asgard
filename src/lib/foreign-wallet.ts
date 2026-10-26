import { useSyncExternalStore } from "react";
import { chainById, chainByLabel, type ChainMeta } from "@/lib/chains";

type Eip = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
};

type SolWallet = {
  isPhantom?: boolean;
  publicKey?: { toString: () => string };
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  signAndSendTransaction: (tx: unknown) => Promise<{ signature: string } | string>;
};

type BtcWallet = {
  requestAccounts: () => Promise<string[]>;
  sendBitcoin: (to: string, sats: number) => Promise<string>;
};

export type ForeignWallets = {
  evm: string | null;
  evmChainId: number | null;
  sol: string | null;
  btc: string | null;
};

const empty: ForeignWallets = { evm: null, evmChainId: null, sol: null, btc: null };
let state: ForeignWallets = { ...empty };
const listeners = new Set<() => void>();

function emit(next: Partial<ForeignWallets>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function foreignWallets() {
  return state;
}

export function useForeign() {
  return useSyncExternalStore(subscribe, foreignWallets, foreignWallets);
}

export type LinkedWallet = { id: "near" | "evm" | "sol" | "btc"; label: string; address: string };

export const WALLET_MARK: Record<LinkedWallet["id"], string> = {
  near: "/tokens/near.svg",
  evm: "/tokens/eth.png",
  sol: "/chains/solana.png",
  btc: "/chains/bitcoin.png",
};

export function linkedWallets(near: string | null, foreign: ForeignWallets): LinkedWallet[] {
  const rows: LinkedWallet[] = [];
  if (near) rows.push({ id: "near", label: "NEAR", address: near });
  if (foreign.evm) rows.push({ id: "evm", label: "EVM", address: foreign.evm });
  if (foreign.sol) rows.push({ id: "sol", label: "Solana", address: foreign.sol });
  if (foreign.btc) rows.push({ id: "btc", label: "Bitcoin", address: foreign.btc });
  return rows;
}

function ethereum() {
  if (typeof window === "undefined") return null;
  const eth = (window as unknown as { ethereum?: Eip & { providers?: Eip[] } }).ethereum;
  if (!eth) return null;
  return eth.providers?.[0] ?? eth;
}

function solana() {
  if (typeof window === "undefined") return null;
  return (window as unknown as { solana?: SolWallet }).solana ?? null;
}

function bitcoin() {
  if (typeof window === "undefined") return null;
  return (window as unknown as { unisat?: BtcWallet }).unisat ?? null;
}

export async function connectEvm() {
  const provider = ethereum();
  if (!provider) throw new Error("Install MetaMask or Rabby to use an EVM chain.");
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const chain = (await provider.request({ method: "eth_chainId" })) as string;
  const address = accounts[0] ?? null;
  emit({ evm: address, evmChainId: Number(chain) });
  provider.on?.("accountsChanged", (next) => {
    const accounts = next as string[];
    emit({ evm: accounts[0] ?? null });
  });
  provider.on?.("chainChanged", (next) => emit({ evmChainId: Number(next as string) }));
  return address;
}

export async function connectSol() {
  const wallet = solana();
  if (!wallet) throw new Error("Install Phantom to use Solana.");
  const result = await wallet.connect();
  const address = result.publicKey.toString();
  emit({ sol: address });
  return address;
}

export async function connectBtc() {
  const wallet = bitcoin();
  if (!wallet) throw new Error("Install UniSat to use Bitcoin.");
  const accounts = await wallet.requestAccounts();
  const address = accounts[0] ?? null;
  emit({ btc: address });
  return address;
}

export function disconnectForeign(kind: "evm" | "sol" | "btc") {
  if (kind === "evm") emit({ evm: null, evmChainId: null });
  if (kind === "sol") emit({ sol: null });
  if (kind === "btc") emit({ btc: null });
}

export function addressFor(label: string, wallets: { near?: string | null; evm?: string | null; sol?: string | null; btc?: string | null }) {
  const kind = chainByLabel(label)?.kind;
  if (kind === "near") return wallets.near ?? "";
  if (kind === "evm") return wallets.evm ?? "";
  if (kind === "sol") return wallets.sol ?? "";
  if (kind === "btc") return wallets.btc ?? "";
  return "";
}

const NATIVE = "0x0000000000000000000000000000000000000000";

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function padAddress(address: string) {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function isEvmAddress(value: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function hexAmount(amount: string) {
  return `0x${BigInt(amount).toString(16)}`;
}

function hexValue(value: unknown) {
  if (value == null || value === "" || value === 0 || value === "0" || value === "0x" || value === "0x0") return "0x0";
  const raw = String(value);
  if (raw.startsWith("0x")) return raw;
  return `0x${BigInt(raw).toString(16)}`;
}

function hexData(data?: string) {
  if (!data || data === "0x") return "0x";
  return data.startsWith("0x") ? data : `0x${data}`;
}

function nativeCoin(chainId: number) {
  const known: Record<number, { name: string; symbol: string }> = {
    56: { name: "BNB", symbol: "BNB" },
    137: { name: "POL", symbol: "POL" },
    43114: { name: "Avalanche", symbol: "AVAX" },
    100: { name: "xDAI", symbol: "XDAI" },
    196: { name: "OKB", symbol: "OKB" },
  };
  return known[chainId] ?? { name: "Ether", symbol: "ETH" };
}

async function ensureChain(provider: Eip, meta: ChainMeta) {
  if (!meta.chainId) return;
  const chainId = `0x${meta.chainId.toString(16)}`;
  const current = (await provider.request({ method: "eth_chainId" }).catch(() => "0x0")) as string;
  if (Number(current) !== meta.chainId) {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
    } catch (error) {
      const code = (error as { code?: number })?.code;
      if (code !== 4902 || !meta.rpc) throw error;
      const coin = nativeCoin(meta.chainId);
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId, chainName: meta.label, nativeCurrency: { name: coin.name, symbol: coin.symbol, decimals: 18 }, rpcUrls: [meta.rpc] }],
      });
    }
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const now = (await provider.request({ method: "eth_chainId" }).catch(() => "0x0")) as string;
    if (Number(now) === meta.chainId) {
      emit({ evmChainId: meta.chainId });
      return;
    }
    await sleep(150);
  }
  throw new Error(`Switch the wallet to ${meta.label}. Nothing was sent.`);
}

async function assertCanPay(provider: Eip, meta: ChainMeta, from: string, tx: { from: string; to: string; data?: string; value?: string; chainId?: string }) {
  let units = 100_000n;
  try {
    const estimate = (await provider.request({ method: "eth_estimateGas", params: [tx] })) as string;
    units = (BigInt(estimate) * 12n) / 10n;
  } catch {
    throw new Error("The wallet simulated this and the contract rejects it. Nothing was sent.");
  }
  const balance = BigInt(((await provider.request({ method: "eth_getBalance", params: [from, "latest"] })) as string) || "0x0");
  const gasPrice = BigInt(((await provider.request({ method: "eth_gasPrice" }).catch(() => "0x0")) as string) || "0x0");
  const value = BigInt(tx.value && tx.value !== "0x" ? tx.value : "0x0");
  if (balance < value + gasPrice * units) {
    const coin = nativeCoin(meta.chainId ?? 1).symbol;
    throw new Error(`Not enough ${coin} on ${meta.label} to pay gas. Nothing was sent.`);
  }
}

async function tokenBalance(provider: Eip, token: string, owner: string) {
  const data = `0x70a08231${padAddress(owner)}`;
  const raw = (await provider.request({ method: "eth_call", params: [{ to: token, data }, "latest"] })) as string;
  return BigInt(raw || "0x0");
}

async function tokenAllowance(provider: Eip, token: string, owner: string, spender: string) {
  const data = `0xdd62ed3e${padAddress(owner)}${padAddress(spender)}`;
  const raw = (await provider.request({ method: "eth_call", params: [{ to: token, data }, "latest"] })) as string;
  return BigInt(raw || "0x0");
}

async function waitReceipt(provider: Eip, hash: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const receipt = (await provider.request({ method: "eth_getTransactionReceipt", params: [hash] })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status === "0x0") throw new Error("The approval was rejected on chain. Nothing else was sent.");
      return;
    }
    await sleep(1500);
  }
  throw new Error("The approval is still pending. Nothing else was sent.");
}

async function sendApprove(provider: Eip, meta: ChainMeta, from: string, token: string, spender: string, amount: bigint) {
  const data = `0x095ea7b3${padAddress(spender)}${amount.toString(16).padStart(64, "0")}`;
  const tx = { from, to: token, data, value: "0x0", chainId: `0x${(meta.chainId ?? 1).toString(16)}` };
  await assertCanPay(provider, meta, from, tx);
  const hash = (await provider.request({ method: "eth_sendTransaction", params: [tx] })) as string;
  if (!hash) throw new Error("The wallet did not approve the token. Nothing else was sent.");
  await waitReceipt(provider, hash);
}

export async function ensureEvmAllowance(chainLabel: string, token: string, spender: string, amount: string) {
  const meta = chainByLabel(chainLabel);
  if (!meta || meta.kind !== "evm") throw new Error(`No EVM wallet can sign ${chainLabel}. Nothing was sent.`);
  if (!isEvmAddress(token) || token.toLowerCase() === NATIVE || !isEvmAddress(spender)) return;
  const need = BigInt(amount);
  if (need <= 0n) return;
  const provider = ethereum();
  if (!provider) throw new Error("Install MetaMask or Rabby. Nothing was sent.");
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const from = accounts[0];
  if (!from) throw new Error("The EVM wallet has no account. Nothing was sent.");
  await ensureChain(provider, meta);
  const allowed = await tokenAllowance(provider, token, from, spender);
  if (allowed >= need) return;
  const usdt = token.toLowerCase() === "0xdac17f958d2ee523a2206206994597c13d831ec7";
  if (usdt && allowed > 0n) await sendApprove(provider, meta, from, token, spender, 0n);
  await sendApprove(provider, meta, from, token, spender, need);
}

function encodeTransfer(to: string, amount: string) {
  return `0xa9059cbb${padAddress(to)}${BigInt(amount).toString(16).padStart(64, "0")}`;
}

export async function sendOriginDeposit(input: { blockchain: string; contract: string | null; depositAddress: string; amount: string }) {
  const chain = chainById(input.blockchain);
  if (!chain) throw new Error(`No browser wallet can sign a ${input.blockchain} deposit. Nothing was sent.`);
  if (chain.kind === "evm") return sendEvm(chain, input.contract, input.depositAddress, input.amount);
  if (chain.kind === "sol") return sendSol(input.contract, input.depositAddress, input.amount);
  if (chain.kind === "btc") return sendBtc(input.depositAddress, input.amount);
  throw new Error(`No browser wallet can sign a ${chain.label} deposit. Nothing was sent.`);
}

async function sendEvm(meta: ChainMeta, token: string | null, to: string, amount: string) {
  const provider = ethereum();
  if (!provider) throw new Error("Install MetaMask or Rabby. Nothing was sent.");
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const from = accounts[0];
  if (!from) throw new Error("The EVM wallet has no account. Nothing was sent.");
  if (!isEvmAddress(to)) throw new Error("The deposit address is not an EVM address. Nothing was sent.");
  emit({ evm: from });
  await ensureChain(provider, meta);
  const native = !token || token.toLowerCase() === NATIVE;
  const chainId = `0x${(meta.chainId ?? 1).toString(16)}`;
  if (native) {
    const value = hexAmount(amount);
    const tx = { from, to, value, chainId };
    await assertCanPay(provider, meta, from, tx);
    const hash = (await provider.request({ method: "eth_sendTransaction", params: [tx] })) as string;
    if (!hash) throw new Error("The wallet did not return a transaction. Nothing else was sent.");
    return hash;
  }
  if (!isEvmAddress(token)) throw new Error("That token address is not an EVM contract. Nothing was sent.");
  const held = await tokenBalance(provider, token, from);
  if (held < BigInt(amount)) throw new Error(`Not enough of this token on ${meta.label}. Nothing was sent.`);
  const tx = { from, to: token, data: encodeTransfer(to, amount), value: "0x0", chainId };
  await assertCanPay(provider, meta, from, tx);
  const hash = (await provider.request({ method: "eth_sendTransaction", params: [tx] })) as string;
  if (!hash) throw new Error("The wallet did not return a transaction. Nothing else was sent.");
  return hash;
}

export async function sendEvmCall(chainLabel: string, tx: { to: string; data?: string; value?: string }) {
  const meta = chainByLabel(chainLabel);
  if (!meta || meta.kind !== "evm") throw new Error(`No EVM wallet can sign ${chainLabel}. Nothing was sent.`);
  if (!isEvmAddress(tx.to)) throw new Error("The route did not return an EVM address. Nothing was sent.");
  const provider = ethereum();
  if (!provider) throw new Error("Install MetaMask or Rabby. Nothing was sent.");
  const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
  const from = accounts[0];
  if (!from) throw new Error("The EVM wallet has no account. Nothing was sent.");
  emit({ evm: from });
  await ensureChain(provider, meta);
  const value = hexValue(tx.value);
  const call = { from, to: tx.to, data: hexData(tx.data), value, chainId: `0x${(meta.chainId ?? 1).toString(16)}` };
  await assertCanPay(provider, meta, from, call);
  const hash = (await provider.request({ method: "eth_sendTransaction", params: [call] })) as string;
  if (!hash) throw new Error("The wallet did not return a transaction. Nothing else was sent.");
  return hash;
}

export async function sendSolanaSerialized(raw: string) {
  const wallet = solana();
  if (!wallet) throw new Error("Install Phantom. Nothing was sent.");
  const connected = wallet.publicKey ? wallet : await wallet.connect().then(() => solana());
  const owner = connected?.publicKey?.toString();
  if (!owner || !connected) throw new Error("The Solana wallet has no account. Nothing was sent.");
  emit({ sol: owner });
  const web3 = await import("@solana/web3.js");
  const bytes = Uint8Array.from(atob(raw), (char) => char.charCodeAt(0));
  const tx = web3.VersionedTransaction.deserialize(bytes);
  const sent = await connected.signAndSendTransaction(tx);
  const signature = typeof sent === "string" ? sent : sent.signature;
  if (!signature) throw new Error("The wallet did not return a signature. Nothing else was sent.");
  return signature;
}

async function sendSol(token: string | null, to: string, amount: string) {
  const wallet = solana();
  if (!wallet) throw new Error("Install Phantom. Nothing was sent.");
  const connected = wallet.publicKey ? wallet : await wallet.connect().then(() => solana());
  const owner = connected?.publicKey?.toString();
  if (!owner || !connected) throw new Error("The Solana wallet has no account. Nothing was sent.");
  emit({ sol: owner });
  const web3 = await import("@solana/web3.js");
  const connection = new web3.Connection("https://api.mainnet-beta.solana.com", "confirmed");
  const from = new web3.PublicKey(owner);
  const recipient = new web3.PublicKey(to);
  const tx = new web3.Transaction();
  if (!token) {
    tx.add(web3.SystemProgram.transfer({ fromPubkey: from, toPubkey: recipient, lamports: BigInt(amount) }));
  } else {
    const spl = await import("@solana/spl-token");
    const mint = new web3.PublicKey(token);
    const fromAta = await spl.getAssociatedTokenAddress(mint, from);
    const toAta = await spl.getAssociatedTokenAddress(mint, recipient);
    const existing = await connection.getAccountInfo(toAta);
    if (!existing) tx.add(spl.createAssociatedTokenAccountInstruction(from, toAta, recipient, mint));
    tx.add(spl.createTransferInstruction(fromAta, toAta, from, BigInt(amount)));
  }
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = from;
  tx.recentBlockhash = blockhash;
  const sent = await connected.signAndSendTransaction(tx);
  const signature = typeof sent === "string" ? sent : sent.signature;
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed").catch(() => undefined);
  return signature;
}

async function sendBtc(to: string, amount: string) {
  const wallet = bitcoin();
  if (!wallet) throw new Error("Install UniSat. Nothing was sent.");
  const accounts = await wallet.requestAccounts();
  emit({ btc: accounts[0] ?? null });
  const sats = Number(amount);
  if (!Number.isSafeInteger(sats) || sats <= 0) throw new Error("That Bitcoin amount cannot be sent safely. Nothing was sent.");
  return wallet.sendBitcoin(to, sats);
}
