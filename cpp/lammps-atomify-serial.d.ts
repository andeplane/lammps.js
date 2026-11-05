import type { LammpsModule, ModuleOptions } from "../types/index.js";

declare const createModule: (options?: ModuleOptions) => Promise<LammpsModule>;
export default createModule;
