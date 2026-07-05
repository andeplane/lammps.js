import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { installLammpsWorker } from "../dist/worker-host.js";
import type { WorkerScope } from "../dist/worker-host.js";
import type { LammpsClient, AsyncStepData } from "../dist/client.js";
import type { LammpsWorkerRequest, LammpsWorkerResponse } from "../dist/worker-protocol.js";

type StepCallback = (data: AsyncStepData) => void | Promise<void>;

function createScope() {
  const posted: LammpsWorkerResponse[] = [];
  let listener: ((event: { data: unknown }) => void) | null = null;

  const scope: WorkerScope = {
    postMessage: (message) => {
      posted.push(message);
    },
    addEventListener: (_type, handler) => {
      listener = handler;
    }
  };

  const dispatch = (request: LammpsWorkerRequest) => {
    if (!listener) {
      throw new Error("worker host did not register a message listener");
    }
    listener({ data: request });
  };

  return { scope, posted, dispatch };
}

interface ClientMocks {
  start: Mock;
  stop: Mock;
  dispose: Mock;
  runCommand: Mock;
  runScript: Mock;
  runScriptAsync: Mock;
  advance: Mock;
  writeFile: Mock;
  removeFile: Mock;
  setAsyncStepFrequency: Mock;
  getCurrentStep: Mock;
  getTimestepSize: Mock;
}

function createClientMocks(): ClientMocks {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
    runCommand: vi.fn(),
    runScript: vi.fn(),
    runScriptAsync: vi.fn(),
    advance: vi.fn(),
    writeFile: vi.fn(),
    removeFile: vi.fn(),
    setAsyncStepFrequency: vi.fn(() => true),
    getCurrentStep: vi.fn(() => 12),
    getTimestepSize: vi.fn(() => 0.005)
  };
}

async function createInitializedHost() {
  const { scope, posted, dispatch } = createScope();
  const mocks = createClientMocks();
  let capturedModuleOptions: Record<string, unknown> | null = null;
  const createClient = vi.fn(async (moduleOptions: Record<string, unknown>) => {
    capturedModuleOptions = moduleOptions;
    const clientMock: Partial<LammpsClient> = mocks;
    return clientMock as unknown as LammpsClient;
  });

  installLammpsWorker(scope, { createClient });
  dispatch({ id: 1, type: "init", workdir: "/sim" });
  await vi.waitFor(() => {
    expect(posted).toContainEqual({ type: "response", id: 1, ok: true, result: undefined });
  });

  return {
    scope,
    posted,
    dispatch,
    mocks,
    createClient,
    moduleOptions: () => capturedModuleOptions
  };
}

describe("installLammpsWorker", () => {
  it("initializes and starts a client with the requested workdir", async () => {
    const host = await createInitializedHost();

    expect(host.createClient).toHaveBeenCalledWith(expect.anything(), { workdir: "/sim" });
    expect(host.mocks.start).toHaveBeenCalledTimes(1);
  });

  it("rejects requests before initialization", async () => {
    const { scope, posted, dispatch } = createScope();
    installLammpsWorker(scope, {
      createClient: vi.fn(async () => {
        throw new Error("should not be called");
      })
    });

    dispatch({ id: 7, type: "runCommand", command: "run 1" });

    await vi.waitFor(() => {
      expect(posted).toContainEqual({
        type: "response",
        id: 7,
        ok: false,
        error: "LAMMPS worker is not initialized"
      });
    });
  });

  it("forwards stdout/stderr as output messages", async () => {
    const host = await createInitializedHost();

    const options = host.moduleOptions();
    expect(options).not.toBeNull();
    const print = options?.print as (text: string) => void;
    const printErr = options?.printErr as (text: string) => void;
    print("hello");
    printErr("oops");

    expect(host.posted).toContainEqual({ type: "output", stream: "stdout", text: "hello" });
    expect(host.posted).toContainEqual({ type: "output", stream: "stderr", text: "oops" });
  });

  it("delegates simple commands", async () => {
    const host = await createInitializedHost();

    host.dispatch({ id: 2, type: "runCommand", command: "run 0" });
    host.dispatch({ id: 3, type: "runScript", script: "units lj\n" });
    host.dispatch({ id: 4, type: "advance", steps: 3, applyPre: true, applyPost: false });
    host.dispatch({ id: 5, type: "writeFile", path: "in.lj", content: "units lj\n" });
    host.dispatch({ id: 6, type: "removeFile", path: "in.lj" });
    host.dispatch({ id: 7, type: "setAsyncStepFrequency", every: 4, fixId: "myfix" });

    await vi.waitFor(() => {
      expect(host.posted).toContainEqual({ type: "response", id: 7, ok: true, result: true });
    });

    expect(host.mocks.runCommand).toHaveBeenCalledWith("run 0");
    expect(host.mocks.runScript).toHaveBeenCalledWith("units lj\n");
    expect(host.mocks.advance).toHaveBeenCalledWith(3, { applyPre: true, applyPost: false });
    expect(host.mocks.writeFile).toHaveBeenCalledWith("in.lj", "units lj\n");
    expect(host.mocks.removeFile).toHaveBeenCalledWith("in.lj");
    expect(host.mocks.setAsyncStepFrequency).toHaveBeenCalledWith(4, "myfix");
  });

  it("runs scripts asynchronously, pausing each step until acknowledged", async () => {
    const host = await createInitializedHost();

    host.mocks.runScriptAsync.mockImplementation(
      async (_script: string, callback: StepCallback) => {
        await callback({ step: 5, computeScalars: { temp: 1.5 } });
      }
    );

    host.dispatch({ id: 2, type: "runScriptAsync", script: "run 10", options: { every: 2 } });

    await vi.waitFor(() => {
      expect(host.posted.some((message) => message.type === "step")).toBe(true);
    });
    // The run must not complete until the main thread acknowledges the step.
    expect(
      host.posted.some((message) => message.type === "response" && message.id === 2)
    ).toBe(false);

    host.dispatch({ id: 3, type: "stepAck" });

    await vi.waitFor(() => {
      expect(host.posted).toContainEqual({
        type: "response",
        id: 2,
        ok: true,
        result: { aborted: false, step: 12, timestepSize: 0.005 }
      });
    });

    const step = host.posted.find((message) => message.type === "step");
    expect(step).toEqual({
      type: "step",
      data: { step: 5, timestepSize: 0.005, computeScalars: { temp: 1.5 } }
    });

    // Snapshot copies are mandatory for transfer safety.
    const runOptions = host.mocks.runScriptAsync.mock.calls[0][2] as { copy?: boolean };
    expect(runOptions.copy).toBe(true);
  });

  it("aborts a run when requested and reports aborted: true", async () => {
    const host = await createInitializedHost();

    host.mocks.runScriptAsync.mockImplementation(
      async (_script: string, callback: StepCallback) => {
        await callback({ step: 5 });
      }
    );

    host.dispatch({ id: 2, type: "runScriptAsync", script: "run 10", options: { every: 2 } });
    await vi.waitFor(() => {
      expect(host.posted.some((message) => message.type === "step")).toBe(true);
    });

    host.dispatch({ id: 3, type: "abortRun" });

    await vi.waitFor(() => {
      expect(host.posted).toContainEqual({
        type: "response",
        id: 2,
        ok: true,
        result: { aborted: true, step: 12, timestepSize: 0.005 }
      });
    });
  });

  it("reports run failures as error responses", async () => {
    const host = await createInitializedHost();

    host.mocks.runScriptAsync.mockImplementation(async () => {
      throw new Error("bad script");
    });

    host.dispatch({ id: 2, type: "runScriptAsync", script: "run 10", options: { every: 1 } });

    await vi.waitFor(() => {
      expect(host.posted).toContainEqual({
        type: "response",
        id: 2,
        ok: false,
        error: "bad script"
      });
    });
  });

  it("stops and disposes the client", async () => {
    const host = await createInitializedHost();

    host.dispatch({ id: 2, type: "stop" });
    host.dispatch({ id: 3, type: "dispose" });

    await vi.waitFor(() => {
      expect(host.posted).toContainEqual({ type: "response", id: 3, ok: true, result: undefined });
    });
    expect(host.mocks.stop).toHaveBeenCalledTimes(1);
    expect(host.mocks.dispose).toHaveBeenCalledTimes(1);

    // After dispose the client is gone.
    host.dispatch({ id: 4, type: "runCommand", command: "run 0" });
    await vi.waitFor(() => {
      expect(host.posted).toContainEqual({
        type: "response",
        id: 4,
        ok: false,
        error: "LAMMPS worker is not initialized"
      });
    });
  });
});
