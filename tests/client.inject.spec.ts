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
  setAsyncStepFrequency: Mock;
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
  lengths: emptyView()
});

function createHarness(options: { runScriptImpl?: () => void; setFrequencyResult?: boolean } = {}): Harness {
  const runScript = options.runScriptImpl ? vi.fn(options.runScriptImpl) : vi.fn();
  const setAsyncStepCallback = vi.fn();
  const setAsyncStepFrequency = vi.fn(() => options.setFrequencyResult ?? false);

  const instance: Partial<LAMMPSWeb> = {
    start: vi.fn(),
    stop: vi.fn(),
    advance: vi.fn(),
    runCommand: vi.fn(),
    runScript,
    runFile: vi.fn(),
    setAsyncStepCallback,
    setAsyncStepFrequency,
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
    }
  };

  return {
    client: new LammpsClient(
      module as unknown as LammpsModule,
      instance as unknown as LAMMPSWeb
    ),
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
