# LAMMPS source patches

lammps.js builds against an unmodified LAMMPS release tag, plus the patches
in `cpp/patches/`. `cpp/build.py` applies them (idempotently) after cloning.

Each patch is documented here — what it changes and why — so they can be
considered for upstream LAMMPS pull requests later. Keep patches minimal and
additive (new accessors rather than visibility changes) to make upstreaming
realistic.

## 0001-input-expose-last-line.patch

**What:** adds a public `const char *get_last_line() const` accessor to
`Input` (`src/input.h`), returning the `line` buffer (the input line
currently being processed). `line` itself stays protected.

**Why:** when a script fails, the LAMMPS error message names the source
location (e.g. `(src/force.cpp:279)`) but not the *input line* that caused
it. Web UIs built on lammps.js (Atomify) show the failing command in the
editor and a "last command" status readout, which requires reading
`input->line` from the wrapper. Upstream has no public accessor for it —
`utils::point_to_error` is a friend, and the "Last input line:" text LAMMPS
prints on errors is not reachable programmatically through the library
interface.

**Upstream potential:** good — a tiny read-only accessor consistent with the
existing `get_jump_skip()`. Alternatively upstream could expose the last
input line through the C library API (`lammps_get_last_input_line`).
