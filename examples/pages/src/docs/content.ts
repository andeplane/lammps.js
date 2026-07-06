import asyncBasic from "./snippets/async-basic.js?raw";
import asyncRetune from "./snippets/async-retune.js?raw";
import asyncScalars from "./snippets/async-scalars.js?raw";
import bonds from "./snippets/bonds.js?raw";
import errors from "./snippets/errors.js?raw";
import files from "./snippets/files.js?raw";
import gettingStarted from "./snippets/getting-started.js?raw";
import kokkos from "./snippets/kokkos.js?raw";
import manualStep from "./snippets/manual-step.js?raw";
import minimize from "./snippets/minimize.js?raw";
import modifiersRdf from "./snippets/modifiers-rdf.js?raw";
import monitor from "./snippets/monitor.js?raw";
import perAtom from "./snippets/per-atom.js?raw";
import runCommands from "./snippets/run-commands.js?raw";
import snapshots from "./snippets/snapshots.js?raw";
import walls from "./snippets/walls.js?raw";
import workerSnippet from "./snippets/worker.js?raw";

import type { ExampleSpec } from "./block";

export interface RefRow {
  /** Signature, rendered in mono. */
  sig: string;
  /** Short description; may contain inline HTML. */
  desc: string;
  /** Optional #section-id demonstrating it. */
  see?: string;
}

export interface RefGroup {
  title: string;
  rows: RefRow[];
}

export interface Section {
  id: string;
  title: string;
  /** HTML paragraphs shown under the heading. */
  intro: string;
  examples?: ExampleSpec[];
  reference?: RefGroup[];
}

export const heroHtml = `
  <h1>lammps<span class="dot">.js</span> docs</h1>
  <p class="tagline">
    LAMMPS — the classical molecular dynamics code — compiled to WebAssembly,
    with a TypeScript client. Everything on this page runs live in your
    browser: every example below is <strong>editable</strong>, press
    <strong>▶ Run</strong> and the real simulation engine executes it.
  </p>
  <span class="install"><span class="prompt">$</span> npm install lammps.js</span>
`;

export const helpersNote = `
  The examples use three helpers provided by this page — in your app, replace
  them with your own UI: <code>log(…)</code> prints to the output pane,
  <code>draw(data)</code> renders particles to the canvas pane, and
  <code>chart</code> is a small line chart (<code>chart.add</code>,
  <code>chart.set</code>, <code>chart.axes</code>). <code>sim.stopped</code> /
  <code>sim.onStop</code> wire the ■ Stop button. Everything else is exactly
  the code you would ship. One example runs at a time.
`;

export const sections: Section[] = [
  {
    id: "getting-started",
    title: "Getting started",
    intro: `
      <p><code>LammpsClient.create()</code> fetches and instantiates the wasm
      module (≈10&nbsp;MB, cached after the first load), and
      <code>start()</code> boots a LAMMPS session. The <code>print</code> /
      <code>printErr</code> module options receive LAMMPS' stdout and stderr
      line by line.</p>
      <p>A client owns one LAMMPS session at a time — <code>start()</code>
      again gives you a clean slate, <code>dispose()</code> tears everything
      down.</p>`,
    examples: [
      {
        id: "getting-started",
        title: "hello, LAMMPS",
        code: gettingStarted,
        panes: ["console"]
      }
    ]
  },
  {
    id: "running-scripts",
    title: "Scripts, commands & files",
    intro: `
      <p>Three ways in: <code>runScript(script)</code> executes a multi-line
      input, <code>runCommand(command)</code> executes a single command (and
      chains), and <code>runInput(path, content)</code> writes a file into the
      module's in-memory filesystem and runs it — so <code>include</code>,
      <code>read_data</code>, potentials and dump files all behave exactly as
      they do on disk.</p>
      <p>The filesystem is reachable both through the client
      (<code>writeFile</code>, <code>removeFile</code>) and in full through
      the Emscripten API at <code>client.module.FS</code>.</p>`,
    examples: [
      {
        id: "run-commands",
        title: "single commands + LAMMPS variables",
        code: runCommands,
        panes: ["console"]
      },
      {
        id: "files",
        title: "virtual filesystem: run a file, read a dump back",
        code: files,
        panes: ["console"]
      }
    ]
  },
  {
    id: "run-script-async",
    title: "The main flow: runScriptAsync",
    intro: `
      <p><code>runScriptAsync(script, callback, options)</code> is the heart
      of lammps.js. It installs a <code>js/async</code> fix before the run so
      your callback fires every <code>every</code> timesteps of every
      <code>run</code> and <code>minimize</code> in the script — with fresh
      particle, bond and box snapshots. <strong>LAMMPS waits for your
      callback's promise</strong> before continuing, which gives you
      frame-perfect rendering and free speed control: await
      <code>requestAnimationFrame</code> for display-rate, await a timeout to
      slow down, resolve immediately to go flat out.</p>
      <p>Options: <code>every</code> (callback cadence),
      <code>computeScalars</code> (compute IDs whose scalars are delivered per
      callback), <code>wrapped</code> (remap atoms into the periodic box),
      <code>copy</code> (snapshot arrays detached from wasm memory — the
      default here), and <code>fixId</code> (use your own
      <code>fix … js/async</code> id if the script manages it itself).</p>
      <p>Two rules of the road: call client methods <strong>before the first
      <code>await</code></strong> in your callback — while the callback's
      promise is pending the engine is suspended and must not be re-entered —
      and only request computes that LAMMPS can evaluate on any step
      (pressure-style computes need their virial tallied, so read those from
      thermo output instead).</p>`,
    examples: [
      {
        id: "async-basic",
        title: "per-step callback",
        code: asyncBasic,
        panes: ["console"]
      },
      {
        id: "async-scalars",
        title: "computeScalars: live values without parsing thermo",
        code: asyncScalars,
        panes: ["console", "chart"]
      },
      {
        id: "async-retune",
        title: "speed control + setAsyncStepFrequency mid-run",
        code: asyncRetune,
        panes: ["console"]
      },
      {
        id: "minimize",
        title: "it hooks minimize too",
        code: minimize,
        panes: ["console", "chart"]
      }
    ]
  },
  {
    id: "snapshots",
    title: "Snapshots: particles, bonds, box",
    intro: `
      <p>Step callbacks receive snapshots; you can also pull them on demand
      with <code>syncParticles()</code>, <code>syncBonds()</code> and
      <code>syncBox()</code>. Positions are flat
      <code>Float32Array</code> xyz triplets; ids and types come along for the
      ride. By default the sync methods return <strong>zero-copy views</strong>
      into wasm memory — valid until the next command — while
      <code>copy: true</code> (and everything delivered to
      <code>runScriptAsync</code> callbacks) gives you detached copies.</p>`,
    examples: [
      {
        id: "snapshots",
        title: "render a melt from particle snapshots",
        code: snapshots,
        panes: ["console", "canvas"]
      }
    ]
  },
  {
    id: "manual-stepping",
    title: "Manual stepping",
    intro: `
      <p>For full control, skip <code>run</code> entirely:
      <code>advance(steps)</code> integrates synchronously and returns, so you
      can drive the simulation from your own render loop. Pair it with
      <code>getCurrentStep()</code> and <code>getTimestepSize()</code>.</p>`,
    examples: [
      {
        id: "manual-step",
        title: "your loop, your frames",
        code: manualStep,
        panes: ["console", "canvas"]
      }
    ]
  },
  {
    id: "worker-mode",
    title: "Web Worker mode",
    intro: `
      <p>Pass <code>worker: true</code> and the whole engine — wasm module
      included — runs inside a Web Worker. <code>create()</code> resolves to a
      <code>LammpsWorkerClient</code>: commands are forwarded, per-step
      snapshots arrive as copied, <em>transferred</em> arrays (zero-copy
      handoff), and the simulation still pauses until your main-thread
      callback resolves. The page can never jank, no matter how heavy the
      run.</p>
      <p>Differences from the main-thread client: snapshot getters return the
      <strong>latest step received</strong> rather than reading live wasm
      memory, fire-and-forget commands report failures via
      <code>onError</code>, and <code>stopRun()</code> aborts an active run at
      its next callback. No SharedArrayBuffer or special headers needed —
      this is plain <code>postMessage</code>. If your bundler needs to control
      worker creation, pass a <code>Worker</code> instance instead of
      <code>true</code>.</p>`,
    examples: [
      {
        id: "worker",
        title: "a heavy run that can't block the page — and a real Stop",
        code: workerSnippet,
        panes: ["console", "canvas"]
      }
    ]
  },
  {
    id: "kokkos",
    title: "Multithreading (KOKKOS)",
    intro: `
      <p>The package ships a second wasm build with the KOKKOS package:
      LAMMPS runs across a pthread pool (up to 8 threads), started with
      <code>-k on t N -sf kk</code> so plain scripts pick up the
      <code>/kk</code> accelerated styles automatically. Opt in with the
      <code>kokkos</code> client option; it combines with
      <code>worker: true</code>.</p>
      <p>It requires <code>SharedArrayBuffer</code>, i.e. a
      <a href="https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements"
      target="_blank" rel="noopener">cross-origin isolated</a> page: send
      <code>Cross-Origin-Opener-Policy: same-origin</code> and
      <code>Cross-Origin-Embedder-Policy: require-corp</code>, or on static
      hosts use the
      <a href="https://github.com/gzuidhof/coi-serviceworker" target="_blank"
      rel="noopener">coi-serviceworker</a> shim (this page does). Typical
      speedups on a 13.5k-atom melt: ~1.8× on 2 threads, ~3× on 4, ~4.4× on
      8.</p>`,
    examples: [
      {
        id: "kokkos",
        title: "benchmark: same script, N threads",
        code: kokkos,
        panes: ["console"]
      }
    ]
  },
  {
    id: "monitoring",
    title: "Monitoring a run",
    intro: `
      <p><code>client.instance</code> exposes the low-level
      <code>LAMMPSWeb</code> binding. During a run you can read any thermo
      keyword numerically with <code>getThermo("temp" | "press" |
      "cpuremain" | …)</code>, track progress with
      <code>getRunStepsDone()</code> / <code>getRunStepsTotal()</code> /
      <code>getRunMode()</code>, and watch memory with
      <code>getMemoryUsage()</code>.</p>`,
    examples: [
      {
        id: "monitor",
        title: "progress bar + live thermo",
        code: monitor,
        panes: ["console"]
      }
    ]
  },
  {
    id: "modifiers",
    title: "Computes, fixes & variables",
    intro: `
      <p>The <em>modifier</em> API introspects whatever the script defines.
      <code>syncModifiers()</code> refreshes the registry,
      <code>listModifiers()</code> describes every compute, fix and
      equal/atom-style variable, and <code>syncModifier(category, name)</code>
      invokes it (when allowed) and returns labelled data series — time series
      for scalars, histogram-like series (RDF bins, MSD components, …) where
      that's the natural shape. <code>getModifierPerAtom()</code> returns a
      Float64 view with one value per atom, ordered like the particle
      snapshot — perfect for coloring.</p>
      <p>Series <code>x</code>/<code>y</code> are Float32 views into wasm
      memory, valid until the next sync — copy what you keep.</p>`,
    examples: [
      {
        id: "modifiers-rdf",
        title: "live radial distribution function g(r)",
        code: modifiersRdf,
        panes: ["console", "chart"]
      },
      {
        id: "per-atom",
        title: "color atoms by a per-atom compute",
        code: perAtom,
        panes: ["console", "canvas"]
      }
    ]
  },
  {
    id: "bonds-walls",
    title: "Dynamic bonds & walls",
    intro: `
      <p>Even without a bonded force field you can render bonds:
      register a max distance per atom-type pair with
      <code>setBondDistance(type1, type2, distance)</code> and enable
      <code>setBuildNeighborlist(true)</code>, and every synced step's bond
      snapshot includes a bond for each neighbor pair within range.
      <code>getWalls()</code> reports wall fixes
      (<code>fix wall/lj93</code>, …) with face, style and position, ready to
      render.</p>`,
    examples: [
      {
        id: "bonds",
        title: "neighborlist bonds within 1.2σ",
        code: bonds,
        panes: ["console", "canvas"]
      },
      {
        id: "walls",
        title: "confine a gas between LJ walls",
        code: walls,
        panes: ["console", "canvas"]
      }
    ]
  },
  {
    id: "error-handling",
    title: "Error handling",
    intro: `
      <p>LAMMPS errors become thrown JS <code>Error</code>s with the LAMMPS
      message. Afterwards the instance keeps structured details:
      <code>getLastErrorMessage()</code>,
      <code>getLastErrorInputLine()</code> (the line that failed) and
      <code>getLastInputLine()</code> (the line most recently processed).
      In worker mode, rejected <code>runScriptAsync</code> promises and the
      <code>onError</code> option carry the same information.</p>`,
    examples: [
      {
        id: "errors",
        title: "catch, inspect, recover",
        code: errors,
        panes: ["console"]
      }
    ]
  },
  {
    id: "api-reference",
    title: "API reference",
    intro: `
      <p>Everything the package exports, with links to the section that shows
      it live. Import from <code>lammps.js/client</code>; the raw module
      factory is the package root (<code>lammps.js</code>) and the worker
      entry is <code>lammps.js/worker</code>.</p>`,
    reference: [
      {
        title: "LammpsClient (lammps.js/client)",
        rows: [
          { sig: "LammpsClient.create(moduleOptions?, clientOptions?)", desc: "Load the wasm module and create a client. With <code>worker</code> set it resolves to a <code>LammpsWorkerClient</code>; with <code>kokkos</code> it loads the multithreaded build.", see: "getting-started" },
          { sig: "createLammps(moduleOptions?, clientOptions?)", desc: "Function-style alias of <code>LammpsClient.create</code>." },
          { sig: "createModule(options?)", desc: "Load just the raw Emscripten module (no client wrapper)." },
          { sig: "start() / stop() / dispose()", desc: "Boot a fresh LAMMPS session / tear it down. <code>start()</code> on a live client restarts with a clean state.", see: "getting-started" },
          { sig: "runScript(script)", desc: "Execute a multi-line LAMMPS input synchronously.", see: "getting-started" },
          { sig: "runCommand(command)", desc: "Execute one LAMMPS command; returns the client for chaining.", see: "running-scripts" },
          { sig: "runInput(path, content)", desc: "Write a file into the virtual FS and run it.", see: "running-scripts" },
          { sig: "runScriptAsync(script, callback, options)", desc: "Run with a per-step callback: <code>{ every, fixId?, wrapped?, copy?, computeScalars? }</code>. Resolves when the script finishes.", see: "run-script-async" },
          { sig: "setAsyncStepFrequency(every, fixId?)", desc: "Retune the callback cadence, also mid-run.", see: "run-script-async" },
          { sig: "advance(steps?, { applyPre?, applyPost? })", desc: "Integrate N steps synchronously (manual stepping).", see: "manual-stepping" },
          { sig: "writeFile(path, content) / removeFile(path)", desc: "Manage files in the module's in-memory filesystem.", see: "running-scripts" },
          { sig: "syncParticles({ wrapped?, copy? })", desc: "Particle snapshot: <code>{ count, positions, ids, types }</code>. Views by default, copies with <code>copy: true</code>.", see: "snapshots" },
          { sig: "syncBonds({ wrapped?, copy? })", desc: "Bond snapshot: <code>{ count, first, second }</code> endpoint positions.", see: "bonds-walls" },
          { sig: "syncBox({ copy? })", desc: "Simulation box: <code>{ matrix, origin, lengths }</code>.", see: "snapshots" },
          { sig: "getComputeScalar(id) / getComputeScalars(ids)", desc: "Current scalar value(s) of named computes (<code>null</code> when unavailable).", see: "run-script-async" },
          { sig: "getCurrentStep() / getTimestepSize()", desc: "Current timestep number and dt.", see: "manual-stepping" },
          { sig: "module / instance / workdir", desc: "The Emscripten module (incl. <code>FS</code>), the low-level <code>LAMMPSWeb</code> binding, and the working directory." }
        ]
      },
      {
        title: "Options",
        rows: [
          { sig: "ModuleOptions", desc: "<code>print</code> / <code>printErr</code> (LAMMPS stdout/stderr, line by line), <code>locateFile</code>, plus any Emscripten module option.", see: "getting-started" },
          { sig: "LammpsClientOptions.workdir", desc: "Working directory in the virtual FS (default <code>/work</code>)." },
          { sig: "LammpsClientOptions.worker", desc: "<code>true</code> spawns the bundled worker entry; or pass your own <code>Worker</code> instance.", see: "worker-mode" },
          { sig: "LammpsClientOptions.onError", desc: "Worker mode: receives failures from fire-and-forget commands.", see: "worker-mode" },
          { sig: "LammpsClientOptions.kokkos", desc: "<code>true</code> or <code>{ threads?, suffix? }</code> — use the multithreaded KOKKOS build.", see: "kokkos" }
        ]
      },
      {
        title: "LammpsWorkerClient (returned for worker: true)",
        rows: [
          { sig: "runScriptAsync(script, callback, options)", desc: "As on the client; resolves to <code>{ aborted, step, timestepSize }</code>.", see: "worker-mode" },
          { sig: "stopRun()", desc: "Ask the active run to abort at its next step callback.", see: "worker-mode" },
          { sig: "runCommand / runScript / advance / writeFile / removeFile", desc: "Fire-and-forget forwards to the worker (errors reach <code>onError</code>)." },
          { sig: "setAsyncStepFrequency(every, fixId?)", desc: "Async in worker mode — returns a promise." },
          { sig: "syncParticles() / syncBonds() / syncBox()", desc: "Latest snapshot received from the worker (not live wasm memory).", see: "worker-mode" },
          { sig: "getComputeScalar(id) / getCurrentStep() / getTimestepSize()", desc: "Latest values received from the worker." },
          { sig: "stop() / dispose()", desc: "<code>dispose()</code> also terminates the worker when the client created it." },
          { sig: "LammpsWorkerClientOptions.onOutput", desc: "<code>(stream, text)</code> — stdout/stderr forwarded from the worker." }
        ]
      },
      {
        title: "LAMMPSWeb (client.instance)",
        rows: [
          { sig: "startWithArgs(args)", desc: "Boot with CLI args (e.g. <code>-k on t 4 -sf kk</code> — the <code>kokkos</code> option does this for you)." },
          { sig: "hasPackage(name)", desc: "Whether the wasm build includes a LAMMPS package.", see: "monitoring" },
          { sig: "isReady() / getIsRunning()", desc: "Session liveness and whether a run is active." },
          { sig: "getThermo(keyword)", desc: "Any thermo keyword as a number (<code>temp</code>, <code>press</code>, <code>spcpu</code>, <code>cpuremain</code>, …).", see: "monitoring" },
          { sig: "getRunMode() / getRunStepsDone() / getRunStepsTotal()", desc: "Run progress: mode 0 idle / 1 dynamics / 2 minimize.", see: "monitoring" },
          { sig: "getMemoryUsage()", desc: "LAMMPS memory estimate in bytes.", see: "monitoring" },
          { sig: "getLastErrorMessage() / getLastErrorInputLine() / getLastInputLine()", desc: "Structured error state after a failure.", see: "error-handling" },
          { sig: "syncParticlesWrapped() / syncBondsWrapped() / syncSimulationBox()", desc: "Raw snapshot calls returning heap <code>BufferView</code>s (the client wraps these)." },
          { sig: "setBondDistance(t1, t2, d) / clearBondDistances()", desc: "Distance-based dynamic bonds from the neighborlist.", see: "bonds-walls" },
          { sig: "setBuildNeighborlist(build)", desc: "Build a half neighbor list at each synced step (needed for dynamic bonds).", see: "bonds-walls" },
          { sig: "getWalls()", desc: "Renderable wall fixes: <code>{ which, style, position, cutoff }</code>.", see: "bonds-walls" },
          { sig: "syncModifiers() / listModifiers()", desc: "Refresh and list the compute/fix/variable registry.", see: "modifiers" },
          { sig: "syncModifier(category, name)", desc: "Invoke + sync one modifier; returns scalar and labelled x/y series.", see: "modifiers" },
          { sig: "getModifierPerAtom(category, name)", desc: "Float64 view of a per-atom modifier, one value per atom.", see: "modifiers" },
          { sig: "installAsyncFix(fixId, every) / setAsyncStepCallback(cb) / runFile(path)", desc: "Low-level pieces behind <code>runScriptAsync</code> / <code>runInput</code>." }
        ]
      },
      {
        title: "module.FS (Emscripten filesystem)",
        rows: [
          { sig: "writeFile / readFile / unlink / readdir", desc: "File IO; <code>readFile(path, { encoding: \"utf8\" })</code> for text.", see: "running-scripts" },
          { sig: "mkdir / rmdir / chdir / cwd", desc: "Directory management (the client chdirs into <code>workdir</code>)." },
          { sig: "stat / analyzePath / isDir / isFile", desc: "Metadata and existence checks." }
        ]
      }
    ]
  }
];
