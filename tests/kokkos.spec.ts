// @vitest-environment node
//
// Exercises the multi-threaded KOKKOS wasm build (dist/cpp/lammps-kokkos.js).
// Runs in a plain node environment: Emscripten pthreads are backed by
// worker_threads + SharedArrayBuffer, which jsdom does not provide.
import { afterAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { LammpsClient } from "../dist/client.js";

const kokkosModulePath = join(process.cwd(), "dist", "cpp", "lammps-kokkos.js");
const fixturePath = join(process.cwd(), "tests", "fixtures", "lj.mini.in");
const hasKokkosBuild =
  existsSync(kokkosModulePath) &&
  // A stub emitted by scripts/ensure-kokkos-stub.mjs is not a real build.
  !readFileSync(kokkosModulePath, "utf8").startsWith("// lammps.js-wasm-stub");

const clients: LammpsClient[] = [];

async function createKokkosClient(threads: number): Promise<LammpsClient> {
  const client = await LammpsClient.create(
    { print: () => undefined, printErr: () => undefined },
    { kokkos: { threads } }
  );
  clients.push(client);
  return client;
}

afterAll(() => {
  for (const client of clients) {
    client.dispose();
  }
});

describe.skipIf(!hasKokkosBuild)("KOKKOS wasm build", () => {
  it("includes the KOKKOS package", async () => {
    const client = await createKokkosClient(1);
    client.start();
    expect(client.instance.hasPackage("KOKKOS")).toBe(true);
  });

  it("runs a plain LJ script through the kk suffix with multiple threads", async () => {
    const client = await createKokkosClient(2);
    client.start();
    client.runScript(readFileSync(fixturePath, "utf8"));

    const { count, positions, types } = client.syncParticles();
    expect(count).toBe(108); // 4 atoms/cell * 3^3 fcc cells
    expect(positions).toHaveLength(count * 3);
    expect(types).toHaveLength(count);
    for (const value of positions) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(client.getCurrentStep()).toBe(5);
  });

  it("supports runScriptAsync step callbacks (fix js/async)", async () => {
    const client = await createKokkosClient(2);
    client.start();

    const steps: number[] = [];
    await client.runScriptAsync(
      readFileSync(fixturePath, "utf8"),
      (data) => {
        steps.push(data.step);
      },
      { every: 1 }
    );

    expect(steps).toEqual([1, 2, 3, 4, 5]);
  });

  it("restarts cleanly while Kokkos stays initialized", async () => {
    const client = await createKokkosClient(2);
    client.start();
    client.runScript(readFileSync(fixturePath, "utf8"));
    client.start(); // stop + fresh instance
    client.runScript(readFileSync(fixturePath, "utf8"));
    expect(client.getCurrentStep()).toBe(5);
  });
});

describe.skipIf(hasKokkosBuild)("KOKKOS wasm build (missing artifact)", () => {
  it.skip("dist/cpp/lammps-kokkos.js not built; run npm run build:kokkos", () => {});
});
