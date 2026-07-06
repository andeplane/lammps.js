import { LammpsClient } from "lammps.js/client";

const lammps = await LammpsClient.create({ print: (line) => log(line) });
lammps.start();

// client.instance is the low-level LAMMPSWeb binding: live thermo
// keywords, run progress, memory use, build introspection…
const lmp = lammps.instance;
log("KOKKOS package in this build:", lmp.hasPackage("KOKKOS"));
log("");

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
  velocity      all create 1.44 87287
  pair_style    lj/cut 2.5
  pair_coeff    1 1 1.0 1.0 2.5
  fix           1 all nve
  thermo        8000
  run           8000
  `,
  async () => {
    const pct = (100 * lmp.getRunStepsDone()) / lmp.getRunStepsTotal();
    const bar = "█".repeat(Math.round(pct / 5)).padEnd(20, "·");
    log(
      `${bar} ${pct.toFixed(0).padStart(3)}%  ` +
      `T=${lmp.getThermo("temp").toFixed(3)}  ` +
      `E=${lmp.getThermo("etotal").toFixed(3)}  ` +
      `${(lmp.getMemoryUsage() / 1048576).toFixed(1)} MB`
    );
    await new Promise(requestAnimationFrame);
    if (sim.stopped) throw new Error("stopped");
  },
  { every: 400 }
);

log("");
log("run mode now:", lmp.getRunMode(), "(0 idle, 1 dynamics, 2 minimize)");
lammps.dispose();
