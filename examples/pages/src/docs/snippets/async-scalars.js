import { LammpsClient } from "lammps.js/client";

const lammps = await LammpsClient.create({ print: (line) => log(line) });
lammps.start();

chart.axes("step", "temperature");

// Name computes in `computeScalars` and their current values arrive on
// every callback in data.computeScalars — no thermo parsing needed.
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
  compute       ctemp all temp
  compute       cke all ke
  fix           1 all nvt temp 3.0 0.7 0.5
  thermo        2000
  run           6000
  `,
  async (data) => {
    const { ctemp, cke } = data.computeScalars;
    chart.add(data.step, { temperature: ctemp });
    if (data.step % 1000 === 0) {
      log(`step ${data.step}:  T = ${ctemp.toFixed(3)}   KE = ${cke.toFixed(1)}`);
    }
    await new Promise(requestAnimationFrame);
    if (sim.stopped) throw new Error("stopped");
  },
  { every: 50, computeScalars: ["ctemp", "cke"] }
);

lammps.dispose();
