// Exercises the atomify wasm build (dist/cpp/lammps-atomify.js), the flavor
// built with PACKAGES=atomify (the full LAMMPS package set Atomify's example
// library needs: RIGID CLASS2 MANYBODY MC MOLECULE GRANULAR KSPACE SHOCK
// MISC QEQ REAXFF EXTRA-MOLECULE VORONOI COLVARS + moltemplate pair styles).
// It ships in this same package under the ./wasm-atomify export, so this
// loads the module directly rather than through LammpsClient (which only
// knows the default and kokkos variants).
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { LAMMPSWeb, LammpsModule } from "../types";

const atomifyModulePath = join(process.cwd(), "dist", "cpp", "lammps-atomify.js");
const hasAtomifyBuild =
  existsSync(atomifyModulePath) &&
  // A stub emitted by scripts/ensure-wasm-stubs.mjs is not a real build.
  !readFileSync(atomifyModulePath, "utf8").startsWith("// lammps.js-wasm-stub");

// Hiding `process` forces the browser code path under jsdom, same trick as
// tests/helpers/lammps.ts uses for the default variant.
type GlobalWithProcess = { process?: unknown };
const globalScope = globalThis as unknown as GlobalWithProcess;

let modulePromise: Promise<LammpsModule> | null = null;
async function loadAtomifyModule(): Promise<LammpsModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const originalProcess = globalScope.process;
      const hadProcess = typeof originalProcess !== "undefined";
      globalScope.process = undefined;
      try {
        const { default: createModule } = await import("../dist/cpp/lammps-atomify.js");
        return await createModule({ print: () => undefined, printErr: () => undefined });
      } finally {
        if (hadProcess) globalScope.process = originalProcess;
        else delete globalScope.process;
      }
    })();
  }
  return modulePromise;
}

const instances: LAMMPSWeb[] = [];
async function createInstance(): Promise<LAMMPSWeb> {
  const wasm = await loadAtomifyModule();
  const instance = new wasm.LAMMPSWeb();
  instances.push(instance);
  return instance;
}

afterAll(() => {
  for (const instance of instances) {
    instance.stop();
  }
});

describe.skipIf(!hasAtomifyBuild)("atomify wasm build (PACKAGES=atomify)", () => {
  it("includes every package Atomify's examples need", async () => {
    const lmp = await createInstance();
    for (const pkg of [
      "RIGID", "CLASS2", "MANYBODY", "MC", "MOLECULE", "GRANULAR", "KSPACE",
      "SHOCK", "MISC", "QEQ", "REAXFF", "EXTRA-MOLECULE", "VORONOI", "COLVARS",
    ]) {
      expect(lmp.hasPackage(pkg)).toBe(true);
    }
  });

  it("runs a MANYBODY (vashishta) pair style", async () => {
    const lmp = await createInstance();
    lmp.start();
    expect(() =>
      lmp.runScript(`
units metal
atom_style atomic
region box block 0 5 0 5 0 5
create_box 2 box
create_atoms 1 single 2.5 2.5 2.5
mass 1 28.0855
mass 2 12.011
pair_style vashishta
`)
    ).not.toThrow();
  });

  it("accepts the vendored moltemplate pair style", async () => {
    const lmp = await createInstance();
    lmp.start();
    expect(() =>
      lmp.runScript(`
units real
atom_style full
region box block 0 5 0 5 0 5
create_box 1 box
pair_style lj/charmm/coul/charmm/inter 10 12
`)
    ).not.toThrow();
  });
});

describe.skipIf(hasAtomifyBuild)("atomify wasm build (missing artifact)", () => {
  it.skip("dist/cpp/lammps-atomify.js not built; run npm run build:atomify", () => {});
});
