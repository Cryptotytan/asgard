import { createPortal } from "react-dom";
import { LoaderCircle } from "lucide-react";

export function ConfirmGate({ title, detail, onDismiss }: { title: string; detail: string; onDismiss?: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[95] grid place-items-center bg-black/80 p-4" role="alertdialog" aria-modal="true" aria-busy="true" aria-labelledby="confirm-gate-title" onClick={onDismiss}>
      <div className="w-full max-w-md overflow-hidden rounded-3xl border border-primary/30 bg-[#0c100e] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="h-1 overflow-hidden bg-white/10">
          <div className="h-full w-1/3 bg-primary" style={{ animation: "flight-bar 1.15s ease-in-out infinite" }} />
        </div>
        <div className="p-5 text-center">
          <LoaderCircle className="mx-auto size-8 animate-spin text-primary" />
          <h2 id="confirm-gate-title" className="mt-4 text-lg font-semibold">Confirm in your wallet</h2>
          <p className="mt-1 text-sm text-muted">Approve it in the wallet window. Click outside this card to cancel.</p>
          <dl className="mt-4 space-y-2 rounded-2xl border border-line bg-black/40 px-3 py-3 text-left text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Action</dt>
              <dd className="truncate font-semibold">{title}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted">Amount</dt>
              <dd className="truncate font-mono">{detail}</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>,
    document.body,
  );
}