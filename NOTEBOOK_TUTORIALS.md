# LAMMPS.js Jupyter Notebook Tutorials

Plan and ideas for an in-browser notebook tutorial site at **editor.lammps.org/notebook/**,
built with [JupyterLite](https://jupyterlite.readthedocs.io/) and its JavaScript kernel,
running LAMMPS entirely client-side through `lammps.js`.

## Why notebooks

The playground (`/`) is great for pasting a script and watching the log; the docs
(`/docs/`) explain the API snippet by snippet. Notebooks are the missing middle:
narrative + editable code + persistent output, the format every MD tutorial
(LiveCoMS, MSU/CAVS, atomify) already uses — but with zero installation, because
the kernel is the browser.

## Architecture (what the POC ships)

- `examples/notebook/` holds the JupyterLite site source:
  - `requirements.txt` — pinned `jupyterlite-core` + `jupyterlite-javascript-kernel`
    (the kernel is pinned to a 0.4.0 pre-release: it is the first version whose
    kernels support `await` and dynamic `import()` in cells).
  - `content/` — the built-in notebooks, passed to `jupyter lite build --contents content`.
    Users can edit freely; changes persist in browser storage (IndexedDB), originals
    are restored with "revert to original".
  - `jupyter-lite.json` — site config.
- The built lammps.js package (`dist/`) is copied to `notebook/lammps/` in the
  deployed site. Notebooks load it with a dynamic import:

  ```js
  const { LammpsClient } = await import(new URL("../lammps/client.js", document.baseURI));
  ```

  `document.baseURI` resolves against the JupyterLab page (`/notebook/lab/…`), so
  `../lammps/client.js` lands on `/notebook/lammps/client.js` in both the Lab and
  Notebook interfaces. `client.js` then lazy-imports the wasm module relative to
  itself, so the single copied folder is self-contained.
- The JS kernel runs code in a hidden same-origin iframe (there is also a Web
  Worker variant). The iframe kernel is the default for our notebooks: it has DOM
  access (needed for `requestAnimationFrame` throttling, rich HTML output, and
  future three.js visualization) and dynamic `import()` works there.
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
- **Potential/data files** are not bundled in the wasm FS. Notebooks `fetch()`
  them (from `content/` files served by the site, or from lammps.js GitHub raw
  URLs) and write them with `lammps.writeFile(...)` before running.
- **Asyncify rule** (main-thread runs): inside `runScriptAsync` step callbacks,
  make all `lammps.*` calls **before** the first `await` — the wasm cannot be
  re-entered while suspended. Tutorials must model this correctly.
- **No SharedArrayBuffer**: JupyterLite registers its own service worker, so we
  don't install `coi-serviceworker` under `/notebook/`. The KOKKOS multithreaded
  build therefore stays a playground-only feature for now (a COOP/COEP-enabled
  host would lift this).
- **Plotting**: there is no matplotlib. Options, in order of preference:
  a tiny bundled `plot.js` helper (SVG line/scatter charts, no dependencies,
  imported the same way as the client), Plotly/Chart.js from a CDN, or
  `console.table`-style text output. The docs page already has a minimal chart
  renderer (`examples/pages/src/docs/chart.ts`) that can be extracted for this.

## Content folder layout

```
examples/notebook/content/
├── index.ipynb                     # opened by default: welcome + first simulation
├── basics/
│   ├── 01-getting-started.ipynb
│   ├── 02-scripts-and-files.ipynb
│   ├── 03-live-data.ipynb
│   └── 04-snapshots-and-analysis.ipynb
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
| `index.ipynb` | What this site is, how the kernel works, load `LammpsClient`, melt a small LJ crystal, where to go next. |
| `01-getting-started` | `create()` options (`print`/`printErr`), `start()`, `runScript` vs `runCommand` vs `runInput`, reading `syncParticles().count`, `dispose()`. |
| `02-scripts-and-files` | The in-memory FS: `writeFile`/`removeFile`, `module.FS.readFile`, writing dumps and reading them back, fetching a data file from the web into the FS. |
| `03-live-data` | `runScriptAsync` + step callbacks, `computeScalars`, throttling with `requestAnimationFrame`, stopping a run by throwing; the asyncify do-not-re-enter rule. |
| `04-snapshots-and-analysis` | Typed-array access: positions/ids/types, wrapped vs unwrapped, box matrix; compute MSD/temperature in JavaScript from the arrays. |

### Series 1 — MD fundamentals with LJ systems (default wasm ✓)

1. **Melting an fcc crystal** — energy/temperature vs time, spot the phase transition.
2. **Radial distribution function** — `compute rdf`, plot g(r) for solid vs liquid.
3. **Diffusion & mean-squared displacement** — Einstein relation, extract D from MSD slope (atomify has a `diffusion` example to port).
4. **Thermostats** — NVE vs NVT (Nosé–Hoover) vs Langevin; temperature ramping (`fix nvt` with start/stop temps).
5. **Equation of state** — pressure vs density scan of the LJ fluid; LAMMPS loops (`variable`/`next`/`jump`) driven from JS instead.
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

### Series 3 — Materials science (ports of `matsci-tutorials.pdf`, needs MANYBODY)

The LiveCoMS "Materials-Science Tutorials for LAMMPS" (Gravelle, Tschopp,
Kohlmeyer) map almost 1:1 onto notebooks — each tutorial is narrative + input +
post-processing, and the post-processing (currently Python) becomes JavaScript
on the live arrays instead:

1. **Crystalline metals & the EAM potential** — build fcc Al, fetch `Al_zhou.eam.alloy`, minimize, cohesive energy & lattice constant vs experiment.
2. **Energy–volume curve** — scan the lattice parameter, fit Birch–Murnaghan *in the notebook* (a few lines of JS least-squares), report a₀ and bulk modulus.
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
