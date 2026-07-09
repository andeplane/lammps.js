# lammps.js notebooks (JupyterLite site)

The in-browser notebook tutorials deployed at `editor.lammps.org/notebook/`.
See `NOTEBOOK_TUTORIALS.md` at the repo root for the tutorial roadmap.

- `content/` — the built-in notebooks (passed to `jupyter lite build
  --contents`). All notebooks use the Python (Pyodide) kernel through the
  `lammps-js` bindings.
- `../../python/` — the `lammps-js` Python package: bindings that drive the
  lammps.js wasm engine from Pyodide, mirroring the official LAMMPS Python
  module (https://docs.lammps.org/Python_module.html); it imports as
  `lammps`. `build.sh` builds it into a wheel under `pypi/`, which
  `jupyter lite build` bundles so notebooks can `%pip install lammps-js`.
- `requirements.txt` — pinned JupyterLite build dependencies.
- `jupyter-lite.json` — site configuration.

## Building locally

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
npm run build --prefix ../..            # or build:dist if dist/cpp is already built
./build.sh                              # emits dist/ with lammps.js copied in
python3 -m http.server -d dist 8901     # open http://localhost:8901/lab/index.html?path=index.ipynb
```

`build.sh` builds the `python/` wheel into `pypi/`, runs
`jupyter lite build --contents content`, and copies the repo's built `dist/`
into `dist/lammps/`, which is where the Python bindings import the client
from.

In CI, `.github/workflows/pages.yml` does the same and places the output at
`examples/pages/dist/notebook/` so it ships with the Pages site.

## Multithreading (KOKKOS) in notebooks

The Python bindings accept native-style KOKKOS arguments
(`await lammps(cmdargs=["-k", "on", "t", "4", "-sf", "kk"])`), which load the
multithreaded `lammps-kokkos.js` build. Threads need `SharedArrayBuffer`, so
the page must be cross-origin isolated (the COOP/COEP headers).

Static hosting like GitHub Pages cannot send those headers, so `build.sh`
runs `coi_patch.py` after `jupyter lite build`: it folds the
[coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) trick into
JupyterLite's **own** service worker (only one worker can own the scope, and
the contents API — which our DriveFS mount rides on — needs it to be
JupyterLite's). The worker re-serves every response with the headers added,
and a small bootstrap in the app pages reloads once, the first time the
worker takes control. The result: the site is cross-origin isolated even on
GitHub Pages or a bare `python3 -m http.server`, and the KOKKOS build runs
truly multithreaded (~2.4× over serial at `t 4`, verified headlessly — the
Pyodide kernel, piplite and CDN downloads all work under `require-corp`).
If isolation is unavailable (e.g. the reload guard trips), notebooks fall
back to the single-threaded build gracefully.

`coi_patch.py` asserts on the service-worker internals of the pinned
`jupyterlite-core` — a version bump that changes them fails the build loudly.
Upstream feature request: jupyterlite/jupyterlite#1409.
