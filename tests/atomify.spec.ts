// @vitest-environment node
//
// Exercises the atomify wasm build (dist/cpp/lammps-atomify.js): a
// multithreaded KOKKOS/pthreads build with the full LAMMPS package set
// Atomify's example library needs (RIGID CLASS2 MANYBODY MC MOLECULE GRANULAR
// KSPACE SHOCK MISC QEQ REAXFF EXTRA-MOLECULE VORONOI COLVARS + KOKKOS +
// moltemplate pair styles). Runs under a plain node environment because
// emscripten pthreads are backed by worker_threads + SharedArrayBuffer, which
// jsdom does not provide. It ships in this same package under the
// ./wasm-atomify export, loaded both directly and through LammpsClient's
// `variant: "atomify"` option.
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { LammpsClient } from "../dist/client.js";
import type { LAMMPSWeb, LammpsModule } from "../types";

const atomifyModulePath = join(process.cwd(), "dist", "cpp", "lammps-atomify.js");
const hasAtomifyBuild =
  existsSync(atomifyModulePath) &&
  // A stub emitted by scripts/ensure-wasm-stubs.mjs is not a real build.
  !readFileSync(atomifyModulePath, "utf8").startsWith("// lammps.js-wasm-stub");

let modulePromise: Promise<LammpsModule> | null = null;
async function loadAtomifyModule(): Promise<LammpsModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const { default: createModule } = await import("../dist/cpp/lammps-atomify.js");
      return createModule({ print: () => undefined, printErr: () => undefined });
    })();
  }
  return modulePromise;
}

const instances: LAMMPSWeb[] = [];
// Start with the Kokkos runtime enabled (2 threads) and the kk accelerator
// suffix, so styles with a /kk variant run multithreaded and the rest fall
// back to their serial version.
async function createInstance(threads = 2): Promise<LAMMPSWeb> {
  const wasm = await loadAtomifyModule();
  const instance = new wasm.LAMMPSWeb();
  instance.startWithArgs(["-k", "on", "t", String(threads), "-sf", "kk"]);
  instances.push(instance);
  return instance;
}

afterAll(() => {
  for (const instance of instances) {
    instance.stop();
  }
});

describe.skipIf(!hasAtomifyBuild)("atomify wasm build (KOKKOS + full package set)", () => {
  it("includes KOKKOS and every package Atomify's examples need", async () => {
    const wasm = await loadAtomifyModule();
    const lmp = new wasm.LAMMPSWeb();
    instances.push(lmp);
    for (const pkg of [
      "KOKKOS", "RIGID", "CLASS2", "MANYBODY", "MC", "MOLECULE", "GRANULAR",
      "KSPACE", "SHOCK", "MISC", "QEQ", "REAXFF", "EXTRA-MOLECULE", "VORONOI",
      "COLVARS",
    ]) {
      expect(lmp.hasPackage(pkg)).toBe(true);
    }
  });

  it("throws a readable JS Error on a LAMMPS error (MEMORY64 error glue)", async () => {
    // Regression guard for the MEMORY64 pointer bug in lammpsweb_throw_error:
    // this build passes the C-string pointer to EM_JS as a BigInt, so an
    // unguarded UTF8ToString(message) aborted the module instead of throwing.
    // With the Number() coercion the LAMMPS message must surface cleanly.
    const lmp = await createInstance(2);
    expect(() => lmp.runCommand("pair_style does_not_exist")).toThrowError(
      /pair style/i,
    );
    expect(lmp.getLastErrorMessage()).toMatch(/pair style/i);
  });

  it("runs a plain LJ script multithreaded via the kk suffix", async () => {
    const lmp = await createInstance(2);
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
    // Raw LAMMPSWeb.syncParticles() returns BufferView snapshots (ptr/length
    // into the heap), not typed arrays.
    const { count, positions } = lmp.syncParticles();
    expect(count).toBe(256); // 4 atoms/cell * 4^3 fcc cells
    expect(positions.length).toBe(count * 3);
    expect(positions.ptr).toBeGreaterThan(0);
  });

  it("runs a MANYBODY (vashishta) pair style", async () => {
    const lmp = await createInstance(2);
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

  it('is selected by LammpsClient\'s variant: "atomify" option (Kokkos start args)', async () => {
    const client = await LammpsClient.create(
      { print: () => undefined, printErr: () => undefined },
      { variant: "atomify", kokkos: { threads: 2 } }
    );
    instances.push(client.instance);
    client.start();

    // The client resolved the atomify module (full package set) and started
    // LAMMPS with the Kokkos runtime enabled (kk suffix on by default).
    expect(client.instance.hasPackage("KOKKOS")).toBe(true);
    expect(client.instance.hasPackage("MANYBODY")).toBe(true);
    client.runScript(readFileSync(join(process.cwd(), "tests", "fixtures", "lj.mini.in"), "utf8"));
    expect(client.getCurrentStep()).toBe(5);
  });

  it("accepts the vendored moltemplate pair style", async () => {
    const lmp = await createInstance(2);
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
