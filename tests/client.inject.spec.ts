import { describe, expect, it, vi } from "vitest";

import { LammpsClient } from "../dist/client.js";

type Harness = {
  client: LammpsClient;
  runScript: ReturnType<typeof vi.fn>;
  setAsyncStepCallback: ReturnType<typeof vi.fn>;
  setAsyncStepFrequency: ReturnType<typeof vi.fn>;
};

function createHarness(options: { runScriptImpl?: () => void; setFrequencyResult?: boolean } = {}): Harness {
  const runScript = options.runScriptImpl ? vi.fn(options.runScriptImpl) : vi.fn();
  const setAsyncStepCallback = vi.fn();
  const setAsyncStepFrequency = vi.fn(() => options.setFrequencyResult ?? false);

  const instance = {
    start() {},
    stop() {},
    advance() {},
    runCommand() {},
    runScript,
    runFile() {},
    setAsyncStepCallback,
    setAsyncStepFrequency,
    isReady() {
      return true;
    },
    getIsRunning() {
      return false;
    },
    getCurrentStep() {
      return 0;
    },
    getTimestepSize() {
      return 0.0;
    },
    getComputeScalar() {
      return Number.NaN;
    },
    syncParticles() {
      return {
        positions: { ptr: 0, length: 0, components: 3, type: 0 },
        ids: { ptr: 0, length: 0, components: 1, type: 2 },
        types: { ptr: 0, length: 0, components: 1, type: 2 },
        count: 0,
      };
    },
    syncParticlesWrapped() {
      return {
        positions: { ptr: 0, length: 0, components: 3, type: 0 },
        ids: { ptr: 0, length: 0, components: 1, type: 2 },
        types: { ptr: 0, length: 0, components: 1, type: 2 },
        count: 0,
      };
    },
    syncBonds() {
      return {
        first: { ptr: 0, length: 0, components: 3, type: 0 },
        second: { ptr: 0, length: 0, components: 3, type: 0 },
        count: 0,
      };
    },
    syncBondsWrapped() {
      return {
        first: { ptr: 0, length: 0, components: 3, type: 0 },
        second: { ptr: 0, length: 0, components: 3, type: 0 },
        count: 0,
      };
    },
    syncSimulationBox() {
      return {
        matrix: { ptr: 0, length: 0, components: 3, type: 0 },
        origin: { ptr: 0, length: 0, components: 1, type: 0 },
        lengths: { ptr: 0, length: 0, components: 1, type: 0 },
      };
    },
  } as any;

  const module = {
    HEAPF32: new Float32Array(0),
    HEAPF64: new Float64Array(0),
    HEAP32: new Int32Array(0),
    HEAP64: new BigInt64Array(0),
    ScalarType: { Float32: 0, Float64: 1, Int32: 2, Int64: 3 },
    FS: {
      mkdir() {},
      chdir() {},
      writeFile() {},
      unlink() {},
      readFile() {
        return "";
      },
    },
  } as any;

  return {
    client: new LammpsClient(module, instance),
    runScript,
    setAsyncStepCallback,
    setAsyncStepFrequency,
  };
}

describe("LammpsClient script injection", () => {
  it("injects js/async fix for minimize commands on first use", async () => {
    const { client, runScript, setAsyncStepCallback, setAsyncStepFrequency } = createHarness();

    await client.runScriptAsync(
      "minimize 0.0 1.0e-6 50 200",
      null,
      { every: 5, fixId: "jsasync" }
    );

    expect(runScript).toHaveBeenCalledTimes(1);
    expect(runScript).toHaveBeenCalledWith(
      "fix jsasync all js/async 5\nminimize 0.0 1.0e-6 50 200\n"
    );
    expect(setAsyncStepFrequency).not.toHaveBeenCalled();
    expect(setAsyncStepCallback).toHaveBeenLastCalledWith(undefined, undefined);
  });

  it("reuses managed js/async fix on subsequent runs", async () => {
    const { client, runScript, setAsyncStepFrequency } = createHarness({ setFrequencyResult: true });

    await client.runScriptAsync(
      "minimize 0.0 1.0e-6 50 200",
      null,
      { every: 5, fixId: "jsasync" }
    );
    await client.runScriptAsync(
      "minimize 0.0 1.0e-6 50 200",
      null,
      { every: 3, fixId: "jsasync" }
    );

    expect(runScript).toHaveBeenNthCalledWith(
      1,
      "fix jsasync all js/async 5\nminimize 0.0 1.0e-6 50 200\n"
    );
    expect(runScript).toHaveBeenNthCalledWith(2, "minimize 0.0 1.0e-6 50 200\n");
    expect(setAsyncStepFrequency).toHaveBeenCalledWith("jsasync", 3);
  });

  it("treats unfix before minimize as pre-hook cleanup", async () => {
    const { client, runScript, setAsyncStepFrequency } = createHarness({ setFrequencyResult: true });

    await client.runScriptAsync(
      "unfix jsasync\nminimize 0.0 1.0e-6 50 200",
      null,
      { every: 5, fixId: "jsasync" }
    );
    await client.runScriptAsync(
      "minimize 0.0 1.0e-6 50 200",
      null,
      { every: 3, fixId: "jsasync" }
    );

    expect(runScript).toHaveBeenNthCalledWith(
      1,
      "unfix jsasync\nfix jsasync all js/async 5\nminimize 0.0 1.0e-6 50 200\n"
    );
    expect(runScript).toHaveBeenNthCalledWith(2, "minimize 0.0 1.0e-6 50 200\n");
    expect(setAsyncStepFrequency).toHaveBeenCalledWith("jsasync", 3);
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
