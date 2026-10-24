import { Buffer } from "buffer";

const scope = globalThis as typeof globalThis & {
  global?: typeof globalThis;
  Buffer?: typeof Buffer;
  process?: { env: Record<string, string | undefined>; browser?: boolean; nextTick?: (fn: () => void) => void };
};

export function installBrowserGlobals() {
  const target = globalThis as typeof globalThis & {
    global?: typeof globalThis;
    Buffer?: typeof Buffer;
    process?: { env?: Record<string, string | undefined>; browser?: boolean; nextTick?: (fn: () => void) => void };
  };
  target.global = globalThis;
  target.Buffer = target.Buffer ?? Buffer;
  const nextTick = (fn: () => void) => queueMicrotask(fn);
  if (!target.process) target.process = { env: {}, browser: true, nextTick } as NonNullable<typeof target.process>;
  else if (!target.process.nextTick) target.process.nextTick = nextTick;
}

installBrowserGlobals();
