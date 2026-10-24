import { Check, ShieldAlert } from "lucide-react";
import type { Token } from "@/lib/market";
import { isHoneypot } from "@/lib/market";

export function SecurityGate({
  token,
  onClose,
  onConfirm,
}: {
  token: Token;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const blocked = isHoneypot(token);
  return (
    <div className="fixed inset-0 z-40 grid place-items-end bg-bg/80 p-3 sm:place-items-center" onClick={onClose}>
      <div className="panel w-full max-w-md p-4" role="dialog" aria-labelledby="scan-title" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start gap-3">
          {token.verified && !blocked ? <Check className="mt-0.5 size-5 text-primary" /> : <ShieldAlert className="mt-0.5 size-5 text-danger" />}
          <div>
            <h2 id="scan-title" className="text-lg font-semibold">
              Security agent
            </h2>
            <p className="mt-1 text-sm text-muted">
              {token.symbol} scored {token.score}/100
              {blocked ? " · swap blocked" : token.verified ? " · verified" : " · not verified"}
            </p>
          </div>
        </div>
        <ul className="mt-4 space-y-2 text-sm">
          {token.notes.map((note) => (
            <li key={note} className="flex gap-2">
              <span className={blocked || !token.verified ? "text-danger" : "text-primary"}>•</span>
              <span>{note}</span>
            </li>
          ))}
          {token.safety.sellTax > 0 && <li className="text-danger">Sell tax {token.safety.sellTax}%</li>}
          {token.safety.buyTax > 0 && <li className="text-danger">Buy tax {token.safety.buyTax}%</li>}
        </ul>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onClose} className="h-11 rounded-xl border border-line text-sm">
            {blocked ? "Close" : "Cancel"}
          </button>
          {blocked ? (
            <button type="button" disabled className="h-11 rounded-xl bg-surface-2 text-sm text-muted">
              Honeypot
            </button>
          ) : (
            <button type="button" onClick={onConfirm} className="h-11 rounded-xl bg-primary text-sm font-semibold text-primary-fg">
              Buy anyway
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
