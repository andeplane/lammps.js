# Contributing to lammps.js

## Ask a question or report a problem

Use the [lammps.js issue tracker](https://github.com/andeplane/lammps.js/issues) for help with the JavaScript or Python API, WebAssembly builds, installation, or browser integration. Include the package version, the WebAssembly variant, your browser or Node.js version, and the smallest input and client code that reproduce the issue. A runnable playground example or short LAMMPS input is useful. For general LAMMPS modeling questions, use the [LAMMPS community forum](https://matsci.org/c/lammps/).

## Propose a change

For substantial changes to the API, build variants, or engine patches, open an issue to discuss the use case. Open a pull request against `master` and describe what changed, how you tested it, and which variants are affected. Include a focused test for a behavioral change and update the example or documentation that shows the affected API.

## Run checks

From the repository root in a Unix-like shell, use Node.js 20 or newer and run `npm ci`. Build the TypeScript distribution before running the client script-injection tests. These checks do not compile WebAssembly:

```sh
npm run build:dist
npx vitest run tests/client.inject.spec.ts
```

For engine tests, install Python 3, CMake, and the Emscripten SDK version in `emsdk_manifest.txt`. Activate the SDK and set `EMSDK_PATH` to its directory. Run `npm test` for the default build. The [CI workflow](.github/workflows/ci.yml) also runs the KOKKOS, Atomify, and Atomify serial build tests.
