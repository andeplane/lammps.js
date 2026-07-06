import { LammpsClient } from "lammps.js/client";

// worker: true runs everything — the wasm module included — inside a Web
// Worker, so even heavy runs never block the page. create() then resolves
// to a LammpsWorkerClient.
const lammps = await LammpsClient.create(
  { print: (line) => log(line) },
  { worker: true, onError: (err) => log("worker error:", err.message) }
);

// stopRun() asks the active run to abort at its next step callback.
// (The docs ■ Stop button triggers sim.onStop.)
sim.onStop(() => lammps.stopRun());

const result = await lammps.runScriptAsync(
  `
  units         lj
  timestep      0.005
  atom_style    atomic
  lattice       fcc 0.8442
  region        box block 0 4 0 4 0 4
  create_box    1 box
  create_atoms  1 box
  mass          1 1.0
  velocity      all create 3.0 87287
  pair_style    lj/cut 2.5
  pair_coeff    1 1 1.0 1.0 2.5
  fix           1 all nvt temp 3.0 3.0 0.1
  thermo        5000
  run           50000
  `,
  async (data) => {
    // Snapshots arrive on the main thread as copied, transferred arrays.
    draw(data);
  },
  { every: 50, wrapped: true }
);

log(result.aborted ? "aborted by stopRun()" : "completed", "at step", result.step);

// Snapshot getters return the latest data received from the worker:
log("latest known step:", lammps.getCurrentStep());

lammps.dispose(); // shuts down the session and terminates the worker
