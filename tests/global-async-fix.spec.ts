import { beforeEach, afterEach, describe, expect, it } from "vitest";

import type { LAMMPSWeb, LammpsModule } from "../types";
import { loadModule } from "./helpers/lammps";

let wasm: LammpsModule;
let lmp: LAMMPSWeb;

beforeEach(async () => {
  wasm = await loadModule();
  lmp = new wasm.LAMMPSWeb();
  lmp.start();
});

afterEach(() => {
  lmp.stop();
});

describe("globally installed js/async fix", () => {
  it("can be installed before the simulation box exists", () => {
    // Would previously fail with "Fix command before simulation box is defined".
    expect(() => lmp.installAsyncFix("globalsync", 1)).not.toThrow();
  });

  it("fires the step callback for a run inside an include'd file", async () => {
    lmp.installAsyncFix("globalsync", 1);

    wasm.FS.writeFile(
      "/included-run.in",
      "velocity all create 1.44 87287\nfix nve all nve\nrun 3 post no\n",
    );
    wasm.FS.writeFile(
      "/main.in",
      `
units lj
atom_style atomic
lattice fcc 0.8442
region box block 0 2 0 2 0 2
create_box 1 box
create_atoms 1 box
mass 1 1.0
pair_style lj/cut 2.5
pair_coeff 1 1 1.0 1.0 2.5
include /included-run.in
`,
    );

    const steps: number[] = [];
    lmp.setAsyncStepCallback((step) => {
      steps.push(Number(step));
    });
    const result = lmp.runFile("/main.in") as unknown;
    if (result && typeof (result as Promise<unknown>).then === "function") {
      await result;
    }
    lmp.setAsyncStepCallback(null);

    // The run lives in the include'd file, where script injection can't
    // reach — only the globally installed fix makes these fire.
    expect(steps).toEqual([1, 2, 3]);
  });

  it("retunes the frequency when installed again", async () => {
    lmp.installAsyncFix("globalsync", 1);
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
    lmp.installAsyncFix("globalsync", 2);

    const steps: number[] = [];
    lmp.setAsyncStepCallback((step) => {
      steps.push(Number(step));
    });
    const result = lmp.runScript("run 4 post no\n") as unknown;
    if (result && typeof (result as Promise<unknown>).then === "function") {
      await result;
    }
    lmp.setAsyncStepCallback(null);

    expect(steps).toEqual([2, 4]);
  });
});
