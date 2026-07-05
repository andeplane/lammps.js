import type { AsyncStepData, KokkosOptions } from "./client.js";

export interface WorkerParticleData {
  count: number;
  positions: Float32Array;
  ids: Int32Array | BigInt64Array;
  types: Int32Array;
}

export interface WorkerBondData {
  count: number;
  first: Float32Array;
  second: Float32Array;
}

export interface WorkerBoxData {
  matrix: Float32Array;
  origin: Float32Array;
  lengths: Float32Array;
}

export interface WorkerStepData {
  step: number;
  timestepSize: number;
  particles?: WorkerParticleData;
  bonds?: WorkerBondData;
  box?: WorkerBoxData;
  computeScalars?: Record<string, number | null>;
}

export interface WorkerRunOptions {
  every: number;
  fixId?: string;
  wrapped?: boolean;
  computeScalars?: string[];
}

export interface WorkerRunResult {
  aborted: boolean;
  step: number;
  timestepSize: number;
}

export type LammpsWorkerRequest =
  | { id: number; type: "init"; workdir?: string; kokkos?: boolean | KokkosOptions }
  | { id: number; type: "runCommand"; command: string }
  | { id: number; type: "runScript"; script: string }
  | { id: number; type: "runScriptAsync"; script: string; options: WorkerRunOptions }
  | { id: number; type: "advance"; steps: number; applyPre: boolean; applyPost: boolean }
  | { id: number; type: "writeFile"; path: string; content: string | Uint8Array }
  | { id: number; type: "removeFile"; path: string }
  | { id: number; type: "setAsyncStepFrequency"; every: number; fixId?: string }
  | { id: number; type: "stepAck" }
  | { id: number; type: "abortRun" }
  | { id: number; type: "stop" }
  | { id: number; type: "dispose" };

type WithoutId<T> = T extends { id: number } ? Omit<T, "id"> : never;
export type LammpsWorkerRequestBody = WithoutId<LammpsWorkerRequest>;

export type LammpsWorkerResponse =
  | { type: "response"; id: number; ok: true; result?: unknown }
  | { type: "response"; id: number; ok: false; error: string }
  | { type: "step"; data: WorkerStepData }
  | { type: "output"; stream: "stdout" | "stderr"; text: string };

export interface SerializedStep {
  data: WorkerStepData;
  transfer: ArrayBuffer[];
}

/**
 * Prepares async step data for postMessage. The arrays must be copies
 * (runScriptAsync with copy: true) — transferring a view into the wasm
 * heap would detach the whole heap.
 */
export function serializeStepData(data: AsyncStepData, timestepSize: number): SerializedStep {
  const transfer: ArrayBuffer[] = [];
  const track = <T extends { buffer: ArrayBufferLike }>(array: T): T => {
    const buffer = array.buffer;
    if (buffer instanceof ArrayBuffer && !transfer.includes(buffer)) {
      transfer.push(buffer);
    }
    return array;
  };

  const payload: WorkerStepData = { step: data.step, timestepSize };

  if (data.particles) {
    payload.particles = {
      count: data.particles.count,
      positions: track(data.particles.positions),
      ids: track(data.particles.ids),
      types: track(data.particles.types)
    };
  }
  if (data.bonds) {
    payload.bonds = {
      count: data.bonds.count,
      first: track(data.bonds.first),
      second: track(data.bonds.second)
    };
  }
  if (data.box) {
    payload.box = {
      matrix: track(data.box.matrix),
      origin: track(data.box.origin),
      lengths: track(data.box.lengths)
    };
  }
  if (data.computeScalars) {
    payload.computeScalars = data.computeScalars;
  }

  return { data: payload, transfer };
}
