import { beforeEach, afterEach, describe, expect, it } from "vitest";

import type {
  BufferView,
  LAMMPSWeb,
  LammpsModule,
  ModifierInfo,
  ModifierSnapshot,
} from "../types";
import { loadModule } from "./helpers/lammps";

let wasm: LammpsModule;
let lmp: LAMMPSWeb;

const LJ_SETUP = `
units lj
atom_style atomic
lattice fcc 0.8442
region box block 0 3 0 3 0 3
create_box 1 box
create_atoms 1 box
mass 1 1.0
velocity all create 1.44 87287
pair_style lj/cut 2.5
pair_coeff 1 1 1.0 1.0 2.5
fix nve all nve
`;

const floats = (view: BufferView): Float32Array => {
  const start = view.ptr / 4;
  return wasm.HEAPF32.subarray(start, start + view.length) as Float32Array;
};

const byName = (list: ModifierInfo[], name: string) =>
  list.find((entry) => entry.name === name);

async function runWithSync(steps: number, every = 1, names?: Array<[string, string]>) {
  const snapshots: ModifierSnapshot[] = [];
  lmp.setAsyncStepCallback(() => {
    lmp.syncModifiers();
    for (const [category, name] of names ?? []) {
      const snap = lmp.syncModifier(category as "compute" | "fix" | "variable", name);
      if (snap) {
        snapshots.push(snap);
      }
    }
  });
  const result = lmp.runScript(
    `fix cbfix all js/async ${every}\nrun ${steps} post no\n`,
  ) as unknown;
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

describe("modifier enumeration", () => {
  it("lists computes, fixes and variables with category and style", () => {
    lmp.runScript(`
compute mytemp all temp
compute mymsd all msd
variable ekin equal ke
variable perx atom x
`);
    lmp.syncModifiers();
    const list = lmp.listModifiers();

    const temp = byName(list, "mytemp");
    expect(temp).toMatchObject({ category: "compute", style: "temp", hasScalar: true });

    const msd = byName(list, "mymsd");
    expect(msd).toMatchObject({ category: "compute", style: "msd" });

    const nve = byName(list, "nve");
    expect(nve).toMatchObject({ category: "fix", style: "nve" });

    expect(byName(list, "ekin")).toMatchObject({
      category: "variable",
      style: "equal",
      isPerAtom: false,
    });
    expect(byName(list, "perx")).toMatchObject({
      category: "variable",
      style: "atom",
      isPerAtom: true,
    });
    // LAMMPS' auto-defined computes are enumerated too
    expect(byName(list, "thermo_temp")).toBeDefined();
  });

  it("prunes modifiers that are removed", () => {
    lmp.runScript("compute doomed all temp\n");
    lmp.syncModifiers();
    expect(byName(lmp.listModifiers(), "doomed")).toBeDefined();

    lmp.runScript("uncompute doomed\n");
    lmp.syncModifiers();
    expect(byName(lmp.listModifiers(), "doomed")).toBeUndefined();
  });

  it("rebuilds a modifier redefined with the same name but another style", () => {
    lmp.runScript("compute reborn all temp\n");
    lmp.syncModifiers();
    expect(byName(lmp.listModifiers(), "reborn")).toMatchObject({
      style: "temp",
      isPerAtom: false,
    });

    lmp.runScript("uncompute reborn\ncompute reborn all ke/atom\n");
    lmp.syncModifiers();
    expect(byName(lmp.listModifiers(), "reborn")).toMatchObject({
      style: "ke/atom",
      isPerAtom: true,
    });
  });

  it("returns null when syncing an unknown modifier", () => {
    lmp.syncModifiers();
    expect(lmp.syncModifier("compute", "nope")).toBeNull();
  });
});

describe("compute data extraction", () => {
  it("accumulates a scalar time series for compute temp", async () => {
    lmp.runScript("compute mytemp all temp\n");
    const snapshots = await runWithSync(4, 1, [["compute", "mytemp"]]);

    expect(snapshots.length).toBeGreaterThanOrEqual(3);
    const last = snapshots[snapshots.length - 1];
    expect(last.hasScalar).toBe(true);
    expect(last.scalar).toBeGreaterThan(0);

    const scalarSeries = last.series.find((s) => s.name === "scalar");
    expect(scalarSeries).toBeDefined();
    const y = floats(scalarSeries!.y);
    expect(y.length).toBe(snapshots.length);
    expect(y[y.length - 1]).toBeCloseTo(last.scalar, 4);
  });

  it("extracts MSD component series", async () => {
    lmp.runScript("compute mymsd all msd\n");
    const snapshots = await runWithSync(4, 1, [["compute", "mymsd"]]);

    const last = snapshots[snapshots.length - 1];
    const names = last.series.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["dx2", "dy2", "dz2", "dr2"]));
    expect(last.yLabel).toBe("Mean square displacement");

    const dr2 = last.series.find((s) => s.name === "dr2")!;
    expect(floats(dr2.x).length).toBeGreaterThanOrEqual(3);
  });

  it("extracts RDF pair series with clearPerSync", async () => {
    lmp.runScript("compute myrdf all rdf 50\n");
    const snapshots = await runWithSync(4, 2, [["compute", "myrdf"]]);

    const last = snapshots[snapshots.length - 1];
    expect(last.clearPerSync).toBe(true);
    const pair = last.series.find((s) => s.name === "g(r) pair 1");
    expect(pair).toBeDefined();
    const x = floats(pair!.x);
    const y = floats(pair!.y);
    expect(x.length).toBe(50);
    // g(r) must have structure: some bin well above zero
    expect(Math.max(...y)).toBeGreaterThan(0.5);
    // x is r (bin centers), strictly increasing
    expect(x[1]).toBeGreaterThan(x[0]);
  });
});

describe("fix ave/time extraction", () => {
  it("accumulates the averaged scalar series", async () => {
    lmp.runScript(`
compute mytemp all temp
fix avet all ave/time 2 2 4 c_mytemp
`);
    const snapshots = await runWithSync(12, 1, [["fix", "avet"]]);

    const last = snapshots[snapshots.length - 1];
    expect(last.hasScalar).toBe(true);
    expect(last.scalar).toBeGreaterThan(0);
    const scalarSeries = last.series.find((s) => s.name === "scalar");
    expect(scalarSeries).toBeDefined();
    expect(floats(scalarSeries!.y).length).toBeGreaterThanOrEqual(2);
  });
});

describe("variable extraction", () => {
  it("tracks equal-style variables as scalars", async () => {
    lmp.runScript("variable ekin equal ke\n");
    const snapshots = await runWithSync(3, 1, [["variable", "ekin"]]);

    const last = snapshots[snapshots.length - 1];
    expect(last.hasScalar).toBe(true);
    expect(last.scalar).toBeGreaterThan(0);
  });

  it("marks atom-style variables as per-atom", async () => {
    lmp.runScript("variable perx atom x\n");
    const snapshots = await runWithSync(2, 1, [["variable", "perx"]]);
    expect(snapshots[snapshots.length - 1].isPerAtom).toBe(true);
  });
});
