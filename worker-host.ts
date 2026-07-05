import { LammpsClient } from "./client.js";
import { serializeStepData } from "./worker-protocol.js";
import type {
  LammpsWorkerRequest,
  LammpsWorkerResponse,
  WorkerRunResult
} from "./worker-protocol.js";

export interface WorkerScope {
  postMessage(message: LammpsWorkerResponse, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

export interface InstallLammpsWorkerOptions {
  /** Injectable factory, used by tests to supply a mock client. */
  createClient?: (
    moduleOptions: Record<string, unknown>,
    clientOptions: { workdir?: string }
  ) => Promise<LammpsClient>;
}

class RunAbortedError extends Error {
  constructor() {
    super("Run aborted");
    this.name = "RunAbortedError";
  }
}

/**
 * Services LammpsWorkerRequest messages inside a Web Worker. The wasm
 * module and LammpsClient live entirely inside the worker; snapshots are
 * copied and transferred to the main thread per step.
 */
export function installLammpsWorker(scope: WorkerScope, options: InstallLammpsWorkerOptions = {}): void {
  const createClient =
    options.createClient ??
    ((moduleOptions: Record<string, unknown>, clientOptions: { workdir?: string }) =>
      LammpsClient.create(moduleOptions, clientOptions));

  let client: LammpsClient | null = null;
  let abortRequested = false;
  let pendingAck: (() => void) | null = null;

  const post = (message: LammpsWorkerResponse, transfer?: ArrayBuffer[]) => {
    scope.postMessage(message, transfer);
  };
  const respond = (id: number, result?: unknown) => {
    post({ type: "response", id, ok: true, result });
  };

  const requireClient = (): LammpsClient => {
    if (!client) {
      throw new Error("LAMMPS worker is not initialized");
    }
    return client;
  };

  const releaseAck = () => {
    const resolve = pendingAck;
    pendingAck = null;
    resolve?.();
  };

  async function runScriptAsync(
    request: Extract<LammpsWorkerRequest, { type: "runScriptAsync" }>
  ): Promise<WorkerRunResult> {
    const target = requireClient();
    abortRequested = false;

    try {
      await target.runScriptAsync(
        request.script,
        async (data) => {
          if (abortRequested) {
            throw new RunAbortedError();
          }
          const { data: payload, transfer } = serializeStepData(data, target.getTimestepSize());
          post({ type: "step", data: payload }, transfer);
          // The simulation stays paused until the main thread acknowledges
          // the step (or aborts the run).
          await new Promise<void>((resolve) => {
            pendingAck = resolve;
          });
          if (abortRequested) {
            throw new RunAbortedError();
          }
        },
        {
          every: request.options.every,
          fixId: request.options.fixId,
          wrapped: request.options.wrapped,
          computeScalars: request.options.computeScalars,
          // Copies are mandatory: transferred buffers must not alias the heap.
          copy: true
        }
      );
    } catch (err) {
      // A step-callback throw (our RunAbortedError) is how we ask fix
      // js/async to stop. The client swallows that error — it aborts the
      // run and resolves rather than rejecting — so reaching here means a
      // genuine run failure, which must propagate.
      if (!abortRequested) {
        throw err;
      }
    } finally {
      pendingAck = null;
    }

    // `abortRequested` is the source of truth: fix js/async aborts by
    // resolving (not rejecting), so we can't infer the outcome from a
    // thrown error alone.
    return {
      aborted: abortRequested,
      step: target.getCurrentStep(),
      timestepSize: target.getTimestepSize()
    };
  }

  async function handle(request: LammpsWorkerRequest): Promise<void> {
    try {
      switch (request.type) {
        case "init": {
          client = await createClient(
            {
              print: (text: unknown) => post({ type: "output", stream: "stdout", text: String(text) }),
              printErr: (text: unknown) => post({ type: "output", stream: "stderr", text: String(text) })
            },
            { workdir: request.workdir }
          );
          client.start();
          respond(request.id);
          break;
        }
        case "runCommand":
          requireClient().runCommand(request.command);
          respond(request.id);
          break;
        case "runScript":
          requireClient().runScript(request.script);
          respond(request.id);
          break;
        case "runScriptAsync":
          respond(request.id, await runScriptAsync(request));
          break;
        case "advance":
          requireClient().advance(request.steps, {
            applyPre: request.applyPre,
            applyPost: request.applyPost
          });
          respond(request.id);
          break;
        case "writeFile":
          requireClient().writeFile(request.path, request.content);
          respond(request.id);
          break;
        case "removeFile":
          requireClient().removeFile(request.path);
          respond(request.id);
          break;
        case "setAsyncStepFrequency":
          respond(request.id, requireClient().setAsyncStepFrequency(request.every, request.fixId));
          break;
        case "stepAck":
          releaseAck();
          respond(request.id);
          break;
        case "abortRun":
          abortRequested = true;
          releaseAck();
          respond(request.id);
          break;
        case "stop":
          requireClient().stop();
          respond(request.id);
          break;
        case "dispose":
          client?.dispose();
          client = null;
          respond(request.id);
          break;
      }
    } catch (err) {
      post({
        type: "response",
        id: request.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  scope.addEventListener("message", (event) => {
    void handle(event.data as LammpsWorkerRequest);
  });
}
