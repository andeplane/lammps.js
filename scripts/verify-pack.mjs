// Guard against publishing an incomplete package.
//
// The 1.3.1 tarball shipped with only dist/cpp/lammps.js — every other file
// referenced by package.json's exports map (dist/client.js, dist/worker.js,
// all .d.ts entries) was missing, so `import "lammps.js/client"` failed for
// consumers. This script runs as prepublishOnly, so both `npm publish` in CI
// and a manual publish from a stale checkout abort unless the tarball is
// complete and the wasm modules are real builds rather than the placeholder
// stubs written by scripts/ensure-wasm-stubs.mjs.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { STUB_MARKER } from "./ensure-wasm-stubs.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// Every relative file path referenced by the exports map, plus top-level types.
const requiredFiles = new Set();
const collect = (value) => {
  if (typeof value === "string") {
    requiredFiles.add(value.replace(/^\.\//, ""));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach(collect);
  }
};
collect(pkg.exports);
collect(pkg.types);
// client.js/worker.js resolve sibling modules and the wasm at runtime.
["dist/worker-client.js", "dist/worker-host.js", "dist/worker-protocol.js"].forEach((f) =>
  requiredFiles.add(f)
);

const packJson = execFileSync("npm", ["pack", "--dry-run", "--json"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const packed = new Set(JSON.parse(packJson)[0].files.map((f) => f.path));

const missing = [...requiredFiles].filter((f) => !packed.has(f));
if (missing.length > 0) {
  console.error(
    "verify-pack: tarball is missing files referenced by package.json:\n" +
      missing.map((f) => `  - ${f}`).join("\n") +
      "\nRun `npm run build`, `npm run build:kokkos`, and `npm run build:atomify` before publishing."
  );
  process.exit(1);
}

// The wasm entry points must all be real emscripten modules, not stubs —
// every variant ships in this one package (see the ./wasm-atomify export).
const requiredWasm = ["dist/cpp/lammps.js", "dist/cpp/lammps-kokkos.js", "dist/cpp/lammps-atomify.js"];
for (const wasmFile of requiredWasm) {
  const content = readFileSync(join(root, wasmFile), "utf8");
  if (content.startsWith(`// ${STUB_MARKER}`)) {
    console.error(
      `verify-pack: ${wasmFile} is a placeholder stub, not a built wasm module.\n` +
        "Build it first: python3 cpp/build.py, KOKKOS=1 python3 cpp/build.py, and PACKAGES=atomify python3 cpp/build.py."
    );
    process.exit(1);
  }
}

console.log(`verify-pack: OK — ${packed.size} files, all export entries present.`);
