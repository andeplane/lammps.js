---
name: lammps-js
description: Run LAMMPS molecular dynamics simulations in the browser or Node with the lammps.js npm package (WebAssembly build + TypeScript client). Use when building web apps or scripts that create, run, visualize, or analyze MD simulations with lammps.js — covers runScriptAsync step callbacks, snapshots, Web Worker mode, KOKKOS multithreading, and compute/fix introspection.
---

# lammps.js — LAMMPS in the browser

`lammps.js` is LAMMPS compiled to WebAssembly with a TypeScript client.
Interactive docs with runnable examples: https://editor.lammps.org/docs/

```bash
npm install lammps.js
```

```ts
import { LammpsClient } from "lammps.js/client";

const lammps = await LammpsClient.create({ print: (line) => console.log(line) });
lammps.start();
```

`create()` loads the wasm module (~10 MB); `start()` boots a LAMMPS session.
`start()` again restarts with a clean state; `dispose()` tears everything down.

## The main flow: runScriptAsync

Prefer `runScriptAsync` for anything with a `run` or `minimize` command. The
callback fires every `every` timesteps with fresh snapshots, and **LAMMPS
pauses until the callback's promise resolves** — that is the throttle:

```ts
await lammps.runScriptAsync(script, async (data) => {
  // data.step, data.particles { count, positions, ids, types },
  // data.bonds { count, first, second }, data.box { origin, lengths, matrix }
  render(data.particles, data.box);
  await new Promise(requestAnimationFrame); // display-rate; omit to run flat out
}, { every: 100, wrapped: true, computeScalars: ["mytemp"] });
```

Options: `every` (cadence), `wrapped` (remap atoms into the periodic box —
usually what you want for rendering), `copy` (default true: arrays detached
from wasm memory), `computeScalars` (compute IDs delivered per callback in
`data.computeScalars`), `fixId` (only if the script defines its own
`fix <id> all js/async` line).

Other entry points: `runScript(script)` (synchronous), `runCommand(cmd)`
(single command, chains), `runInput(path, content)` (write file + run it),
`advance(steps)` + `syncParticles()/syncBonds()/syncBox()` for manual
stepping loops. `setAsyncStepFrequency(every)` retunes cadence mid-run.

## Web Worker mode (recommended for apps)

```ts
const lammps = await LammpsClient.create(
  { print: (line) => console.log(line) },
  { worker: true, onError: (err) => console.error(err) }
);
```

- Resolves to a `LammpsWorkerClient`; the wasm module runs inside the worker,
  so heavy runs never block the page. No SharedArrayBuffer needed.
- `runScriptAsync` resolves to `{ aborted, step, timestepSize }`;
  `stopRun()` aborts the active run at its next callback.
- Snapshot getters return the latest step received, not live wasm memory.
- Under vite, `worker: true` may not resolve the packaged worker entry; pass
  a Worker instance instead:
  `new Worker(new URL("lammps.js/worker", import.meta.url), { type: "module" })`.

## Multithreading (KOKKOS)

```ts
{ worker: true, kokkos: { threads: 4 } }  // or kokkos: true
```

Loads the second wasm build (pthreads, up to 8 threads, `-sf kk` applied
automatically). Requires a cross-origin isolated page:
`Cross-Origin-Opener-Policy: same-origin` +
`Cross-Origin-Embedder-Policy: require-corp`, or the coi-serviceworker shim
on static hosts (GitHub Pages). Check `crossOriginIsolated` at runtime and
fall back to the serial build when false.

## Introspection & analysis

- `client.instance` is the low-level `LAMMPSWeb` binding: `getThermo("temp")`
  (any thermo keyword), `getRunStepsDone()/getRunStepsTotal()/getRunMode()`,
  `getMemoryUsage()`, `hasPackage("KOKKOS")`.
- Modifier API: `syncModifiers()` then `listModifiers()` describes every
  compute/fix/variable; `syncModifier("compute", name)` invokes it and
  returns labelled x/y series (RDF bins, MSD components, ave/time history);
  `getModifierPerAtom()` gives one Float64 per atom for coloring.
- Series and per-atom values are heap views (`{ ptr, length }` into
  `client.module.HEAPF32`/`HEAPF64`) — copy what you keep:
  `module.HEAPF32.subarray(v.ptr / 4, v.ptr / 4 + v.length)`.
- Dynamic bonds without a bonded force field:
  `instance.setBuildNeighborlist(true)` +
  `instance.setBondDistance(type1, type2, maxDist)` → bond snapshots include
  neighbor pairs within range. `instance.getWalls()` reports wall fixes.

## Files

The module has an in-memory filesystem (workdir `/work`):
`writeFile`/`removeFile` on the client, full Emscripten API at
`client.module.FS` (`readFile(path, { encoding: "utf8" })`, `readdir`, …).
Put data files/potentials in before running; read dumps back out after.

## Pitfalls

- LAMMPS errors throw JS `Error`s; afterwards
  `instance.getLastErrorMessage()` / `getLastErrorInputLine()` hold details.
  A failed session needs `start()` again before reuse.
- Zero-copy snapshot views (`copy: false`, the sync-method default) are only
  valid until the next command, and wasm memory growth invalidates cached
  heap references — re-read views, never cache them.
- `runScriptAsync` swallows errors thrown by your step callback: the run
  aborts and the promise **resolves** (worker mode: `aborted: true`), with
  the error printed to stdout. Track failures with your own flag if you need
  to distinguish them.
- A `clear` command inside a script wipes the injected js/async fix; runs
  after it won't fire callbacks.
- Keep `every` proportional to run length (e.g. `run 50000` with
  `every: 50`) — a per-step callback on a long run is the usual perf bug.
