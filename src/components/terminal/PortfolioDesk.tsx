import { useMemo, useState } from "react";
import { TokenIcon } from "@/components/terminal/TokenIcon";
import { PnlCard } from "@/components/terminal/PnlCard";
import { linkedWallets, useForeign, WALLET_MARK } from "@/lib/foreign-wallet";
import { fmt, money, TOKENS, usd, type Token } from "@/lib/market";
import { useDesk } from "@/lib/store";
import { useHoldings } from "@/lib/wallet-holdings";

const RANGES = ["1D", "7D", "30D", "1Y"] as const;
const TABS = ["Balances", "Vault", "Lending", "Positions", "History"] as const;
type Tab = (typeof TABS)[number];

export function PortfolioDesk() {
  const accountId = useDesk((s) => s.accountId);
  const connect = useDesk((s) => s.connect);
  const foreign = useForeign();
  const wallets = linkedWallets(accountId, foreign);
  const nearHold = useHoldings(wallets.find((wallet) => wallet.id === "near") ?? null);
  const evmHold = useHoldings(wallets.find((wallet) => wallet.id === "evm") ?? null);
  const solHold = useHoldings(wallets.find((wallet) => wallet.id === "sol") ?? null);
  const btcHold = useHoldings(wallets.find((wallet) => wallet.id === "btc") ?? null);
  const vault = useDesk((s) => s.vault);
  const supplied = useDesk((s) => s.supplied);
  const loans = useDesk((s) => s.loans);
  const positions = useDesk((s) => s.positions);
  const closePerp = useDesk((s) => s.closePerp);
  const activity = useDesk((s) => s.activity);
  const marks = useDesk((s) => s.marks);
  const realized = useDesk((s) => s.realized);
  const wins = useDesk((s) => s.wins);
  const closes = useDesk((s) => s.closes);
  const [range, setRange] = useState<(typeof RANGES)[number]>("30D");
  const [tab, setTab] = useState<Tab>("Balances");

  const holdings = useMemo(() => {
    const rows: { token: Token; amount: number; wallet: string }[] = [];
    const take = (book: Record<string, number>, label: string) => {
      for (const [symbol, amount] of Object.entries(book)) {
        if (amount <= 1e-8) continue;
        const token = TOKENS.find((item) => item.symbol === symbol);
        if (!token) continue;
        rows.push({ token, amount, wallet: label });
      }
    };
    take(nearHold.book, "NEAR");
    take(evmHold.book, "EVM");
    take(solHold.book, "Solana");
    take(btcHold.book, "Bitcoin");
    return rows.sort((a, b) => b.amount * (marks[b.token.symbol] ?? b.token.price) - a.amount * (marks[a.token.symbol] ?? a.token.price));
  }, [nearHold.book, evmHold.book, solHold.book, btcHold.book, marks]);
  const walletValue = holdings.reduce((sum, row) => sum + row.amount * (marks[row.token.symbol] ?? row.token.price), 0);
  const vaultRows = useMemo(() => rowsOf(vault, marks), [vault, marks]);
  const lendRows = useMemo(() => rowsOf(supplied, marks), [supplied, marks]);
  const debtRows = useMemo(() => rowsOf(loans, marks), [loans, marks]);
  const vaultValue = valueOf(vaultRows);
  const lendValue = valueOf(lendRows);
  const debtValue = valueOf(debtRows);
  const openPnl = positions.reduce((sum, position) => {
    const mark = marks[position.base] ?? position.entry;
    const pnl = position.side === "long" ? (mark - position.entry) * position.size : (position.entry - mark) * position.size;
    return sum + pnl;
  }, 0);
  const total = walletValue + vaultValue + lendValue - debtValue + positions.reduce((sum, position) => sum + position.margin, 0) + openPnl;

  return (
    <div className="px-2 py-3 sm:px-4 sm:py-5">
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            {wallets.length > 0 ? (
              <span className="flex shrink-0 -space-x-2">
                {wallets.map((wallet) => (
                  <img key={wallet.id} src={WALLET_MARK[wallet.id]} alt="" className="size-10 rounded-full bg-bg object-cover ring-2 ring-surface" />
                ))}
              </span>
            ) : (
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-fg">A</span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{wallets.length ? `${wallets.length} wallet${wallets.length === 1 ? "" : "s"} connected` : "Not connected"}</p>
              <p className="truncate text-xs text-muted">{wallets.length ? wallets.map((wallet) => wallet.label).join(" · ") : "Connect a wallet to read its balances"}</p>
            </div>
          </div>
          <div className="flex w-full rounded-full bg-bg p-0.5 text-xs sm:w-auto sm:text-xs">
            {RANGES.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setRange(item)}
                className={`h-8 flex-1 rounded-full px-2 sm:h-8 sm:flex-none sm:px-2.5 ${range === item ? "bg-surface-2 text-fg" : "text-muted"}`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
          <Stat k="Total value" v={money(total)} />
          <Stat k="Holdings" v={holdings.length ? String(holdings.length) : "—"} />
          <Stat k="Vault" v={vaultRows.length ? money(vaultValue) : "—"} />
          <Stat k="Lending" v={lendRows.length ? money(lendValue) : "—"} />
          <Stat k="Realized PnL" v={closes ? money(realized) : "—"} tone={closes ? (realized >= 0 ? "up" : "down") : undefined} />
          <Stat k="Win rate" v={closes ? `${Math.round((wins / closes) * 100)}%` : "—"} />
        </dl>

        <div className="sticky top-0 z-10 border-b border-line bg-surface px-2 py-2 sm:px-3">
          <div className="grid grid-cols-5 gap-1.5">
            {TABS.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                className={`h-10 min-w-0 rounded-lg px-1 text-xs font-medium sm:text-sm ${tab === item ? "bg-bg text-fg shadow-[inset_0_-2px_0_var(--color-primary)]" : "text-muted"}`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-40">
          {wallets.length === 0 ? (
            <Gate onConnect={connect} />
          ) : (
            <>
              {tab === "Balances" && <Holdings rows={holdings} wallet={walletValue} empty="Nothing in these wallets yet. Balances are read from each chain you connect." loading={nearHold.loading || evmHold.loading || solHold.loading || btcHold.loading} />}
              {tab === "Vault" && <Book rows={vaultRows} empty="Nothing in the vault yet. Deposits you make in Vault land here." />}
              {tab === "Lending" && (
                <div>
                  <Book rows={lendRows} empty="Nothing supplied yet. Lending you open shows up here." label="Supplied" />
                  {debtRows.length > 0 && <Book rows={debtRows} empty="" label="Borrowed" debt />}
                </div>
              )}
              {tab === "Positions" && (
                <div className="px-3 py-2 sm:px-4">
                  {positions.length === 0 ? (
                    <Empty title="No open perps" body="Longs and shorts on NEAR and ETH show up here." />
                  ) : (
                    <ul className="space-y-2">
                      {positions.map((position) => (
                        <li key={position.id}>
                          <PnlCard position={position} mark={marks[position.base] ?? position.entry} onClose={() => closePerp(position.id)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {tab === "History" && (
                <div className="px-3 py-2 sm:px-4">
                  {activity.length === 0 ? (
                    <Empty title="This wallet hasn't traded yet" body="Balances are live. Trading stats fill in after the first swap, vault deposit, or loan." />
                  ) : (
                    <ul className="divide-y divide-line">
                      {activity.map((item) => (
                        <li key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                          <span className="min-w-0">
                            <span className="block font-semibold">{item.title}</span>
                            <span className="block truncate text-xs text-muted">{item.detail}</span>
                          </span>
                          <span className={`shrink-0 font-mono text-xs ${item.value < 0 ? "text-danger" : ""}`}>{usd(item.value)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </section>
      <p className="px-1 pt-3 text-[11px] text-muted">
        {activity.length} trades · Open PnL {money(openPnl)} · Debt {debtRows.length ? money(debtValue) : "—"}
      </p>
    </div>
  );
}

function Stat({ k, v, tone }: { k: string; v: string; tone?: "up" | "down" }) {
  return (
    <div className="bg-surface px-3 py-3.5 sm:px-3">
      <dt className="text-[11px] uppercase leading-4 tracking-wide text-muted">{k}</dt>
      <dd className={`mt-1.5 truncate font-mono text-sm ${tone === "up" ? "text-primary" : tone === "down" ? "text-danger" : ""}`}>{v}</dd>
    </div>
  );
}

function Holdings({
  rows,
  wallet,
  empty,
  loading,
}: {
  rows: { token: Token; amount: number; wallet: string }[];
  wallet: number;
  empty: string;
  loading?: boolean;
}) {
  if (rows.length === 0) return <Empty title={loading ? "Reading wallets…" : "Nothing here yet"} body={loading ? "Balances are loaded from each connected chain." : empty} />;
  const marks = useDesk.getState().marks;
  return (
    <ul className="divide-y divide-line px-3 sm:px-4">
      {rows.map((row) => {
        const value = row.amount * (marks[row.token.symbol] ?? row.token.price);
        const share = wallet > 0 ? Math.min(100, (value / wallet) * 100) : 0;
        return (
          <li key={`${row.wallet}-${row.token.symbol}`} className="flex items-center gap-3 py-3">
            <TokenIcon token={row.token} className="size-9" />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{row.token.symbol}</span>
                <span className="font-mono text-sm">{usd(value)}</span>
              </span>
              <span className="mt-0.5 flex items-baseline justify-between gap-2 text-xs text-muted">
                <span className="truncate">{row.token.chain} · {row.wallet}</span>
                <span className="shrink-0 font-mono">{fmt(row.amount)}</span>
              </span>
              <span className="mt-2 block h-1 overflow-hidden rounded-full bg-bg">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Book({
  rows,
  empty,
  label,
  debt,
}: {
  rows: { symbol: string; amount: number; usd: number }[];
  empty: string;
  label?: string;
  debt?: boolean;
}) {
  if (rows.length === 0) {
    if (!empty) return null;
    return <Empty title="Nothing here yet" body={empty} />;
  }
  return (
    <div className="px-3 py-2">
      {label && <p className="text-xs uppercase tracking-wide text-muted">{label}</p>}
      <ul className="divide-y divide-line">
        {rows.map((row) => {
          const token = TOKENS.find((item) => item.symbol === row.symbol);
          return (
            <li key={row.symbol} className="flex items-center gap-2 py-2">
              {token && <TokenIcon token={token} />}
              <span className="flex-1 font-semibold">{row.symbol}</span>
              <span className={`text-right font-mono text-xs ${debt ? "text-danger" : ""}`}>
                <span className="block">{fmt(row.amount)}</span>
                <span className="text-muted">{usd(row.usd)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Gate({ onConnect }: { onConnect: () => void }) {
  return (
    <div>
      <Empty title="Nothing here yet" body="Connect a wallet. Balances are read from that chain." />
      <div className="px-3 pb-5 text-center">
        <button type="button" onClick={onConnect} className="h-10 rounded-full bg-primary px-4 text-sm font-semibold text-primary-fg">
          Connect
        </button>
      </div>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-sm text-muted">{body}</p>
    </div>
  );
}

function rowsOf(book: Record<string, number>, marks: Record<string, number>) {
  return Object.entries(book)
    .filter(([, amount]) => amount > 1e-8)
    .map(([symbol, amount]) => {
      const price = marks[symbol] ?? TOKENS.find((token) => token.symbol === symbol)?.price ?? 0;
      return { symbol, amount, usd: amount * price };
    });
}

function valueOf(rows: { usd: number }[]) {
  return rows.reduce((sum, row) => sum + row.usd, 0);
}
