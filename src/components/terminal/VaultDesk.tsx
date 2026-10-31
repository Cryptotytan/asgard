import { useEffect, useState } from "react";
import { fmt, qty, tokenBySymbol, usd } from "@/lib/market";
import { TokenIcon } from "@/components/terminal/TokenIcon";
import { executeIntent, parseUnits } from "@/lib/intents";
import { stakeNear, syncWallet } from "@/lib/near-wallet";
import { useDesk } from "@/lib/store";

const PAY = ["USDC", "NEAR", "ETH"];
const SHOWN = ["STNEAR", "USDC", "NEAR", "ETH"];

function cleanVaultError(error: unknown) {
  const message = error instanceof Error ? error.message : "Vault move failed.";
  if (/rate limit|fastnear|-429|jsonrpc/i.test(message)) return "NEAR RPC is busy. Retry in a moment.";
  if (message.trim().startsWith("{")) return "The NEAR network rejected that vault move. Retry in a moment.";
  return message;
}

export function VaultDesk() {
  const connected = useDesk((s) => s.connected);
  const accountId = useDesk((s) => s.accountId);
  const connect = useDesk((s) => s.connect);
  const chain = useDesk((s) => s.chain);
  const nearYocto = useDesk((s) => s.nearYocto);
  const [symbol, setSymbol] = useState("NEAR");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const staked = chain.STNEAR ?? chain.stNEAR ?? 0;
  const value = staked * tokenBySymbol("STNEAR").price;
  useEffect(() => {
    if (accountId) void syncWallet(accountId);
  }, [accountId]);

  async function run(kind: "in" | "out") {
    if (!connected || !accountId) {
      connect();
      setNote("Connect a NEAR wallet first.");
      return;
    }
    const n = Number(amount) || 0;
    if (n <= 0 || busy) return;
    const wallet = useDesk.getState().accountId;
    if (!wallet) return;
    if (kind === "in" && symbol === "NEAR") {
      const liquid = nearYocto ? Number(nearYocto) / 1e24 : 0;
      if (liquid + 1e-8 < n + 0.05) {
        setNote(`This account has ${qty(liquid)} liquid NEAR. Leave about 0.05 NEAR for gas.`);
        return;
      }
    } else if (kind === "in" && (chain[symbol] ?? 0) + 1e-8 < n) {
      setNote(`This wallet holds ${qty(chain[symbol] ?? 0)} ${symbol}.`);
      return;
    }
    if (kind === "out" && staked + 1e-8 < n) {
      setNote(`This account holds ${qty(staked)} stNEAR.`);
      return;
    }
    setBusy(true);
    setNote(kind === "in" && symbol === "NEAR" ? "Confirm the stake in your NEAR wallet. Meta Pool mints stNEAR." : kind === "in" ? "Confirm the swap into stNEAR on NEAR Intents." : "Confirm the swap out of stNEAR on NEAR Intents.");
    try {
      if (kind === "in" && symbol === "NEAR") {
        const yocto = parseUnits(String(n), 24);
        if (!yocto) throw new Error("Enter an amount.");
        await stakeNear(wallet, yocto);
        await syncWallet(wallet);
        setAmount("");
        setNote(`Staked ${fmt(n)} NEAR. stNEAR arrives in this wallet.`);
      } else if (kind === "in") {
        const result = await executeIntent({ from: symbol, to: "STNEAR", amount: String(n), accountId, purpose: "Vault deposit" });
        if (useDesk.getState().accountId !== wallet) return;
        await syncWallet(wallet);
        setAmount("");
        setNote(`Deposited into stNEAR. ${result.status}.`);
      } else {
        await executeIntent({
          from: "STNEAR",
          to: "NEAR",
          amount: String(n),
          accountId,
          purpose: "Vault withdraw",
          maxPay: staked,
        });
        if (useDesk.getState().accountId !== wallet) return;
        await syncWallet(wallet);
        setAmount("");
        setWithdrawing(false);
        setNote(`Withdrew ${fmt(n)} stNEAR. NEAR returns to this wallet.`);
      }
    } catch (error) {
      setNote(cleanVaultError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid h-full min-h-0 content-start items-start gap-1.5 overflow-y-auto sm:h-auto sm:gap-3 lg:grid-cols-3">
      <section className="deck panel p-2 sm:p-4 lg:col-span-2">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted">Vault</p>
            <h2 className="font-mono text-base leading-tight sm:text-3xl">{usd(value)}</h2>
          </div>
        </div>
        <ul className="lift-deck mt-1">
          {SHOWN.map((item) => {
            const token = tokenBySymbol(item);
            const held = chain[item] ?? (item === "STNEAR" ? staked : 0);
            const on = symbol === item;
            return (
              <li key={item}>
                <button
                  type="button"
                  onClick={() => {
                    if (PAY.includes(item)) setSymbol(item);
                  }}
                  className={`lift flex w-full items-center justify-between rounded-xl px-2 py-1 text-left sm:py-2 ${on ? "is-up bg-bg" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <TokenIcon token={token} className="size-5 sm:size-6" />
                    <div>
                      <p className="text-sm font-semibold">{token.symbol}</p>
                      <p className="font-mono text-[10px] text-muted sm:text-xs">{qty(held)} in this wallet</p>
                    </div>
                  </div>
                  <p className="font-mono text-xs sm:text-sm">{usd(held * token.price)}</p>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="deck panel p-2 sm:p-4">
        <p className="text-[10px] uppercase tracking-widest text-muted">Move funds</p>
        <div className="mt-1.5 flex gap-1.5">
          {PAY.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setSymbol(item)}
              className={`h-8 flex-1 rounded-full text-xs sm:h-10 sm:text-sm ${symbol === item ? "bg-primary text-primary-fg" : "border border-line text-muted"}`}
            >
              {item}
            </button>
          ))}
        </div>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
          aria-label="Vault amount"
          className="mt-1.5 h-8 w-full rounded-xl border border-line bg-bg px-3 font-mono text-sm outline-none sm:mt-3 sm:h-10 sm:rounded-2xl"
        />
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          <button type="button" disabled={busy} onClick={() => void run("in")} className="h-8 rounded-full bg-primary text-sm font-semibold text-primary-fg disabled:opacity-50 sm:h-10">
            {symbol === "NEAR" ? "Stake" : "Deposit"}
          </button>
          <button type="button" disabled={busy} onClick={() => { setWithdrawing(true); setAmount(""); setNote(""); }} className="h-8 rounded-full border border-line text-sm disabled:opacity-50 sm:h-10">
            Withdraw
          </button>
        </div>
        {note && !withdrawing && <p className="mt-1.5 font-mono text-[11px] text-primary">{note}</p>}
      </section>
      {withdrawing && (
        <section className="deck panel p-2 sm:p-4 lg:col-span-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[10px] uppercase tracking-widest text-muted">Withdraw</p>
            <button type="button" onClick={() => setWithdrawing(false)} className="text-xs text-muted">Close</button>
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-line bg-bg px-3 py-2">
            <div className="flex items-center gap-2">
              <TokenIcon token={tokenBySymbol("STNEAR")} className="size-6" />
              <div>
                <p className="text-sm font-semibold">stNEAR</p>
                <p className="font-mono text-[11px] text-muted">{qty(staked)} in this wallet</p>
              </div>
            </div>
            <p className="font-mono text-sm">{usd(value)}</p>
          </div>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
            aria-label="stNEAR withdraw amount"
            placeholder="stNEAR amount"
            className="mt-2 h-10 w-full rounded-xl border border-line bg-bg px-3 font-mono text-sm outline-none"
          />
          <button type="button" disabled={busy} onClick={() => void run("out")} className="mt-2 h-10 w-full rounded-full bg-primary text-sm font-semibold text-primary-fg disabled:opacity-50">
            {busy ? "Withdrawing…" : "Withdraw"}
          </button>
          {note && <p className="mt-1.5 font-mono text-[11px] text-primary">{note}</p>}
        </section>
      )}
    </div>
  );
}
