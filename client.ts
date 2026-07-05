import createModule from "./cpp/lammps.js";

import type {
  LammpsModule,
  LAMMPSWeb,
  ModuleOptions,
  ParticleSnapshot,
  BondSnapshot,
  BoxSnapshot
} from "./types/index.js";

const DEFAULT_WORKDIR = "/work";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findFirstRunOrMinimizeIndex(lines: string[]): number {
  return lines.findIndex((line) => /^\s*(run|minimize)(\s|$)/.test(line));
}

function hasActiveAsyncFixBeforeIndex(lines: string[], fixId: string, index: number): boolean {
  const escapedId = escapeRegex(fixId);
  const pattern = new RegExp(`^\\s*fix\\s+${escapedId}\\s+\\S+\\s+js/async(\\s|$)`, "m");
  const unfixPattern = new RegExp(`^\\s*unfix\\s+${escapedId}(\\s|$)`, "m");
  let active = false;
  for (let i = 0; i < index; i += 1) {
    const line = lines[i];
    if (pattern.test(line)) {
      active = true;
      continue;
    }
    if (unfixPattern.test(line)) {
      active = false;
    }
  }
  return active;
}

function hasUnfixAfterIndex(lines: string[], fixId: string, index: number): boolean {
  if (index < 0) {
    return false;
  }
  const escapedId = escapeRegex(fixId);
  const pattern = new RegExp(`^\\s*unfix\\s+${escapedId}(\\s|$)`, "m");
  for (let i = index + 1; i < lines.length; i += 1) {
    if (pattern.test(lines[i])) {
      return true;
    }
  }
  return false;
}

function injectAsyncFix(script: string, every: number, fixId: string): string {
  const trimmed = script.trimEnd();
  const lines = trimmed.split("\n");
  const hookIndex = findFirstRunOrMinimizeIndex(lines);
  if (hookIndex === -1) {
    return script.endsWith("\n") ? script : `${script}\n`;
  }

  lines.splice(hookIndex, 0, `fix ${fixId} all js/async ${every}`);
  return `${lines.join("\n")}\n`;
}

export interface SyncOptions {
  wrapped?: boolean;
  copy?: boolean;
}

export interface SyncBoxOptions {
  copy?: boolean;
}

export interface LammpsClientOptions {
  workdir?: string;
}

export interface ParticleArrays {
  count: number;
  positions: Float32Array;
  ids: Int32Array | BigInt64Array;
  types: Int32Array;
  snapshot: ParticleSnapshot;
}

export interface BondArrays {
  count: number;
  first: Float32Array;
  second: Float32Array;
  snapshot: BondSnapshot;
}

export interface BoxArrays {
  matrix: Float32Array;
  origin: Float32Array;
  lengths: Float32Array;
  snapshot: BoxSnapshot;
}

export interface AsyncStepData {
  step: number;
  particles?: ParticleArrays;
  bonds?: BondArrays;
  box?: BoxArrays;
  computeScalars?: Record<string, number | null>;
}

type HeapView = Float32Array | Float64Array | Int32Array | BigInt64Array;

function buildHeapMap(module: LammpsModule): Map<number, HeapView> {
  const Scalar = module.ScalarType ?? {};
  const map = new Map<number, HeapView>();
  if (module.HEAPF32) map.set(Scalar.Float32 ?? 0, module.HEAPF32);
  if (module.HEAPF64) map.set(Scalar.Float64 ?? 1, module.HEAPF64);
  if (module.HEAP32) map.set(Scalar.Int32 ?? 2, module.HEAP32);
  if (module.HEAP64) {
    map.set(Scalar.Int64 ?? 3, module.HEAP64);
  } else if (module.HEAP32) {
    map.set(Scalar.Int64 ?? 3, module.HEAP32);
  }
  return map;
}

function buildShiftMap(module: LammpsModule): Map<number, number> {
  const Scalar = module.ScalarType ?? {};
  const map = new Map<number, number>();
  map.set(Scalar.Float32 ?? 0, 2);
  map.set(Scalar.Float64 ?? 1, 3);
  map.set(Scalar.Int32 ?? 2, 2);
  map.set(Scalar.Int64 ?? 3, 3);
  return map;
}

function viewToTyped(
  module: LammpsModule,
  heaps: Map<number, HeapView>,
  shifts: Map<number, number>,
  view: ParticleSnapshot["positions"] | undefined,
  copy: boolean
): HeapView {
  if (!view || !view.ptr || !view.length) {
    const heap = heaps.get(0) ?? module.HEAPF32;
    const empty = heap.subarray(0, 0);
    return copy ? empty.slice() : empty;
  }
  const heap = heaps.get(view.type) ?? module.HEAPF32;
  const shift = shifts.get(view.type) ?? 2;
  const start = view.ptr >> shift;
  const typed = heap.subarray(start, start + view.length);
  return copy ? typed.slice() : typed;
}

function toParticleResult(client: LammpsClient, wrapped: boolean, copy: boolean): ParticleArrays {
  const snap = wrapped ? client.instance.syncParticlesWrapped() : client.instance.syncParticles();
  const positions = viewToTyped(client.module, client._heaps, client._shifts, snap.positions, copy) as Float32Array;
  const ids = viewToTyped(client.module, client._heaps, client._shifts, snap.ids, copy) as Int32Array | BigInt64Array;
  const types = viewToTyped(client.module, client._heaps, client._shifts, snap.types, copy) as Int32Array;
  return { count: snap.count, positions, ids, types, snapshot: snap };
}

function toBondResult(client: LammpsClient, wrapped: boolean, copy: boolean): BondArrays {
  const snap = wrapped ? client.instance.syncBondsWrapped() : client.instance.syncBonds();
  const first = viewToTyped(client.module, client._heaps, client._shifts, snap.first, copy) as Float32Array;
  const second = viewToTyped(client.module, client._heaps, client._shifts, snap.second, copy) as Float32Array;
  return { count: snap.count, first, second, snapshot: snap };
}

function toBoxResult(client: LammpsClient, copy: boolean): BoxArrays {
  const snap = client.instance.syncSimulationBox();
  const matrix = viewToTyped(client.module, client._heaps, client._shifts, snap.matrix, copy) as Float32Array;
  const origin = viewToTyped(client.module, client._heaps, client._shifts, snap.origin, copy) as Float32Array;
  const lengths = viewToTyped(client.module, client._heaps, client._shifts, snap.lengths, copy) as Float32Array;
  return { matrix, origin, lengths, snapshot: snap };
}

export class LammpsClient {
  readonly module: LammpsModule;
  readonly instance: LAMMPSWeb;
  readonly workdir: string;

  readonly _heaps: Map<number, HeapView>;
  readonly _shifts: Map<number, number>;
  readonly #managedAsyncFixIds: Set<string>;

  constructor(module: LammpsModule, instance: LAMMPSWeb, options: LammpsClientOptions = {}) {
    this.module = module;
    this.instance = instance;
    this.workdir = options.workdir ?? DEFAULT_WORKDIR;
    this._heaps = buildHeapMap(module);
    this._shifts = buildShiftMap(module);
    this.#managedAsyncFixIds = new Set<string>();

    try {
      module.FS.mkdir(this.workdir);
    } catch {
      /* already exists */
    }
    module.FS.chdir(this.workdir);
  }

  static async create(
    moduleOptions: ModuleOptions = {},
    clientOptions: LammpsClientOptions = {}
  ): Promise<LammpsClient> {
    const module = await createModule(moduleOptions);
    const instance = new module.LAMMPSWeb();
    return new LammpsClient(module, instance, clientOptions);
  }

  start(): this {
    this.instance.start();
    return this;
  }

  stop(): this {
    this.instance.stop();
    return this;
  }

  dispose(): void {
    this.stop();
  }

  advance(steps = 1, options: { applyPre?: boolean; applyPost?: boolean } = {}): this {
    const pre = options.applyPre ?? false;
    const post = options.applyPost ?? false;
    this.instance.advance(steps, pre, post);
    return this;
  }

  runCommand(command: string): this {
    this.instance.runCommand(command);
    return this;
  }

  runScript(script: string): this {
    const normalized = script.endsWith("\n") ? script : `${script}\n`;
    this.instance.runScript(normalized);
    return this;
  }

  runScriptAsync(
    script: string,
    callback: ((data: AsyncStepData) => void | Promise<void>) | null,
    options: {
      every: number;
      fixId?: string;
      wrapped?: boolean;
      copy?: boolean;
      computeScalars?: string[];
    } = { every: 1 }
  ): Promise<this> {
    const {
      every,
      fixId = "jsasync",
      wrapped = false,
      copy = true,
      computeScalars
    } = options;
    this.#setAsyncStepCallback(callback, { wrapped, copy, computeScalars });

    const normalizedScript = script.endsWith("\n") ? script : `${script}\n`;
    const scriptLines = normalizedScript.trimEnd().split("\n");
    const hookIndex = findFirstRunOrMinimizeIndex(scriptLines);
    const hasHook = hookIndex !== -1;
    const definesFix = hasActiveAsyncFixBeforeIndex(scriptLines, fixId, hookIndex);
    const unfixesFix = hasUnfixAfterIndex(scriptLines, fixId, hookIndex);
    let injectedFix = false;

    let wrappedScript = normalizedScript;
    if (hasHook && !definesFix) {
      if (this.#managedAsyncFixIds.has(fixId)) {
        const hasFix = this.instance.setAsyncStepFrequency(fixId, every);
        if (!hasFix) {
          this.#managedAsyncFixIds.delete(fixId);
          wrappedScript = injectAsyncFix(normalizedScript, every, fixId);
          injectedFix = true;
        }
      } else {
        wrappedScript = injectAsyncFix(normalizedScript, every, fixId);
        injectedFix = true;
      }
    }

    let done: Promise<unknown>;
    try {
      const result = this.instance.runScript(wrappedScript) as unknown;
      done =
        result && typeof (result as Promise<unknown>).then === "function"
          ? (result as Promise<unknown>)
          : Promise.resolve();
    } catch (err) {
      this.#setAsyncStepCallback(null);
      throw err;
    }

    return done
      .then(() => {
        if (injectedFix && !unfixesFix) {
          this.#managedAsyncFixIds.add(fixId);
        }
        if (unfixesFix) {
          this.#managedAsyncFixIds.delete(fixId);
        }
        this.#setAsyncStepCallback(null);
        return this;
      })
      .catch((err) => {
        if (hasHook && !definesFix) {
          const stillPresent = this.instance.setAsyncStepFrequency(fixId, every);
          if (stillPresent) {
            this.#managedAsyncFixIds.add(fixId);
          } else {
            this.#managedAsyncFixIds.delete(fixId);
          }
        }
        this.#setAsyncStepCallback(null);
        throw err;
      });
  }

  runInput(path: string, content: string | Uint8Array): this {
    this.writeFile(path, content);
    this.instance.runFile(path);
    return this;
  }

  setAsyncStepFrequency(every: number, fixId = "jsasync"): boolean {
    return this.instance.setAsyncStepFrequency(fixId, every);
  }

  writeFile(path: string, content: string | Uint8Array): this {
    this.module.FS.writeFile(path, content);
    return this;
  }

  removeFile(path: string): this {
    this.module.FS.unlink(path);
    return this;
  }

  syncParticles(options: SyncOptions = {}): ParticleArrays {
    const wrapped = options.wrapped ?? false;
    const copy = options.copy ?? false;
    return toParticleResult(this, wrapped, copy);
  }

  syncBonds(options: SyncOptions = {}): BondArrays {
    const wrapped = options.wrapped ?? false;
    const copy = options.copy ?? false;
    return toBondResult(this, wrapped, copy);
  }

  syncBox(options: SyncBoxOptions = {}): BoxArrays {
    const copy = options.copy ?? false;
    return toBoxResult(this, copy);
  }

  getComputeScalar(id: string): number | null {
    const value = this.instance.getComputeScalar(id);
    return Number.isFinite(value) ? value : null;
  }

  getComputeScalars(ids: string[]): Record<string, number | null> {
    const scalars: Record<string, number | null> = {};
    for (const id of ids) {
      scalars[id] = this.getComputeScalar(id);
    }
    return scalars;
  }

  #setAsyncStepCallback(
    callback: ((data: AsyncStepData) => void | Promise<void>) | null,
    options: {
      wrapped?: boolean;
      copy?: boolean;
      computeScalars?: string[];
    } = {}
  ): this {
    if (callback === null) {
      this.instance.setAsyncStepCallback(undefined, undefined);
      return this;
    }

    const { wrapped = false, copy = true, computeScalars } = options;
    const computeScalarIds = computeScalars ? [...computeScalars] : [];

    const module = this.module;
    const waiter = (promise: Promise<unknown>, donePtr: number, errPtr: number) => {
      promise.then(
        () => {
          module.HEAP32[donePtr >> 2] = 1;
        },
        (err) => {
          module.HEAP32[errPtr >> 2] = 1;
          module.HEAP32[donePtr >> 2] = 1;
          module.__lammpsAsyncError = err;
        }
      );
    };

    this.instance.setAsyncStepCallback((step) => {
      const stepValue = typeof step === "bigint" ? Number(step) : step;
      const normalizedStep = Number.isFinite(stepValue) ? stepValue : 0;
      const data: AsyncStepData = {
        step: normalizedStep,
        particles: this.syncParticles({ wrapped, copy }),
        bonds: this.syncBonds({ wrapped, copy }),
        box: this.syncBox({ copy })
      };
      if (computeScalarIds.length > 0) {
        data.computeScalars = this.getComputeScalars(computeScalarIds);
      }
      return callback(data);
    }, waiter);
    return this;
  }

  getCurrentStep(): number {
    return this.instance.getCurrentStep();
  }

  getTimestepSize(): number {
    return this.instance.getTimestepSize();
  }
}

export async function createLammps(
  moduleOptions: ModuleOptions = {},
  clientOptions: LammpsClientOptions = {}
): Promise<LammpsClient> {
  return LammpsClient.create(moduleOptions, clientOptions);
}

export { createModule };
