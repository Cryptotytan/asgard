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

async function switchEvm(provider: Eip, meta: ChainMeta) {
  if (!meta.chainId) return;
  const chainId = `0x${meta.chainId.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (error) {
    const code = (error as { code?: number })?.code;
    if (code !== 4902 || !meta.rpc) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId, chainName: meta.label, nativeCurrency: { name: meta.label, symbol: "ETH", decimals: 18 }, rpcUrls: [meta.rpc] }],
    });
  }
  emit({ evmChainId: meta.chainId });
}

function hex(amount: string) {
  return `0x${BigInt(amount).toString(16)}`;
}

function encodeTransfer(to: string, amount: string) {
  const addr = to.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const value = BigInt(amount).toString(16).padStart(64, "0");
  return `0xa9059cbb${addr}${value}`;
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
  emit({ evm: from });
  await switchEvm(provider, meta);
  const tx = token
    ? { from, to: token, data: encodeTransfer(to, amount), value: "0x0" }
    : { from, to, value: hex(amount) };
  const hash = (await provider.request({ method: "eth_sendTransaction", params: [tx] })) as string;
  if (!hash) throw new Error("The wallet did not return a transaction. Nothing else was sent.");
  return hash;
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
