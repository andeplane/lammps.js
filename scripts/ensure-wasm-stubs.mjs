// dist/client.js dynamically imports ./cpp/lammps.js and
// ./cpp/lammps-kokkos.js. Bundlers and vitest resolve those specifiers
// statically, so a build of one variant still needs a file at the other
// variant's path. lammps-atomify.js is not imported by client.js, but it is
// referenced by package.json's exports map, so verify-pack (prepublishOnly)
// requires it to exist too. This writes a throwing stub for any variant
// whose real module (built by cpp/build.py) is absent.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const STUB_MARKER = "lammps.js-wasm-stub";

const distCpp = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cpp");

for (const { file, buildCommand } of [
  { file: "lammps.js", buildCommand: "python3 cpp/build.py" },
  { file: "lammps-kokkos.js", buildCommand: "KOKKOS=1 python3 cpp/build.py" },
  { file: "lammps-atomify.js", buildCommand: "PACKAGES=atomify python3 cpp/build.py" }
]) {
  const target = join(distCpp, file);
  const isRealModule =
    existsSync(target) && !readFileSync(target, "utf8").startsWith(`// ${STUB_MARKER}`);
  if (isRealModule) {
    continue;
  }
  mkdirSync(distCpp, { recursive: true });
  writeFileSync(
    target,
    `// ${STUB_MARKER} — placeholder emitted by scripts/ensure-wasm-stubs.mjs.
// The real module is produced by: ${buildCommand}
export default async function createModule() {
  throw new Error("This wasm module is not part of this build. Build it with: ${buildCommand}");
}
`
  );
  console.log(`Wrote wasm stub: ${target}`);
}
