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
  velocity      all create 2.0 87287
  pair_style    lj/cut 2.5
  pair_coeff    1 1 1.0 1.0 2.5
  fix           1 all nve
  run           0 post no
`);
log("timestep size:", lammps.getTimestepSize());

// advance() integrates N steps synchronously — you own the loop.
for (let frame = 0; frame < 400 && !sim.stopped; frame += 1) {
  lammps.advance(5);
  draw({
    particles: lammps.syncParticles({ wrapped: true }),
    box: lammps.syncBox(),
  });
  if (frame % 100 === 0) log("now at step", lammps.getCurrentStep());
  await new Promise(requestAnimationFrame);
}

log("final step:", lammps.getCurrentStep());
lammps.dispose();
