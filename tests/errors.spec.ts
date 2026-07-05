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

describe("LAMMPS error reporting", () => {
  it("throws a JS Error with the LAMMPS message on an invalid command", () => {
    expect(() => lmp.runCommand("pair_style does_not_exist")).toThrowError(
      /pair style/i,
    );
  });

  it("exposes the failing message and input line after the throw", () => {
    expect(() => lmp.runCommand("pair_style does_not_exist")).toThrow();
    expect(lmp.getLastErrorMessage()).toMatch(/pair style/i);
    expect(lmp.getLastErrorInputLine()).toBe("pair_style does_not_exist");
  });

  it("throws for a failing script and reports the offending line", () => {
    expect(() =>
      lmp.runScript(`
units lj
atom_style atomic
this_is_not_a_command 1 2 3
`),
    ).toThrowError(/unknown command/i);
    expect(lmp.getLastErrorInputLine()).toContain("this_is_not_a_command");
  });

  it("reports no error for a valid script", () => {
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
`);
    expect(lmp.getLastErrorMessage()).toBe("");
    expect(lmp.getLastErrorInputLine()).toBe("");
  });

  it("clears the recorded error when a new session starts", () => {
    expect(() => lmp.runCommand("pair_style does_not_exist")).toThrow();
    expect(lmp.getLastErrorMessage()).not.toBe("");
    lmp.start();
    expect(lmp.getLastErrorMessage()).toBe("");
    expect(lmp.getLastErrorInputLine()).toBe("");
  });
});
