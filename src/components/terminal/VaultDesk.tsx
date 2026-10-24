import { useState } from "react";
import { fmt, tokenBySymbol, usd } from "@/lib/market";
import { TokenIcon } from "@/components/terminal/TokenIcon";
import { executeIntent } from "@/lib/intents";
import { useDesk } from "@/lib/store";

const PAY = ["USDC", "NEAR", "ETH"];
const SHOWN = ["STNEAR", "USDC", "NEAR", "ETH"];

export function VaultDesk() {
  const connected = useDesk((s) => s.connected);
  const accountId = useDesk((s) => s.accountId);
  const connect = useDesk((s) => s.connect);
  const balances = useDesk((s) => s.balances);
  const chain = useDesk((s) => s.chain);
  const vault = useDesk((s) => s.vault);
  const depositVault = useDesk((s) => s.depositVault);
  const dropVault = useDesk((s) => s.dropVault);
  const [symbol, setSymbol] = useState("NEAR");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const value = SHOWN.reduce((sum, item) => sum + (vault[item] ?? 0) * tokenBySymbol(item).price, 0);

  async function run(kind: "in" | "out") {
    if (!connected || !accountId) {
      connect();
      setNote("Connect a NEAR wallet first.");
      return;
    }
    const n = Number(amount) || 0;
    if (n <= 0 || busy) return;
    setBusy(true);
    setNote(kind === "in" ? "Confirm the deposit. It swaps into stNEAR on NEAR Intents." : "Confirm the withdraw. stNEAR swaps back on NEAR Intents.");
    try {
      if (kind === "in") {
        const result = await executeIntent({ from: symbol, to: "STNEAR", amount: String(n), accountId, purpose: "Vault deposit" });
        const parked = Math.min(result.amountOutHuman, useDesk.getState().balances.STNEAR ?? result.amountOutHuman);
        depositVault("STNEAR", parked);
        setNote(`Deposited ${fmt(result.amountOutHuman)} stNEAR.`);
      } else {
        const result = await executeIntent({
          from: "STNEAR",
          to: symbol,
          amount: String(n),
          accountId,
          purpose: "Vault withdraw",
          swapType: "EXACT_OUTPUT",
          maxPay: vault.STNEAR ?? 0,
        });
        dropVault("STNEAR", result.amountInHuman);
        setNote(`Withdrew ${fmt(result.amountOutHuman)} ${symbol}.`);
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Vault move failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid h-full min-h-0 content-center items-start gap-1.5 overflow-hidden sm:h-auto sm:content-start sm:gap-3 sm:overflow-visible lg:grid-cols-3">
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
            const held = vault[item] ?? 0;
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
                      <p className="font-mono text-[10px] text-muted sm:text-xs">{fmt(held)} · wallet {fmt((chain[item] ?? balances[item]) || 0)}</p>
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
            Deposit
          </button>
          <button type="button" disabled={busy} onClick={() => void run("out")} className="h-8 rounded-full border border-line text-sm disabled:opacity-50 sm:h-10">
            Withdraw
          </button>
        </div>
        {note && <p className="mt-1.5 truncate font-mono text-[11px] text-primary">{note}</p>}
      </section>
    </div>
  );
}
