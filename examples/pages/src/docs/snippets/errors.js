import { LammpsClient } from "lammps.js/client";

const lammps = await LammpsClient.create({ printErr: (line) => log(line) });
lammps.start();

// LAMMPS errors surface as thrown JS Errors, with structured details
// available on the instance afterwards.
try {
  lammps.runScript(`
    units       lj
    atom_style  atomic
    this_is_not_a_command 1 2 3
  `);
} catch (err) {
  log("");
  log("caught:", err.message);
  log("failing line:", lammps.instance.getLastErrorInputLine());
  log("last processed line:", lammps.instance.getLastInputLine());
}

// start() begins a fresh session and clears the recorded error state.
lammps.start();
log("");
log("after restart, last error:", JSON.stringify(lammps.instance.getLastErrorMessage()));
lammps.dispose();
