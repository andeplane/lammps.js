import type { LammpsModule } from "../../types";

let modulePromise: Promise<LammpsModule> | null = null;

export async function loadModule(): Promise<LammpsModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const originalProcess = (globalThis as any).process;
      const hadProcess = typeof originalProcess !== "undefined";
      (globalThis as any).process = undefined;

      try {
        const { default: createModule } = await import("../../dist/cpp/lammps.js");
        return await createModule({
          print: () => undefined,
          printErr: () => undefined,
        });
      } finally {
        if (hadProcess) (globalThis as any).process = originalProcess;
        else delete (globalThis as any).process;
      }
    })();
  }

  return modulePromise;
}
