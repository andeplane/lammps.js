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
import type { AsyncStepData, LammpsClientOptions } from "../dist/client.js";

const Scalar = {
  Float32: 0,
  Float64: 1,
  Int32: 2,
  Int64: 3
} as unknown as LammpsModule["ScalarType"];

function view(ptr: number, length: number, components: number, type: number): BufferView {
  return { ptr, length, components, type: type as unknown as BufferView["type"] };
}

const emptyView = (): BufferView => view(0, 0, 0, 0);

function emptyParticles(): ParticleSnapshot {
  return { positions: emptyView(), ids: emptyView(), types: emptyView(), count: 0 };
}

function emptyBonds(): BondSnapshot {
  return { first: emptyView(), second: emptyView(), count: 0 };
}

function emptyBox(): BoxSnapshot {
  return { matrix: emptyView(), origin: emptyView(), lengths: emptyView() };
}

interface ModuleMockOptions {
  withHeap64?: boolean;
}

function createModuleMock(options: ModuleMockOptions = {}) {
  const buffer = new ArrayBuffer(1024);
  const fs = {
    mkdir: vi.fn(),
    chdir: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    readFile: vi.fn(() => "")
  };

  const moduleMock: Partial<LammpsModule> = {
    HEAPF32: new Float32Array(buffer),
    HEAPF64: new Float64Array(buffer),
    HEAP32: new Int32Array(buffer),
    ScalarType: Scalar,
    FS: fs
  };
  if (options.withHeap64 !== false) {
    moduleMock.HEAP64 = new BigInt64Array(buffer);
  }

  return { moduleMock, fs, buffer };
}

interface InstanceMockResult {
  instanceMock: Partial<LAMMPSWeb>;
  mocks: {
    start: Mock;
    startWithArgs: Mock;
    stop: Mock;
    advance: Mock;
    runCommand: Mock;
    runScript: Mock;
    runFile: Mock;
    setAsyncStepCallback: Mock;
    setAsyncStepFrequency: Mock;
    installAsyncFix: Mock;
    getComputeScalar: Mock;
    getCurrentStep: Mock;
    getTimestepSize: Mock;
    syncParticles: Mock;
    syncParticlesWrapped: Mock;
    syncBonds: Mock;
    syncBondsWrapped: Mock;
    syncSimulationBox: Mock;
  };
}

function createInstanceMock(overrides: Partial<LAMMPSWeb> = {}): InstanceMockResult {
  const mocks = {
    start: vi.fn(),
    startWithArgs: vi.fn(),
    stop: vi.fn(),
    advance: vi.fn(),
    runCommand: vi.fn(),
    runScript: vi.fn(),
    runFile: vi.fn(),
    setAsyncStepCallback: vi.fn(),
    setAsyncStepFrequency: vi.fn(() => false),
    installAsyncFix: vi.fn(),
    getComputeScalar: vi.fn(() => Number.NaN),
    getCurrentStep: vi.fn(() => 0),
    getTimestepSize: vi.fn(() => 0),
    syncParticles: vi.fn(emptyParticles),
    syncParticlesWrapped: vi.fn(emptyParticles),
    syncBonds: vi.fn(emptyBonds),
    syncBondsWrapped: vi.fn(emptyBonds),
    syncSimulationBox: vi.fn(emptyBox)
  };

  const instanceMock: Partial<LAMMPSWeb> = { ...mocks, ...overrides };
  return { instanceMock, mocks };
}

function createClient(
  moduleMock: Partial<LammpsModule>,
  instanceMock: Partial<LAMMPSWeb>,
  options: LammpsClientOptions = {}
): LammpsClient {
  return new LammpsClient(
    moduleMock as unknown as LammpsModule,
    instanceMock as unknown as LAMMPSWeb,
    options
  );
}

type StepCallback = (step: number | bigint) => void | Promise<void>;
type Waiter = (promise: Promise<unknown>, donePtr: number, errPtr: number) => void;

function lastRegisteredCallback(setAsyncStepCallback: Mock): {
  callback: StepCallback;
  waiter: Waiter;
} {
  const call = setAsyncStepCallback.mock.calls[0];
  return {
    callback: call[0] as unknown as StepCallback,
    waiter: call[1] as unknown as Waiter
  };
}

describe("LammpsClient constructor", () => {
  it("creates and enters the default workdir", () => {
    const { moduleMock, fs } = createModuleMock();
    const { instanceMock } = createInstanceMock();

    const client = createClient(moduleMock, instanceMock);

    expect(client.workdir).toBe("/work");
    expect(fs.mkdir).toHaveBeenCalledWith("/work");
    expect(fs.chdir).toHaveBeenCalledWith("/work");
  });

  it("honors a custom workdir", () => {
    const { moduleMock, fs } = createModuleMock();
    const { instanceMock } = createInstanceMock();

    const client = createClient(moduleMock, instanceMock, { workdir: "/sim" });

    expect(client.workdir).toBe("/sim");
    expect(fs.mkdir).toHaveBeenCalledWith("/sim");
    expect(fs.chdir).toHaveBeenCalledWith("/sim");
  });

  it("ignores mkdir failures for pre-existing directories", () => {
    const { moduleMock, fs } = createModuleMock();
    fs.mkdir.mockImplementation(() => {
      throw new Error("EEXIST");
    });
    const { instanceMock } = createInstanceMock();

    expect(() => createClient(moduleMock, instanceMock)).not.toThrow();
    expect(fs.chdir).toHaveBeenCalledWith("/work");
  });
});

describe("LammpsClient lifecycle and delegation", () => {
  it("delegates start/stop and supports chaining", () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    const client = createClient(moduleMock, instanceMock);

    expect(client.start()).toBe(client);
    expect(client.stop()).toBe(client);
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it("start() with kokkos options uses startWithArgs", () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    const client = createClient(moduleMock, instanceMock, { kokkos: { threads: 4 } });

    client.start();

    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.startWithArgs).toHaveBeenCalledWith(["-k", "on", "t", "4", "-sf", "kk"]);
  });

  it('variant: "kokkos" starts with Kokkos args like kokkos: true', () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    const client = createClient(moduleMock, instanceMock, { variant: "kokkos" });

    client.start();

    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.startWithArgs).toHaveBeenCalledTimes(1);
    const args = mocks.startWithArgs.mock.calls[0][0] as string[];
    expect(args.slice(0, 3)).toEqual(["-k", "on", "t"]);
    expect(args.slice(4)).toEqual(["-sf", "kk"]);
  });

  it('variant: "atomify" is a threaded build: starts with Kokkos args, kokkos option tunes them', () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    const client = createClient(moduleMock, instanceMock, {
      variant: "atomify",
      kokkos: { threads: 4 }
    });

    client.start();

    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.startWithArgs).toHaveBeenCalledWith(["-k", "on", "t", "4", "-sf", "kk"]);
  });

  it('explicit variant: "serial" wins over kokkos: true (plain start)', () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    const client = createClient(moduleMock, instanceMock, {
      variant: "serial",
      kokkos: true
    });

    client.start();

    expect(mocks.startWithArgs).not.toHaveBeenCalled();
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });

  it("clamps kokkos threads to the pthread pool size and honors suffix: false", () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    const client = createClient(moduleMock, instanceMock, {
      kokkos: { threads: 32, suffix: false }
    });

    client.start();

    expect(mocks.startWithArgs).toHaveBeenCalledWith(["-k", "on", "t", "8"]);
  });

  it("dispose stops the instance", () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    const client = createClient(moduleMock, instanceMock);

    client.dispose();

    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it("advance defaults to one step without pre/post", () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    const client = createClient(moduleMock, instanceMock);

    client.advance();
    client.advance(5, { applyPre: true, applyPost: true });

    expect(mocks.advance).toHaveBeenNthCalledWith(1, 1, false, false);
    expect(mocks.advance).toHaveBeenNthCalledWith(2, 5, true, true);
  });

  it("runCommand passes the command through unchanged", () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    const client = createClient(moduleMock, instanceMock);

    client.runCommand("run 1");

    expect(mocks.runCommand).toHaveBeenCalledWith("run 1");
  });

  it("runScript normalizes the trailing newline", () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    const client = createClient(moduleMock, instanceMock);

    client.runScript("units lj");
    client.runScript("units lj\n");

    expect(mocks.runScript).toHaveBeenNthCalledWith(1, "units lj\n");
    expect(mocks.runScript).toHaveBeenNthCalledWith(2, "units lj\n");
  });

  it("runInput writes the file before running it", () => {
    const { moduleMock, fs } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    const client = createClient(moduleMock, instanceMock);

    client.runInput("in.lj", "units lj\n");

    expect(fs.writeFile).toHaveBeenCalledWith("in.lj", "units lj\n");
    expect(mocks.runFile).toHaveBeenCalledWith("in.lj");
    expect(fs.writeFile.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.runFile.mock.invocationCallOrder[0]
    );
  });

  it("writeFile and removeFile delegate to the module FS", () => {
    const { moduleMock, fs } = createModuleMock();
    const { instanceMock } = createInstanceMock();
    const client = createClient(moduleMock, instanceMock);

    client.writeFile("data.txt", "abc");
    client.removeFile("data.txt");

    expect(fs.writeFile).toHaveBeenCalledWith("data.txt", "abc");
    expect(fs.unlink).toHaveBeenCalledWith("data.txt");
  });

  it("delegates step and timestep getters", () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    mocks.getCurrentStep.mockReturnValue(42);
    mocks.getTimestepSize.mockReturnValue(0.005);
    const client = createClient(moduleMock, instanceMock);

    expect(client.getCurrentStep()).toBe(42);
    expect(client.getTimestepSize()).toBe(0.005);
  });

  it("setAsyncStepFrequency uses the default fix id", () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    mocks.setAsyncStepFrequency.mockReturnValue(true);
    const client = createClient(moduleMock, instanceMock);

    expect(client.setAsyncStepFrequency(10)).toBe(true);
    expect(client.setAsyncStepFrequency(4, "myfix")).toBe(true);

    expect(mocks.setAsyncStepFrequency).toHaveBeenNthCalledWith(1, "jsasync", 10);
    expect(mocks.setAsyncStepFrequency).toHaveBeenNthCalledWith(2, "myfix", 4);
  });
});

describe("LammpsClient compute scalars", () => {
  it("returns finite values and null for non-finite ones", () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    mocks.getComputeScalar
      .mockReturnValueOnce(2.5)
      .mockReturnValueOnce(Number.NaN)
      .mockReturnValueOnce(Number.POSITIVE_INFINITY);
    const client = createClient(moduleMock, instanceMock);

    expect(client.getComputeScalar("a")).toBe(2.5);
    expect(client.getComputeScalar("b")).toBeNull();
    expect(client.getComputeScalar("c")).toBeNull();
  });

  it("collects multiple scalars into a record", () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    mocks.getComputeScalar.mockImplementation((id: string) =>
      id === "temp" ? 1.5 : Number.NaN
    );
    const client = createClient(moduleMock, instanceMock);

    expect(client.getComputeScalars(["temp", "missing"])).toEqual({
      temp: 1.5,
      missing: null
    });
  });
});

describe("LammpsClient snapshot views", () => {
  it("maps particle snapshots onto the heap without copying by default", () => {
    const { moduleMock } = createModuleMock();
    const positions = view(64, 6, 3, 0);
    const ids = view(128, 2, 1, 2);
    const types = view(160, 2, 1, 2);

    const heapF32 = moduleMock.HEAPF32 as Float32Array;
    const heap32 = moduleMock.HEAP32 as Int32Array;
    heapF32.set([1, 2, 3, 4, 5, 6], 64 >> 2);
    heap32.set([11, 22], 128 >> 2);
    heap32.set([1, 2], 160 >> 2);

    const { instanceMock, mocks } = createInstanceMock();
    mocks.syncParticles.mockReturnValue({ positions, ids, types, count: 2 });
    const client = createClient(moduleMock, instanceMock);

    const particles = client.syncParticles();

    expect(particles.count).toBe(2);
    expect(Array.from(particles.positions)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(particles.ids as Int32Array)).toEqual([11, 22]);
    expect(Array.from(particles.types)).toEqual([1, 2]);
    // No copy: the view shares memory with the module heap.
    expect(particles.positions.buffer).toBe(heapF32.buffer);
    heapF32[64 >> 2] = 99;
    expect(particles.positions[0]).toBe(99);
    expect(particles.snapshot.count).toBe(2);
  });

  it("reads live heap views after WASM memory growth detaches the old buffer", () => {
    const { moduleMock } = createModuleMock();
    const positions = view(64, 3, 3, 0);

    const { instanceMock, mocks } = createInstanceMock();
    mocks.syncParticles.mockReturnValue({
      positions,
      ids: emptyView(),
      types: emptyView(),
      count: 1
    });
    const client = createClient(moduleMock, instanceMock);

    // Simulate Emscripten memory growth: a new, larger buffer replaces the old
    // one, the module's HEAP* views are reassigned, and the old buffer is
    // detached (transferred). A client that cached the old views would now
    // throw "Cannot perform Construct on a detached ArrayBuffer".
    const oldBuffer = moduleMock.HEAPF32!.buffer;
    const grownBuffer = new ArrayBuffer(4096);
    moduleMock.HEAPF32 = new Float32Array(grownBuffer);
    moduleMock.HEAPF64 = new Float64Array(grownBuffer);
    moduleMock.HEAP32 = new Int32Array(grownBuffer);
    moduleMock.HEAP64 = new BigInt64Array(grownBuffer);
    structuredClone(oldBuffer, { transfer: [oldBuffer] });
    expect(oldBuffer.byteLength).toBe(0); // confirm detachment

    moduleMock.HEAPF32.set([7, 8, 9], 64 >> 2);

    expect(() => client.syncParticles()).not.toThrow();
    const particles = client.syncParticles();

    expect(Array.from(particles.positions)).toEqual([7, 8, 9]);
    expect(particles.positions.buffer).toBe(grownBuffer);
  });

  it("returns detached arrays when copy is requested", () => {
    const { moduleMock } = createModuleMock();
    const positions = view(64, 3, 3, 0);
    const heapF32 = moduleMock.HEAPF32 as Float32Array;
    heapF32.set([7, 8, 9], 64 >> 2);

    const { instanceMock, mocks } = createInstanceMock();
    mocks.syncParticles.mockReturnValue({
      positions,
      ids: emptyView(),
      types: emptyView(),
      count: 1
    });
    const client = createClient(moduleMock, instanceMock);

    const particles = client.syncParticles({ copy: true });

    expect(Array.from(particles.positions)).toEqual([7, 8, 9]);
    expect(particles.positions.buffer).not.toBe(heapF32.buffer);
    heapF32[64 >> 2] = 0;
    expect(particles.positions[0]).toBe(7);
  });

  it("uses the wrapped snapshot when requested", () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    const client = createClient(moduleMock, instanceMock);

    client.syncParticles({ wrapped: true });
    client.syncBonds({ wrapped: true });

    expect(mocks.syncParticlesWrapped).toHaveBeenCalledTimes(1);
    expect(mocks.syncParticles).not.toHaveBeenCalled();
    expect(mocks.syncBondsWrapped).toHaveBeenCalledTimes(1);
    expect(mocks.syncBonds).not.toHaveBeenCalled();
  });

  it("reads 64-bit ids from the 64-bit heap when available", () => {
    const { moduleMock } = createModuleMock();
    const heap64 = moduleMock.HEAP64 as BigInt64Array;
    heap64.set([101n, 202n], 512 >> 3);

    const { instanceMock, mocks } = createInstanceMock();
    mocks.syncParticles.mockReturnValue({
      positions: emptyView(),
      ids: view(512, 2, 1, 3),
      types: emptyView(),
      count: 2
    });
    const client = createClient(moduleMock, instanceMock);

    const particles = client.syncParticles();

    expect(particles.ids).toBeInstanceOf(BigInt64Array);
    expect(Array.from(particles.ids as BigInt64Array)).toEqual([101n, 202n]);
  });

  it("falls back to the 32-bit heap when no 64-bit heap exists", () => {
    const { moduleMock } = createModuleMock({ withHeap64: false });
    const heap32 = moduleMock.HEAP32 as Int32Array;
    heap32.set([7, 8], 128 >> 2);

    const { instanceMock, mocks } = createInstanceMock();
    mocks.syncParticles.mockReturnValue({
      positions: emptyView(),
      ids: view(128, 2, 1, 3),
      types: emptyView(),
      count: 2
    });
    const client = createClient(moduleMock, instanceMock);

    const particles = client.syncParticles();

    expect(particles.ids).toBeInstanceOf(Int32Array);
  });

  it("returns empty arrays for null buffer views", () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock } = createInstanceMock();
    const client = createClient(moduleMock, instanceMock);

    const particles = client.syncParticles();
    const bonds = client.syncBonds();

    expect(particles.positions.length).toBe(0);
    expect(particles.ids.length).toBe(0);
    expect(bonds.first.length).toBe(0);
    expect(bonds.second.length).toBe(0);
  });

  it("maps bond snapshots onto the heap", () => {
    const { moduleMock } = createModuleMock();
    const heapF32 = moduleMock.HEAPF32 as Float32Array;
    heapF32.set([1, 1, 1], 192 >> 2);
    heapF32.set([2, 2, 2], 256 >> 2);

    const { instanceMock, mocks } = createInstanceMock();
    mocks.syncBonds.mockReturnValue({
      first: view(192, 3, 3, 0),
      second: view(256, 3, 3, 0),
      count: 1
    });
    const client = createClient(moduleMock, instanceMock);

    const bonds = client.syncBonds();

    expect(bonds.count).toBe(1);
    expect(Array.from(bonds.first)).toEqual([1, 1, 1]);
    expect(Array.from(bonds.second)).toEqual([2, 2, 2]);
  });

  it("maps box snapshots onto the heap", () => {
    const { moduleMock } = createModuleMock();
    const heapF32 = moduleMock.HEAPF32 as Float32Array;
    heapF32.set([10, 0, 0, 0, 10, 0, 0, 0, 10], 320 >> 2);
    heapF32.set([-5, -5, -5], 384 >> 2);
    heapF32.set([10, 10, 10], 448 >> 2);

    const { instanceMock, mocks } = createInstanceMock();
    mocks.syncSimulationBox.mockReturnValue({
      matrix: view(320, 9, 3, 0),
      origin: view(384, 3, 3, 0),
      lengths: view(448, 3, 3, 0)
    });
    const client = createClient(moduleMock, instanceMock);

    const box = client.syncBox({ copy: true });

    expect(Array.from(box.matrix)).toEqual([10, 0, 0, 0, 10, 0, 0, 0, 10]);
    expect(Array.from(box.origin)).toEqual([-5, -5, -5]);
    expect(Array.from(box.lengths)).toEqual([10, 10, 10]);
  });
});

describe("LammpsClient runScriptAsync", () => {
  it("runs scripts unmodified and installs the fix up front", async () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    const client = createClient(moduleMock, instanceMock);

    await client.runScriptAsync("units lj", null, { every: 5 });

    expect(mocks.runScript).toHaveBeenCalledWith("units lj\n");
    expect(mocks.installAsyncFix).toHaveBeenCalledWith("jsasync", 5);
    expect(mocks.setAsyncStepCallback).toHaveBeenLastCalledWith(undefined, undefined);
  });

  it("does not inject when the script already defines the fix", async () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    const client = createClient(moduleMock, instanceMock);

    await client.runScriptAsync("fix jsasync all js/async 7\nrun 5", null, { every: 2 });

    expect(mocks.runScript).toHaveBeenCalledWith("fix jsasync all js/async 7\nrun 5\n");
    expect(mocks.installAsyncFix).not.toHaveBeenCalled();
  });

  it("reinstalls the fix after a script that unfixes it", async () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    const client = createClient(moduleMock, instanceMock);

    await client.runScriptAsync("run 5\nunfix jsasync", null, { every: 2 });
    await client.runScriptAsync("run 5", null, { every: 2 });

    expect(mocks.installAsyncFix).toHaveBeenCalledTimes(2);
    expect(mocks.runScript).toHaveBeenNthCalledWith(1, "run 5\nunfix jsasync\n");
    expect(mocks.runScript).toHaveBeenNthCalledWith(2, "run 5\n");
  });

  it("invokes the callback with snapshot data and compute scalars", async () => {
    const { moduleMock } = createModuleMock();
    const heapF32 = moduleMock.HEAPF32 as Float32Array;
    heapF32.set([1, 2, 3], 64 >> 2);

    const { instanceMock, mocks } = createInstanceMock();
    mocks.syncParticles.mockReturnValue({
      positions: view(64, 3, 3, 0),
      ids: emptyView(),
      types: emptyView(),
      count: 1
    });
    mocks.getComputeScalar.mockReturnValue(1.5);

    let resolveRun!: () => void;
    mocks.runScript.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRun = resolve;
      })
    );

    const client = createClient(moduleMock, instanceMock);
    const received: AsyncStepData[] = [];

    const pending = client.runScriptAsync(
      "run 10",
      (data) => {
        received.push(data);
      },
      { every: 2, computeScalars: ["temp"] }
    );

    const { callback } = lastRegisteredCallback(mocks.setAsyncStepCallback);
    await callback(4n);
    await callback(6);

    resolveRun();
    await pending;

    expect(received).toHaveLength(2);
    expect(received[0].step).toBe(4);
    expect(received[1].step).toBe(6);
    expect(Array.from(received[0].particles?.positions ?? [])).toEqual([1, 2, 3]);
    expect(received[0].computeScalars).toEqual({ temp: 1.5 });
    // Callback data is copied by default: mutating the heap afterwards
    // must not change what the callback captured.
    heapF32[64 >> 2] = 42;
    expect(received[0].particles?.positions[0]).toBe(1);
    expect(mocks.setAsyncStepCallback).toHaveBeenLastCalledWith(undefined, undefined);
  });

  it("provides a waiter that flags completion and failure in the heap", async () => {
    const { moduleMock } = createModuleMock();
    const heap32 = moduleMock.HEAP32 as Int32Array;
    const { instanceMock, mocks } = createInstanceMock();

    let resolveRun!: () => void;
    mocks.runScript.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRun = resolve;
      })
    );

    const client = createClient(moduleMock, instanceMock);
    const pending = client.runScriptAsync("run 1", () => undefined, { every: 1 });
    const { waiter } = lastRegisteredCallback(mocks.setAsyncStepCallback);

    waiter(Promise.resolve(), 800, 804);
    await vi.waitFor(() => {
      expect(heap32[800 >> 2]).toBe(1);
    });
    expect(heap32[804 >> 2]).toBe(0);

    const failure = new Error("callback failed");
    waiter(Promise.reject(failure), 808, 812);
    await vi.waitFor(() => {
      expect(heap32[808 >> 2]).toBe(1);
    });
    expect(heap32[812 >> 2]).toBe(1);
    expect(moduleMock.__lammpsAsyncError).toBe(failure);

    resolveRun();
    await pending;
  });

  it("clears the callback and rethrows when the run fails", async () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    mocks.runScript.mockReturnValue(Promise.reject(new Error("run failed")));
    const client = createClient(moduleMock, instanceMock);

    await expect(
      client.runScriptAsync("run 10", () => undefined, { every: 1 })
    ).rejects.toThrow("run failed");

    expect(mocks.setAsyncStepCallback).toHaveBeenLastCalledWith(undefined, undefined);
  });

  it("keeps runs after a failure working (fix reinstalled per call)", async () => {
    const { moduleMock } = createModuleMock();
    const { instanceMock, mocks } = createInstanceMock();
    mocks.runScript
      .mockReturnValueOnce(Promise.reject(new Error("run failed")))
      .mockReturnValueOnce(undefined);
    const client = createClient(moduleMock, instanceMock);

    await expect(client.runScriptAsync("run 10", null, { every: 1 })).rejects.toThrow(
      "run failed"
    );
    await client.runScriptAsync("run 10", null, { every: 3 });

    expect(mocks.runScript).toHaveBeenNthCalledWith(2, "run 10\n");
    expect(mocks.installAsyncFix).toHaveBeenLastCalledWith("jsasync", 3);
  });
});
