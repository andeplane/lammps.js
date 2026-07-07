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
the page must be cross-origin isolated: serve the site with

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

GitHub Pages cannot send these headers and the JupyterLite service worker
occupies the site scope (so the playground's `coi-serviceworker` trick is not
available here) — on the deployed site the KOKKOS notebook falls back to the
single-threaded build. Local serving with the headers above gives real
multithreading; the Pyodide kernel and CDN downloads work fine under COOP/COEP.
