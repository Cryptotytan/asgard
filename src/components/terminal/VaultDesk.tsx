import { useEffect, useRef, useState } from "react";
import { fmt, qty, tokenBySymbol } from "@/lib/market";
import { parseUnits } from "@/lib/intents";
import { TokenIcon } from "@/components/terminal/TokenIcon";
import { applyStake, armWalletPopup, cancelNearSigning, moveVault, nearFromStnear, primeVaultMove, stakeMintEstimate, stakeNear, stNearPrice, syncWallet, warmMetaPool, warmNearSigner, warmSmallStake } from "@/lib/near-wallet";
import { useDesk } from "@/lib/store";
import { ConfirmGate } from "@/components/terminal/ConfirmGate";

const PAY = ["USDC", "NEAR", "ETH"];
const SHOWN = ["STNEAR", "USDC", "NEAR", "ETH"];

function cleanVaultError(error: unknown) {
  const message = error instanceof Error ? error.message : "Vault move failed.";
  if (/rate limit|fastnear|-429|jsonrpc/i.test(message)) return "NEAR RPC is busy. Retry in a moment.";
  if (/failed to fetch|networkerror|load failed/i.test(message)) return "The pool did not answer. Retry in a moment.";
  if (/minimum deposit amount is 1000000000000000000000000|minimum stake is 1 NEAR/i.test(message)) return "Meta Pool's minimum stake is 1 NEAR.";
  return message;
}

export function VaultDesk() {
  const connected = useDesk((s) => s.connected);
  const accountId = useDesk((s) => s.accountId);
  const connect = useDesk((s) => s.connect);
  const chain = useDesk((s) => s.chain);
  const nearMark = useDesk((s) => s.marks.NEAR);
  const stMark = useDesk((s) => s.marks.STNEAR);
  const nearYocto = useDesk((s) => s.nearYocto);
  const [symbol, setSymbol] = useState("NEAR");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [turn, setTurn] = useState<"idle" | "out" | "in">("idle");
  const [flight, setFlight] = useState<{ title: string; detail: string } | null>(null);
  const flightGen = useRef(0);
  const staked = chain.STNEAR ?? chain.stNEAR ?? 0;
  const price = stNearPrice() || nearMark || stMark || 0;
  const value = staked * (price > 0 ? price : 0);
  useEffect(() => {
    warmNearSigner();
    if (accountId) {
      void warmMetaPool(accountId);
      void syncWallet(accountId);
    }
  }, [accountId]);
  useEffect(() => {
    const n = Number(amount) || 0;
    if (n <= 0) return;
    primeVaultMove(withdrawing ? "STNEAR" : symbol, amount, withdrawing ? "out" : "in");
    if (!withdrawing && symbol === "NEAR" && n < 1 && accountId) warmSmallStake(accountId);
  }, [amount, symbol, withdrawing, accountId]);

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
    const generation = flightGen.current;
    armWalletPopup();
    setBusy(true);
    const title = kind === "out" ? "Withdraw stNEAR" : symbol === "NEAR" ? "Stake NEAR" : `Deposit ${symbol}`;
    setFlight({ title, detail: `${fmt(n)} ${kind === "out" ? "stNEAR" : symbol}` });
    setNote(kind === "in" && symbol === "NEAR" ? "Confirm the stake in your NEAR wallet. Meta Pool mints stNEAR." : kind === "in" ? "Confirm the swap into stNEAR." : "Confirm the swap out of stNEAR.");
    try {
      if (kind === "in" && symbol === "NEAR") {
        const yocto = parseUnits(String(n), 24);
        if (!yocto) throw new Error("Enter an amount.");
        await stakeNear(wallet, yocto);
        applyStake(n, stakeMintEstimate(n));
        void syncWallet(wallet);
        if (flightGen.current !== generation) return;
        setAmount("");
        setNote(`Staked ${fmt(n)} NEAR. stNEAR arrives in this wallet.`);
      } else if (kind === "in") {
        await moveVault(wallet, symbol, amount, "in");
        applyStake(0, stakeMintEstimate(n * (tokenBySymbol(symbol).price || 1) / Math.max(tokenBySymbol("NEAR").price || 1, 1e-8)), { symbol, amount: n });
        void syncWallet(wallet);
        setAmount("");
        setNote(`Deposited ${fmt(n)} ${symbol} into stNEAR.`);
      } else {
        const mode = await moveVault(wallet, "STNEAR", amount, "out");
        applyStake(mode === "delayed" ? 0 : -nearFromStnear(n), -n);
        void syncWallet(wallet);
        setAmount("");
        setWithdrawing(false);
        setNote(mode === "delayed" ? `Unstake started for ${fmt(n)} stNEAR. NEAR unlocks after Meta Pool's waiting period.` : `Withdrew ${fmt(n)} stNEAR. NEAR returns to this wallet.`);
      }
    } catch (error) {
      if (flightGen.current !== generation) return;
      setNote(cleanVaultError(error));
    } finally {
      if (flightGen.current === generation) {
        setBusy(false);
        setFlight(null);
      }
    }
  }

  function dismissFlight() {
    flightGen.current += 1;
    cancelNearSigning();
    setFlight(null);
    setBusy(false);
    setNote("Cancelled.");
  }

  function flipFunds(next: boolean) {
    if (turn !== "idle" || next === withdrawing) return;
    setTurn("out");
    window.setTimeout(() => {
      setWithdrawing(next);
      setAmount("");
      setNote("");
      setTurn("in");
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setTurn("idle"));
      });
    }, 280);
  }

  return (
    <div className="grid h-full min-h-0 content-start items-start gap-1.5 overflow-y-auto sm:h-auto sm:gap-3 lg:grid-cols-3">
      <section className="deck panel p-2 sm:p-4 lg:col-span-2">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted">Vault</p>
            <h2 className="font-mono text-base leading-tight sm:text-3xl">{usd2(value)}</h2>
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
                  <p className="font-mono text-xs sm:text-sm">{usd2(held * (item === "STNEAR" ? (price > 0 ? price : 0) : token.price))}</p>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="yaw-scene deck panel p-2 sm:p-4">
        <div className={`yaw-swap ${turn === "out" ? "is-out" : turn === "in" ? "is-in" : ""}`}>
        {withdrawing ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] uppercase tracking-widest text-muted">Withdraw</p>
              <button type="button" onClick={() => flipFunds(false)} className="text-xs text-muted">Back</button>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-line bg-bg px-3 py-2">
              <div className="flex items-center gap-2">
                <TokenIcon token={tokenBySymbol("STNEAR")} className="size-6" />
                <div>
                  <p className="text-sm font-semibold">stNEAR</p>
                  <p className="font-mono text-[11px] text-muted">{qty(staked)} in this wallet</p>
                </div>
              </div>
              <p className="font-mono text-sm">{usd2(value)}</p>
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
          </>
        ) : (
          <>
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
              placeholder="Amount"
              className="mt-1.5 h-8 w-full rounded-xl border border-line bg-bg px-3 font-mono text-sm outline-none sm:mt-3 sm:h-10 sm:rounded-2xl"
            />
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <button type="button" disabled={busy} onClick={() => void run("in")} className="h-8 rounded-full bg-primary text-sm font-semibold text-primary-fg disabled:opacity-50 sm:h-10">
                {symbol === "NEAR" ? "Stake" : "Deposit"}
              </button>
              <button type="button" disabled={busy} onClick={() => flipFunds(true)} className="h-8 rounded-full border border-line text-sm disabled:opacity-50 sm:h-10">
                Withdraw
              </button>
            </div>
            {note && <p className="mt-1.5 font-mono text-[11px] text-primary">{note}</p>}
          </>
        )}
        </div>
      </section>
      {flight && <ConfirmGate title={flight.title} detail={flight.detail} onDismiss={dismissFlight} />}
    </div>
  );
}

function usd2(n: number) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
