import type {
  BondSnapshot,
  BoxSnapshot,
  LAMMPSWeb,
  LammpsModule,
  ModuleOptions,
  ParticleSnapshot
} from "./index.js";

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

export declare class LammpsClient {
  readonly module: LammpsModule;
  readonly instance: LAMMPSWeb;
  readonly workdir: string;

  constructor(module: LammpsModule, instance: LAMMPSWeb, options?: LammpsClientOptions);
  static create(
    moduleOptions?: ModuleOptions,
    clientOptions?: LammpsClientOptions
  ): Promise<LammpsClient>;

  start(): this;
  stop(): this;
  dispose(): void;

  advance(steps?: number, options?: { applyPre?: boolean; applyPost?: boolean }): this;
  runCommand(command: string): this;
  runScript(script: string): this;
  runScriptAsync(
    script: string,
    callback: ((data: AsyncStepData) => void | Promise<void>) | null,
    options?: {
      every: number;
      fixId?: string;
      wrapped?: boolean;
      copy?: boolean;
      computeScalars?: string[];
    }
  ): Promise<this>;
  runInput(path: string, content: string | Uint8Array): this;

  writeFile(path: string, content: string | Uint8Array): this;
  removeFile(path: string): this;

  syncParticles(options?: SyncOptions): ParticleArrays;
  syncBonds(options?: SyncOptions): BondArrays;
  syncBox(options?: SyncBoxOptions): BoxArrays;
  getComputeScalar(id: string): number | null;
  getComputeScalars(ids: string[]): Record<string, number | null>;

  setAsyncStepFrequency(every: number, fixId?: string): boolean;

  getCurrentStep(): number;
  getTimestepSize(): number;
}

export declare function createLammps(
  moduleOptions?: ModuleOptions,
  clientOptions?: LammpsClientOptions
): Promise<LammpsClient>;

export { default as createModule } from "./index.js";
