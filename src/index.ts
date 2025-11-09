// Re-export all types
export type {
  CPPArray,
  LMPData1D,
  LMPModifier,
  InternalLammpsWeb,
  Data1D,
  Compute,
  Fix,
  Variable,
  LammpsOutput,
  LammpsModuleOptions,
  LammpsModule,
  CreateModuleFunction,
} from "./types.js";

export { ModifierType } from "./types.js";

// Export the main wrapper class
export { LammpsWeb } from "./wrapper.js";

// For advanced users who want direct access to createModule
// @ts-ignore - This will be resolved from the bundled lammps.mjs
import lammpsMjs from "./lammps.mjs";

// Re-export createModule from the compiled WASM module
export const createModule = lammpsMjs as unknown as import("./types").CreateModuleFunction;

