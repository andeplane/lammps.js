export enum ScalarType {
  Float32 = 0,
  Float64 = 1,
  Int32 = 2,
  Int64 = 3
}

export interface BufferView {
  /** Pointer within the Emscripten heap. Use HEAP* views to read data. */
  ptr: number;
  /** Total number of scalar values exposed via this view. */
  length: number;
  /** Number of components per logical element (e.g. 3 for xyz positions). */
  components: number;
  /** Underlying scalar representation for this view. */
  type: ScalarType;
}

export interface ParticleSnapshot {
  positions: BufferView;
  ids: BufferView;
  types: BufferView;
  count: number;
}

export interface BondSnapshot {
  first: BufferView;
  second: BufferView;
  count: number;
}

export interface BoxSnapshot {
  matrix: BufferView;
  origin: BufferView;
  lengths: BufferView;
}

export interface LAMMPSWeb {
  start(): void;
  /** Start LAMMPS with extra command-line arguments (e.g. ["-k", "on", "t", "4", "-sf", "kk"]). */
  startWithArgs(args?: string[] | null): void;
  /** Whether the wasm build includes a given LAMMPS package (e.g. "KOKKOS"). */
  hasPackage(name: string): boolean;
  stop(): void;
  advance(steps: number, applyPre?: boolean, applyPost?: boolean): void;
  runCommand(command: string): void;
  runScript(script: string): void;
  runFile(path: string): void;
  setAsyncStepCallback(
    callback?: ((step: number) => void | Promise<void>) | null,
    waiter?: (promise: Promise<unknown>, donePtr: number, errPtr: number) => void
  ): void;
  setAsyncStepFrequency(fixId: string, every: number): boolean;

  isReady(): boolean;
  getIsRunning(): boolean;
  /** Message of the most recent LAMMPS error this session ("" if none). */
  getLastErrorMessage(): string;
  /** Input line the most recent LAMMPS error stopped on ("" if none). */
  getLastErrorInputLine(): string;
  /** Input line currently (or most recently) being processed. */
  getLastInputLine(): string;
  getCurrentStep(): number;
  getTimestepSize(): number;
  getComputeScalar(id: string): number;

  syncParticles(): ParticleSnapshot;
  syncParticlesWrapped(): ParticleSnapshot;
  syncBonds(): BondSnapshot;
  syncBondsWrapped(): BondSnapshot;
  syncSimulationBox(): BoxSnapshot;
}

export interface LammpsModule {
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  HEAP64: BigInt64Array;
  FS: {
    mkdir(path: string): void;
    chdir(path: string): void;
    writeFile(path: string, data: string | Uint8Array): void;
    unlink(path: string): void;
    readFile(path: string, opts?: { encoding: "utf8" }): string;
  };
  LAMMPSWeb: new () => LAMMPSWeb;
  ScalarType: typeof ScalarType;
  [key: string]: unknown;
}

export interface ModuleOptions {
  print?: (...args: unknown[]) => void;
  printErr?: (...args: unknown[]) => void;
  locateFile?: (path: string, prefix?: string) => string;
  [key: string]: unknown;
}

declare function createModule(options?: ModuleOptions): Promise<LammpsModule>;

export default createModule;
