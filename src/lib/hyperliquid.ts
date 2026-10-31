import { foreignWallets, signingEvm } from "@/lib/foreign-wallet";
import { useDesk, type RestingOrder } from "@/lib/store";

const INFO = "https://api.hyperliquid.xyz/info";
const EXCHANGE = "https://api.hyperliquid.xyz/exchange";

type Asset = { name: string; index: number; szDecimals: number };

let book: Asset[] | null = null;

async function info<T>(body: object): Promise<T> {
  const response = await fetch(INFO, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Hyperliquid did not answer.");
  return (await response.json()) as T;
}

async function assets() {
  if (book) return book;
  const meta = await info<{ universe?: { name?: string; szDecimals?: number }[] }>({ type: "meta" });
  book = (meta.universe ?? []).map((row, index) => ({ name: (row.name || "").toUpperCase(), index, szDecimals: row.szDecimals ?? 4 }));
  return book;
}

function alias(symbol: string) {
  const base = symbol.split(".")[0]?.toUpperCase() ?? symbol.toUpperCase();
  if (base === "1000PEPE") return "KPEPE";
  if (base === "1000BONK") return "KBONK";
  if (base === "1000SHIB") return "KSHIB";
  return base;
}

export async function hyperliquidAsset(symbol: string) {
  const list = await assets();
  const name = alias(symbol);
  return list.find((asset) => asset.name === name) ?? null;
}

function wirePrice(price: number, szDecimals: number) {
  const places = Math.max(0, 6 - szDecimals);
  const sig = Number(price.toPrecision(5));
  if (!(sig > 0)) return "";
  return sig.toFixed(places).replace(/\.?0+$/, "");
}

function wireSize(size: number, szDecimals: number) {
  if (!(size > 0)) return "";
  const text = size.toFixed(szDecimals).replace(/\.?0+$/, "");
  return text === "0" ? "" : text;
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function actionHash(action: object, nonce: number) {
  const { encode } = await import("@msgpack/msgpack");
  const { keccak_256 } = await import("@noble/hashes/sha3.js");
  const packed = encode(action);
  const nonceBytes = new Uint8Array(8);
  new DataView(nonceBytes.buffer).setBigUint64(0, BigInt(nonce));
  const merged = new Uint8Array(packed.length + 9);
  merged.set(packed, 0);
  merged.set(nonceBytes, packed.length);
  merged[packed.length + 8] = 0;
  return `0x${bytesToHex(keccak_256(merged))}`;
}

async function signAction(action: object, nonce: number) {
  const provider = signingEvm();
  const address = foreignWallets().evm;
  if (!provider || !address) throw new Error("Connect MetaMask, Rabby, or Zerion. Perps settle on Hyperliquid, not a paper balance.");
  const connectionId = await actionHash(action, nonce);
  const typed = {
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      Agent: [
        { name: "source", type: "string" },
        { name: "connectionId", type: "bytes32" },
      ],
    },
    primaryType: "Agent",
    domain: { name: "Exchange", version: "1", chainId: 1337, verifyingContract: "0x0000000000000000000000000000000000000000" },
    message: { source: "a", connectionId },
  };
  const signature = (await provider.request({ method: "eth_signTypedData_v4", params: [address, JSON.stringify(typed)] })) as string;
  const r = signature.slice(0, 66);
  const s = `0x${signature.slice(66, 130)}`;
  let v = Number.parseInt(signature.slice(130, 132), 16);
  if (v < 27) v += 27;
  const response = await fetch(EXCHANGE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, nonce, signature: { r, s, v } }),
  });
  const body = (await response.json().catch(() => null)) as { status?: string; response?: unknown } | null;
  if (!response.ok || body?.status === "err") {
    const text = typeof body?.response === "string" ? body.response : "Hyperliquid rejected the order. Nothing was opened.";
    throw new Error(text);
  }
  return body;
}

function orderError(body: { response?: unknown } | null) {
  const data = (body?.response as { data?: { statuses?: { error?: string; resting?: { oid?: number }; filled?: { oid?: number; avgPx?: string; totalSz?: string } }[] } })?.data;
  const status = data?.statuses?.[0];
  if (status?.error) throw new Error(status.error);
  return status;
}

export async function placeHyperliquid(input: { symbol: string; side: "long" | "short"; notional: number; mark: number; leverage: number; limit?: number; reduceOnly?: boolean }) {
  const asset = await hyperliquidAsset(input.symbol);
  if (!asset) throw new Error(`${input.symbol.split(".")[0]} is not listed on Hyperliquid.`);
  const limit = input.limit && input.limit > 0 ? input.limit : 0;
  const cross = limit ? (input.side === "long" ? input.mark < limit : input.mark > limit) : true;
  const rawPx = limit && !cross ? limit : input.mark * (input.side === "long" ? 1.008 : 0.992);
  const price = wirePrice(rawPx, asset.szDecimals);
  const size = wireSize(input.notional / (limit && !cross ? limit : input.mark), asset.szDecimals);
  if (!price || !size) throw new Error("That size is below Hyperliquid's minimum. Nothing was sent.");
  const leverageNonce = Date.now();
  await signAction({ type: "updateLeverage", asset: asset.index, isCross: true, leverage: Math.min(20, Math.max(1, Math.round(input.leverage))) }, leverageNonce).catch(() => undefined);
  const nonce = Date.now();
  const action = {
    type: "order",
    orders: [
      {
        a: asset.index,
        b: input.side === "long",
        p: price,
        s: size,
        r: Boolean(input.reduceOnly),
        t: { limit: { tif: limit && !cross ? "Gtc" : "Ioc" } },
      },
    ],
    grouping: "na",
  };
  const body = await signAction(action, nonce);
  const status = orderError(body);
  const resting = Boolean(status?.resting?.oid);
  return {
    resting,
    oid: status?.resting?.oid ?? status?.filled?.oid,
    asset: asset.index,
    coin: asset.name,
    size: Number(status?.filled?.totalSz || size),
    price: Number(status?.filled?.avgPx || price),
  };
}

export async function closeHyperliquid(input: { symbol: string; side: "long" | "short"; size: number }) {
  const asset = await hyperliquidAsset(input.symbol);
  if (!asset) throw new Error("This position is not on Hyperliquid.");
  const mark = useDesk.getState().marks[input.symbol] || useDesk.getState().marks[input.symbol.split(".")[0] ?? ""] || 0;
  if (!(mark > 0)) throw new Error("No live mark for this close.");
  const price = wirePrice(mark * (input.side === "long" ? 0.992 : 1.008), asset.szDecimals);
  const size = wireSize(input.size, asset.szDecimals);
  if (!price || !size) throw new Error("That position size cannot be closed on Hyperliquid.");
  const action = {
    type: "order",
    orders: [{ a: asset.index, b: input.side !== "long", p: price, s: size, r: true, t: { limit: { tif: "Ioc" } } }],
    grouping: "na",
  };
  const body = await signAction(action, Date.now());
  orderError(body);
}

export async function cancelHyperliquid(asset: number, oid: number) {
  const action = { type: "cancel", cancels: [{ a: asset, o: oid }] };
  await signAction(action, Date.now());
}

export async function syncHyperliquidOrders(orders: RestingOrder[]) {
  const watched = orders.filter((order) => order.hlOid);
  const address = foreignWallets().evm;
  if (!watched.length || !address) return;
  const open = await info<{ oid?: number }[]>({ type: "openOrders", user: address }).catch(() => null);
  if (!open) return;
  const live = new Set(open.map((order) => order.oid));
  for (const order of watched) {
    if (order.hlOid && live.has(order.hlOid)) continue;
    useDesk.getState().cancelOrder(order.id, "filled");
  }
}
