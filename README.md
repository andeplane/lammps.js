# lammps.js

[![CI](https://github.com/lammps/lammps.js/actions/workflows/ci.yml/badge.svg)](https://github.com/lammps/lammps.js/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/lammps.js.svg)](https://www.npmjs.com/package/lammps.js)

LAMMPS in the browser. WebAssembly build + a small TS-friendly client.

**[Try in your browser →](https://editor.lammps.org/)**

## Install

```bash
npm install lammps.js
```

The default build enables the MOLECULE package. If your scripts need more of
LAMMPS, install the **atomify flavor** instead — same code and API, built with
`PACKAGES=atomify` (RIGID CLASS2 MANYBODY MC MOLECULE GRANULAR KSPACE SHOCK
MISC QEQ REAXFF EXTRA-MOLECULE VORONOI COLVARS, plus moltemplate's extra pair
styles). It is bigger (~19 MB module vs ~11 MB) and ships the serial module
only (no KOKKOS variant):

```bash
npm install lammps.js-atomify
# or, to keep imports unchanged, alias it:
npm install lammps.js@npm:lammps.js-atomify
```

Both flavors are published from this repository at the same version
(`release.yml` / `release-atomify.yml`).

## Usage (main flow: `runScriptAsync`)

`runScriptAsync()` is the main API.
It works with `run ...` and `minimize ...`.
Your callback is called every `N` steps (`every`).
LAMMPS waits for the callback Promise before going to the next step.
If the Promise never resolves, simulation stays paused.

```ts
import { LammpsClient } from "lammps.js/client";

const lammps = await LammpsClient.create();
lammps.start();

await lammps.runScriptAsync(
  `
    units lj
    atom_style atomic
    lattice fcc 0.8442
    region box block 0 3 0 3 0 3
    create_box 1 box
    create_atoms 1 box
    mass 1 1.0
    pair_style lj/cut 2.5
    pair_coeff 1 1 1.0 1.0 2.5
    run 5000
  `,
  async (data) => {
    console.log("step", data.step, "count", data.particles?.count);
    await new Promise(requestAnimationFrame);
  },
  { every: 50 }
);
```

You can control speed from JS (no `run 1` loop):

```ts
let speed = 5; // UI-controlled value

await lammps.runScriptAsync(
  "run 100000",
  async () => {
    const delayMs = Math.max(0, 100 - speed * 10);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  },
  { every: 1 }
);
```

You can also include compute scalars in callback data:

```ts
await lammps.runScriptAsync(
  `
    compute ctemp all temp
    compute cke all ke
    minimize 0.0 1.0e-6 100 1000
    uncompute ctemp
    uncompute cke
  `,
  async (data) => {
    console.log("step", data.step);
    console.log("temp", data.computeScalars?.ctemp);
    console.log("ke", data.computeScalars?.cke);
  },
  {
    every: 5,
    computeScalars: ["ctemp", "cke"],
  }
);
```

## Usage (in a Web Worker)

Pass `worker: true` to run the whole simulation — wasm module included — inside a
Web Worker instead of on the calling thread. Long runs then never block the UI:

```ts
import { LammpsClient } from "lammps.js/client";

const lammps = await LammpsClient.create(
  { print: (msg) => console.log(msg) },
  { worker: true }
);

const result = await lammps.runScriptAsync(
  "run 100000",
  async (data) => {
    // Called on the main thread every `every` steps with copied snapshots.
    console.log("step", data.step, "atoms", data.particles?.count);
  },
  { every: 100 }
);

lammps.stopRun();  // ask a running script to abort at its next step
lammps.dispose();  // shuts down and terminates the worker
```

What `worker: true` means:

- `create()` resolves to a `LammpsWorkerClient` instead of a `LammpsClient`.
  Commands are forwarded to the worker; snapshot getters
  (`syncParticles()`, `getCurrentStep()`, …) return the **latest step data
  received from the worker** rather than reading live wasm memory.
- Per-step data is **copied and transferred** (zero-copy handoff of the
  copies) to the main thread. The simulation pauses until your step
  callback's promise resolves, exactly like the synchronous mode.
- If your bundler needs control over worker creation, pass a `Worker`
  instance instead of `true`:

```ts
const worker = new Worker(new URL("lammps.js/worker", import.meta.url), { type: "module" });
const lammps = await LammpsClient.create({}, { worker });
```

### Do I need SharedArrayBuffer?

**No — not for this.** Worker mode communicates via `postMessage` with
transferred `ArrayBuffer`s, which works everywhere Web Workers do, with no
special headers.

`SharedArrayBuffer` is only required for the **multithreaded KOKKOS
build** (see below).

## Usage (multithreaded, KOKKOS)

The package also ships a KOKKOS-enabled wasm build
(`dist/cpp/lammps-kokkos.js`) that runs LAMMPS Kokkos styles across
multiple pthreads. Opt in with the `kokkos` client option — it combines
with `worker: true`:

```ts
const lammps = await LammpsClient.create(
  {},
  { worker: true, kokkos: { threads: 4 } }
);
```

- `kokkos: true` picks a thread count from `navigator.hardwareConcurrency`
  (capped at 8, the module's pthread pool size).
- LAMMPS starts with `-k on t <threads> -sf kk`, so plain scripts
  automatically use the accelerated `/kk` styles where they exist. Pass
  `suffix: false` to manage suffixes yourself.
- Typical speedups (13,500-atom Lennard-Jones melt, M-series MacBook):
  ~1.8× on 2 threads, ~3× on 4, ~4.4× on 8.

### Required headers (browsers only)

SharedArrayBuffer — and therefore the KOKKOS build — only works on pages
that are
[cross-origin isolated](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements).
Node needs no setup. If you control the server, send these two response
headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

For example, with vite:

```ts
// vite.config.ts
export default defineConfig({
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp"
    }
  }
});
```

If your host can't set response headers — GitHub Pages, most static
hosting — install the
[coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) shim,
which injects the headers from a service worker (the page reloads once on
first visit):

```bash
npm install coi-serviceworker
cp node_modules/coi-serviceworker/coi-serviceworker.min.js <your-static-files-dir>/
```

```html
<!-- Must be served from your own origin and loaded before your app code;
     it cannot be bundled or loaded from a CDN. -->
<script src="coi-serviceworker.min.js"></script>
```

You can check `crossOriginIsolated` in the browser console — when it is
`true`, the KOKKOS build will work.

## Usage (manual stepping, optional)

```ts
const lammps = await LammpsClient.create();

lammps.start().runScript(`
  units lj
  atom_style atomic
  lattice fcc 0.8442
  region box block 0 3 0 3 0 3
  create_box 1 box
  create_atoms 1 box
  mass 1 1.0
  pair_style lj/cut 2.5
  pair_coeff 1 1 1.0 1.0 2.5
  run 1
`);

const particles = lammps.syncParticles({ copy: true });
console.log(`atoms: ${particles.count}`);

for (let frame = 0; frame < 10; frame += 1) {
  lammps.advance(1, false, false);
  const { positions, count } = lammps.syncParticles({ copy: true });
  console.log(`frame ${frame}: ${count} atoms`);
}

lammps.dispose();
```

## Build

```bash
npm run build          # serial wasm module + TypeScript
npm run build:kokkos   # multithreaded KOKKOS wasm module + TypeScript
```

Outputs go straight into `dist/`:
- `dist/cpp/lammps.js` (single-file wasm module)
- `dist/cpp/lammps-kokkos.js` (single-file KOKKOS/pthreads wasm module)
- `dist/client.js`
- `dist/**/*.d.ts`

## Tests

```bash
npm test               # serial build + full suite
npm run test:kokkos    # KOKKOS build + KOKKOS suite
```

## Example

```bash
cd examples/threejs
npm install
npm run dev
```

It uses `tests/fixtures/lj.mini.in`.
