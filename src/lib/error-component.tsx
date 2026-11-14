import { useEffect, useState } from "react";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

const FALLBACK_MESSAGE = "An unexpected error occurred. Try reloading the page.";
const RELOAD_KEY = "asgard-chunk-tries";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return FALLBACK_MESSAGE;
}

function staleChunk(error: unknown) {
  const text = errorMessage(error);
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(text);
}

function reloadCount() {
  try {
    return Number(sessionStorage.getItem(RELOAD_KEY) || 0);
  } catch {
    return 0;
  }
}

function loadFresh() {
  const url = new URL(window.location.href);
  url.searchParams.set("asgard", String(Date.now()));
  window.location.replace(url.toString());
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  const outdated = staleChunk(error);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!outdated) return;
    const tries = reloadCount();
    if (tries >= 2) {
      setStuck(true);
      return;
    }
    try {
      if (sessionStorage.getItem(`${RELOAD_KEY}-go`) === "1") return;
      sessionStorage.setItem(`${RELOAD_KEY}-go`, "1");
      sessionStorage.setItem(RELOAD_KEY, String(tries + 1));
    } catch {
      setStuck(true);
      return;
    }
    loadFresh();
  }, [outdated]);

  if (outdated && !stuck) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg px-6 text-center text-sm text-muted">
        Updating the desk…
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-fg">
      <span className="text-danger" aria-hidden="true">
        <TriangleAlert className="size-10" strokeWidth={2} />
      </span>
      <h1 className="text-lg font-semibold">{outdated ? "This page is out of date" : "Something went wrong"}</h1>
      <p className="max-w-md text-sm text-muted">
        {outdated ? "A new version was published. Reloading picks up the latest files." : errorMessage(error)}
      </p>
      <button
        type="button"
        onClick={() => {
          try {
            sessionStorage.removeItem(RELOAD_KEY);
            sessionStorage.removeItem(`${RELOAD_KEY}-go`);
          } catch {
            /* ignore */
          }
          loadFresh();
        }}
        className="mt-2 h-10 rounded-full bg-primary px-5 text-sm font-semibold text-primary-fg"
      >
        Reload
      </button>
    </main>
  );
}