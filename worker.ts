import { installLammpsWorker } from "./worker-host.js";
import type { WorkerScope } from "./worker-host.js";

// Worker entry point: created automatically by LammpsClient.create with
// `worker: true`, or manually via
// new Worker(new URL("lammps.js/worker", import.meta.url), { type: "module" }).
installLammpsWorker(globalThis as unknown as WorkerScope);
