# lammps-js (LAMMPS Python bindings for the browser)

Python bindings that drive the [lammps.js](https://github.com/lammps/lammps.js)
WebAssembly engine from a Pyodide kernel (JupyterLite), mirroring the official
[`lammps` Python module](https://docs.lammps.org/Python_module.html):

```python
%pip install lammps-js

from lammps import lammps

lmp = await lammps()          # wasm loads asynchronously → one await at creation
lmp.commands_string("""
  units       lj
  lattice     fcc 0.8442
  region      box block 0 3 0 3 0 3
  create_box  1 box
  create_atoms 1 box
  mass        1 1.0
  velocity    all create 3.0 87287
  pair_style  lj/cut 2.5
  pair_coeff  1 1 1.0 1.0 2.5
  fix         1 all nve
""")
lmp.command("run 100")
print(lmp.get_natoms(), lmp.get_thermo("temp"))
x = lmp.extract_atom("x")     # numpy array, shape (natoms, 3)
lmp.close()
```

Multithreaded (KOKKOS) build, same arguments as native LAMMPS — requires a
cross-origin isolated page:

```python
lmp = await lammps(cmdargs=["-k", "on", "t", "4", "-sf", "kk"])
```

The full-package Atomify build (MANYBODY, KSPACE, REAXFF, GRANULAR, … — also
a multithreaded KOKKOS build, so it needs a cross-origin isolated page too):

```python
lmp = await lammps(variant="atomify")
```

Differences from the native module are listed in the module docstring
(`import lammps; help(lammps)`).

This wheel is pure Python and only works inside Pyodide, in a page that
serves the built lammps.js package at `{site}/lammps/client.js` (the
lammps.js JupyterLite site does). Set `lammps.CLIENT_URL` to load the client
from elsewhere.
