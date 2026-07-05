import { beforeAll, afterAll, describe, expect, it } from "vitest";

import type { BufferView, LAMMPSWeb, LammpsModule } from "../types";
import { loadModule } from "./helpers/lammps";

const BOX_SIZE = 20;
const BOND_LENGTH = 1.0;

// Two bonded atoms on opposite sides of the periodic x boundary: the real
// bond length is 1.0 (0.5 <-> 19.5 across the edge), while the naive
// in-box distance is 19.
const BOND_DATA = `LAMMPS bond fixture

2 atoms
1 bonds
1 atom types
1 bond types

0 ${BOX_SIZE} xlo xhi
0 ${BOX_SIZE} ylo yhi
0 ${BOX_SIZE} zlo zhi

Masses

1 1.0

Atoms # bond

1 1 1 0.5 10.0 10.0
2 1 1 19.5 10.0 10.0

Bonds

1 1 1 2
`;

let wasm: LammpsModule;
let lmp: LAMMPSWeb;

const floatView = (module: LammpsModule, view: BufferView): Float32Array => {
  const start = view.ptr / 4;
  return module.HEAPF32.subarray(start, start + view.length) as Float32Array;
};

const bondLength = (first: Float32Array, second: Float32Array): number => {
  const dx = second[0] - first[0];
  const dy = second[1] - first[1];
  const dz = second[2] - first[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

beforeAll(async () => {
  wasm = await loadModule();
  lmp = new wasm.LAMMPSWeb();
  lmp.start();
  wasm.FS.writeFile("/bond-fixture.data", BOND_DATA);
  lmp.runScript(`
units lj
atom_style bond
boundary p p p
bond_style harmonic
read_data /bond-fixture.data
bond_coeff 1 10.0 1.0
`);
});

afterAll(() => {
  lmp.stop();
});

describe("bond snapshots across periodic boundaries", () => {
  it("minimum-images wrapped bond endpoints", () => {
    const bonds = lmp.syncBondsWrapped();
    expect(bonds.count).toBe(1);

    const first = floatView(wasm, bonds.first);
    const second = floatView(wasm, bonds.second);
    // Without minimum imaging this is ~19 (spanning the box).
    expect(bondLength(first, second)).toBeCloseTo(BOND_LENGTH, 3);
  });

  it("keeps unwrapped bond endpoints at the real bond length", () => {
    const bonds = lmp.syncBonds();
    expect(bonds.count).toBe(1);

    const first = floatView(wasm, bonds.first);
    const second = floatView(wasm, bonds.second);
    expect(bondLength(first, second)).toBeCloseTo(BOND_LENGTH, 3);
  });
});
