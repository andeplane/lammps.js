import { LammpsClient } from "lammps.js/client";

const lammps = await LammpsClient.create({ print: (line) => log(line) });
lammps.start();

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
  fix           1 all nvt temp 3.0 3.0 0.1
  thermo        2000
  run           6000
  `,
  async (data) => {
    // data.particles: { count, positions (xyz Float32), ids, types }
    // data.box:       { origin, lengths, matrix }
    draw(data); // docs helper — renders to the canvas on the right
    await new Promise(requestAnimationFrame);
    if (sim.stopped) throw new Error("stopped");
  },
  { every: 10, wrapped: true } // wrapped: remap atoms into the periodic box
);

// Between (or after) runs, pull snapshots directly. copy: true detaches
// the arrays from wasm memory; the default is a zero-copy view.
const { count, positions } = lammps.syncParticles({ wrapped: true, copy: true });
const box = lammps.syncBox();
log("");
log(`first of ${count} atoms:`,
  positions[0].toFixed(3), positions[1].toFixed(3), positions[2].toFixed(3));
log("box lengths:", Array.from(box.lengths).map((v) => v.toFixed(2)).join(" × "));

lammps.dispose();
