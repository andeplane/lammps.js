import { LammpsClient } from "lammps.js/client";

// Load the wasm module and boot a LAMMPS session.
const lammps = await LammpsClient.create({
  print: (line) => log(line),     // LAMMPS stdout
  printErr: (line) => log(line),  // LAMMPS stderr
});
lammps.start();

// Any LAMMPS input works. runScript executes a whole script at once.
lammps.runScript(`
  units         lj
  atom_style    atomic
  lattice       fcc 0.8442
  region        box block 0 2 0 2 0 2
  create_box    1 box
  create_atoms  1 box
  mass          1 1.0
`);

log("");
log("atoms created:", lammps.syncParticles().count);
log("session ready:", lammps.instance.isReady());

// dispose() = stop() + cleanup; the wasm module can be garbage collected.
lammps.dispose();
