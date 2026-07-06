import { LammpsClient } from "lammps.js/client";

import type { ChartApi } from "./chart";
import type { DrawFn } from "./draw";

// Executes an editable docs snippet. Snippets are the exact code an npm
// consumer would write, plus three documented docs-page helpers (log, draw,
// chart) and a `sim` handle for cooperative stopping. The import line is
// shown for copyability and stripped before evaluation; `LammpsClient` is
// provided as a facade so `worker: true` — which normally resolves the
// worker entry relative to the installed package — is rewired to a
// vite-bundled worker.

export interface SnippetContext {
  log: (...args: unknown[]) => void;
  draw?: DrawFn;
  chart?: ChartApi;
}

export interface RunStatusSink {
  setStatus(status: "idle" | "loading" | "running" | "stopping" | "done" | "error"): void;
}

interface ActiveRun {
  requestStop(): void;
  done: Promise<void>;
}

let activeRun: ActiveRun | null = null;

/** The block that owns the currently running snippet (for UI resets). */
let activeOwner: symbol | null = null;

export function isRunning(owner: symbol): boolean {
  return activeOwner === owner && activeRun !== null;
}

export function stopActiveRun(): void {
  activeRun?.requestStop();
}

const AsyncFunction = Object.getPrototypeOf(async function () {
  /* prototype probe */
}).constructor as new (...args: string[]) => (...fnArgs: unknown[]) => Promise<unknown>;

function stripLammpsImports(code: string): string {
  // Keep line numbers stable: blank the import lines instead of removing them.
  return code.replace(/^import\s[^\n]*?"lammps\.js\/[^"]*";?[^\n]*$/gm, "");
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return String(value);
  }
  try {
    return JSON.stringify(
      value,
      (_key, v: unknown) => {
        if (typeof v === "bigint") return v.toString();
        if (ArrayBuffer.isView(v)) {
          const arr = v as unknown as ArrayLike<unknown>;
          const head = Array.from({ length: Math.min(arr.length, 8) }, (_, i) => arr[i]);
          return `[${head.join(", ")}${arr.length > 8 ? ", …" : ""}] (${arr.length})`;
        }
        return v;
      },
      2
    );
  } catch {
    return String(value);
  }
}

export async function runSnippet(
  owner: symbol,
  code: string,
  context: SnippetContext,
  status: RunStatusSink
): Promise<void> {
  // Only one simulation at a time keeps memory in check. Ask a previous run
  // to stop and give it a moment to unwind before starting the next one.
  if (activeRun) {
    activeRun.requestStop();
    await Promise.race([
      activeRun.done,
      new Promise((resolve) => setTimeout(resolve, 5000))
    ]);
  }

  const workers: Worker[] = [];
  const clients: { dispose?: () => void; stopRun?: () => void }[] = [];
  const stopCallbacks: (() => void)[] = [];
  let stopped = false;

  const sim = {
    get stopped() {
      return stopped;
    },
    onStop(fn: () => void) {
      stopCallbacks.push(fn);
    }
  };

  const clientFacade = {
    create: async (
      moduleOptions: Record<string, unknown> = {},
      clientOptions: Record<string, unknown> = {}
    ) => {
      const options = { ...clientOptions };
      if (options.worker === true) {
        const worker = new Worker(new URL("../lammps.worker.ts", import.meta.url), {
          type: "module"
        });
        workers.push(worker);
        options.worker = worker;
      }
      status.setStatus("loading");
      const client = await LammpsClient.create(
        moduleOptions,
        options as unknown as Parameters<typeof LammpsClient.create>[1]
      );
      clients.push(client as unknown as (typeof clients)[number]);
      status.setStatus(stopped ? "stopping" : "running");
      return client;
    }
  };

  const log = (...args: unknown[]) => {
    context.log(...args.map(formatValue));
  };

  let requestStopFn = () => {
    stopped = true;
  };

  const done = (async () => {
    try {
      const fn = new AsyncFunction(
        "LammpsClient",
        "log",
        "draw",
        "chart",
        "sim",
        stripLammpsImports(code)
      );
      context.chart?.clear();
      await fn(clientFacade, log, context.draw, context.chart, sim);
      status.setStatus(stopped ? "idle" : "done");
    } catch (err) {
      if (stopped) {
        status.setStatus("idle");
      } else {
        context.log(`✗ ${err instanceof Error ? err.message : String(err)}`);
        status.setStatus("error");
      }
    } finally {
      for (const client of clients) {
        try {
          client.dispose?.();
        } catch {
          /* already gone */
        }
      }
      for (const worker of workers) {
        worker.terminate();
      }
      if (activeOwner === owner) {
        activeRun = null;
        activeOwner = null;
      }
    }
  })();

  requestStopFn = () => {
    if (stopped) return;
    stopped = true;
    status.setStatus("stopping");
    for (const fn of stopCallbacks) {
      try {
        fn();
      } catch {
        /* snippet callback errors are not fatal to stopping */
      }
    }
    // Worker-backed clients can abort at the next step callback.
    for (const client of clients) {
      try {
        client.stopRun?.();
      } catch {
        /* ignore */
      }
    }
  };

  activeRun = { requestStop: () => requestStopFn(), done };
  activeOwner = owner;
  await done;
}
