# LAMMPS.js Jupyter Notebook Tutorials

Plan and ideas for an in-browser notebook tutorial site at **editor.lammps.org/notebook/**,
built with [JupyterLite](https://jupyterlite.readthedocs.io/) and its Python
(Pyodide) kernel, running LAMMPS entirely client-side through `lammps.js` and
the bundled `lammps-js` Python bindings.

## Why notebooks

The playground (`/`) is great for pasting a script and watching the log; the docs
(`/docs/`) explain the API snippet by snippet. Notebooks are the missing middle:
narrative + editable code + persistent output, the format every MD tutorial
(LiveCoMS, MSU/CAVS, atomify) already uses — but with zero installation, because
the kernel is the browser.

## Architecture (what the POC ships)

- `examples/notebook/` holds the JupyterLite site source:
  - `requirements.txt` — pinned `jupyterlite-core` + `jupyterlite-pyodide-kernel`.
  - `content/` — the built-in notebooks, passed to `jupyter lite build --contents content`.
    Users can edit freely; changes persist in browser storage (IndexedDB), originals
    are restored with "revert to original".
  - `jupyter-lite.json` — site config.
- The built lammps.js package (`dist/`) is copied to `notebook/lammps/` in the
  deployed site; the Python bindings dynamic-import
  `{site}/lammps/client.js` inside the Pyodide worker (the site root is
  derived from the kernel's own URL). `client.js` lazy-imports the wasm module
  relative to itself, so the single copied folder is self-contained.
- **The `lammps-js` Python bindings** (repo-root `python/`, built into a wheel
  under `pypi/` that piplite indexes — notebooks run `%pip install lammps-js`;
  the module imports as `lammps`). They mirror the official LAMMPS Python
  module (https://docs.lammps.org/Python_module.html): `command`,
  `commands_string`, `file`, `get_natoms`, `get_thermo`,
  `extract_atom/compute/fix/variable`, `extract_box`, `version`, `close` —
  with `lmp = await lammps(...)` as the one creation-time difference (wasm
  loads async), numpy arrays instead of ctypes pointers, and native-style
  KOKKOS `cmdargs` (`-k on t 4 -sf kk`) selecting the multithreaded build.
  Per-atom and vector data flow through the modifier registry
  (`syncModifier`, `getModifierPerAtom`) into numpy copies.
- The JavaScript kernel was removed when the Python notebooks replaced the JS
  ones (git history has them); JS usage is covered by the playground and
  `/docs/` instead.
- Deployment: the Pages workflow builds the JupyterLite site into
  `examples/pages/dist/notebook/` after the vite build, so it ships inside the same
  Pages artifact → `editor.lammps.org/notebook/`.
- The landing page opens the intro notebook via the `?path=` URL parameter
  (e.g. `/notebook/lab/index.html?path=index.ipynb`); the "Try in Jupyter notebook"
  button on the playground links straight there.

### Constraints to keep in mind

- **Package set**: the deployed wasm is the default `PACKAGES=MOLECULE` build.
  LJ + molecular force fields work; EAM (`MANYBODY`), `KSPACE`, `REAXFF`,
  `GRANULAR` do not. Tutorials that need them are marked below; shipping the
  atomify-flavor wasm (`PACKAGES=atomify`) to the notebook site later unlocks
  nearly all of them.
- **Potential/data files** are not bundled in the wasm FS. Notebooks fetch
  them (`pyfetch(lammps.site_url("files/data/…"))`, or any URL) and hand them
  to `lmp.file(path, contents=…)` / `lmp.write_file(...)` before running.
- **Asyncify rule** (JS client, main-thread runs): inside `runScriptAsync`
  step callbacks, make all `lammps.*` calls **before** the first `await` — the
  wasm cannot be re-entered while suspended. The Python notebooks sidestep
  this by running in chunks (`run 25` in a loop) from the worker.
- **No SharedArrayBuffer on GitHub Pages**: JupyterLite registers its own
  service worker, so we don't install `coi-serviceworker` under `/notebook/`.
  On the deployed site the KOKKOS multithreaded build is therefore unavailable
  and the KOKKOS tutorial (`basics/04`) falls back to the single-threaded build
  with an explanation. On a COOP/COEP-enabled host the same site is fully
  multithreaded — the Pyodide kernel, piplite and CDN downloads all work under
  `require-corp` (verified headlessly).
- **Plotting**: `%pip install matplotlib` just works in the Pyodide kernel
  (rendered inline as rich output) — this was the main reason to go
  Python-first.

## Content folder layout

```
examples/notebook/content/
├── index.ipynb                     # opened by default: welcome + first simulation
├── basics/
│   ├── 01-getting-started.ipynb
│   ├── 02-scripts-and-files.ipynb
│   ├── 03-analysis-and-plotting.ipynb
│   └── 04-multithreading-kokkos.ipynb
├── materials/                      # SHIPPED: matsci-tutorials arc on an LJ metal
│   ├── 01-perfect-crystal.ipynb
│   ├── 02-energy-volume-curve.ipynb
│   ├── 03-uniaxial-deformation.ipynb
│   ├── 04-grain-boundary.ipynb
│   ├── 05-fracture.ipynb
│   └── 06-nanoindentation.ipynb
├── md-basics/                      # molecular dynamics concepts (LJ systems)
├── materials/                      # matsci-tutorials.pdf ports (needs MANYBODY)
├── soft-matter/                    # LiveCoMS soft-matter ports (needs KSPACE/MOLECULE)
├── showcase/                       # atomify example ports
└── data/                           # shared potentials / data files notebooks fetch
```

## Tutorial ideas

### Series 0 — Using lammps.js in a notebook (POC scope)

| Notebook | Contents |
|---|---|
| `index.ipynb` | What this site is, `%pip install lammps-js`, melt a small LJ crystal, where to go next. |
| `01-getting-started` | The official-module API: `await lammps()`, `commands_string`/`command`, `get_thermo`, `extract_global`/`extract_box`, `extract_atom` as numpy, atom-style variables, `close()`. |
| `02-scripts-and-files` | The in-memory FS: `lmp.file(path, contents=…)`, dumps back out with `read_file` + numpy parsing, `write_file`, fetching a script over HTTP with `site_url`. |
| `03-analysis-and-plotting` | numpy + matplotlib on a live run: thermo series in chunks, MSD → diffusion coefficient, RDF via `extract_compute(ARRAY)`, per-atom KE histogram. |
| `04-multithreading-kokkos` | The KOKKOS wasm build via native-style `cmdargs`, cross-origin-isolation check + fallback, benchmark. |

### Series 1 — MD fundamentals with LJ systems (default wasm ✓)

1. **Melting an fcc crystal** — energy/temperature vs time, spot the phase transition.
2. **Radial distribution function** — `compute rdf`, plot g(r) for solid vs liquid.
3. **Diffusion & mean-squared displacement** — Einstein relation, extract D from MSD slope (atomify has a `diffusion` example to port).
4. **Thermostats** — NVE vs NVT (Nosé–Hoover) vs Langevin; temperature ramping (`fix nvt` with start/stop temps).
5. **Equation of state** — pressure vs density scan of the LJ fluid; LAMMPS loops (`variable`/`next`/`jump`) driven from Python instead.
6. **2D systems** — cheap, fast, and pretty: 2D LJ crystallization.
7. **Walls & confinement** — `fix wall/lj93`, particles in a box/channel (atomify `walls` example).
8. **Surface diffusion** — adatom hopping on a crystal surface (atomify `surfacediffusion`).
9. **Granular pour** *(needs GRANULAR)* — atomify's granular demos.

### Series 2 — The lammps.js API in depth (default wasm ✓)

1. **Manual stepping** — `advance()`, pre/post flags, building custom run loops.
2. **Monitoring LAMMPS state** — variables, computes, `getComputeScalar`, thermo parsing vs structured extraction.
3. **Per-atom data** — per-atom computes, gathering custom per-atom quantities.
4. **Bonds & molecules** — `syncBonds`, molecular topology, a small polymer.
5. **Error handling** — LAMMPS errors → JS exceptions; recovering a session.
6. **Worker mode** — `worker: true`, why the UI stays responsive, snapshot getters.
7. **Retuning a run in flight** — change fix parameters from the callback (`async-retune` docs snippet as a notebook).
8. **Performance** — timing runs, system-size scaling, what wasm costs vs native.

### Series 3 — Materials science (SHIPPED as `materials/`, adapted to LJ)

The LiveCoMS "Materials-Science Tutorials for LAMMPS" (Gravelle, Tschopp,
Kohlmeyer) are shipped as the `materials/` series, **adapted from EAM aluminum
to a model LJ fcc metal** (the default wasm has no MANYBODY): same arc — perfect
crystal → E–V curve/Birch–Murnaghan → uniaxial deformation → Σ5(310) grain
boundary → GB fracture → nanoindentation — same LAMMPS techniques
(`fix box/relax`, `fix deform` + npt, `delete_atoms overlap`, grips via
`fix setforce` + quasi-static minimize, `fix indent`, `compute centro/atom`
visualized as matplotlib scatter plots). Once a serial full-package wasm ships
here, re-porting to real EAM aluminum is a units + pair_style swap. Original
per-tutorial notes:

1. **Crystalline metals & the EAM potential** — build fcc Al, fetch `Al_zhou.eam.alloy`, minimize, cohesive energy & lattice constant vs experiment.
2. **Energy–volume curve** — scan the lattice parameter, fit Birch–Murnaghan *in the notebook* (numpy least-squares), report a₀ and bulk modulus.
3. **Uniaxial deformation** — strain a single crystal in tension/compression, live stress–strain plot while it runs (this is where in-browser shines).
4. **Grain boundaries** — Σ5(310) tilt boundary, GB energy computation.
5. **Bicrystal fracture** — strain to failure, per-atom stress coloring.
6. **Nanoindentation** — rigid indenter into an Al surface, force–depth curve.

### Series 4 — Soft matter (LiveCoMS companion tutorials, needs KSPACE for some)

Atomify already bundles these (`simongravelle` folder) and they are the most
popular starting tutorials on the web:

1. **Lennard-Jones binary fluid** — the classic "first input" tutorial (✓ default wasm).
2. **Pulling on a carbon nanotube** — bonded vs reactive description.
3. **Polymer in water** — SPC/E water + PEG polymer *(KSPACE)*.
4. **Nanosheared electrolyte** — water + ions between walls *(KSPACE)*.
5. **Free energy sampling** — umbrella sampling of a particle through a barrier.
6. **Water models** *(KSPACE)* — atomify `water` example, density/RDF of SPC/E.

### Series 5 — Showcases (atomify ports, needs the atomify wasm flavor)

- **Silica melt-quench** (`silica`, Vashishta) — glass formation.
- **Silicon carbide** (`sic`) — high-temperature crystal.
- **ReaxFF combustion** (`reaxff`) — reactive chemistry in the browser.
- **Moltemplate systems** (`moltemplate`) — pre-built molecular data files.

### Cross-cutting ideas

- **3D visualization cell** — a `viz.js` helper that renders `syncParticles()`
  positions in a three.js canvas inside a notebook output (the
  `examples/threejs/` code is most of it). This would be the headline feature:
  a rotating, live-updating simulation inside a notebook cell.
- **"Open in playground" links** — each notebook's LAMMPS script with a link that
  preloads it in the editor at `/`.
- **Exercises with solutions** — collapsed solution cells, LiveCoMS style.
- **A `lammpsjs-notebook` helper module** — one import that gives
  `{ LammpsClient, plot, viz, fetchFile }` so tutorial boilerplate stays minimal.

## Roadmap

1. **POC (this PR)** — JupyterLite site with the JS kernel at `/notebook/`,
   `index.ipynb` + Series 0 basics, lammps.js importable, deployed by the Pages
   workflow, "Try in Jupyter notebook" button on the playground.
2. Plot helper + Series 1 (LJ fundamentals) + Series 2 (API).
3. three.js visualization helper.
4. Ship the atomify-flavor wasm alongside (or instead of) the MOLECULE build on
   the notebook site → Series 3–5.
5. Optional: a Pyodide-kernel variant for Python-first users, driving lammps.js
   through a thin JS bridge (atomify's jupyterlite already ships the Python
   kernel + `lammps_logfile` for log analysis — worth mirroring for parsing
   uploaded logs even before the bridge exists).
