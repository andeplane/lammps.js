# lammps.js notebooks (JupyterLite site)

The in-browser notebook tutorials deployed at `editor.lammps.org/notebook/`.
See `NOTEBOOK_TUTORIALS.md` at the repo root for the tutorial roadmap.

- `content/` — the built-in notebooks (passed to `jupyter lite build --contents`).
- `requirements.txt` — pinned JupyterLite build dependencies.
- `jupyter-lite.json` — site configuration.

## Building locally

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
npm run build --prefix ../..            # or build:dist if dist/cpp is already built
./build.sh                              # emits dist/ with lammps.js copied in
python3 -m http.server -d dist 8901     # open http://localhost:8901/lab/index.html?path=index.ipynb
```

`build.sh` runs `jupyter lite build --contents content` and copies the repo's
built `dist/` into `dist/lammps/`, which is where the notebooks import the
client from (`new URL("../lammps/client.js", document.baseURI)`).

In CI, `.github/workflows/pages.yml` does the same and places the output at
`examples/pages/dist/notebook/` so it ships with the Pages site.
