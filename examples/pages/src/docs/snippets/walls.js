import { LammpsClient } from "lammps.js/client";

const lammps = await LammpsClient.create({ print: (line) => log(line) });
lammps.start();

lammps.runScript(`
  units         lj
  timestep      0.005
  boundary      p p f
  atom_style    atomic
  lattice       fcc 0.8442
  region        box block 0 5 0 5 0 5
  create_box    1 box
  region        inner block 0 5 0 5 0.7 4.3
  create_atoms  1 region inner
  mass          1 1.0
  velocity      all create 1.5 87287
  pair_style    lj/cut 2.5
  pair_coeff    1 1 1.0 1.0 2.5
  fix           1 all nve
  fix           zwalls all wall/lj93 zlo EDGE 1.0 1.0 2.5 zhi EDGE 1.0 1.0 2.5
  run           0 post no
`);

// getWalls() reports renderable wall fixes (EDGE and CONSTANT styles):
// which 0–5 = XLO, XHI, YLO, YHI, ZLO, ZHI.
const walls = lammps.instance.getWalls();
log(walls);

const planes = walls.map((w) => ({
  axis: Math.floor(w.which / 2),
  position: w.position,
}));

await lammps.runScriptAsync(
  "run 6000",
  async (data) => {
    draw(data, { walls: planes });
    await new Promise(requestAnimationFrame);
    if (sim.stopped) throw new Error("stopped");
  },
  { every: 10, wrapped: true }
);

lammps.dispose();
