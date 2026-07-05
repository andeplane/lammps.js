import { LammpsClient } from "lammps.js/client";
import type { LammpsWorkerClient } from "lammps.js/client";
import { examples } from "./examples";

// Get DOM elements
const selectEl = document.getElementById("example-select") as HTMLSelectElement;
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

// Show code for selected example (editable — running uses the textarea contents)
function showExample(index: number) {
  codeEl.value = examples[index].script;
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
  const every = examples[Number(selectEl.value)]?.every ?? 100;

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
      { worker }
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
