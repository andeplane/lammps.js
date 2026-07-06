import { createChart } from "./chart";
import { createDraw } from "./draw";
import { createEditor } from "./editor";
import { isRunning, runSnippet, stopActiveRun } from "./runner";

import type { SnippetContext } from "./runner";

export type PaneKind = "console" | "canvas" | "chart";

export interface ExampleSpec {
  id: string;
  title: string;
  code: string;
  panes: PaneKind[];
}

const MAX_CONSOLE_LINES = 600;

export function createExampleBlock(spec: ExampleSpec): HTMLElement {
  const owner = Symbol(spec.id);

  const root = document.createElement("div");
  root.className = "example";
  root.id = `example-${spec.id}`;
  root.dataset.status = "idle";

  // header: LED, title, status, reset, run/stop
  const head = document.createElement("div");
  head.className = "example-head";
  const led = document.createElement("span");
  led.className = "led";
  const title = document.createElement("span");
  title.className = "ex-title";
  title.textContent = spec.title;
  const statusEl = document.createElement("span");
  statusEl.className = "ex-status";
  statusEl.textContent = "idle";
  const resetBtn = document.createElement("button");
  resetBtn.className = "btn";
  resetBtn.textContent = "Reset code";
  const copyBtn = document.createElement("button");
  copyBtn.className = "btn";
  copyBtn.textContent = "Copy";
  const runBtn = document.createElement("button");
  runBtn.className = "btn btn-run";
  runBtn.textContent = "▶ Run";
  head.append(led, title, statusEl, copyBtn, resetBtn, runBtn);

  const editor = createEditor(spec.code.trimEnd());

  const panes = document.createElement("div");
  panes.className = "example-panes";
  const visualPanes = spec.panes.filter((p) => p !== "console");
  if (visualPanes.length > 0 && spec.panes.includes("console")) {
    panes.classList.add("split");
  }

  let consoleEl: HTMLPreElement | null = null;
  const context: SnippetContext = {
    log: () => {
      /* replaced below when a console pane exists */
    }
  };

  for (const kind of spec.panes) {
    const pane = document.createElement("div");
    pane.className = `pane pane-${kind}`;
    const label = document.createElement("div");
    label.className = "pane-label";
    label.textContent = kind === "console" ? "output" : kind === "canvas" ? "simulation" : "chart";
    pane.appendChild(label);

    if (kind === "console") {
      consoleEl = document.createElement("pre");
      consoleEl.className = "pane-console";
      pane.appendChild(consoleEl);
    } else if (kind === "canvas") {
      const canvas = document.createElement("canvas");
      pane.appendChild(canvas);
      context.draw = createDraw(canvas);
    } else {
      const host = document.createElement("div");
      pane.appendChild(host);
      context.chart = createChart(host);
    }
    panes.appendChild(pane);
  }

  if (consoleEl) {
    const target = consoleEl;
    context.log = (...args: unknown[]) => {
      const line = document.createTextNode(args.join(" ") + "\n");
      target.appendChild(line);
      while (target.childNodes.length > MAX_CONSOLE_LINES) {
        target.removeChild(target.firstChild!);
      }
      target.scrollTop = target.scrollHeight;
    };
  }

  function setStatus(status: string) {
    root.dataset.status = status;
    statusEl.textContent = status;
    const running = status === "loading" || status === "running" || status === "stopping";
    runBtn.textContent = running ? "■ Stop" : "▶ Run";
    runBtn.dataset.mode = running ? "stop" : "run";
    runBtn.disabled = status === "stopping";
  }

  runBtn.addEventListener("click", async () => {
    if (isRunning(owner)) {
      stopActiveRun();
      return;
    }
    if (consoleEl) consoleEl.textContent = "";
    setStatus("loading");
    await runSnippet(owner, editor.getValue(), context, { setStatus });
  });

  resetBtn.addEventListener("click", () => {
    editor.setValue(spec.code.trimEnd());
  });

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(editor.getValue());
      copyBtn.textContent = "Copied ✓";
    } catch {
      copyBtn.textContent = "Copy failed";
    }
    setTimeout(() => {
      copyBtn.textContent = "Copy";
    }, 1400);
  });

  root.append(head, editor.root, panes);
  return root;
}
