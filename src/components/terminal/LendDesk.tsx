import { useState } from "react";
import { borrowRoom, fmt, healthFactor, LEND_MARKETS, qty, tokenBySymbol, TOKENS, usd } from "@/lib/market";
import { TokenIcon } from "@/components/terminal/TokenIcon";
import { borrowFromBurrow, repayOnBurrow, supplyOnBurrow, withdrawFromBurrow } from "@/lib/burrow";
import { syncWallet } from "@/lib/near-wallet";
import { useDesk } from "@/lib/store";

const FALLBACK = [
  { symbol: "USDC", token: "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", supplyApy: 0, borrowApy: 0 },
  { symbol: "USDT", token: "usdt.tether-token.near", supplyApy: 0, borrowApy: 0 },
  { symbol: "ETH", token: "eth.bridge.near", supplyApy: 0, borrowApy: 0 },
  { symbol: "wBTC", token: "2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near", supplyApy: 0, borrowApy: 0 },
  { symbol: "NEAR", token: "wrap.near", supplyApy: 0, borrowApy: 0 },
];

export function LendDesk() {
  const connected = useDesk((s) => s.connected);
  const accountId = useDesk((s) => s.accountId);
  const connect = useDesk((s) => s.connect);
  const supplied = useDesk((s) => s.supplied);
  const loans = useDesk((s) => s.loans);
  const chain = useDesk((s) => s.chain);
  const [picked, setPicked] = useState<string>("USDC");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useDesk((s) => s.clock);
  const health = healthFactor(supplied, loans);
  const room = borrowRoom(supplied, loans);
  const n = Number(amount) || 0;
  const markets = LEND_MARKETS.length ? LEND_MARKETS : FALLBACK;

  async function act(kind: "supply" | "withdraw" | "borrow" | "repay", symbol: string) {
    setPicked(symbol);
    if (!connected || !accountId) {
      connect();
      setNote("Connect a NEAR wallet first.");
      return;
    }
    if (n <= 0 || busy) return;
    const market = markets.find((item) => item.symbol === symbol);
    const token = market?.token || TOKENS.find((item) => item.symbol === symbol && item.chain === "NEAR")?.address;
    if (!token) {
      setNote("That market has no NEAR contract.");
      return;
    }
    const key = TOKENS.find((item) => item.address?.toLowerCase() === token.toLowerCase())?.symbol ?? symbol;
    const decimals = TOKENS.find((item) => item.symbol === key)?.decimals ?? (token === "wrap.near" || token === "meta-pool.near" ? 24 : 18);
    const wallet = useDesk.getState().accountId;
    if (!wallet) return;
    if ((kind === "supply" || kind === "repay") && (kind === "repay" ? loans[key] ?? 0 : chain[key] ?? 0) + 1e-8 < n) {
      setNote(kind === "repay" ? "This account does not owe that much." : `This wallet holds ${qty(chain[key] ?? 0)} ${key}.`);
      return;
    }
    if (kind === "withdraw" && (supplied[key] ?? 0) + 1e-8 < n) {
      setNote("That is more than this account supplied on Rhea.");
      return;
    }
    setBusy(true);
    try {
      setNote("Confirm the transaction in your NEAR wallet.");
      if (kind === "supply") await supplyOnBurrow(wallet, token, String(n), decimals);
      else if (kind === "withdraw") await withdrawFromBurrow(wallet, token, String(n), decimals);
      else if (kind === "borrow") await borrowFromBurrow(wallet, token, String(n), decimals);
      else await repayOnBurrow(wallet, token, String(n), decimals);
      await syncWallet(wallet);
      setNote(`${kind === "supply" ? "Supplied" : kind === "withdraw" ? "Withdrew" : kind === "borrow" ? "Borrowed" : "Repaid"} ${fmt(n)} ${key} on Rhea.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : "Lending move failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col pb-3">
      <section className="deck panel flex min-h-0 w-full flex-1 flex-col p-3 sm:p-4">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
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
        <label className="mt-2 flex shrink-0 items-center gap-3 text-[10px] uppercase tracking-wide text-muted">
          Amount
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ""))}
            className="h-9 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 font-mono text-base normal-case text-fg outline-none sm:max-w-xs"
          />
        </label>
        <ul className="mt-2 min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain pr-1">
          {markets.map((market) => {
            const key = TOKENS.find((item) => item.address?.toLowerCase() === market.token?.toLowerCase())?.symbol ?? market.symbol;
            const token = tokenBySymbol(key);
            return (
              <li key={`${market.symbol}-${market.token ?? ""}`}>
                <div onClick={() => setPicked(market.symbol)} className={`rounded-xl border bg-bg p-2 ${picked === market.symbol ? "border-primary" : "border-line"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <TokenIcon token={token} />
                      <div className="min-w-0">
                        <p className="font-semibold">{key}</p>
                        <p className="truncate font-mono text-[10px] text-muted">
                          wallet {qty(chain[key] ?? 0)} · {qty(supplied[key] ?? 0)} supplied · {qty(loans[key] ?? 0)} debt
                        </p>
                      </div>
                    </div>
                    <div className="shrink-0 text-right font-mono text-[11px]">
                      <p className="text-primary">{Number(market.supplyApy || 0).toFixed(1)}% supply</p>
                      <p className="text-muted">{Number(market.borrowApy || 0).toFixed(1)}% borrow</p>
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
            );
          })}
        </ul>
        {note && <p className="mt-2 shrink-0 text-[11px] text-muted">{note}</p>}
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
