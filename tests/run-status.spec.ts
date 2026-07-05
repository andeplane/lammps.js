import { beforeAll, afterAll, describe, expect, it } from "vitest";

import type { LAMMPSWeb, LammpsModule } from "../types";
import { loadModule } from "./helpers/lammps";

const RUN_STEPS = 6;

let wasm: LammpsModule;
let lmp: LAMMPSWeb;

beforeAll(async () => {
  wasm = await loadModule();
  lmp = new wasm.LAMMPSWeb();
  lmp.start();
  lmp.runScript(`
units lj
atom_style atomic
lattice fcc 0.8442
region box block 0 2 0 2 0 2
create_box 1 box
create_atoms 1 box
mass 1 1.0
pair_style lj/cut 2.5
pair_coeff 1 1 1.0 1.0 2.5
fix nve all nve
`);
});

afterAll(() => {
  lmp.stop();
});

describe("run status and thermo", () => {
  it("reports idle before any run", () => {
    expect(lmp.getRunMode()).toBe(0);
    expect(lmp.getRunStepsDone()).toBe(0);
    expect(lmp.getRunStepsTotal()).toBe(0);
  });

  it("reports run mode and progress from inside the step callback", async () => {
    const seen: Array<{ mode: number; done: number; total: number }> = [];
    lmp.setAsyncStepCallback((step) => {
      seen.push({
        mode: lmp.getRunMode(),
        done: lmp.getRunStepsDone(),
        total: lmp.getRunStepsTotal(),
      });
    });
    const result = lmp.runScript(
      `fix cb all js/async 1\nrun ${RUN_STEPS} post no\n`,
    ) as unknown;
    if (result && typeof (result as Promise<unknown>).then === "function") {
      await result;
    }
    lmp.setAsyncStepCallback(null);

    expect(seen.length).toBeGreaterThan(0);
    for (const status of seen) {
      expect(status.mode).toBe(1);
      expect(status.total).toBe(RUN_STEPS);
      expect(status.done).toBeGreaterThan(0);
      expect(status.done).toBeLessThanOrEqual(RUN_STEPS);
    }
  });

  it("returns thermo keywords as numbers", () => {
    expect(lmp.getThermo("temp")).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(lmp.getThermo("press"))).toBe(true);
    // spcpu/cpuremain are only meaningful during a run, but must not blow up.
    expect(Number.isFinite(lmp.getThermo("spcpu"))).toBe(true);
    expect(Number.isFinite(lmp.getThermo("cpuremain"))).toBe(true);
  });

  it("reports a positive memory usage for an active simulation", () => {
    expect(lmp.getMemoryUsage()).toBeGreaterThan(0);
  });

  it("does not poison error state when polling run-only keywords while idle", () => {
    // spcpu raises "cannot be used between runs" internally when idle; that
    // captured error must not leak into the next successful command.
    expect(lmp.getThermo("spcpu")).toBe(0);
    expect(() => lmp.runCommand("run 0 post no")).not.toThrow();
  });
});
