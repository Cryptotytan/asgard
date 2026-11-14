import { useEffect } from "react";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";

const FALLBACK_MESSAGE = "An unexpected error occurred. Try reloading the page.";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return FALLBACK_MESSAGE;
}

function staleChunk(error: unknown) {
  const text = errorMessage(error);
  return /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(text);
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  const outdated = staleChunk(error);
  useEffect(() => {
    if (!outdated) return;
    const key = "asgard-chunk-reload";
    try {
      const last = Number(sessionStorage.getItem(key) || 0);
      if (Date.now() - last < 15000) return;
      sessionStorage.setItem(key, String(Date.now()));
    } catch {
      return;
    }
    window.location.reload();
  }, [outdated]);

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
        onClick={() => window.location.reload()}
        className="mt-2 h-10 rounded-full bg-primary px-5 text-sm font-semibold text-primary-fg"
      >
        Reload
      </button>
    </main>
  );
}