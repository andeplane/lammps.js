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

## 0002-fix-ave-time-introspection.patch

**What:** in `src/fix_ave_time.h`, moves the `value_t` struct out of the
private section and adds public read-only accessors: `getmode()`,
`getnvalues()`, `getnrows()`, `getValues()`, and makes `nextvalid()`
callable (declaration moved to the public block). No behavior change; the
data members themselves stay private.

**Why:** `fix ave/time` is the standard way LAMMPS scripts produce
time-averaged observables, and live-plotting UIs (Atomify) need to read what
the fix is averaging (`values`, `mode`) and when its next result is due
(`nextvalid()`) to extract scalar/vector/array results each time they become
valid. None of that is reachable through `compute_scalar/vector/array` alone:
without `mode`/`nvalues`/`nrows` the caller cannot know the result shape, and
without `nextvalid()` it cannot know when reading is legal.

**Upstream potential:** moderate — read-only accessors are unintrusive, but
upstream may prefer exposing this through the library interface (e.g.
extending `lammps_extract_fix` with shape/readiness queries) instead of
public class accessors.

## 0003-modify-allow-js-async-pre-box.patch

**What:** adds `"js/async"` to the exceptions list in `Modify::add_fix`
(`src/modify.cpp`) — the styles allowed to be defined before the simulation
box exists.

**Why:** the js/async fix is how lammps.js yields to the browser event loop
and delivers per-step data. If it can only be defined after `create_box`/
`read_data`, it has to be text-injected before the first `run` of the
top-level script — which misses runs inside `include`'d files and `jump`
loops, freezing the browser tab for those runs. With this exception the fix
can be installed once right after `lammps_open`, before any user input runs
(see `LAMMPSWeb::installAsyncFix`). The fix touches no per-atom or box data
outside its callbacks, so pre-box definition is safe — the same approach
Atomify used for its `fix atomify`.

**Upstream potential:** low as-is, since `js/async` lives in this repo, not
upstream LAMMPS. The upstreamable idea is a general mechanism for
library-registered callbacks that don't depend on the box (e.g. allowing
`fix external` in the exceptions list, or a dedicated pre-box-safe fix
flag).
