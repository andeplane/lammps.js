import { beforeEach, afterEach, describe, expect, it } from "vitest";

import type { BufferView, LAMMPSWeb, LammpsModule } from "../types";
import { loadModule } from "./helpers/lammps";

let wasm: LammpsModule;
let lmp: LAMMPSWeb;

const doubles = (view: BufferView): Float64Array => {
  const start = view.ptr / 8;
  return wasm.HEAPF64.subarray(start, start + view.length) as Float64Array;
};

beforeEach(async () => {
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
velocity all create 1.44 87287
pair_style lj/cut 2.5
pair_coeff 1 1 1.0 1.0 2.5
fix nve all nve
run 0 post no
`);
});

afterEach(() => {
  lmp.stop();
});

describe("per-atom modifier data", () => {
  it("exposes per-atom compute values (ke/atom)", () => {
    lmp.runScript("compute myke all ke/atom\n");
    lmp.syncModifiers();
    const snap = lmp.syncModifier("compute", "myke");
    expect(snap?.isPerAtom).toBe(true);

    const view = lmp.getModifierPerAtom("compute", "myke");
    const numAtoms = lmp.syncParticles().count;
    expect(view.length).toBe(numAtoms);
    expect(view.type).toBe(wasm.ScalarType.Float64);

    const values = doubles(view);
    // velocities were created at T=1.44, so kinetic energies are positive
    const positive = values.filter((value) => value > 0).length;
    expect(positive).toBe(numAtoms);
  });

  it("exposes atom-style variable values matching atom coordinates", () => {
    lmp.runScript("variable perx atom x\n");
    lmp.syncModifiers();
    const snap = lmp.syncModifier("variable", "perx");
    expect(snap?.isPerAtom).toBe(true);

    const particles = lmp.syncParticles();
    const view = lmp.getModifierPerAtom("variable", "perx");
    expect(view.length).toBe(particles.count);

    const values = doubles(view);
    const positionsStart = particles.positions.ptr / 4;
    const positions = wasm.HEAPF32.subarray(
      positionsStart,
      positionsStart + particles.positions.length,
    );
    for (let i = 0; i < particles.count; i += 1) {
      expect(values[i]).toBeCloseTo(positions[3 * i], 4);
    }
  });

  it("shrinks the per-atom buffer when atoms are deleted", () => {
    lmp.runScript("compute myke all ke/atom\n");
    lmp.syncModifiers();
    lmp.syncModifier("compute", "myke");
    const before = lmp.getModifierPerAtom("compute", "myke").length;
    expect(before).toBe(lmp.syncParticles().count);

    lmp.runScript("region half block 0 1 INF INF INF INF\ndelete_atoms region half\nrun 0 post no\n");
    lmp.syncModifier("compute", "myke");
    const after = lmp.getModifierPerAtom("compute", "myke");
    expect(after.length).toBe(lmp.syncParticles().count);
    expect(after.length).toBeLessThan(before);
  });

  it("returns an empty view for non-per-atom or unknown modifiers", () => {
    lmp.runScript("compute mytemp all temp\n");
    lmp.syncModifiers();
    lmp.syncModifier("compute", "mytemp");

    expect(lmp.getModifierPerAtom("compute", "mytemp").length).toBe(0);
    expect(lmp.getModifierPerAtom("compute", "nope").length).toBe(0);
  });
});
