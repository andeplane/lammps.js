import { LammpsClient } from "lammps.js/client";
import type { LammpsWorkerClient } from "lammps.js/client";
import { examples } from "./examples";

// Get DOM elements
const selectEl = document.getElementById("example-select") as HTMLSelectElement;
const multithreadEl = document.getElementById("multithread-checkbox") as HTMLInputElement;
const threadsLabelEl = document.getElementById("threads-label") as HTMLLabelElement;
const threadsSelectEl = document.getElementById("threads-select") as HTMLSelectElement;
const runBtn = document.getElementById("run-btn") as HTMLButtonElement;
const codeEl = document.getElementById("lammps-code") as HTMLTextAreaElement;
const outputEl = document.getElementById("console-output") as HTMLPreElement;

// Populate dropdown
examples.forEach((ex, i) => {
  const opt = document.createElement("option");
  opt.value = String(i);
  opt.textContent = ex.name;
  selectEl.appendChild(opt);
});

// Thread choices for multithreaded (KOKKOS) runs: powers of two up to the module's
// pthread pool size (8), defaulting to the hardware concurrency. The
// selection is passed to LAMMPS as `-k on t N` when the client starts —
// it is not part of the script.
const MAX_KOKKOS_THREADS = 8;
const defaultThreads = Math.min(navigator.hardwareConcurrency || 4, MAX_KOKKOS_THREADS);
for (let threads = 1; threads <= MAX_KOKKOS_THREADS; threads *= 2) {
  const opt = document.createElement("option");
  opt.value = String(threads);
  opt.textContent = String(threads);
  if (threads === defaultThreads || (threads < defaultThreads && threads * 2 > defaultThreads)) {
    opt.selected = true;
  }
  threadsSelectEl.appendChild(opt);
}

// The threads dropdown is only shown while multithreading is enabled.
function updateThreadsVisibility() {
  threadsLabelEl.classList.toggle("visible", multithreadEl.checked);
}
multithreadEl.addEventListener("change", updateThreadsVisibility);

// Show code for selected example (editable — running uses the textarea contents).
// An example's `kokkos` flag sets the checkbox default; the user can toggle it.
function showExample(index: number) {
  codeEl.value = examples[index].script;
  multithreadEl.checked = Boolean(examples[index].kokkos);
  updateThreadsVisibility();
}
showExample(0);

selectEl.addEventListener("change", () => {
  showExample(Number(selectEl.value));
});

// Output management
function appendLine(text: string) {
  outputEl.textContent += text + "\n";
  outputEl.scrollTop = outputEl.scrollHeight;
}

// Simulation state. The simulation runs inside a Web Worker so even the
// 1M-atom example never blocks the page.
let client: LammpsWorkerClient | null = null;
let worker: Worker | null = null;
let isRunning = false;
let stopRequested = false;

function setRunning(running: boolean) {
  isRunning = running;
  runBtn.textContent = running ? "Stop" : "Run";
  runBtn.disabled = false;
}

runBtn.addEventListener("click", async () => {
  if (isRunning) {
    // Ask the worker to abort at its next step callback; the pending
    // runScriptAsync promise resolves with aborted: true.
    stopRequested = true;
    client?.stopRun();
    runBtn.textContent = "Stopping…";
    runBtn.disabled = true;
    return;
  }

  // Start
  outputEl.textContent = "";
  stopRequested = false;
  setRunning(true);

  const script = codeEl.value;
  const example = examples[Number(selectEl.value)];
  const every = example?.every ?? 100;

  let kokkos: { threads: number } | undefined;
  if (multithreadEl.checked) {
    if (crossOriginIsolated) {
      kokkos = { threads: Number(threadsSelectEl.value) || 1 };
      appendLine(`Running on the KOKKOS build with ${kokkos.threads} thread(s).\n`);
    } else {
      appendLine(
        "SharedArrayBuffer is unavailable (page is not cross-origin isolated); " +
          "falling back to the single-threaded build.\n"
      );
    }
  }

  try {
    worker = new Worker(new URL("./lammps.worker.ts", import.meta.url), {
      type: "module",
    });
    client = await LammpsClient.create(
      {
        // Once the user has asked to stop, suppress further output:
        // aborting the run makes LAMMPS print an "async step callback
        // rejected" error that is expected here and would just be noise
        // before the "Stopped." line.
        print: (msg: unknown) => {
          if (!stopRequested) appendLine(String(msg));
        },
        printErr: (msg: unknown) => {
          if (!stopRequested) appendLine(String(msg));
        },
      },
      { worker, kokkos }
    );
    if (stopRequested) {
      return;
    }

    const result = await client.runScriptAsync(
      script,
      async () => {
        await new Promise(requestAnimationFrame);
      },
      { every }
    );
    if (result.aborted) {
      stopRequested = true;
    }
  } catch (err) {
    if (!stopRequested) {
      appendLine(`Error: ${err}`);
    }
  } finally {
    client?.dispose();
    client = null;
    // dispose() leaves caller-provided workers alive; terminate ours.
    worker?.terminate();
    worker = null;
    if (stopRequested) {
      appendLine("Stopped.");
    }
    stopRequested = false;
    setRunning(false);
  }
});

window.addEventListener("beforeunload", () => {
  client?.dispose();
  worker?.terminate();
});
