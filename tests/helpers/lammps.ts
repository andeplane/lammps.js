import type { LammpsModule } from "../../types";

// The Emscripten loader sniffs `process` to decide whether it runs under
// Node; hiding it forces the browser code path under jsdom.
type GlobalWithProcess = { process?: unknown };
const globalScope = globalThis as unknown as GlobalWithProcess;

let modulePromise: Promise<LammpsModule> | null = null;

export async function loadModule(): Promise<LammpsModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const originalProcess = globalScope.process;
      const hadProcess = typeof originalProcess !== "undefined";
      globalScope.process = undefined;

      try {
        const { default: createModule } = await import("../../dist/cpp/lammps.js");
        return await createModule({
          print: () => undefined,
          printErr: () => undefined,
        });
      } finally {
        if (hadProcess) globalScope.process = originalProcess;
        else delete globalScope.process;
      }
    })();
  }

  return modulePromise;
}
