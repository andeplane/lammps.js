import { beforeEach, afterEach, describe, expect, it } from "vitest";

import type { BondSnapshot, LAMMPSWeb, LammpsModule } from "../types";
import { loadModule } from "./helpers/lammps";

// fcc lattice at reduced density 0.8442: nearest-neighbor distance ~1.09.
const NEAREST_NEIGHBOR_CUTOFF = 1.2;

let wasm: LammpsModule;
let lmp: LAMMPSWeb;

const LJ_SETUP = `
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
`;

async function runAndCaptureBonds(script: string): Promise<BondSnapshot[]> {
  const snapshots: BondSnapshot[] = [];
  lmp.setAsyncStepCallback(() => {
    snapshots.push(lmp.syncBondsWrapped());
  });
  const result = lmp.runScript(script) as unknown;
  if (result && typeof (result as Promise<unknown>).then === "function") {
    await result;
  }
  lmp.setAsyncStepCallback(null);
  return snapshots;
}

beforeEach(async () => {
  wasm = await loadModule();
  lmp = new wasm.LAMMPSWeb();
  lmp.start();
  lmp.runScript(LJ_SETUP);
});

afterEach(() => {
  lmp.stop();
});

describe("distance-based dynamic bonds", () => {
  it("derives bonds from the neighborlist for registered type pairs", async () => {
    lmp.setBondDistance(1, 1, NEAREST_NEIGHBOR_CUTOFF);
    lmp.setBuildNeighborlist(true);

    const snapshots = await runAndCaptureBonds(
      "fix cb all js/async 1\nrun 2 post no\n",
    );

    expect(snapshots.length).toBeGreaterThan(0);
    const last = snapshots[snapshots.length - 1];
    // 32 atoms, 12 nearest neighbors each, half list -> 192 pairs.
    expect(last.count).toBeGreaterThan(100);

    // Every derived bond must be shorter than the registered distance.
    const first = wasm.HEAPF32.subarray(
      last.first.ptr / 4,
      last.first.ptr / 4 + last.first.length,
    );
    const second = wasm.HEAPF32.subarray(
      last.second.ptr / 4,
      last.second.ptr / 4 + last.second.length,
    );
    for (let i = 0; i < last.count; i += 1) {
      const dx = second[3 * i] - first[3 * i];
      const dy = second[3 * i + 1] - first[3 * i + 1];
      const dz = second[3 * i + 2] - first[3 * i + 2];
      const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
      expect(length).toBeLessThan(NEAREST_NEIGHBOR_CUTOFF);
      expect(length).toBeGreaterThan(0);
    }
  });

  it("returns no bonds without registered distances", async () => {
    lmp.setBuildNeighborlist(true);

    const snapshots = await runAndCaptureBonds(
      "fix cb all js/async 1\nrun 2 post no\n",
    );
    expect(snapshots[snapshots.length - 1].count).toBe(0);
  });

  it("stops deriving bonds after clearBondDistances", async () => {
    lmp.setBondDistance(1, 1, NEAREST_NEIGHBOR_CUTOFF);
    lmp.setBuildNeighborlist(true);
    lmp.clearBondDistances();

    const snapshots = await runAndCaptureBonds(
      "fix cb all js/async 1\nrun 2 post no\n",
    );
    expect(snapshots[snapshots.length - 1].count).toBe(0);
  });
});
