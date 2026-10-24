import { useState } from "react";
import { borrowRoom, fmt, healthFactor, LEND_MARKETS, tokenBySymbol, usd } from "@/lib/market";
import { TokenIcon } from "@/components/terminal/TokenIcon";
import { executeIntent } from "@/lib/intents";
import { useDesk } from "@/lib/store";

export function LendDesk() {
  const connected = useDesk((s) => s.connected);
  const accountId = useDesk((s) => s.accountId);
  const connect = useDesk((s) => s.connect);
  const supplied = useDesk((s) => s.supplied);
  const loans = useDesk((s) => s.loans);
  const receipts = useDesk((s) => s.receipts);
  const borrow = useDesk((s) => s.borrow);
  const repay = useDesk((s) => s.repay);
  const noteSupply = useDesk((s) => s.noteSupply);
  const noteUnsupply = useDesk((s) => s.noteUnsupply);
  const addReceipt = useDesk((s) => s.addReceipt);
  const subReceipt = useDesk((s) => s.subReceipt);
  const [picked, setPicked] = useState<string>(LEND_MARKETS[0]?.symbol ?? "USDC");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useDesk((s) => s.clock);
  const health = healthFactor(supplied, loans);
  const room = borrowRoom(supplied, loans);
  const n = Number(amount) || 0;

  async function act(kind: "supply" | "withdraw" | "borrow" | "repay", symbol: string) {
    setPicked(symbol);
    if (!connected || !accountId) {
      connect();
      setNote("Connect a NEAR wallet first.");
      return;
    }
    if (n <= 0 || busy) return;
    if (kind === "borrow") {
      const cost = n * tokenBySymbol(symbol).price;
      if (cost > room + 1e-6) {
        setNote("That borrow breaks the 70% collateral limit.");
        return;
      }
      const ok = borrow(symbol, n);
      setNote(ok ? `Borrowed ${symbol} against supplied collateral.` : "Not enough collateral.");
      return;
    }
    if (kind === "repay") {
      const ok = repay(symbol, n);
      setNote(ok ? `Repaid ${symbol}.` : "Not enough balance to repay.");
      return;
    }
    setBusy(true);
    try {
      if (kind === "supply") {
        setNote("Confirm the supply. NEAR Intents swaps it into stNEAR.");
        const result = await executeIntent({ from: symbol, to: "STNEAR", amount: String(n), accountId, purpose: "Supply" });
        noteSupply(symbol, n);
        addReceipt(`lend:${symbol}`, "STNEAR", result.amountOutHuman);
        useDesk.getState().applyChain(useDesk.getState().chain);
        setNote(`Supplied ${symbol}. Receipt ${fmt(result.amountOutHuman)} stNEAR.`);
      } else {
        if ((supplied[symbol] ?? 0) + 1e-8 < n) {
          setNote("That is more than you supplied.");
          return;
        }
        const parked = receipts[`lend:${symbol}`]?.amount ?? 0;
        setNote("Confirm the withdraw. stNEAR swaps back on NEAR Intents.");
        const result = await executeIntent({
          from: "STNEAR",
          to: symbol,
          amount: String(n),
          accountId,
          purpose: "Withdraw supply",
          swapType: "EXACT_OUTPUT",
          maxPay: parked,
        });
        const removed = noteUnsupply(symbol, n);
        if (removed) subReceipt(`lend:${symbol}`, result.amountInHuman);
        useDesk.getState().applyChain(useDesk.getState().chain);
        setNote(removed ? `Withdrew ${fmt(result.amountOutHuman)} ${symbol}.` : "That is more than you supplied.");
      }
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Lending move failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-full max-h-full min-h-0 w-full max-w-5xl items-center overflow-hidden">
      <section className="deck panel max-h-full w-full overflow-hidden p-3 sm:p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted">Money market</p>
            <h2 className="text-base font-semibold sm:text-xl">Supply and borrow</h2>
          </div>
          <div className="flex gap-2">
            <div className="rounded-xl bg-bg px-3 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted">Health</p>
              <p className={`font-mono text-base sm:text-lg ${health > 0 && health < 1.15 ? "text-danger" : "text-primary"}`}>{!Number.isFinite(health) || health === 0 ? "—" : health.toFixed(2)}</p>
            </div>
            <div className="rounded-xl bg-bg px-3 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted">Borrow room</p>
              <p className="font-mono text-base sm:text-lg">{usd(room)}</p>
            </div>
          </div>
        </div>
        <label className="mt-2 flex items-center gap-3 text-[10px] uppercase tracking-wide text-muted">
          Amount
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
            className="h-9 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 font-mono text-base normal-case text-fg outline-none sm:max-w-xs"
          />
        </label>
        <ul className="lift-deck mt-2 space-y-1.5">
          {LEND_MARKETS.length === 0 && <li className="rounded-xl border border-line bg-bg p-4 text-sm text-muted">Loading live supply and borrow rates from Rhea.</li>}
          {LEND_MARKETS.map((market) => (
            <li key={market.symbol}>
              <div
                onClick={() => setPicked(market.symbol)}
                className={`lift rounded-xl border border-line bg-bg p-2 ${picked === market.symbol ? "is-up" : ""}`}
              >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <TokenIcon token={tokenBySymbol(market.symbol)} />
                  <div className="min-w-0">
                    <p className="font-semibold">{market.symbol}</p>
                    <p className="truncate font-mono text-[10px] text-muted">
                      {fmt(supplied[market.symbol] ?? 0)} supplied · {fmt(loans[market.symbol] ?? 0)} debt
                    </p>
                  </div>
                </div>
                <div className="shrink-0 text-right font-mono text-[11px]">
                  <p className="text-primary">{market.supplyApy.toFixed(1)}% supply</p>
                  <p className="text-muted">{market.borrowApy.toFixed(1)}% borrow</p>
                </div>
              </div>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                <Mini tone="primary" onClick={() => void act("supply", market.symbol)}>Supply</Mini>
                <Mini onClick={() => void act("withdraw", market.symbol)}>Withdraw</Mini>
                <Mini onClick={() => void act("borrow", market.symbol)}>Borrow</Mini>
                <Mini onClick={() => void act("repay", market.symbol)}>Repay</Mini>
              </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-muted">Rates are live from Rhea. Supply and withdraw still settle through NEAR Intents into stNEAR. Borrow stays inside the 70% line.{note ? ` ${note}` : ""}</p>
      </section>
    </div>
  );
}

function Mini({ children, onClick, tone }: { children: string; onClick: () => void; tone?: "primary" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-8 whitespace-nowrap rounded-full px-1 text-[10px] sm:h-9 sm:px-3 sm:text-sm ${tone === "primary" ? "bg-primary font-semibold text-primary-fg" : "border border-line"}`}
    >
      {children}
    </button>
  );
}
