import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { BufferView, LAMMPSWeb, LammpsModule } from "../types";
import { LammpsClient } from "../dist/client.js";
import { loadModule } from "./helpers/lammps";

const fixturePath = join(process.cwd(), "tests", "fixtures", "lj.mini.in");
const ASYNC_CALLBACK_EVERY = 2;
const ASYNC_CALLBACK_DELAY_MS = 25;
const ASYNC_CALLBACK_TIMEOUT_MS = 2000;
const ASYNC_CALLBACK_MIN_ELAPSED_MS = 40;
const ASYNC_RUN_STEPS = 4;
const ASYNC_DATA_CALLBACK_EVERY = 1;
const ASYNC_DATA_RUN_STEPS = 2;
const ASYNC_MINIMIZE_CALLBACK_EVERY = 1;
const ASYNC_DYNAMIC_EVERY_INITIAL = 3;
const ASYNC_DYNAMIC_EVERY_UPDATED = 1;
const ASYNC_DYNAMIC_RUN_STEPS = 6;

let wasm: LammpsModule;
let lmp: LAMMPSWeb;
let client: LammpsClient;

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}
const resolveView = (module: LammpsModule, view: BufferView) => {
  if (!view.ptr || !view.length) {
    return null;
  }

  const { ScalarType } = module;
  switch (view.type) {
    case ScalarType.Float32: {
      const start = view.ptr >> 2;
      return module.HEAPF32.subarray(start, start + view.length);
    }
    case ScalarType.Float64: {
      const start = view.ptr >> 3;
      return module.HEAPF64.subarray(start, start + view.length);
    }
    case ScalarType.Int32: {
      const start = view.ptr >> 2;
      return module.HEAP32.subarray(start, start + view.length);
    }
    case ScalarType.Int64: {
      const start = view.ptr >> 3;
      return module.HEAP64.subarray(start, start + view.length);
    }
    default:
      return null;
  }
};

beforeAll(async () => {
  const script = readFileSync(fixturePath, "utf8");
  wasm = await loadModule();

  try {
    wasm.FS.mkdir("/work");
  } catch {
    // ignore if already exists
  }
  wasm.FS.chdir("/work");
  wasm.FS.writeFile("in.lj", script);

  lmp = new wasm.LAMMPSWeb();
  lmp.start();
  lmp.runFile("in.lj");

  client = new LammpsClient(wasm, new wasm.LAMMPSWeb());
  client.start();
  client.runInput("in.lj", script);
});

afterAll(() => {
  client?.dispose();
  lmp?.stop();
});

describe("lammps.js wasm interface", () => {
  it("exposes particles after running the LJ sample", () => {
    const particles = lmp.syncParticles();
    expect(particles.count).toBeGreaterThan(0);
    const positions =
      (resolveView(wasm, particles.positions) as Float32Array | null) ??
      new Float32Array(0);
    expect(positions.length).toBe(particles.count * 3);
  });

  it("provides simulation box information", () => {
    const box = lmp.syncSimulationBox();
    const origin =
      (resolveView(wasm, box.origin) as Float32Array | null) ??
      new Float32Array(0);
    const lengths =
      (resolveView(wasm, box.lengths) as Float32Array | null) ??
      new Float32Array(0);
    expect(origin.length).toBe(3);
    expect(lengths.length).toBe(3);
    expect(lengths[0]).toBeGreaterThan(0);
  });

  it("advances timesteps via advance()", () => {
    const before = lmp.getCurrentStep();
    lmp.advance(3, false, false);
    const after = lmp.getCurrentStep();
    expect(after).toBeCloseTo(before + 3);
  });

  it("returns bond snapshots even when no bonds exist", () => {
    const bonds = lmp.syncBonds();
    expect(bonds.count).toBeGreaterThanOrEqual(0);
    const first =
      (resolveView(wasm, bonds.first) as Float32Array | null) ??
      new Float32Array(0);
    const second =
      (resolveView(wasm, bonds.second) as Float32Array | null) ??
      new Float32Array(0);
    expect(first.length).toBe(bonds.count * 3);
    expect(second.length).toBe(bonds.count * 3);
  });

  it("supports wrapped snapshots", () => {
    const wrappedParticles = lmp.syncParticlesWrapped();
    expect(wrappedParticles.count).toBeGreaterThan(0);
    const wrappedBonds = lmp.syncBondsWrapped();
    expect(wrappedBonds.count).toBeGreaterThanOrEqual(0);
  });

  it("extracts compute scalar values", () => {
    lmp.runCommand("compute test_temp all temp");
    lmp.runCommand("run 0");
    const temp = lmp.getComputeScalar("test_temp");
    expect(Number.isFinite(temp)).toBe(true);
    expect(temp).toBeGreaterThan(0);
    lmp.runCommand("uncompute test_temp");
  });

  it("allows async JS callbacks during run", async () => {
    let calls = 0;
    let resolveDone: (() => void) | null = null;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const timeout = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error("async callback timeout")), ASYNC_CALLBACK_TIMEOUT_MS);
    });

    const waiter = (promise: Promise<unknown>, donePtr: number, errPtr: number) => {
      promise.then(
        () => {
          wasm.HEAP32[donePtr >> 2] = 1;
        },
        () => {
          wasm.HEAP32[errPtr >> 2] = 1;
          wasm.HEAP32[donePtr >> 2] = 1;
        }
      );
    };

    lmp.setAsyncStepCallback(() => {
      calls += 1;
      if (calls === 2 && resolveDone) {
        resolveDone();
      }
      return Promise.resolve();
    }, waiter);

    // Under ASYNCIFY the embind binding may return a promise even though
    // the declared return type is void.
    const maybe: unknown = lmp.runScript(`
      fix jsasync all js/async ${ASYNC_CALLBACK_EVERY}
      run ${ASYNC_RUN_STEPS}
      unfix jsasync
    `);
    if (isPromiseLike(maybe)) {
      await maybe;
    }

    await Promise.race([done, timeout]);

    expect(calls).toBe(2);

    lmp.setAsyncStepCallback(undefined, undefined);
  });
});

describe("LammpsClient helper", () => {
  it("exposes particle arrays", () => {
    const { count, positions } = client.syncParticles({ copy: true });
    expect(count).toBeGreaterThan(0);
    expect(positions).toBeInstanceOf(Float32Array);
  });

  it("supports wrapped particle data", () => {
    const wrapped = client.syncParticles({ wrapped: true, copy: true });
    expect(wrapped.count).toBeGreaterThan(0);
  });

  it("returns bond arrays", () => {
    const bonds = client.syncBonds({ wrapped: false, copy: true });
    expect(bonds.first.length).toBe(bonds.count * 3);
    expect(bonds.second.length).toBe(bonds.count * 3);
  });

  it("provides simulation box data", () => {
    const box = client.syncBox({ copy: true });
    expect(box.matrix.length).toBe(9);
    expect(box.origin.length).toBe(3);
    expect(box.lengths.length).toBe(3);
  });

  it("returns compute scalar values", () => {
    client.runCommand("compute client_temp all temp");
    client.runCommand("run 0");
    const temp = client.getComputeScalar("client_temp");
    expect(temp).not.toBeNull();
    expect(temp as number).toBeGreaterThan(0);
    client.runCommand("uncompute client_temp");
  });

  it("supports async step callbacks during run", async () => {
    let calls = 0;
    let delayed = false;
    let resolveDone: (() => void) | null = null;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const timeout = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error("async callback timeout")), ASYNC_CALLBACK_TIMEOUT_MS);
    });
    const start = Date.now();

    await client.runScriptAsync(
      `
        run ${ASYNC_RUN_STEPS}
      `,
      () => {
        calls += 1;
        if (calls === 2 && resolveDone) {
          resolveDone();
        }
        return new Promise<void>((resolve) => {
          setTimeout(() => {
            delayed = true;
            resolve();
          }, ASYNC_CALLBACK_DELAY_MS);
        });
      },
      { every: ASYNC_CALLBACK_EVERY }
    );

    await Promise.race([done, timeout]);

    expect(calls).toBe(2);
    expect(delayed).toBe(true);
    expect(Date.now() - start).toBeGreaterThanOrEqual(ASYNC_CALLBACK_MIN_ELAPSED_MS);

  });

  it("supports async step callbacks during minimize", async () => {
    let calls = 0;
    let resolveDone: (() => void) | null = null;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const timeout = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error("async minimize callback timeout")), ASYNC_CALLBACK_TIMEOUT_MS);
    });

    await client.runScriptAsync(
      `
        displace_atoms all random 0.1 0.1 0.1 12345 units box
        min_style cg
        minimize 0.0 1.0e-6 50 200
      `,
      (data) => {
        calls += 1;
        if (data.step >= 0) {
          resolveDone?.();
        }
        return Promise.resolve();
      },
      { every: ASYNC_MINIMIZE_CALLBACK_EVERY }
    );

    await Promise.race([done, timeout]);

    expect(calls).toBeGreaterThan(0);

  });

  it("provides snapshot data in async callbacks", async () => {
    let captured = null as null | {
      step: number;
      particlesCount: number;
      bondsCount: number;
      boxLengths: number;
    };
    let resolveDone: (() => void) | null = null;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const timeout = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error("async data callback timeout")), ASYNC_CALLBACK_TIMEOUT_MS);
    });

    await client.runScriptAsync(
      `
        run ${ASYNC_DATA_RUN_STEPS}
      `,
      (data) => {
        if (!captured) {
          captured = {
            step: data.step,
            particlesCount: data.particles?.count ?? 0,
            bondsCount: data.bonds?.count ?? 0,
            boxLengths: data.box?.lengths.length ?? 0,
          };
          resolveDone?.();
        }
        return Promise.resolve();
      },
      { every: ASYNC_DATA_CALLBACK_EVERY }
    );

    await Promise.race([done, timeout]);

    expect(captured?.step).toBeGreaterThan(0);
    expect(captured?.particlesCount).toBeGreaterThan(0);
    expect(captured?.bondsCount).toBeGreaterThanOrEqual(0);
    expect(captured?.boxLengths).toBe(3);

  });

  it("provides compute scalar data in async callbacks", async () => {
    let captured: number | null = null;
    let resolveDone: (() => void) | null = null;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const timeout = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error("async compute callback timeout")), ASYNC_CALLBACK_TIMEOUT_MS);
    });

    await client.runScriptAsync(
      `
        compute async_temp all temp
        run ${ASYNC_DATA_RUN_STEPS}
        uncompute async_temp
      `,
      (data) => {
        if (captured === null && data.computeScalars) {
          captured = data.computeScalars.async_temp ?? null;
          resolveDone?.();
        }
        return Promise.resolve();
      },
      { every: ASYNC_DATA_CALLBACK_EVERY, computeScalars: ["async_temp"] }
    );

    await Promise.race([done, timeout]);

    expect(captured).not.toBeNull();
    expect(captured ?? Number.NaN).toBeGreaterThan(0);

  });

  it("updates async step frequency while running", async () => {
    const steps: number[] = [];
    let resolveDone: (() => void) | null = null;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const timeout = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error("async frequency update timeout")), ASYNC_CALLBACK_TIMEOUT_MS);
    });

    const baseStep = client.getCurrentStep();
    const finishStep = baseStep + ASYNC_DYNAMIC_RUN_STEPS;
    const initialCallback = Math.ceil((baseStep + 1) / ASYNC_DYNAMIC_EVERY_INITIAL) * ASYNC_DYNAMIC_EVERY_INITIAL;

    await client.runScriptAsync(
      `
        run ${ASYNC_DYNAMIC_RUN_STEPS}
      `,
      (data) => {
        steps.push(data.step);
        if (data.step === initialCallback) {
          const updated = client.setAsyncStepFrequency(ASYNC_DYNAMIC_EVERY_UPDATED);
          if (!updated) {
            throw new Error("failed to update async step frequency");
          }
        }
        if (data.step >= finishStep) {
          resolveDone?.();
        }
        return Promise.resolve();
      },
      { every: ASYNC_DYNAMIC_EVERY_INITIAL }
    );

    await Promise.race([done, timeout]);

    const expectedSteps = [];
    for (let step = initialCallback; step <= finishStep; step += 1) {
      expectedSteps.push(step);
    }
    expect(steps).toEqual(expectedSteps);

  });
});
