import { LammpsClient } from "lammps.js/client";

const lammps = await LammpsClient.create({ print: (line) => log(line) });
lammps.start();

lammps.runScript(`
  units         lj
  timestep      0.005
  atom_style    atomic
  lattice       fcc 0.8442
  region        box block 0 4 0 4 0 4
  create_box    1 box
  create_atoms  1 box
  mass          1 1.0
  velocity      all create 1.0 87287
  pair_style    lj/cut 2.5
  pair_coeff    1 1 1.0 1.0 2.5
  fix           1 all nvt temp 1.0 1.0 0.1
  compute       myrdf all rdf 60
  run           0 post no
`);

// The modifier registry tracks the computes, fixes and (equal/atom-style)
// variables currently defined in the session:
lammps.instance.syncModifiers();
for (const mod of lammps.instance.listModifiers()) {
  log(`${mod.category} "${mod.name}"  style=${mod.style}  perAtom=${mod.isPerAtom}`);
}

chart.axes("r", "g(r)");
// Series x/y are Float32 views into wasm memory — read them via the heap.
const f32 = (view) =>
  lammps.module.HEAPF32.subarray(view.ptr / 4, view.ptr / 4 + view.length);

await lammps.runScriptAsync(
  "run 4000",
  async () => {
    // syncModifier invokes the compute (when allowed) and syncs its series.
    const rdf = lammps.instance.syncModifier("compute", "myrdf");
    const pair = rdf?.series.find((s) => s.name === "g(r) pair 1");
    if (pair) chart.set("g(r)", f32(pair.x), f32(pair.y));
    await new Promise(requestAnimationFrame);
    if (sim.stopped) throw new Error("stopped");
  },
  { every: 50 }
);

lammps.dispose();
