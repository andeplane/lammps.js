import { LammpsClient } from "lammps.js/client";

const lammps = await LammpsClient.create({ print: (line) => log(line) });
lammps.start();

// runCommand executes one LAMMPS command at a time; calls chain.
lammps
  .runCommand("units lj")
  .runCommand("atom_style atomic")
  .runCommand("lattice sc 0.5")
  .runCommand("region box block 0 3 0 3 0 3")
  .runCommand("create_box 1 box")
  .runCommand("create_atoms 1 box");

// LAMMPS variables and immediate $(...) expressions work as usual.
lammps.runCommand('variable third equal atoms/3');
lammps.runCommand('print "atoms: $(atoms)  volume: $(vol)  a third: ${third}"');

lammps.dispose();
