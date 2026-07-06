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
  velocity      all create 0.8 87287
  pair_style    lj/cut 2.5
  pair_coeff    1 1 1.0 1.0 2.5
  fix           1 all nve
  run           0 post no
`);

// Derive renderable "bonds" from the neighborlist: every type 1–1 pair
// closer than 1.2σ shows up in the bond snapshot of each synced step.
lammps.instance.setBuildNeighborlist(true);
lammps.instance.setBondDistance(1, 1, 1.2);

await lammps.runScriptAsync(
  "run 4000",
  async (data) => {
    draw(data, { bonds: true });
    if (data.step % 500 === 0) {
      log(`step ${data.step}: ${data.bonds.count} bonds within 1.2σ`);
    }
    await new Promise(requestAnimationFrame);
    if (sim.stopped) throw new Error("stopped");
  },
  { every: 10, wrapped: true }
);

lammps.instance.clearBondDistances();
lammps.dispose();
