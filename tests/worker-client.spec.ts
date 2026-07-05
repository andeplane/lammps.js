import { describe, expect, it, vi } from "vitest";

import { LammpsWorkerClient } from "../dist/worker-client.js";
import type { WorkerLike } from "../dist/worker-client.js";
import type {
  LammpsWorkerRequest,
  LammpsWorkerResponse,
  WorkerStepData
} from "../dist/worker-protocol.js";

class FakeWorker implements WorkerLike {
  posted: LammpsWorkerRequest[] = [];
  terminated = false;
  #listener: ((event: { data: unknown }) => void) | null = null;

  postMessage(message: unknown): void {
    this.posted.push(message as LammpsWorkerRequest);
  }

  addEventListener(_type: "message", listener: (event: { data: unknown }) => void): void {
    this.#listener = listener;
  }

  terminate(): void {
    this.terminated = true;
  }

  dispatch(response: LammpsWorkerResponse): void {
    if (!this.#listener) {
      throw new Error("no listener registered");
    }
    this.#listener({ data: response });
  }

  respondOk(id: number, result?: unknown): void {
    this.dispatch({ type: "response", id, ok: true, result });
  }

  respondError(id: number, error: string): void {
    this.dispatch({ type: "response", id, ok: false, error });
  }

  lastRequest(): LammpsWorkerRequest {
    const request = this.posted[this.posted.length - 1];
    if (!request) {
      throw new Error("no request posted");
    }
    return request;
  }
}

async function createClient(options: Parameters<typeof LammpsWorkerClient.create>[1] = {}) {
  const worker = new FakeWorker();
  const pending = LammpsWorkerClient.create(worker, options, true);
  const init = worker.lastRequest();
  expect(init.type).toBe("init");
  worker.respondOk(init.id);
  const client = await pending;
  return { worker, client };
}

describe("LammpsWorkerClient", () => {
  it("sends init with the configured workdir on create", async () => {
    const worker = new FakeWorker();
    const pending = LammpsWorkerClient.create(worker, { workdir: "/sim" });

    expect(worker.lastRequest()).toEqual({ id: 1, type: "init", workdir: "/sim" });
    worker.respondOk(1);
    await pending;
  });

  it("rejects create when initialization fails", async () => {
    const worker = new FakeWorker();
    const pending = LammpsWorkerClient.create(worker);
    worker.respondError(worker.lastRequest().id, "wasm failed to load");

    await expect(pending).rejects.toThrow("wasm failed to load");
  });

  it("posts fire-and-forget commands and reports their failures via onError", async () => {
    const onError = vi.fn();
    const { worker, client } = await createClient({ onError });

    client.runCommand("run 0");
    const request = worker.lastRequest();
    expect(request).toMatchObject({ type: "runCommand", command: "run 0" });

    worker.respondError(request.id, "boom");
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("runs scripts asynchronously, delivering steps and acknowledging them", async () => {
    const { worker, client } = await createClient();
    const steps: WorkerStepData[] = [];

    const runPromise = client.runScriptAsync(
      "run 10",
      (data) => {
        steps.push(data);
      },
      { every: 2 }
    );

    const runRequest = worker.lastRequest();
    expect(runRequest).toMatchObject({
      type: "runScriptAsync",
      script: "run 10",
      options: { every: 2 }
    });

    worker.dispatch({
      type: "step",
      data: { step: 4, timestepSize: 0.001, computeScalars: { temp: 2.5 } }
    });

    await vi.waitFor(() => {
      expect(worker.posted.some((message) => message.type === "stepAck")).toBe(true);
    });
    expect(steps).toHaveLength(1);
    expect(steps[0].step).toBe(4);

    worker.respondOk(runRequest.id, { aborted: false, step: 10, timestepSize: 0.001 });
    const result = await runPromise;

    expect(result).toEqual({ aborted: false, step: 10, timestepSize: 0.001 });
    // Step data is cached for the synchronous getters.
    expect(client.getCurrentStep()).toBe(4);
    expect(client.getTimestepSize()).toBe(0.001);
    expect(client.getComputeScalar("temp")).toBe(2.5);
    expect(client.getComputeScalar("missing")).toBeNull();
  });

  it("caches the latest particle, bond, and box snapshots", async () => {
    const { worker, client } = await createClient();

    expect(client.syncParticles()).toBeNull();
    expect(client.syncBonds()).toBeNull();
    expect(client.syncBox()).toBeNull();

    const data: WorkerStepData = {
      step: 2,
      timestepSize: 0.005,
      particles: {
        count: 1,
        positions: new Float32Array([1, 2, 3]),
        ids: new Int32Array([1]),
        types: new Int32Array([1])
      },
      bonds: { count: 0, first: new Float32Array(0), second: new Float32Array(0) },
      box: {
        matrix: new Float32Array(9),
        origin: new Float32Array(3),
        lengths: new Float32Array([10, 10, 10])
      }
    };
    worker.dispatch({ type: "step", data });

    await vi.waitFor(() => {
      expect(worker.posted.some((message) => message.type === "stepAck")).toBe(true);
    });

    expect(client.syncParticles()?.count).toBe(1);
    expect(Array.from(client.syncParticles()?.positions ?? [])).toEqual([1, 2, 3]);
    expect(client.syncBonds()?.count).toBe(0);
    expect(Array.from(client.syncBox()?.lengths ?? [])).toEqual([10, 10, 10]);
  });

  it("stops an active run via stopRun", async () => {
    const { worker, client } = await createClient();
    const callback = vi.fn();

    const runPromise = client.runScriptAsync("run 100", callback, { every: 1 });
    const runRequest = worker.lastRequest();

    client.stopRun();
    expect(worker.lastRequest()).toMatchObject({ type: "abortRun" });

    // A step arriving after the stop request is not delivered to the
    // callback and is answered with abortRun instead of stepAck.
    worker.dispatch({ type: "step", data: { step: 1, timestepSize: 0.001 } });
    await vi.waitFor(() => {
      expect(
        worker.posted.filter((message) => message.type === "abortRun").length
      ).toBeGreaterThanOrEqual(2);
    });
    expect(callback).not.toHaveBeenCalled();
    expect(worker.posted.some((message) => message.type === "stepAck")).toBe(false);

    worker.respondOk(runRequest.id, { aborted: true, step: 1, timestepSize: 0.001 });
    const result = await runPromise;
    expect(result.aborted).toBe(true);
  });

  it("aborts the run when the step callback throws", async () => {
    const onError = vi.fn();
    const { worker, client } = await createClient({ onError });

    const runPromise = client.runScriptAsync(
      "run 100",
      () => {
        throw new Error("render failed");
      },
      { every: 1 }
    );
    const runRequest = worker.lastRequest();

    worker.dispatch({ type: "step", data: { step: 1, timestepSize: 0.001 } });
    await vi.waitFor(() => {
      expect(worker.posted.some((message) => message.type === "abortRun")).toBe(true);
    });
    expect(onError).toHaveBeenCalledTimes(1);

    worker.respondOk(runRequest.id, { aborted: true, step: 1, timestepSize: 0.001 });
    const result = await runPromise;
    expect(result.aborted).toBe(true);
  });

  it("forwards worker output to onOutput", async () => {
    const onOutput = vi.fn();
    const { worker } = await createClient({ onOutput });

    worker.dispatch({ type: "output", stream: "stdout", text: "Step 100" });
    worker.dispatch({ type: "output", stream: "stderr", text: "warning" });

    expect(onOutput).toHaveBeenNthCalledWith(1, "stdout", "Step 100");
    expect(onOutput).toHaveBeenNthCalledWith(2, "stderr", "warning");
  });

  it("resolves setAsyncStepFrequency with the worker result", async () => {
    const { worker, client } = await createClient();

    const pending = client.setAsyncStepFrequency(5, "myfix");
    const request = worker.lastRequest();
    expect(request).toMatchObject({ type: "setAsyncStepFrequency", every: 5, fixId: "myfix" });

    worker.respondOk(request.id, true);
    await expect(pending).resolves.toBe(true);
  });

  it("dispose sends dispose, rejects pending requests, and terminates an owned worker", async () => {
    const { worker, client } = await createClient();

    const pending = client.setAsyncStepFrequency(5);
    client.dispose();

    expect(worker.posted.some((message) => message.type === "dispose")).toBe(true);
    expect(worker.terminated).toBe(true);
    await expect(pending).rejects.toThrow("disposed");
  });
});
