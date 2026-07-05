import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import type {
  BondSnapshot,
  BoxSnapshot,
  BufferView,
  LAMMPSWeb,
  LammpsModule,
  ParticleSnapshot
} from "../types";
import { LammpsClient } from "../dist/client.js";

type Harness = {
  client: LammpsClient;
  runScript: Mock;
  setAsyncStepCallback: Mock;
  installAsyncFix: Mock;
};

const emptyView = (): BufferView =>
  ({ ptr: 0, length: 0, components: 0, type: 0 } as unknown as BufferView);

const emptyParticles = (): ParticleSnapshot => ({
  positions: emptyView(),
  ids: emptyView(),
  types: emptyView(),
  count: 0
});

const emptyBonds = (): BondSnapshot => ({
  first: emptyView(),
  second: emptyView(),
  count: 0
});

const emptyBox = (): BoxSnapshot => ({
  matrix: emptyView(),
  origin: emptyView(),
  lengths: emptyView(),
  dimension: 3
});

function createHarness(options: { runScriptImpl?: () => void } = {}): Harness {
  const runScript = options.runScriptImpl ? vi.fn(options.runScriptImpl) : vi.fn();
  const setAsyncStepCallback = vi.fn();
  const installAsyncFix = vi.fn();

  const instance: Partial<LAMMPSWeb> = {
    start: vi.fn(),
    stop: vi.fn(),
    advance: vi.fn(),
    runCommand: vi.fn(),
    runScript,
    runFile: vi.fn(),
    setAsyncStepCallback,
    setAsyncStepFrequency: vi.fn(() => false),
    installAsyncFix,
    isReady: vi.fn(() => true),
    getIsRunning: vi.fn(() => false),
    getCurrentStep: vi.fn(() => 0),
    getTimestepSize: vi.fn(() => 0),
    getComputeScalar: vi.fn(() => Number.NaN),
    syncParticles: vi.fn(emptyParticles),
    syncParticlesWrapped: vi.fn(emptyParticles),
    syncBonds: vi.fn(emptyBonds),
    syncBondsWrapped: vi.fn(emptyBonds),
    syncSimulationBox: vi.fn(emptyBox)
  };

  const module: Partial<LammpsModule> = {
    HEAPF32: new Float32Array(16),
    HEAPF64: new Float64Array(16),
    HEAP32: new Int32Array(16),
    HEAP64: new BigInt64Array(16),
    ScalarType: {
      Float32: 0,
      Float64: 1,
      Int32: 2,
      Int64: 3
    } as unknown as LammpsModule["ScalarType"],
    FS: {
      mkdir: vi.fn(),
      chdir: vi.fn(),
      writeFile: vi.fn(),
      unlink: vi.fn(),
      readFile: vi.fn(() => "")
    } as unknown as LammpsModule["FS"]
  };

  return {
    client: new LammpsClient(
      module as unknown as LammpsModule,
      instance as unknown as LAMMPSWeb
    ),
    runScript,
    setAsyncStepCallback,
    installAsyncFix,
  };
}

describe("LammpsClient js/async fix management", () => {
  it("installs the fix and runs the script unmodified", async () => {
    const { client, runScript, setAsyncStepCallback, installAsyncFix } = createHarness();

    await client.runScriptAsync(
      "minimize 0.0 1.0e-6 50 200",
      null,
      { every: 5, fixId: "jsasync" }
    );

    expect(installAsyncFix).toHaveBeenCalledWith("jsasync", 5);
    expect(runScript).toHaveBeenCalledTimes(1);
    expect(runScript).toHaveBeenCalledWith("minimize 0.0 1.0e-6 50 200\n");
    expect(setAsyncStepCallback).toHaveBeenLastCalledWith(undefined, undefined);
  });

  it("retunes the fix on subsequent runs", async () => {
    const { client, runScript, installAsyncFix } = createHarness();

    await client.runScriptAsync("run 10", null, { every: 5, fixId: "jsasync" });
    await client.runScriptAsync("run 10", null, { every: 3, fixId: "jsasync" });

    expect(installAsyncFix).toHaveBeenNthCalledWith(1, "jsasync", 5);
    expect(installAsyncFix).toHaveBeenNthCalledWith(2, "jsasync", 3);
    expect(runScript).toHaveBeenNthCalledWith(1, "run 10\n");
    expect(runScript).toHaveBeenNthCalledWith(2, "run 10\n");
  });

  it("installs even when the run lives in an include'd file", async () => {
    const { client, runScript, installAsyncFix } = createHarness();

    await client.runScriptAsync(
      "include /setup-and-run.in",
      null,
      { every: 2, fixId: "jsasync" }
    );

    expect(installAsyncFix).toHaveBeenCalledWith("jsasync", 2);
    expect(runScript).toHaveBeenCalledWith("include /setup-and-run.in\n");
  });

  it("leaves scripts that manage their own js/async fix alone", async () => {
    const { client, runScript, installAsyncFix } = createHarness();

    await client.runScriptAsync(
      "fix jsasync all js/async 7\nrun 10\nunfix jsasync",
      null,
      { every: 5, fixId: "jsasync" }
    );

    expect(installAsyncFix).not.toHaveBeenCalled();
    expect(runScript).toHaveBeenCalledWith(
      "fix jsasync all js/async 7\nrun 10\nunfix jsasync\n"
    );
  });

  it("clears callback when runScript throws synchronously", async () => {
    const boom = new Error("boom");
    const { client, setAsyncStepCallback } = createHarness({
      runScriptImpl: () => {
        throw boom;
      },
    });

    expect(() =>
      client.runScriptAsync(
        "run 1",
        () => Promise.resolve(),
        { every: 1, fixId: "jsasync" }
      )
    ).toThrow("boom");

    expect(setAsyncStepCallback).toHaveBeenLastCalledWith(undefined, undefined);
  });
});
