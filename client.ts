import { LammpsWorkerClient } from "./worker-client.js";

import type { LammpsWorkerClientOptions, WorkerLike } from "./worker-client.js";
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

export interface SyncOptions {
  wrapped?: boolean;
  copy?: boolean;
}

export interface SyncBoxOptions {
  copy?: boolean;
}

export interface KokkosOptions {
  /**
   * Number of Kokkos threads. Defaults to the hardware concurrency
   * reported by the environment, capped at 8 (the pthread pool size the
   * KOKKOS wasm module is built with).
   */
  threads?: number;
  /**
   * Apply the kk accelerator suffix to all styles (`-sf kk`), so plain
   * scripts run their Kokkos variants automatically. Default true.
   */
  suffix?: boolean;
}

export interface LammpsClientOptions {
  workdir?: string;
  /**
   * Run LAMMPS inside a Web Worker instead of on the calling thread.
   * `true` spawns the bundled worker entry (`lammps.js/worker`); pass a
   * Worker instance to control how the worker is created (e.g. with a
   * bundler-specific URL). When set, create() resolves to a
   * LammpsWorkerClient whose snapshot getters return the latest step
   * data received from the worker.
   */
  worker?: boolean | WorkerLike;
  /** Worker mode only: receives failures from fire-and-forget commands. */
  onError?: (error: Error) => void;
  /**
   * Use the multi-threaded KOKKOS wasm build (dist/cpp/lammps-kokkos.js).
   * Requires a cross-origin isolated context in browsers
   * (SharedArrayBuffer). `true` uses default options.
   */
  kokkos?: boolean | KokkosOptions;
}

const KOKKOS_MAX_THREADS = 8;

function resolveKokkosOptions(value: boolean | KokkosOptions | undefined): KokkosOptions | null {
  if (!value) {
    return null;
  }
  return value === true ? {} : value;
}

function defaultKokkosThreads(): number {
  const hardware =
    typeof navigator !== "undefined" && Number.isFinite(navigator.hardwareConcurrency)
      ? navigator.hardwareConcurrency
      : 4;
  return Math.min(Math.max(1, hardware), KOKKOS_MAX_THREADS);
}

function kokkosStartArgs(options: KokkosOptions): string[] {
  const threads = Math.min(Math.max(1, options.threads ?? defaultKokkosThreads()), KOKKOS_MAX_THREADS);
  const args = ["-k", "on", "t", String(threads)];
  if (options.suffix !== false) {
    args.push("-sf", "kk");
  }
  return args;
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

// The Emscripten module is built with memory growth enabled. When the WASM
// heap grows, the underlying ArrayBuffer is detached and the module's HEAP*
// views are replaced with fresh ones. We must therefore resolve the heap view
// from the module on every access rather than caching it, otherwise a large
// run that grows memory leaves us holding a detached buffer ("Cannot perform
// Construct on a detached ArrayBuffer").
function resolveHeap(module: LammpsModule, type: number): HeapView {
  const Scalar = module.ScalarType ?? {};
  if (type === (Scalar.Float64 ?? 1) && module.HEAPF64) return module.HEAPF64;
  if (type === (Scalar.Int32 ?? 2) && module.HEAP32) return module.HEAP32;
  if (type === (Scalar.Int64 ?? 3)) return module.HEAP64 ?? module.HEAP32;
  return module.HEAPF32;
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
  shifts: Map<number, number>,
  view: ParticleSnapshot["positions"] | undefined,
  copy: boolean
): HeapView {
  if (!view || !view.ptr || !view.length) {
    const empty = module.HEAPF32.subarray(0, 0);
    return copy ? empty.slice() : empty;
  }
  const heap = resolveHeap(module, view.type);
  const shift = shifts.get(view.type) ?? 2;
  // Divide instead of >>: bitwise ops truncate to 32 bits, which corrupts
  // pointers above 2GB (possible with memory growth, and in KOKKOS builds).
  const start = view.ptr / (1 << shift);
  const typed = heap.subarray(start, start + view.length);
  return copy ? typed.slice() : typed;
}

function toParticleResult(client: LammpsClient, wrapped: boolean, copy: boolean): ParticleArrays {
  const snap = wrapped ? client.instance.syncParticlesWrapped() : client.instance.syncParticles();
  const positions = viewToTyped(client.module, client._shifts, snap.positions, copy) as Float32Array;
  const ids = viewToTyped(client.module, client._shifts, snap.ids, copy) as Int32Array | BigInt64Array;
  const types = viewToTyped(client.module, client._shifts, snap.types, copy) as Int32Array;
  return { count: snap.count, positions, ids, types, snapshot: snap };
}

function toBondResult(client: LammpsClient, wrapped: boolean, copy: boolean): BondArrays {
  const snap = wrapped ? client.instance.syncBondsWrapped() : client.instance.syncBonds();
  const first = viewToTyped(client.module, client._shifts, snap.first, copy) as Float32Array;
  const second = viewToTyped(client.module, client._shifts, snap.second, copy) as Float32Array;
  return { count: snap.count, first, second, snapshot: snap };
}

function toBoxResult(client: LammpsClient, copy: boolean): BoxArrays {
  const snap = client.instance.syncSimulationBox();
  const matrix = viewToTyped(client.module, client._shifts, snap.matrix, copy) as Float32Array;
  const origin = viewToTyped(client.module, client._shifts, snap.origin, copy) as Float32Array;
  const lengths = viewToTyped(client.module, client._shifts, snap.lengths, copy) as Float32Array;
  return { matrix, origin, lengths, snapshot: snap };
}

export class LammpsClient {
  readonly module: LammpsModule;
  readonly instance: LAMMPSWeb;
  readonly workdir: string;

  readonly _shifts: Map<number, number>;
  readonly #kokkos: KokkosOptions | null;

  constructor(module: LammpsModule, instance: LAMMPSWeb, options: LammpsClientOptions = {}) {
    this.module = module;
    this.instance = instance;
    this.workdir = options.workdir ?? DEFAULT_WORKDIR;
    this._shifts = buildShiftMap(module);
    this.#kokkos = resolveKokkosOptions(options.kokkos);

    try {
      module.FS.mkdir(this.workdir);
    } catch {
      /* already exists */
    }
    module.FS.chdir(this.workdir);
  }

  static async create(
    moduleOptions?: ModuleOptions,
    clientOptions?: LammpsClientOptions & { worker?: false | undefined }
  ): Promise<LammpsClient>;
  static async create(
    moduleOptions: ModuleOptions,
    clientOptions: LammpsClientOptions & { worker: true | WorkerLike }
  ): Promise<LammpsWorkerClient>;
  static async create(
    moduleOptions: ModuleOptions = {},
    clientOptions: LammpsClientOptions = {}
  ): Promise<LammpsClient | LammpsWorkerClient> {
    if (clientOptions.worker) {
      return createWorkerBackedClient(moduleOptions, clientOptions, clientOptions.worker);
    }
    // Both wasm modules are imported lazily so that consumers (and CI
    // variants) only need the artifact they actually use.
    const factory = clientOptions.kokkos
      ? (await import("./cpp/lammps-kokkos.js")).default
      : (await import("./cpp/lammps.js")).default;
    const module = await factory(moduleOptions);
    const instance = new module.LAMMPSWeb();
    return new LammpsClient(module, instance, clientOptions);
  }

  start(): this {
    if (this.#kokkos) {
      this.instance.startWithArgs(kokkosStartArgs(this.#kokkos));
    } else {
      this.instance.start();
    }
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
    const definesFix = hasActiveAsyncFixBeforeIndex(
      scriptLines,
      fixId,
      hookIndex === -1 ? scriptLines.length : hookIndex
    );

    // Unless the script manages its own js/async fix, install (or retune)
    // ours up front. installAsyncFix works before the simulation box exists,
    // so runs inside include'd files and jump loops fire the callback too —
    // no script text injection. Caveat: a `clear` command inside the script
    // wipes all fixes including this one; runs after it won't yield.
    if (!definesFix) {
      try {
        this.instance.installAsyncFix(fixId, every);
      } catch (err) {
        this.#setAsyncStepCallback(null);
        throw err;
      }
    }

    let done: Promise<unknown>;
    try {
      const result = this.instance.runScript(normalizedScript) as unknown;
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
        this.#setAsyncStepCallback(null);
        return this;
      })
      .catch((err) => {
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
          module.HEAP32[donePtr / 4] = 1;
        },
        (err) => {
          module.HEAP32[errPtr / 4] = 1;
          module.HEAP32[donePtr / 4] = 1;
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

function toOutputWriter(value: unknown): ((text: string) => void) | undefined {
  return typeof value === "function" ? (value as (text: string) => void) : undefined;
}

function createDefaultWorker(): WorkerLike {
  if (typeof Worker === "undefined") {
    throw new Error(
      "Web Workers are not available in this environment; pass { worker: <Worker instance> } instead"
    );
  }
  return new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
}

async function createWorkerBackedClient(
  moduleOptions: ModuleOptions,
  clientOptions: LammpsClientOptions,
  worker: true | WorkerLike
): Promise<LammpsWorkerClient> {
  const ownsWorker = worker === true;
  const target = worker === true ? createDefaultWorker() : worker;
  const print = toOutputWriter(moduleOptions.print);
  const printErr = toOutputWriter(moduleOptions.printErr);

  const options: LammpsWorkerClientOptions = {
    workdir: clientOptions.workdir,
    onError: clientOptions.onError,
    kokkos: clientOptions.kokkos
  };
  if (print || printErr) {
    options.onOutput = (stream, text) => {
      if (stream === "stdout") {
        print?.(text);
      } else {
        printErr?.(text);
      }
    };
  }

  return LammpsWorkerClient.create(target, options, ownsWorker);
}

export async function createLammps(
  moduleOptions?: ModuleOptions,
  clientOptions?: LammpsClientOptions & { worker?: false | undefined }
): Promise<LammpsClient>;
export async function createLammps(
  moduleOptions: ModuleOptions,
  clientOptions: LammpsClientOptions & { worker: true | WorkerLike }
): Promise<LammpsWorkerClient>;
export async function createLammps(
  moduleOptions: ModuleOptions = {},
  clientOptions: LammpsClientOptions = {}
): Promise<LammpsClient | LammpsWorkerClient> {
  if (clientOptions.worker) {
    return createWorkerBackedClient(moduleOptions, clientOptions, clientOptions.worker);
  }
  return LammpsClient.create(moduleOptions, {
    workdir: clientOptions.workdir,
    onError: clientOptions.onError,
    kokkos: clientOptions.kokkos
  });
}

/** Loads the serial wasm module. Lazy: the module file is only fetched on call. */
export async function createModule(options: ModuleOptions = {}): Promise<LammpsModule> {
  const factory = (await import("./cpp/lammps.js")).default;
  return factory(options);
}
export { LammpsWorkerClient } from "./worker-client.js";
export type { WorkerLike, LammpsWorkerClientOptions } from "./worker-client.js";
export type {
  WorkerStepData,
  WorkerRunOptions,
  WorkerRunResult,
  WorkerParticleData,
  WorkerBondData,
  WorkerBoxData
} from "./worker-protocol.js";
