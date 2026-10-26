import { useEffect, useState, type ReactNode } from "react";
import { Bell, Eye, EyeOff, Pencil, Plus, Search, Trash2, Wallet, X } from "lucide-react";
import { TokenIcon } from "@/components/terminal/TokenIcon";
import { qty, signedPct, scoreLabel, TOKENS, usd, type Token } from "@/lib/market";
import { useDesk } from "@/lib/store";
import {
  EMPTY_TRACKER,
  LABELS,
  loadChain,
  nearProblem,
  peekChain,
  readTracker,
  refreshChain,
  subscribeChain,
  writeTracker,
  type AlertOn,
  type Label,
  type NotifyVia,
  type TrackedWallet,
  type TrackerState,
} from "@/lib/tracker";

const blank = {
  id: "",
  kind: "named" as "named" | "implicit",
  address: "",
  name: "",
  alert: "all" as AlertOn,
  notify: "toast" as NotifyVia,
  sound: "Chime",
  minUsd: "12",
  folder: "",
  labels: [] as Label[],
  note: "",
};

export function TrackerDesk({ onTrade, onFlash }: { onTrade: (symbol: string) => void; onFlash: (message: string) => void }) {
  const [data, setData] = useState<TrackerState>(EMPTY_TRACKER);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<"wallets" | "live" | "tokens">("wallets");
  const [form, setForm] = useState(blank);
  const [walletOpen, setWalletOpen] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [folderDraft, setFolderDraft] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [range, setRange] = useState<"1D" | "7D" | "30D" | "1Y">("30D");
  const [pane, setPane] = useState<"balances" | "performance" | "activity">("balances");
  const [spam, setSpam] = useState(false);
  const [research, setResearch] = useState("");
  const [chainRev, setChainRev] = useState(0);
  const [walletFilter, setWalletFilter] = useState("all");
  const [folderFilter, setFolderFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(TOKENS[0]?.symbol ?? "NEAR");
  const accountId = useDesk((s) => s.accountId);
  const connected = useDesk((s) => s.connected);
  const connect = useDesk((s) => s.connect);

  useEffect(() => {
    if (!connected || !accountId) {
      setReady(false);
      setData(EMPTY_TRACKER);
      setActive(null);
      setWalletOpen(false);
      setTokenOpen(false);
      return;
    }
    setData(readTracker(accountId));
    setReady(true);
  }, [accountId, connected]);

  useEffect(() => {
    if (ready && accountId) writeTracker(accountId, data);
  }, [data, ready, accountId]);

  useEffect(() => subscribeChain(() => setChainRev((value) => value + 1)), []);

  const wallet = data.wallets.find((item) => item.id === active) ?? null;
  const liveRows = data.wallets.flatMap((item) => {
    if (walletFilter !== "all" && item.id !== walletFilter) return [];
    if (folderFilter !== "all" && item.folder !== folderFilter) return [];
    const live = peekChain(item.address);
    return (live?.fills ?? []).map((fill) => ({ ...fill, wallet: item.name }));
  });

  function saveWallet() {
    const problem = nearProblem(form.address, form.kind);
    if (problem) return;
    if (!form.name.trim()) return;
    const next: TrackedWallet = {
      id: form.id || `${Date.now()}`,
      address: form.address.trim().toLowerCase(),
      name: form.name.trim(),
      alert: form.alert,
      notify: form.notify,
      sound: form.sound,
      minUsd: Number(form.minUsd) || 0,
      folder: form.folder,
      labels: form.labels,
      note: form.note.trim(),
      muted: data.wallets.find((item) => item.id === form.id)?.muted ?? false,
    };
    setData((current) => ({
      ...current,
      wallets: form.id ? current.wallets.map((item) => (item.id === form.id ? next : item)) : [next, ...current.wallets].slice(0, 100),
      folders: next.folder && !current.folders.includes(next.folder) ? [...current.folders, next.folder] : current.folders,
    }));
    setWalletOpen(false);
    void refreshChain(next.address).then(() => setChainRev((value) => value + 1));
    onFlash(`Wallet ${form.id ? "updated" : "added to Tracker"}\n${next.name}`);
  }

  function openEdit(item: TrackedWallet) {
    setForm({
      id: item.id,
      kind: /^[0-9a-f]{64}$/.test(item.address) ? "implicit" : "named",
      address: item.address,
      name: item.name,
      alert: item.alert,
      notify: item.notify,
      sound: item.sound,
      minUsd: String(item.minUsd),
      folder: item.folder,
      labels: item.labels,
      note: item.note,
    });
    setWalletOpen(true);
  }

  useEffect(() => {
    if (!data.wallets.length) return;
    let stop = false;
    const pull = (fresh: boolean) => {
      void Promise.all(data.wallets.map((item) => (fresh ? refreshChain(item.address) : loadChain(item.address)).catch(() => null))).then(() => {
        if (!stop) setChainRev((value) => value + 1);
      });
    };
    pull(false);
    const timer = window.setInterval(() => pull(true), 20_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [data.wallets]);
  const problem = form.address ? nearProblem(form.address, form.kind) : "";
  const watched = TOKENS.filter((token) => data.tokens.includes(token.symbol));
  const results = TOKENS.filter((token) => `${token.symbol} ${token.name}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.volN - a.volN)
    .slice(0, 8);
  const focus = TOKENS.find((token) => token.symbol === picked) ?? TOKENS[0];

  if (!connected) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-6 text-center">
        <div className="max-w-sm">
          <p className="text-lg font-semibold">Connect to open the tracker</p>
          <p className="mt-2 text-sm text-muted">Watched accounts, live fills, and tokens stay with the connected NEAR wallet.</p>
          <button type="button" onClick={() => connect()} className="mt-4 h-10 rounded-full bg-primary px-4 text-sm font-semibold text-primary-fg">Connect wallet</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
        <div className="flex rounded-full bg-surface p-1 ring-1 ring-line ring-inset">
          {(
            [
              ["wallets", "Wallets"],
              ["live", "Live trades"],
              ["tokens", "Tokens"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" onClick={() => { setTab(id); setActive(null); }} className={`h-8 rounded-full px-3 text-xs sm:text-sm ${tab === id ? "bg-bg text-fg shadow-[inset_0_-2px_0_var(--color-primary)]" : "text-muted"}`}>
              {label}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-xs text-muted">{tab === "tokens" ? data.tokens.length : data.wallets.length}/100</span>
        {tab !== "live" && (
          <button
            type="button"
            onClick={() => {
              if (tab === "tokens") setTokenOpen(true);
              else {
                setForm(blank);
                setWalletOpen(true);
              }
            }}
            className="inline-flex h-9 items-center gap-1 rounded-full bg-primary px-3 text-sm font-semibold text-primary-fg"
          >
            <Plus className="size-3.5" />
            {tab === "tokens" ? "Add token" : "Add wallet"}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === "wallets" && !wallet && (
          data.wallets.length === 0 ? (
            <Empty title="No wallets tracked yet" body="Add up to 100 NEAR accounts and watch what they trade." action="Add wallet" onClick={() => { setForm(blank); setWalletOpen(true); }} />
          ) : (
            <>
            <ul className="grid gap-2 p-3 md:hidden">
              {data.wallets.map((item) => {
                const live = peekChain(item.address);
                const value = live ? `${(live.usdt ?? live.value).toFixed(2)} USDT` : "Reading…";
                return (
                  <li key={item.id}>
                    <button type="button" onClick={() => { setActive(item.id); setResearch(""); }} className="w-full rounded-2xl border border-line bg-surface p-3 text-left">
                      <span className="flex items-center gap-3">
                        <i className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-sm font-bold text-primary-fg not-italic">{item.name.slice(0, 1).toUpperCase()}</i>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{item.name} {item.labels[0] && <em className="text-xs font-normal text-primary not-italic">{item.labels[0]}</em>}</span>
                          <span className="block truncate text-xs text-muted">{item.note || item.address}</span>
                        </span>
                        <span className="font-mono text-sm text-fg">{value}</span>
                      </span>
                      <span className="mt-3 grid grid-cols-3 text-xs text-muted">
                        <span className="truncate">{live ? (live.holdings.slice(0, 3).map((row) => row.symbol).join(" ") || "No tokens") : "Reading wallet"}</span>
                        <span>{live ? `${live.holdings.length} tokens` : "…"}</span>
                        <span className="text-right">{live?.ago ?? "…"}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="scroll-x hidden md:block">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-muted">
                  <tr className="border-b border-line">
                    {["Wallet", "Note", "Value", "Holdings", "Last activity", ""].map((label) => (
                      <th key={label} className="px-3 py-2 font-medium">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.wallets.map((item) => {
                    const live = peekChain(item.address);
                    return (
                      <tr key={item.id} className="cursor-pointer border-b border-line hover:bg-surface" onClick={() => { setActive(item.id); setResearch(""); }}>
                        <td className="px-3 py-2.5">
                          <span className="flex items-center gap-2">
                            <i className="grid size-8 place-items-center rounded-full bg-primary text-xs font-bold text-black not-italic">{item.name.slice(0, 1).toUpperCase()}</i>
                            <span>
                              <span className="block font-semibold">{item.name} {item.labels[0] && <em className="text-xs font-normal text-primary not-italic">{item.labels[0]}</em>}</span>
                              <span className="text-xs text-muted">NEAR</span>
                            </span>
                          </span>
                        </td>
                        <td className="max-w-48 truncate px-3 text-muted">{item.note || "—"}</td>
                        <td className="px-3 font-mono">{live ? `${(live.usdt ?? live.value).toFixed(2)} USDT` : "Reading…"}</td>
                        <td className="px-3 font-mono">{live ? live.holdings.length : "…"}</td>
                        <td className="px-3 text-muted">{live?.ago ?? "…"}</td>
                        <td className="px-3">
                          <span className="flex justify-end gap-1">
                            <IconButton label={item.muted ? "Unmute" : "Mute"} onClick={() => setData((current) => ({ ...current, wallets: current.wallets.map((row) => row.id === item.id ? { ...row, muted: !row.muted } : row) }))}>{item.muted ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}</IconButton>
                            <IconButton label="Alerts" onClick={() => setData((current) => ({ ...current, wallets: current.wallets.map((row) => row.id === item.id ? { ...row, notify: row.notify === "off" ? "toast" : "off" } : row) }))}><Bell className="size-3.5" /></IconButton>
                            <IconButton label="Edit" onClick={() => openEdit(item)}><Pencil className="size-3.5" /></IconButton>
                            <IconButton label="Remove" onClick={() => setData((current) => ({ ...current, wallets: current.wallets.filter((row) => row.id !== item.id) }))}><Trash2 className="size-3.5" /></IconButton>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )
        )}

        {tab === "wallets" && wallet && (
          <WalletDetail
            wallet={wallet}
            range={range}
            pane={pane}
            spam={spam}
            research={research}
            onRange={setRange}
            onPane={setPane}
            onSpam={setSpam}
            onResearch={() => setResearch(`${wallet.name} is a watched NEAR account. Balances and transfers are read from the chain.`)}
            onTrade={onTrade}
            onBack={() => setActive(null)}
          />
        )}

        {tab === "live" && (
          <div>
            <div className="flex gap-2 px-3 py-2">
              <select value={walletFilter} onChange={(event) => setWalletFilter(event.target.value)} className="h-8 rounded-full border border-line bg-surface px-2 text-xs">
                <option value="all">All wallets</option>
                {data.wallets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <select value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)} className="h-8 rounded-full border border-line bg-surface px-2 text-xs">
                <option value="all">All folders</option>
                {data.folders.map((folder) => <option key={folder}>{folder}</option>)}
              </select>
            </div>
            {liveRows.length === 0 ? (
              <Empty title="No live transfers yet" body="Track a NEAR account. Recent fungible transfers from the chain show up here." action="Add wallet" onClick={() => { setForm(blank); setWalletOpen(true); }} />
            ) : (
              <div className="scroll-x">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-muted">
                    <tr className="border-b border-line">{["Activity", "Wallet", "Detail", "Amount", "Time", ""].map((label) => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {liveRows.map((fill) => (
                      <tr key={`${fill.wallet}-${fill.id}`} className="border-b border-line">
                        <td className={`px-3 py-2 font-semibold ${fill.incoming ? "text-primary" : "text-fg"}`}>{fill.kind}</td>
                        <td className="px-3">{fill.wallet}</td>
                        <td className="max-w-48 truncate px-3">{fill.symbol}</td>
                        <td className="px-3 font-mono">{fill.amount ? fill.amount.toPrecision(4) : "—"}</td>
                        <td className="px-3 text-muted">{fill.ago}</td>
                        <td className="px-3 text-right"><button type="button" onClick={() => onTrade(fill.symbol)} className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-black">Trade</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "tokens" && (
          watched.length === 0 ? (
            <Empty title="No tokens tracked yet" body="Add up to 100 NEAR tokens and follow them from this desk." action="Add token" onClick={() => setTokenOpen(true)} />
          ) : (
            <div className="scroll-x">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-muted">
                  <tr className="border-b border-line">{["Token", "Market cap", "24h", "Liquidity", "Volume", "Txns", ""].map((label) => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr>
                </thead>
                <tbody>
                  {watched.map((token) => (
                    <tr key={token.symbol} className="border-b border-line">
                      <td className="px-3 py-2"><span className="flex items-center gap-2"><TokenIcon token={token} /><span><b className="block">{token.symbol}</b><span className="text-xs text-muted">{token.name} · {token.chain}</span></span></span></td>
                      <td className="px-3">{token.mcap}</td>
                      <td className={`px-3 font-mono ${token.change >= 0 ? "text-primary" : "text-danger"}`}>{signedPct(token.change)}</td>
                      <td className="px-3">{token.liquidity}</td>
                      <td className="px-3">{token.volume}</td>
                      <td className="px-3">{token.txns}</td>
                      <td className="px-3 text-right">
                        <button type="button" onClick={() => onTrade(token.symbol)} className="mr-2 h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-black">20 USDC</button>
                        <button type="button" aria-label="Remove" onClick={() => setData((current) => ({ ...current, tokens: current.tokens.filter((symbol) => symbol !== token.symbol) }))} className="text-muted"><Trash2 className="inline size-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {walletOpen && (
        <Modal title={form.id ? "Edit wallet" : "Add wallet"} onClose={() => setWalletOpen(false)}>
          <div className="mb-4 border-b border-line pb-4">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-2xl bg-primary/15 text-primary">
                <Wallet className="size-5" />
              </span>
              <div>
                <p className="text-base font-semibold">{form.id ? "Edit wallet" : "Follow a wallet"}</p>
                <p className="text-xs text-muted">Alerts stay on this connected account. Another wallet’s balances are never copied here.</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-surface p-1 ring-1 ring-line ring-inset">
            {(["named", "implicit"] as const).map((kind) => (
              <button key={kind} type="button" onClick={() => setForm({ ...form, kind })} className={`h-10 rounded-xl text-sm ${form.kind === kind ? "bg-bg font-semibold text-fg shadow-[inset_0_0_0_1px_var(--color-primary)]" : "text-muted"}`}>{kind === "named" ? "Named .near" : "Implicit"}</button>
            ))}
          </div>
          <Field label="NEAR account">
            <input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} placeholder={form.kind === "named" ? "whale.near" : "64-character implicit account"} className={`mt-1.5 h-12 w-full rounded-2xl border bg-surface px-3 font-mono text-sm outline-none ${problem ? "border-danger" : "border-line focus:border-primary"}`} />
            <span className={`mt-1.5 block text-xs normal-case tracking-normal ${problem ? "text-danger" : "text-muted"}`}>{problem || (form.kind === "named" ? "A named account such as whale.near" : "A 64-character hex account, no 0x")}</span>
          </Field>
          <Field label="Name">
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Whale #1" className="mt-1.5 h-12 w-full rounded-2xl border border-line bg-surface px-3 text-sm outline-none focus:border-primary" />
          </Field>
          <Field label="Alert on">
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {(["all", "buys", "sells"] as const).map((alert) => (
                <button key={alert} type="button" onClick={() => setForm({ ...form, alert })} className={`h-11 rounded-2xl text-sm capitalize ${form.alert === alert ? "bg-primary font-semibold text-primary-fg" : "bg-surface text-muted ring-1 ring-line ring-inset"}`}>{alert === "all" ? "All" : alert}</button>
              ))}
            </div>
          </Field>
          <Field label="Notify">
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {([["toast", "In-app"], ["off", "Off"]] as const).map(([id, label]) => (
                <button key={id} type="button" onClick={() => setForm({ ...form, notify: id })} className={`h-11 rounded-2xl text-sm ${form.notify === id ? "bg-primary font-semibold text-primary-fg" : "bg-surface text-muted ring-1 ring-line ring-inset"}`}>{label}</button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sound">
              <select value={form.sound} onChange={(event) => setForm({ ...form, sound: event.target.value })} className="mt-1.5 h-12 w-full rounded-2xl border border-line bg-surface px-3 text-sm outline-none focus:border-primary">
                {["Chime", "Soft", "Off"].map((sound) => <option key={sound}>{sound}</option>)}
              </select>
            </Field>
            <Field label="Min USD">
              <input value={form.minUsd} onChange={(event) => setForm({ ...form, minUsd: event.target.value.replace(/[^0-9.]/g, "") })} className="mt-1.5 h-12 w-full rounded-2xl border border-line bg-surface px-3 font-mono text-sm outline-none focus:border-primary" />
            </Field>
          </div>
          <Field label="Folder">
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button type="button" onClick={() => setForm({ ...form, folder: "" })} className={`h-9 rounded-full px-3 text-xs ${form.folder === "" ? "bg-primary font-semibold text-primary-fg" : "bg-surface text-muted ring-1 ring-line ring-inset"}`}>None</button>
              {data.folders.map((folder) => (
                <button key={folder} type="button" onClick={() => setForm({ ...form, folder })} className={`h-9 rounded-full px-3 text-xs ${form.folder === folder ? "bg-primary font-semibold text-primary-fg" : "bg-surface text-muted ring-1 ring-line ring-inset"}`}>{folder}</button>
              ))}
              <input value={folderDraft} onChange={(event) => setFolderDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && folderDraft.trim()) { setForm({ ...form, folder: folderDraft.trim() }); setFolderDraft(""); } }} placeholder="New folder" className="h-9 w-28 rounded-full border border-line bg-surface px-3 text-xs outline-none focus:border-primary" />
            </div>
          </Field>
          <Field label="Labels">
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {LABELS.map((label) => {
                const on = form.labels.includes(label);
                return <button key={label} type="button" onClick={() => setForm({ ...form, labels: on ? form.labels.filter((item) => item !== label) : [...form.labels, label] })} className={`h-9 rounded-full px-3 text-xs ${on ? "bg-primary font-semibold text-primary-fg" : "bg-surface text-muted ring-1 ring-line ring-inset"}`}>{label}</button>;
              })}
            </div>
          </Field>
          <Field label="Note">
            <textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Why you follow this account" className="mt-1.5 h-20 w-full resize-none rounded-2xl border border-line bg-surface px-3 py-2 text-sm normal-case tracking-normal outline-none focus:border-primary" />
          </Field>
          <div className="sticky bottom-0 -mx-4 mt-5 grid grid-cols-[7rem_minmax(0,1fr)] gap-2 border-t border-line bg-bg px-4 py-3">
            <button type="button" onClick={() => setWalletOpen(false)} className="h-12 rounded-2xl border border-line text-sm">Cancel</button>
            <button type="button" disabled={Boolean(problem) || !form.name.trim() || !form.address.trim()} onClick={saveWallet} className="h-12 rounded-2xl bg-primary text-sm font-semibold text-primary-fg disabled:opacity-40">{form.id ? "Save wallet" : "Add wallet"}</button>
          </div>
        </Modal>
      )}

      {tokenOpen && focus && (
        <Modal title="Add token" wide onClose={() => setTokenOpen(false)}>
          <div className="grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search NEAR tokens" className="h-10 w-full rounded-lg border border-line bg-bg pl-9 pr-3 text-sm outline-none focus:border-primary" />
              </label>
              <ul className="mt-2 max-h-80 overflow-auto">
                {results.map((token) => (
                  <li key={token.symbol}>
                    <button type="button" onClick={() => setPicked(token.symbol)} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${picked === token.symbol ? "bg-surface" : ""}`}>
                      <TokenIcon token={token} />
                      <span className="min-w-0 flex-1"><b className="block truncate">{token.symbol}</b><span className="text-xs text-muted">{token.name}</span></span>
                      <span className="font-mono">{usd(token.price)}</span>
                      <span className={token.change >= 0 ? "text-primary" : "text-danger"}>{signedPct(token.change)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <TokenPreview token={focus} tracked={data.tokens.includes(focus.symbol)} onTrade={() => { setTokenOpen(false); onTrade(focus.symbol); }} onWatch={() => {
              setData((current) => ({ ...current, tokens: current.tokens.includes(focus.symbol) ? current.tokens : [focus.symbol, ...current.tokens].slice(0, 100) }));
              onFlash(`Added to watchlist\n${focus.symbol}`);
            }} />
          </div>
        </Modal>
      )}
    </div>
  );
}

function WalletDetail({
  wallet, range, pane, spam, research, onRange, onPane, onSpam, onResearch, onTrade, onBack,
}: {
  wallet: TrackedWallet;
  range: "1D" | "7D" | "30D" | "1Y";
  pane: "balances" | "performance" | "activity";
  spam: boolean;
  research: string;
  onRange: (range: "1D" | "7D" | "30D" | "1Y") => void;
  onPane: (pane: "balances" | "performance" | "activity") => void;
  onSpam: (value: boolean) => void;
  onResearch: () => void;
  onTrade: (symbol: string) => void;
  onBack: () => void;
}) {
  const live = peekChain(wallet.address);
  const held = (live?.holdings ?? []).filter((row) => spam || row.usd >= 0.05 || row.usd === 0);
  const top = (live?.holdings ?? []).slice(0, 3);
  return (
    <div className="px-3 py-3 sm:px-4">
      <button type="button" onClick={onBack} className="text-xs text-muted">← Wallets</button>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <i className="grid size-11 place-items-center rounded-full bg-primary text-sm font-bold text-black not-italic">{wallet.name.slice(0, 1).toUpperCase()}</i>
          <div>
            <p className="text-lg font-semibold">{wallet.name} <span className="text-sm font-normal text-muted">NEAR</span></p>
            <p className="max-w-[16rem] truncate font-mono text-xs text-muted">{wallet.address}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {(["1D", "7D", "30D", "1Y"] as const).map((item) => (
            <button key={item} type="button" onClick={() => onRange(item)} className={`h-8 rounded-full px-2.5 text-xs ${range === item ? "bg-primary text-black" : "text-muted"}`}>{item}</button>
          ))}
          <button type="button" onClick={onResearch} className="h-8 rounded-full border border-line px-3 text-xs">AI research</button>
        </div>
      </div>
      {research && <p className="mt-2 max-w-3xl text-sm text-muted">{research}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Stat k="Total value" v={live ? usd(live.value) : "…"} />
        <Stat k="Holdings" v={live ? String(live.holdings.length) : "…"} />
        <Stat k="In USDT" v={live ? `${(live.usdt ?? live.value).toFixed(2)} USDT` : "…"} />
        <Stat k="Last transfer" v={live?.ago ?? "…"} />
      </div>
      <div className="mt-3 rounded-xl border border-line bg-surface p-3">
        <p className="text-xs text-muted">Total worth of tokens</p>
        <p className="font-mono text-xl">{live ? usd(live.value) : "Reading balances…"}</p>
        <p className="mt-1 text-xs text-muted">{live ? `${live.holdings.length} holdings · ${(live.usdt ?? live.value).toFixed(2)} USDT` : "Balances show as soon as the account is read. Transfers follow."}</p>
      </div>
      <div className="mt-4 flex items-center gap-3 border-b border-line">
        {(["balances", "performance", "activity"] as const).map((item) => (
          <button key={item} type="button" onClick={() => onPane(item)} className={`h-9 capitalize ${pane === item ? "text-fg shadow-[inset_0_-2px_0_var(--color-primary)]" : "text-muted"}`}>{item}</button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={spam} onChange={(event) => onSpam(event.target.checked)} /> Show spam</label>
      </div>
      {pane === "balances" && (
        <div className="scroll-x">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-[11px] uppercase text-muted"><tr>{["Token", "Amount", "USD", "USDT", "Share", ""].map((label) => <th key={label} className="py-2 font-medium">{label}</th>)}</tr></thead>
            <tbody>
              {!live && (
                <tr><td colSpan={6} className="py-4 text-sm text-muted">Reading balances…</td></tr>
              )}
              {live && held.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-sm text-muted">This wallet has no tokens.</td></tr>
              )}
              {held.map((row) => {
                const token = TOKENS.find((item) => item.symbol.toLowerCase() === row.symbol.toLowerCase());
                const unit = live && live.value > 0 ? row.usd / (live.value / Math.max(live.usdt, 1e-12)) : row.usd;
                return (
                <tr key={row.symbol} className="border-t border-line">
                  <td className="py-2">
                    <span className="flex items-center gap-2 font-semibold">
                      {token && <TokenIcon token={token} className="size-5" />}
                      {row.symbol}
                    </span>
                  </td>
                  <td className="font-mono">{qty(row.amount)}</td>
                  <td className="font-mono">{row.usd ? usd(row.usd) : "—"}</td>
                  <td className="font-mono">{row.usd ? unit.toFixed(2) : "—"}</td>
                  <td><span className="block h-1.5 w-24 overflow-hidden rounded-full bg-bg"><i className="block h-full bg-primary" style={{ width: `${row.share}%` }} /></span></td>
                  <td className="text-right"><button type="button" onClick={() => onTrade(row.symbol)} className="h-8 rounded-lg bg-primary px-3 text-xs font-semibold text-black">Buy</button></td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pane === "performance" && (
        <div className="grid grid-cols-2 gap-2 py-3 sm:grid-cols-3">
          <Stat k="Token worth" v={live ? usd(live.value) : "…"} />
          <Stat k="USDT total" v={live ? `${(live.usdt ?? live.value).toFixed(2)} USDT` : "…"} />
          <Stat k="Holdings" v={live ? String(live.holdings.length) : "…"} />
          <Stat k="Largest" v={top[0] ? `${top[0].symbol} ${top[0].share.toFixed(0)}%` : "—"} />
          <Stat k="In" v={live ? String(live.fills.filter((fill) => fill.incoming).length) : "…"} />
          <Stat k="Out" v={live ? String(live.fills.filter((fill) => !fill.incoming).length) : "…"} />
        </div>
      )}
      {pane === "activity" && (
        <ul className="divide-y divide-line text-sm">
          {!live && <li className="py-3 text-muted">Reading transfers…</li>}
          {(live?.fills ?? []).map((fill) => (
            <li key={fill.id} className="flex items-center justify-between gap-3 py-2">
              <span className={`w-24 shrink-0 ${fill.incoming ? "text-primary" : "text-fg"}`}>{fill.kind}</span>
              <span className="min-w-0 flex-1 truncate">{fill.symbol}{fill.detail ? ` · ${fill.detail}` : ""}</span>
              <span className="font-mono">{fill.amount ? qty(fill.amount) : "—"}</span>
              <span className="text-muted">{fill.ago}</span>
            </li>
          ))}
          {live && live.fills.length === 0 && <li className="py-3 text-muted">{live.ago === "…" ? "Reading transfers…" : "No recent account activity."}</li>}
        </ul>
      )}
    </div>
  );
}

function TokenPreview({ token, tracked, onTrade, onWatch }: { token: Token; tracked: boolean; onTrade: () => void; onWatch: () => void }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <div className="flex items-center gap-2"><TokenIcon token={token} /><div><b>{token.symbol}</b><p className="text-xs text-muted">{token.name} · {token.chain}</p></div></div>
      <p className="mt-3 font-mono text-lg">{usd(token.price)}</p>
      <p className={`text-sm ${token.change >= 0 ? "text-primary" : "text-danger"}`}>{signedPct(token.change)} · 24h</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div><dt className="text-xs text-muted">Market cap</dt><dd>{token.mcap}</dd></div>
        <div><dt className="text-xs text-muted">Liquidity</dt><dd>{token.liquidity}</dd></div>
        <div><dt className="text-xs text-muted">Volume</dt><dd>{token.volume}</dd></div>
        <div><dt className="text-xs text-muted">Score</dt><dd>{scoreLabel(token)}</dd></div>
      </dl>
      <button type="button" onClick={onTrade} className="mt-3 h-10 w-full rounded-xl bg-primary text-sm font-semibold text-black">Trade</button>
      <button type="button" onClick={onWatch} disabled={tracked} className="mt-2 h-9 w-full rounded-xl border border-line text-sm disabled:opacity-50">{tracked ? "On the watchlist" : "Add to watchlist"}</button>
    </div>
  );
}

function Spark({ values }: { values: number[] }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const d = values.map((value, index) => `${index === 0 ? "M" : "L"}${((index / (values.length - 1)) * 100).toFixed(2)} ${((1 - (value - min) / span) * 70 + 8).toFixed(2)}`).join(" ");
  return (
    <svg viewBox="0 0 100 86" className="mt-2 h-28 w-full">
      <path d={`${d} L100 86 L0 86 Z`} fill="rgba(0,236,151,0.16)" />
      <path d={d} fill="none" stroke="#00ec97" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Stat({ k, v, good }: { k: string; v: string; good?: boolean }) {
  return <div className="rounded-xl border border-line bg-surface px-3 py-2"><p className="text-[10px] uppercase tracking-wide text-muted">{k}</p><p className={`mt-1 truncate font-mono text-sm ${good ? "text-primary" : ""}`}>{v}</p></div>;
}

function Empty({ title, body, action, onClick }: { title: string; body: string; action: string; onClick: () => void }) {
  return (
    <div className="grid min-h-[50vh] place-items-center px-6 text-center">
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-sm text-muted">{body}</p>
        <button type="button" onClick={onClick} className="mt-4 inline-flex h-10 items-center gap-1 rounded-full bg-primary px-4 text-sm font-semibold text-black"><Plus className="size-3.5" />{action}</button>
      </div>
    </div>
  );
}

function Modal({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-black/70 p-3 sm:place-items-center" onClick={onClose}>
      <div className={`max-h-[90vh] w-full overflow-auto rounded-3xl border border-line bg-bg shadow-2xl ${wide ? "max-w-3xl p-4" : "max-w-lg p-4"}`} onClick={(event) => event.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between"><h2 className="sr-only">{title}</h2><span className="text-base font-semibold">{wide ? title : ""}</span><button type="button" aria-label="Close" onClick={onClose} className="grid size-9 place-items-center rounded-full bg-surface text-muted"><X className="size-4" /></button></div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      {children}
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return <button type="button" aria-label={label} title={label} onClick={(event) => { event.stopPropagation(); onClick(); }} className="grid size-7 place-items-center rounded-lg text-muted hover:bg-surface hover:text-fg">{children}</button>;
}
