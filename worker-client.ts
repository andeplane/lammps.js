import type { KokkosOptions } from "./client.js";
import type {
  LammpsWorkerRequest,
  LammpsWorkerRequestBody,
  LammpsWorkerResponse,
  WorkerBondData,
  WorkerBoxData,
  WorkerParticleData,
  WorkerRunOptions,
  WorkerRunResult,
  WorkerStepData
} from "./worker-protocol.js";

/** Minimal structural Worker interface so tests can inject a fake. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  terminate?(): void;
}

export interface LammpsWorkerClientOptions {
  workdir?: string;
  onOutput?: (stream: "stdout" | "stderr", text: string) => void;
  /** Receives failures from fire-and-forget commands (runCommand, writeFile, …). */
  onError?: (error: Error) => void;
  /** Use the multi-threaded KOKKOS wasm build inside the worker. */
  kokkos?: boolean | KokkosOptions;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Main-thread proxy for a LammpsClient running inside a Web Worker.
 *
 * Commands are posted to the worker; per-step snapshot data arrives as
 * copied, transferred arrays. The step-data getters (syncParticles,
 * getCurrentStep, …) return the latest snapshot received from the worker
 * rather than reading live wasm memory.
 */
export class LammpsWorkerClient {
  readonly #worker: WorkerLike;
  readonly #ownsWorker: boolean;
  readonly #onOutput?: (stream: "stdout" | "stderr", text: string) => void;
  readonly #onError?: (error: Error) => void;

  #nextId = 1;
  #pending = new Map<number, PendingRequest>();
  #latestStep: WorkerStepData | null = null;
  #stepHandler: ((data: WorkerStepData) => void | Promise<void>) | null = null;
  #stopRequested = false;

  constructor(worker: WorkerLike, options: LammpsWorkerClientOptions = {}, ownsWorker = false) {
    this.#worker = worker;
    this.#ownsWorker = ownsWorker;
    this.#onOutput = options.onOutput;
    this.#onError = options.onError;
    worker.addEventListener("message", (event) => {
      this.#onMessage(event.data as LammpsWorkerResponse);
    });
  }

  static async create(
    worker: WorkerLike,
    options: LammpsWorkerClientOptions = {},
    ownsWorker = false
  ): Promise<LammpsWorkerClient> {
    const client = new LammpsWorkerClient(worker, options, ownsWorker);
    await client.#request({ type: "init", workdir: options.workdir, kokkos: options.kokkos });
    return client;
  }

  runCommand(command: string): this {
    this.#send({ type: "runCommand", command });
    return this;
  }

  runScript(script: string): this {
    this.#send({ type: "runScript", script });
    return this;
  }

  async runScriptAsync(
    script: string,
    callback: ((data: WorkerStepData) => void | Promise<void>) | null,
    options: WorkerRunOptions = { every: 1 }
  ): Promise<WorkerRunResult> {
    this.#stepHandler = callback;
    this.#stopRequested = false;
    try {
      const result = await this.#request({ type: "runScriptAsync", script, options });
      return result as WorkerRunResult;
    } finally {
      this.#stepHandler = null;
    }
  }

  /**
   * Requests that the active runScriptAsync stops at its next step
   * callback. The pending runScriptAsync promise resolves with
   * `aborted: true` once the run has unwound inside the worker.
   */
  stopRun(): void {
    this.#stopRequested = true;
    this.#send({ type: "abortRun" });
  }

  advance(steps = 1, options: { applyPre?: boolean; applyPost?: boolean } = {}): this {
    this.#send({
      type: "advance",
      steps,
      applyPre: options.applyPre ?? false,
      applyPost: options.applyPost ?? false
    });
    return this;
  }

  writeFile(path: string, content: string | Uint8Array): this {
    this.#send({ type: "writeFile", path, content });
    return this;
  }

  removeFile(path: string): this {
    this.#send({ type: "removeFile", path });
    return this;
  }

  async setAsyncStepFrequency(every: number, fixId?: string): Promise<boolean> {
    const result = await this.#request({ type: "setAsyncStepFrequency", every, fixId });
    return result === true;
  }

  /** Latest particle snapshot received from the worker, if any. */
  syncParticles(): WorkerParticleData | null {
    return this.#latestStep?.particles ?? null;
  }

  /** Latest bond snapshot received from the worker, if any. */
  syncBonds(): WorkerBondData | null {
    return this.#latestStep?.bonds ?? null;
  }

  /** Latest simulation box received from the worker, if any. */
  syncBox(): WorkerBoxData | null {
    return this.#latestStep?.box ?? null;
  }

  /** Latest value of a compute scalar requested via runScriptAsync options. */
  getComputeScalar(id: string): number | null {
    return this.#latestStep?.computeScalars?.[id] ?? null;
  }

  getCurrentStep(): number {
    return this.#latestStep?.step ?? 0;
  }

  getTimestepSize(): number {
    return this.#latestStep?.timestepSize ?? 0;
  }

  stop(): this {
    this.#send({ type: "stop" });
    return this;
  }

  dispose(): void {
    this.#send({ type: "dispose" });
    const failure = new Error("LammpsWorkerClient disposed");
    for (const pending of this.#pending.values()) {
      pending.reject(failure);
    }
    this.#pending.clear();
    if (this.#ownsWorker) {
      this.#worker.terminate?.();
    }
  }

  #request(body: LammpsWorkerRequestBody): Promise<unknown> {
    const id = this.#nextId;
    this.#nextId += 1;
    const message: LammpsWorkerRequest = { id, ...body };
    return new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#worker.postMessage(message);
    });
  }

  #send(body: LammpsWorkerRequestBody): void {
    this.#request(body).catch((err: Error) => {
      this.#onError?.(err);
    });
  }

  #onMessage(message: LammpsWorkerResponse): void {
    switch (message.type) {
      case "response": {
        const pending = this.#pending.get(message.id);
        if (!pending) {
          return;
        }
        this.#pending.delete(message.id);
        if (message.ok) {
          pending.resolve(message.result);
        } else {
          pending.reject(new Error(message.error));
        }
        return;
      }
      case "step":
        this.#latestStep = message.data;
        void this.#handleStep(message.data);
        return;
      case "output":
        this.#onOutput?.(message.stream, message.text);
        return;
    }
  }

  async #handleStep(data: WorkerStepData): Promise<void> {
    try {
      if (this.#stepHandler && !this.#stopRequested) {
        await this.#stepHandler(data);
      }
    } catch (err) {
      this.#stopRequested = true;
      this.#onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      // The worker keeps the simulation paused until this arrives.
      this.#send({ type: this.#stopRequested ? "abortRun" : "stepAck" });
    }
  }
}
