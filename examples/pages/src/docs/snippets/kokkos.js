import { LammpsClient } from "lammps.js/client";

// The KOKKOS build runs LAMMPS styles across multiple pthreads. It needs
// SharedArrayBuffer, i.e. a cross-origin isolated page. This page is —
// GitHub Pages can't send COOP/COEP headers, so it uses the
// coi-serviceworker shim.
log("crossOriginIsolated:", crossOriginIsolated);

const threads = Math.min(navigator.hardwareConcurrency || 4, 8);
const lammps = await LammpsClient.create(
  { print: (line) => log(line) },
  // kokkos: true picks a thread count automatically; suffix: false would
  // stop LAMMPS from applying the /kk style variants for you.
  { worker: true, kokkos: { threads } }
);
sim.onStop(() => lammps.stopRun());

log(`running with ${threads} Kokkos thread(s)…`);
const t0 = performance.now();

await lammps.runScriptAsync(
  `
  units         lj
  timestep      0.005
  atom_style    atomic
  lattice       fcc 0.8442
  region        box block 0 10 0 10 0 10
  create_box    1 box
  create_atoms  1 box
  mass          1 1.0
  velocity      all create 1.44 87287
  pair_style    lj/cut 2.5
  pair_coeff    1 1 1.0 1.0 2.5
  fix           1 all nve
  thermo        500
  run           2000
  `,
  async () => {}, // no per-step work: this one is a pure benchmark
  { every: 1000 }
);

const seconds = (performance.now() - t0) / 1000;
log(`4000 atoms × 2000 steps: ${seconds.toFixed(2)} s — edit \`threads\` and rerun`);
lammps.dispose();
