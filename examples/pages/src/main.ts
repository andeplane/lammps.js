import { LammpsClient } from "lammps.js/client";
import { examples } from "./examples";

// Get DOM elements
const selectEl = document.getElementById("example-select") as HTMLSelectElement;
const runBtn = document.getElementById("run-btn") as HTMLButtonElement;
const codeEl = document.getElementById("lammps-code") as HTMLPreElement;
const outputEl = document.getElementById("console-output") as HTMLPreElement;

// Populate dropdown
examples.forEach((ex, i) => {
  const opt = document.createElement("option");
  opt.value = String(i);
  opt.textContent = ex.name;
  selectEl.appendChild(opt);
});

// Show code for selected example
function showExample(index: number) {
  codeEl.textContent = examples[index].script;
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

// Simulation state
let client: LammpsClient | null = null;
let isRunning = false;
let stopRequested = false;

function setRunning(running: boolean) {
  isRunning = running;
  runBtn.textContent = running ? "Stop" : "Run";
  runBtn.disabled = false;
}

runBtn.addEventListener("click", async () => {
  if (isRunning) {
    // Request a stop: the step callback rejects on the next invocation,
    // which aborts the run. Disposing here would tear down the LAMMPS
    // instance while the run is still suspended on the asyncify stack.
    stopRequested = true;
    runBtn.textContent = "Stopping…";
    runBtn.disabled = true;
    return;
  }

  // Start
  outputEl.textContent = "";
  stopRequested = false;
  setRunning(true);

  const index = Number(selectEl.value);
  const script = examples[index].script;

  try {
    client = await LammpsClient.create({
      print: (msg: string) => appendLine(msg),
      printErr: (msg: string) => appendLine(msg),
    });
    if (stopRequested) {
      return;
    }
    client.start();

    await client.runScriptAsync(
      script,
      async () => {
        if (stopRequested) {
          throw new Error("Stopped by user");
        }
        await new Promise(requestAnimationFrame);
      },
      { every: 100 }
    );
  } catch (err) {
    if (!stopRequested) {
      appendLine(`Error: ${err}`);
    }
  } finally {
    client?.dispose();
    client = null;
    if (stopRequested) {
      appendLine("Stopped.");
    }
    stopRequested = false;
    setRunning(false);
  }
});

window.addEventListener("beforeunload", () => {
  client?.dispose();
});
