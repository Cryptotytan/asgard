import { Buffer } from "buffer";

const scope = globalThis as typeof globalThis & {
  global?: typeof globalThis;
  Buffer?: typeof Buffer;
  process?: { env: Record<string, string | undefined>; browser?: boolean };
};

scope.global = globalThis;
scope.Buffer = Buffer;
if (!scope.process) (scope as { process: { env: Record<string, string | undefined>; browser: boolean } }).process = { env: {}, browser: true };
