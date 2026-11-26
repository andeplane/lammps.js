---
title: 'lammps.js: An embeddable LAMMPS engine for the web'
tags:
  - molecular dynamics
  - WebAssembly
  - LAMMPS
  - JavaScript
  - research software
authors:
  - name: Anders Hafreager
    affiliation: 1
    equal-contrib: true
  - name: Alexander Zhilkin
    affiliation: 2
    equal-contrib: true
affiliations:
  - name: Center for Computing in Science Education, University of Oslo, Oslo, Norway
    index: 1
  - name: Technion, Haifa
    index: 2
date: 22 November 2026
bibliography: paper.bib
---

<!-- Author review: add ORCIDs if available. The date above is for this draft. Record the version of lammps.js submitted for review. -->

# Summary

lammps.js lets a website run molecular and materials simulations on the reader's device. It packages the LAMMPS simulation engine [@thompson2022lammps] as a reusable WebAssembly library with a TypeScript interface. A page can supply a model, run a LAMMPS input script, and turn the resulting particle motion or measurements into plots and animations. This makes it possible to build research tools with controls for a particular model, or to put runnable simulations in course websites and interactive books. The [lammps.js playground](https://andeplane.github.io/lammps.js/) demonstrates this with an editable input and a live output pane.

# Statement of need

Rerunning a published molecular simulation or changing a parameter usually requires readers to obtain the inputs, install a compatible LAMMPS build, and set up visualization.

lammps.js is a standalone npm package that ships the LAMMPS engine precompiled to WebAssembly with a TypeScript interface. Researchers and instructors can embed the engine in a web page alongside the model, controls, and visualization. Readers can open a shared link, change parameters, and rerun the simulation on their own computer or smartphone using a compatible browser, without installing LAMMPS or a separate application.

# State of the field

The project continues work that began with Atomify, a desktop application that combined a LAMMPS script editor, live visualization, and plots [@hafreager2017atomify]. LAMMPS-GUI offers a related desktop workflow through the LAMMPS C library [@kohlmeyer2026gui]. To bring that workflow to a website, developers need a browser-compatible build of LAMMPS and an interface for reading simulation state during a run. When Atomify moved to the browser, we developed lammps.js so the simulation engine could be distributed and maintained independently of a particular interface. Applications can supply their own inputs, visualization, and analysis while sharing the packaged engine.

# Software design

We use Emscripten to compile the LAMMPS C++ engine to WebAssembly and generate a JavaScript module that loads it. We built a TypeScript client on top of the C++ bindings so that applications can initialize the engine, load model files into its in-memory filesystem, and execute standard LAMMPS input scripts through one API. A custom LAMMPS fix hands control to the client at selected steps during a run or minimization. The client passes typed snapshots of particle positions, bonds, cell geometry, and selected scalar quantities to the application. LAMMPS resumes when the application finishes handling the snapshot. In Web Worker mode, the engine stays off the interface thread and the worker transfers copies of the requested data. Sampling at an interval chosen by the application limits data transfer and gives it control over playback.

The serial build supports static hosting. Optional KOKKOS builds offer parallel execution for supported styles and require cross-origin isolation in browsers. This trade-off lets an application choose a build for its required LAMMPS packages and hosting setup. Automated tests exercise the WebAssembly builds and the worker interface. The [interactive documentation](https://andeplane.github.io/lammps.js/docs/) and [browser-based notebook tutorials](https://andeplane.github.io/lammps.js/notebook/lab/index.html?path=index.ipynb) show how to run the same engine from different interfaces.

# Research impact statement

We use lammps.js in the [Elastic Network Editor](https://mendelsresearchgroup.github.io/elastic-network-editor/) to study elastic networks, which model materials as particles connected by springs. We vary the network geometry and spring stiffness to explore how the networks respond to compression and heating. The [editor's GitHub repository](https://github.com/MendelsResearchGroup/elastic-network-editor) records when it [adopted the lammps.js npm package in October 2025](https://github.com/MendelsResearchGroup/elastic-network-editor/commit/da2b8cd9b89ca9964971eec54ec409a3a8f7c4dd). This work complements our group's studies of learned simulators and inverse design for disordered elastic networks [@salman2025prediction; @shteingolts2026inverse], and our ongoing investigations of latent-space simulation and optimization at elevated temperature.

In networks optimized with machine learning for an auxetic response, we often see small groups of triangles rotate as the network narrows sideways under compression. The editor lets us change spring stiffness or move nodes in those regions and see how each change affects the local rotations and the overall deformation. We also recreate these motifs in larger networks to test how they influence the response of the whole network.

To check the workflow against a known mechanism, we reconstructed the corner-hinged rotating squares of @grima2000squares, converting the paper's geometry into an editable periodic model. In a benchmark run at 3% horizontal compression, the secant Poisson ratio was about −1, in agreement with the predicted response along that direction. A separate run at 15% compression makes the opposite rotations of adjacent squares easier to see (Figure \ref{fig:simulations}a–b). The [case study](https://github.com/MendelsResearchGroup/elastic-network-editor/tree/d7d6de88f37e6116d89eec134099afb7326bd90a/examples/rotating-squares) provides the input, loading protocol, and reproduction script.

![Simulation snapshots from lammps.js. (a–b) The periodic network before and after 15% horizontal compression, shown at the same scale. The dashed outline marks the relaxed cell, and arrows show the directions of rotation of adjacent squares. Diagonal braces are omitted. (c) A solvated five-residue peptide after 300 steps, with water and hydrogen atoms hidden.](figures/simulation-examples.png){#fig:simulations width="100%"}

The editor also includes a [negative thermal expansion example](https://mendelsresearchgroup.github.io/elastic-network-editor/?example=negative-thermal-expansion) in which a spring lattice contracts as it is heated at zero external pressure.

Anders Hafreager also integrates lammps.js into the [Atomify web application](https://andeplane.github.io/atomify/). Atomify's [simulation worker](https://github.com/andeplane/atomify/blob/7a23b7b35530758656308560a63c0e2959c3184e/src/wasm/lammps.worker.ts) loads the packaged engine to run user-supplied LAMMPS scripts and display particle motion and plots in real time. Figure \ref{fig:simulations}c shows the [solvated peptide example distributed with LAMMPS](https://raw.githubusercontent.com/lammps/lammps/stable_30Sep2026_update1/examples/peptide/in.peptide), run with the serial Atomify build of lammps.js.

Alexander Zhilkin also uses lammps.js to prepare and visualize examples for a molecular simulation course whose exercise sessions he will tutor. He plans to share browser-based exercises so students can change inputs and rerun simulations on their own devices. The [Atomify examples template](https://github.com/andeplane/atomify-examples-template) demonstrates how a single course link can bundle scripts and optional analysis notebooks.

# AI usage disclosure

We developed the original lammps.js core without generative AI assistance. We used OpenAI Codex and Anthropic Claude during later feature development and revision. We made the core design decisions, reviewed the changes and tested them manually in our existing workflows. The project also uses automated regression tests. Anders Hafreager and Alexander Zhilkin wrote the original manuscript. We used OpenAI Codex (GPT-6.2 Sol) to revise the draft, assist with code, tests, and documentation for the Elastic Network Editor case study, and plot the simulation snapshots. We take responsibility for the software and manuscript.

<!-- Author review: add the model versions and specific uses from Codex and Claude development sessions where known. Both authors should confirm the wording on manual testing and review, and document how they checked the final AI-assisted manuscript text and case-study materials. -->

# Acknowledgements

We acknowledge the LAMMPS and Atomify contributors whose work made this library possible. This work received no dedicated funding.

# References
