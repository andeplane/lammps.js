import { LammpsClient } from "lammps.js/client";

const lammps = await LammpsClient.create({ print: (line) => log(line) });
lammps.start();

let callbacks = 0;
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
  thermo        5000
  run           10000
  `,
  async (data) => {
    callbacks += 1;
    log(`callback #${callbacks} at step ${data.step}`);

    // Retune the callback cadence mid-run — sync less once it's going.
    // (Call client methods before the first await: while the callback's
    // promise is pending the engine is suspended and must not re-enter.)
    if (data.step === 1000) {
      lammps.setAsyncStepFrequency(2000);
      log("→ retuned: now syncing every 2000 steps");
    }

    // Control speed from JS: the run pauses for as long as you await.
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (sim.stopped) throw new Error("stopped");
  },
  { every: 200 }
);

log("done:", callbacks, "callbacks for 10000 steps");
lammps.dispose();
