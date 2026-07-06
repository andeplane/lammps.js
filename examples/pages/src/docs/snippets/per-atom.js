import { LammpsClient } from "lammps.js/client";

const lammps = await LammpsClient.create({ print: (line) => log(line) });
lammps.start();

lammps.runScript(`
  units         lj
  timestep      0.005
  atom_style    atomic
  lattice       fcc 0.8442
  region        box block 0 3 0 3 0 3
  create_box    1 box
  create_atoms  1 box
  mass          1 1.0
  velocity      all create 2.5 87287
  pair_style    lj/cut 2.5
  pair_coeff    1 1 1.0 1.0 2.5
  fix           1 all nve
  compute       myke all ke/atom
  run           0 post no
`);

// Per-atom modifier values arrive as a Float64 heap view, one value per
// atom, ordered exactly like the particle snapshot.
const f64 = (view) =>
  lammps.module.HEAPF64.subarray(view.ptr / 8, view.ptr / 8 + view.length);

await lammps.runScriptAsync(
  "run 6000",
  async (data) => {
    lammps.instance.syncModifiers();
    lammps.instance.syncModifier("compute", "myke");
    const perAtom = lammps.instance.getModifierPerAtom("compute", "myke");
    draw(data, { colorBy: f64(perAtom) }); // bright = high kinetic energy
    await new Promise(requestAnimationFrame);
    if (sim.stopped) throw new Error("stopped");
  },
  { every: 10, wrapped: true }
);

lammps.dispose();
