# lammps.js — Project Instructions

LAMMPS (molecular dynamics) compiled to WebAssembly with a TypeScript client. Published to npm as `lammps.js`.

## Layout

- `client.ts` — the TypeScript client (`LammpsClient`), the main API surface. Published as `lammps.js/client`.
- `types/` — hand-written type declarations for the wasm module (`LammpsModule`, `LAMMPSWeb`, snapshot types).
- `cpp/` — C++ glue code and build tooling:
  - `cpp/lammpsweb/` — embind bindings (`lammpsweb.cpp/.h`) and the `js/async` fix (`fix_js_async.cpp/.h`) that powers `runScriptAsync`.
  - `cpp/build.py` — CMake/Emscripten build script; clones LAMMPS (tag pinned via `LAMMPS_TAG`) and emits `dist/cpp/lammps.js`. With `KOKKOS=1` it emits the multithreaded `dist/cpp/lammps-kokkos.js` (pthreads + `-sMEMORY64=2`).
- `tests/` — vitest specs. `tests/lammps.spec.ts` exercises the real wasm build; `tests/client.inject.spec.ts` tests script-injection logic without wasm.
- `examples/pages/` — the GitHub Pages demo (deployed by `.github/workflows/pages.yml`).
- `examples/notebook/` — the JupyterLite notebook tutorial site (deployed to `/notebook/` on Pages). `content/` holds the built-in notebooks; `build.sh` runs `jupyter lite build` and copies the repo's `dist/` into the site as `{site}/lammps/`, which is where notebooks import the client from. Tutorial roadmap: `NOTEBOOK_TUTORIALS.md`.
- `examples/threejs/` — a three.js visualization example.

## Building & testing

- Building wasm requires the Emscripten SDK, pinned to the version in `emsdk_manifest.txt`. Set `EMSDK_PATH` to the SDK directory.
- `npm run build` — builds wasm (`cpp/build.py`) then compiles TS to `dist/`.
- `npm test` — full build + vitest. Requires Emscripten.
- `npx vitest run tests/client.inject.spec.ts` — runs without a wasm build.

## Conventions

- The npm package ships only `dist/`, `cpp/build.py`, `README.md`, and `LICENSE` (see `package.json` `files`).
- All shipped source is TypeScript; avoid adding plain `.js` sources.
- `runScriptAsync` works by injecting a `fix <id> all js/async <every>` line before the first `run`/`minimize` command — see the helpers at the top of `client.ts` before changing that logic.
- `emsdk_manifest.txt` is the single source of truth for the Emscripten version — the CI/release workflows install the version it names and use it in their cache keys.
- The notebook site pins `jupyterlite-javascript-kernel` to a 0.4.0 pre-release deliberately: it is the first version whose kernels support `await` and dynamic `import()` in cells (0.3.0 does a bare `eval` in a web worker, where neither works). Notebooks must put cross-cell state on `globalThis` — cells run as separate async function bodies, so top-level `const`/`var` do not persist. Don't use `globalThis.origin` as a variable name (read-only in workers).
