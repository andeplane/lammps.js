# lammps.js

[![CI](https://github.com/lammps/lammps.js/actions/workflows/ci.yml/badge.svg)](https://github.com/lammps/lammps.js/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/lammps.js.svg)](https://www.npmjs.com/package/lammps.js)

LAMMPS in the browser. WebAssembly build + a small TS-friendly client.

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
