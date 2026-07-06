import { LammpsClient } from "lammps.js/client";

const lammps = await LammpsClient.create({ print: (line) => log(line) });
lammps.start();

// The callback fires every `every` timesteps. LAMMPS pauses until the
// returned promise resolves — awaiting requestAnimationFrame throttles
// the run to your display and keeps the page perfectly responsive.
await lammps.runScriptAsync(
  `
  units         lj
  timestep      0.005
  atom_style    atomic
  lattice       fcc 0.8442
  region        box block 0 3 0 3 0 3
  create_box    1 box
  create_atoms  1 box
  mass          1 1.0
  velocity      all create 3.0 87287
  pair_style    lj/cut 2.5
  pair_coeff    1 1 1.0 1.0 2.5
  fix           1 all nve
  thermo        1000
  run           3000
  `,
  async (data) => {
    log(`callback at step ${data.step} — ${data.particles.count} atoms`);
    await new Promise(requestAnimationFrame);
    if (sim.stopped) throw new Error("stopped"); // wired to the ■ Stop button
  },
  { every: 250 }
);

log("finished at step", lammps.getCurrentStep());
lammps.dispose();
