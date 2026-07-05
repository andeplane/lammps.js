import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

describe("box dimension", () => {
  it("reports 3 for a 3d simulation", () => {
    lmp.runScript(`
units lj
atom_style atomic
region box block 0 5 0 5 0 5
create_box 1 box
`);
    expect(lmp.syncSimulationBox().dimension).toBe(3);
  });

  it("reports 2 for a 2d simulation", () => {
    lmp.runScript(`
dimension 2
units lj
atom_style atomic
region box block 0 5 0 5 -0.5 0.5
create_box 1 box
`);
    expect(lmp.syncSimulationBox().dimension).toBe(2);
  });
});

describe("wall introspection", () => {
  it("returns an empty array when no walls are defined", () => {
    lmp.runScript(`
units lj
atom_style atomic
region box block 0 5 0 5 0 5
create_box 1 box
`);
    expect(lmp.getWalls()).toEqual([]);
  });

  it("reports EDGE and CONSTANT walls with face and position", () => {
    lmp.runScript(`
units lj
atom_style atomic
boundary f p p
region box block 0 10 0 10 0 10
create_box 1 box
create_atoms 1 single 5 5 5
mass 1 1.0
pair_style lj/cut 2.5
pair_coeff 1 1 1.0 1.0 2.5
fix walls all wall/lj93 xlo EDGE 1.0 1.0 2.5 xhi 8.0 1.0 1.0 2.5
`);
    const walls = lmp.getWalls();
    expect(walls).toHaveLength(2);

    const [lo, hi] = walls;
    expect(lo.which).toBe(0); // XLO
    expect(lo.style).toBe(1); // EDGE
    expect(lo.position).toBe(0);

    expect(hi.which).toBe(1); // XHI
    expect(hi.style).toBe(2); // CONSTANT
    expect(hi.position).toBe(8);
  });
});
