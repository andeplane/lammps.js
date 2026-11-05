// @vitest-environment node
//
// Exercises the atomify-serial wasm build (dist/cpp/lammps-atomify-serial.js):
// the same package set as the atomify build, but single-threaded with no
// KOKKOS, pthreads or MEMORY64. It needs no SharedArrayBuffer, so it runs in
// pages that cannot be cross-origin isolated (Safari lacks COEP
// credentialless). Shipped under the ./wasm-atomify-serial export.
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { LAMMPSWeb, LammpsModule } from "../types";

const modulePath = join(process.cwd(), "dist", "cpp", "lammps-atomify-serial.js");
const hasBuild =
  existsSync(modulePath) &&
  // A stub emitted by scripts/ensure-wasm-stubs.mjs is not a real build.
  !readFileSync(modulePath, "utf8").startsWith("// lammps.js-wasm-stub");

let modulePromise: Promise<LammpsModule> | null = null;
async function loadModule(): Promise<LammpsModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const { default: createModule } = await import("../dist/cpp/lammps-atomify-serial.js");
      return createModule({ print: () => undefined, printErr: () => undefined });
    })();
  }
  return modulePromise;
}

const instances: LAMMPSWeb[] = [];
async function createInstance(): Promise<LAMMPSWeb> {
  const wasm = await loadModule();
  const instance = new wasm.LAMMPSWeb();
  instance.start();
  instances.push(instance);
  return instance;
}

afterAll(() => {
  for (const instance of instances) {
    instance.stop();
  }
});

describe.skipIf(!hasBuild)("atomify-serial wasm build (full package set, no KOKKOS)", () => {
  it("is not a pthreads build", () => {
    // A pthreads module would spawn workers and need SharedArrayBuffer.
    const source = readFileSync(modulePath, "utf8");
    expect(source).not.toMatch(/new SharedArrayBuffer|PThread\.init/);
  });

  it("includes every package Atomify's examples need, without KOKKOS", async () => {
    const wasm = await loadModule();
    const lmp = new wasm.LAMMPSWeb();
    instances.push(lmp);
    expect(lmp.hasPackage("KOKKOS")).toBe(false);
    for (const pkg of [
      "RIGID", "CLASS2", "MANYBODY", "MC", "MOLECULE", "GRANULAR", "KSPACE",
      "SHOCK", "MISC", "QEQ", "REAXFF", "EXTRA-MOLECULE", "VORONOI", "COLVARS",
    ]) {
      expect(lmp.hasPackage(pkg)).toBe(true);
    }
  });

  it("throws a readable JS Error on a LAMMPS error", async () => {
    const lmp = await createInstance();
    expect(() => lmp.runCommand("pair_style does_not_exist")).toThrowError(/pair style/i);
    expect(lmp.getLastErrorMessage()).toMatch(/pair style/i);
  });

  it("runs a plain LJ script", async () => {
    const lmp = await createInstance();
    lmp.runScript(`
units lj
atom_style atomic
lattice fcc 0.8442
region box block 0 4 0 4 0 4
create_box 1 box
create_atoms 1 box
mass 1 1.0
velocity all create 1.44 87287
pair_style lj/cut 2.5
pair_coeff 1 1 1.0 1.0 2.5
fix nve all nve
run 5 post no
`);
    expect(lmp.getCurrentStep()).toBe(5);
    const { count, positions } = lmp.syncParticles();
    expect(count).toBe(256);
    expect(positions.length).toBe(count * 3);
    expect(positions.ptr).toBeGreaterThan(0);
  });

  it("accepts MANYBODY and the vendored moltemplate pair styles", async () => {
    const lmp = await createInstance();
    expect(() =>
      lmp.runScript(`
units metal
atom_style atomic
region box block 0 5 0 5 0 5
create_box 2 box
pair_style vashishta
`)
    ).not.toThrow();
    const lmp2 = await createInstance();
    expect(() =>
      lmp2.runScript(`
units real
atom_style full
region box block 0 5 0 5 0 5
create_box 1 box
pair_style lj/charmm/coul/charmm/inter 10 12
`)
    ).not.toThrow();
  });
});

describe.skipIf(hasBuild)("atomify-serial wasm build (missing artifact)", () => {
  it.skip("dist/cpp/lammps-atomify-serial.js not built; run npm run build:atomify-serial", () => {});
});
