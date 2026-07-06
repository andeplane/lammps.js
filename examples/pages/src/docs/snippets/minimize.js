import { LammpsClient } from "lammps.js/client";

const lammps = await LammpsClient.create({ print: (line) => log(line) });
lammps.start();

chart.axes("step", "potential energy / atom");

// runScriptAsync also hooks `minimize` — watch the energy relax after
// atoms are randomly displaced from their lattice sites.
await lammps.runScriptAsync(
  `
  units         lj
  atom_style    atomic
  lattice       fcc 0.8442
  region        box block 0 3 0 3 0 3
  create_box    1 box
  create_atoms  1 box
  mass          1 1.0
  pair_style    lj/cut 2.5
  pair_coeff    1 1 1.0 1.0 2.5
  displace_atoms all random 0.25 0.25 0.25 87287
  compute       cpe all pe
  thermo        100
  minimize      1.0e-8 1.0e-8 1000 10000
  `,
  async (data) => {
    chart.add(data.step, {
      "PE / atom": data.computeScalars.cpe / data.particles.count,
    });
    await new Promise(requestAnimationFrame);
    if (sim.stopped) throw new Error("stopped");
  },
  { every: 5, computeScalars: ["cpe"] }
);

log("minimization finished at step", lammps.getCurrentStep());
lammps.dispose();
