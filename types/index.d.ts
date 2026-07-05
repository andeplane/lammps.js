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
  /** domain->dimension: 2 or 3. */
  dimension: number;
}

export type ModifierCategory = "compute" | "fix" | "variable";

export interface ModifierInfo {
  name: string;
  category: ModifierCategory;
  /** LAMMPS style string, e.g. "rdf", "msd", "ave/time"; "equal" | "atom" for variables. */
  style: string;
  isPerAtom: boolean;
  hasScalar: boolean;
  /** Series x-axis is not time (histogram-like); consumers should replace, not append. */
  clearPerSync: boolean;
  xLabel: string;
  yLabel: string;
}

export interface ModifierSeries {
  /** Stable key, e.g. "Pxx", "g(r) pair 1". */
  name: string;
  /** Display label. */
  label: string;
  /**
   * Float32 views over the full accumulated series. Only valid until the
   * next syncModifier/syncModifiers call (the backing buffers can move or be
   * freed when the modifier is removed) — copy what you need immediately and
   * never cache a view across syncs.
   */
  x: BufferView;
  y: BufferView;
}

export interface ModifierSnapshot extends ModifierInfo {
  /** Last scalar value (meaningful when hasScalar). */
  scalar: number;
  series: ModifierSeries[];
}

export interface WallInfo {
  /** Box face: 0-5 = XLO, XHI, YLO, YHI, ZLO, ZHI. */
  which: number;
  /** 1 = EDGE (on the box face), 2 = CONSTANT (fixed coordinate). */
  style: number;
  /** Wall position along its axis. */
  position: number;
  /** Interaction range (0 when not exposed by the fix). */
  cutoff: number;
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
  /** update->whichflag: 0 = idle, 1 = dynamics run, 2 = minimization. */
  getRunMode(): number;
  /** Steps completed in the active run (0 when idle). */
  getRunStepsDone(): number;
  /** Total steps of the active run (0 when idle). */
  getRunStepsTotal(): number;
  /** Any thermo keyword as a number (e.g. "spcpu", "cpuremain", "temp"). */
  getThermo(keyword: string): number;
  /** Current LAMMPS memory usage estimate in bytes. */
  getMemoryUsage(): number;

  syncParticles(): ParticleSnapshot;
  syncParticlesWrapped(): ParticleSnapshot;
  syncBonds(): BondSnapshot;
  syncBondsWrapped(): BondSnapshot;
  syncSimulationBox(): BoxSnapshot;
  /** Renderable wall fixes (fix wall/...), EDGE and CONSTANT styles only. */
  getWalls(): WallInfo[];

  /** Refresh the modifier registry from the currently defined computes/fixes/variables. */
  syncModifiers(): void;
  /** Tracked computes, fixes, and (equal/atom-style) variables. */
  listModifiers(): ModifierInfo[];
  /**
   * Invoke (computes, when allowed) and sync one modifier's data. Returns the
   * updated snapshot with series views, or null if the modifier is unknown.
   */
  syncModifier(category: ModifierCategory, name: string): ModifierSnapshot | null;
}

export interface LammpsModule {
  HEAPF32: Float32Array;
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  HEAP64: BigInt64Array;
  FS: {
    mkdir(path: string): void;
    rmdir(path: string): void;
    chdir(path: string): void;
    cwd(): string;
    writeFile(path: string, data: string | Uint8Array): void;
    unlink(path: string): void;
    readFile(path: string, opts?: { encoding: "utf8" }): string;
    readdir(path: string): string[];
    analyzePath(path: string): {
      exists: boolean;
      isRoot: boolean;
      path: string;
      name: string;
      error: number;
    };
    stat(path: string): { size: number; mode: number; mtime: Date };
    isDir(mode: number): boolean;
    isFile(mode: number): boolean;
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
