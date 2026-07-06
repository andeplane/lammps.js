import { LammpsClient } from "lammps.js/client";

const lammps = await LammpsClient.create({ print: (line) => log(line) });
lammps.start();

// The wasm module has an in-memory filesystem (default workdir: /work).
// runInput writes the file and tells LAMMPS to run it.
lammps.runInput("melt.in", `
  units         lj
  atom_style    atomic
  lattice       fcc 0.8442
  region        box block 0 2 0 2 0 2
  create_box    1 box
  create_atoms  1 box
  mass          1 1.0
  pair_style    lj/cut 2.5
  pair_coeff    1 1 1.0 1.0 2.5
  write_dump    all atom atoms.dump
`);

// Read files LAMMPS produced back out through the Emscripten FS API.
const dump = lammps.module.FS.readFile("atoms.dump", { encoding: "utf8" });
log("");
log(dump.split("\n").slice(0, 9).join("\n"), "…");
log("");
log("workdir contents:", lammps.module.FS.readdir(".").join("  "));

// writeFile / removeFile manage individual files (data files, potentials…).
lammps.writeFile("note.txt", "any bytes or text");
lammps.removeFile("note.txt");

lammps.dispose();
