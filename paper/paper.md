---
title: 'lammps.js: An embeddable LAMMPS engine for the web'
tags:
  - molecular dynamics
  - WebAssembly
  - LAMMPS
  - JavaScript
  - research software
authors:
  - name: Alexander Zhilkin
    affiliation: 1
    equal-contrib: true
  - name: Anders Hafreager
    affiliation: 2
    equal-contrib: true
affiliations:
  - name: Technion – Israel Institute of Technology, Haifa, Israel
    index: 1
  - name: Affiliation to be confirmed
    index: 2
date: 22 November 2026
bibliography: paper.bib
---

<!-- Author review: confirm Anders's current affiliation. University of Oslo is his affiliation in the 2017 Atomify workshop record. Confirm author order and add ORCIDs if available. The date above is for this draft. Record the version of lammps.js submitted for review. -->

# Summary

lammps.js lets a website run molecular and materials simulations on the reader's device. It packages the LAMMPS simulation engine [@thompson2022lammps] as a reusable WebAssembly library with a JavaScript interface. A page can supply a model, run a LAMMPS input script, and turn the resulting particle motion or measurements into plots and animations. This makes it possible to build research tools with controls for a particular model, or to put runnable simulations in course websites and interactive books. The [lammps.js playground](https://andeplane.github.io/lammps.js/) demonstrates this with an editable input and a live output pane.

# Statement of need

A static figure or trajectory shows the result of one simulation. Reproducing it from a different starting state or changing a parameter usually requires the reader to obtain input files, install a compatible LAMMPS build, and set up visualization. For elastic-network models, a published drawing may also require reconstruction as explicit coordinates, bonds, and boundary conditions. These steps interrupt the process of asking a question, changing the model, and inspecting its response. lammps.js lets application developers put that cycle into a single page. They can design controls for the relevant scientific parameters and supply the rest of the input alongside the page.

# State of the field

The project continues work that began with Atomify, a desktop application that combined a LAMMPS script editor, live visualization, and plots [@hafreager2017atomify]. LAMMPS-GUI offers a related desktop workflow through the LAMMPS C library [@kohlmeyer2026gui]. When Atomify moved to the browser, we developed lammps.js so the simulation engine could be distributed and maintained independently of a particular interface. That separation lets the same package power the [current Atomify web application](https://andeplane.github.io/atomify/), an editor whose controls operate on nodes and springs, and a browser-based notebook. Each application supplies its own inputs, visualization, and analysis.

# Software design

We compile the LAMMPS engine to WebAssembly and expose its script execution and simulation state through C++ bindings and a TypeScript client. A custom LAMMPS fix hands control to the application at selected steps during a run or minimization. The client gathers positions, bonds, cell geometry, or selected scalar quantities, and LAMMPS can continue once the application finishes handling the snapshot. In Web Worker mode, the engine stays off the interface thread and the worker transfers copies of the requested data. Sampling every few steps instead of every step limits the data sent to the interface and gives an application control over playback.

The serial build supports static hosting. Optional KOKKOS builds offer parallel execution for supported styles and require cross-origin isolation in browsers. This trade-off lets an application choose a build for its required LAMMPS packages and hosting setup. Automated tests exercise the WebAssembly builds and the worker interface. The [interactive documentation](https://andeplane.github.io/lammps.js/docs/) and [browser-based notebook tutorials](https://andeplane.github.io/lammps.js/notebook/lab/index.html?path=index.ipynb) show how to run the same engine from different interfaces.

# Research impact statement

We use lammps.js in the [Elastic Network Editor](https://mendelsresearchgroup.github.io/elastic-network-editor/) to explore how geometry and spring stiffness affect mechanical and thermal responses. The editor's public history records its [npm integration in October 2025](https://github.com/MendelsResearchGroup/elastic-network-editor/commit/da2b8cd9b89ca9964971eec54ec409a3a8f7c4dd). This work complements our group's studies of learned simulators and inverse design for disordered elastic networks [@salman2025prediction; @shteingolts2026inverse], and our ongoing investigations of latent-space simulation and optimization at elevated temperature.

We used the editor to explore whether a diamond-shaped network with four softened springs could narrow under compression. The [original model](https://github.com/MendelsResearchGroup/elastic-network-editor/blob/da2b8cd9b89ca9964971eec54ec409a3a8f7c4dd/src/useGraph.ts) is in the October 2025 revision. To check the workflow against a known mechanism, we reconstructed the corner-hinged rotating squares of @grima2000squares, converting the paper's geometry into an editable periodic model. Under 3% horizontal compression, the calculation gave a secant Poisson ratio of about −1, in agreement with the predicted response along that direction. The [case study](https://github.com/MendelsResearchGroup/elastic-network-editor/tree/d7d6de88f37e6116d89eec134099afb7326bd90a/examples/rotating-squares) provides the input, loading protocol, and reproduction script.

A [thermal case study](https://github.com/MendelsResearchGroup/elastic-network-editor/tree/d7d6de88f37e6116d89eec134099afb7326bd90a/examples/negative-thermal-expansion) uses the same library to compare mean cell areas at two temperatures and zero external pressure. The periodic spring lattice contracted by 0.28–0.45% upon heating across three initial velocity seeds. The simulation script, seed values, and analysis are available with the model.

Alexander Zhilkin also uses lammps.js to prepare and visualize examples for a molecular simulation course whose exercise sessions he will tutor. He plans to share browser-based exercises so students can change inputs and rerun simulations on their own devices. The [Atomify examples template](https://github.com/andeplane/atomify-examples-template) demonstrates how a single course link can bundle scripts and optional analysis notebooks.

# AI usage disclosure

We developed the original lammps.js core without generative AI assistance. We used OpenAI Codex and Anthropic Claude during later feature development and revision. We made the core design decisions, reviewed the changes and tested them manually in our existing workflows. The project also uses automated regression tests. Alexander Zhilkin and Anders Hafreager wrote the original manuscript. We used OpenAI Codex (GPT-6.2 Sol) to revise the draft and assist with code, tests, and documentation for the Elastic Network Editor case study. We take responsibility for the software and manuscript.

<!-- Author review: add the model versions and specific uses from Codex and Claude development sessions where known. Both authors should confirm the wording on manual testing and review, and document how they checked the final AI-assisted manuscript text and case-study materials. -->

# Acknowledgements

We acknowledge the LAMMPS and Atomify contributors whose work made this library possible. This work received no dedicated funding.

# References
