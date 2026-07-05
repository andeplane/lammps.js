# lammps.js

[![CI](https://github.com/lammps/lammps.js/actions/workflows/ci.yml/badge.svg)](https://github.com/lammps/lammps.js/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/lammps.js.svg)](https://www.npmjs.com/package/lammps.js)

LAMMPS in the browser. WebAssembly build + a small TS-friendly client.

**[Try in your browser →](https://editor.lammps.org/)**

## Install

```bash
npm install lammps.js
```

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

`SharedArrayBuffer` only becomes relevant for future **multithreaded**
builds (Emscripten pthreads / KOKKOS). If that lands, pages will need to be
[cross-origin isolated](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements):
served with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`. Hosts that can't set response
headers — like GitHub Pages — can enable it with the
[coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) shim,
which injects those headers from a service worker.

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
npm run build
```

Outputs go straight into `dist/`:
- `dist/cpp/lammps.js` (single-file wasm module)
- `dist/client.js`
- `dist/**/*.d.ts`

## Tests

```bash
npm test
```

## Example

```bash
cd examples/threejs
npm install
npm run dev
```

It uses `tests/fixtures/lj.mini.in`.
