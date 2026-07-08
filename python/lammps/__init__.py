"""LAMMPS Python bindings for the browser (Pyodide / JupyterLite).

Drives the lammps.js WebAssembly engine from Python, mirroring the official
`lammps` Python module (https://docs.lammps.org/Python_module.html) as closely
as the browser allows:

    from lammps import lammps

    lmp = await lammps()            # the one browser-specific difference:
                                    # wasm loads asynchronously, so creation
                                    # needs a single `await`
    lmp.command("units lj")
    lmp.commands_string(SCRIPT)
    lmp.command("run 100")
    lmp.get_natoms()
    lmp.get_thermo("temp")
    x = lmp.extract_atom("x")       # numpy array, shape (natoms, 3)
    lmp.close()

Multithreading (KOKKOS build, needs a cross-origin isolated page) uses the
same command-line arguments as native LAMMPS:

    lmp = await lammps(cmdargs=["-k", "on", "t", "4", "-sf", "kk"])

Differences from the native module, by necessity or convenience:

- Creation is `await lammps(...)` instead of `lammps(...)`.
- `extract_atom` / `extract_compute` / `extract_fix` / `extract_variable`
  return numpy arrays (copies), not ctypes pointers into LAMMPS memory.
- `extract_atom` exposes what the wasm bindings export: "x", "id", "type".
  Other per-atom quantities are available through atom-style variables and
  `extract_variable(name, vartype=LMP_VAR_ATOM)`.
- LAMMPS runs in an in-memory filesystem. `lmp.file(path)` transparently
  copies `path` from the notebook's filesystem into the wasm filesystem when
  it exists locally, and also accepts the file body via `contents=`.

Filesystem: in JupyterLite, the wasm module's ``/work`` directory is
mounted with the same **DriveFS** that Pyodide uses for ``/drive`` — LAMMPS
reads and writes go directly through the JupyterLite service worker to the
notebook filesystem, so dump files, logs, etc. appear in the Jupyter file
browser instantly — in the running notebook's own directory, where native
LAMMPS would put them — and local files are visible to LAMMPS without any
copying.
The wasm module is also **shared** across all ``lammps()`` calls in the same
kernel session, so each ``await lammps()`` reuses the same engine (and the
wasm download only happens once).
"""

from __future__ import annotations

import math
import re
from pathlib import Path, PurePosixPath

__all__ = [
    "lammps",
    "LammpsError",
    "site_url",
    "LMP_STYLE_GLOBAL",
    "LMP_STYLE_ATOM",
    "LMP_STYLE_LOCAL",
    "LMP_TYPE_SCALAR",
    "LMP_TYPE_VECTOR",
    "LMP_TYPE_ARRAY",
    "LMP_VAR_EQUAL",
    "LMP_VAR_ATOM",
]

# Style/type constants, same values as the official lammps Python module.
LMP_STYLE_GLOBAL = 0
LMP_STYLE_ATOM = 1
LMP_STYLE_LOCAL = 2

LMP_TYPE_SCALAR = 0
LMP_TYPE_VECTOR = 1
LMP_TYPE_ARRAY = 2

LMP_VAR_EQUAL = 0
LMP_VAR_ATOM = 1

#: Override to load the lammps.js client from a custom URL. By default the
#: module derives the site root from the kernel's own URL and loads
#: ``{site}/lammps/client.js`` (the JupyterLite site ships the built package
#: there).
CLIENT_URL: str | None = None

_KERNEL_PATH_RE = re.compile(
    r"(extensions|lab|notebooks|files|tree|repl|consoles|edit|build)/.*$"
)

_MONTHS = {
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
    "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
}

_client_modules: dict[str, object] = {}
_wasm_modules: dict[str, object] = {}
_drivefs_mounted: set[int] = set()

_MOUNT_DRIVEFS_JS = """
(lammpsModule, pyodideFS) => {
  // Grab the existing DriveFS that the Pyodide kernel mounted on /drive.
  const driveMount = pyodideFS.lookupPath("/drive", { follow: false }).node.mount;
  const pyDriveFS = driveMount.type;   // The DriveFS instance
  const pyAPI     = pyDriveFS.API;     // Its ContentsAPI (does XHR to service worker)

  // Build a lightweight filesystem backend for the LAMMPS module that
  // delegates every operation to the *same* ContentsAPI. This gives LAMMPS
  // direct read/write access to the notebook filesystem with zero sync.
  const FS   = lammpsModule.FS;
  // PATH and ERRNO_CODES may not be exported by the LAMMPS wasm module,
  // so we provide minimal inline implementations.
  const join2 = (a, b) => {
    if (!a || a === "/") return "/" + b;
    return a.replace(/\\/+$/, "") + "/" + b;
  };
  const EC = lammpsModule.ERRNO_CODES || { ENOENT: 44, EINVAL: 28, EPERM: 63 };
  const DIR_MODE  = 16895;   // 040777
  const SEEK_CUR  = 1;
  const SEEK_END  = 2;

  const mountpoint = "/work";

  // Rewrite paths: the API expects paths relative to the Pyodide /drive
  // mount, but our mountpoint is /work on a different FS. Map /work to the
  // kernel's *current directory* inside /drive (not the drive root), so
  // LAMMPS files land next to the running notebook — the same place native
  // LAMMPS would put them (the process cwd).
  const toAPIPath = (p) => {
    if (p.startsWith(mountpoint)) p = p.slice(mountpoint.length);
    if (!p.startsWith("/")) p = "/" + p;
    let prefix = "";
    try {
      const cwd = pyodideFS.cwd();
      if (cwd.startsWith("/drive/")) prefix = cwd.slice("/drive".length);
    } catch {}
    return prefix + p;
  };

  const realPath = (node) => {
    const parts = [];
    let n = node;
    parts.push(n.name);
    while (n.parent !== n) { n = n.parent; parts.push(n.name); }
    parts.reverse();
    return parts.join("/").replace(/\\/\\/+/g, "/");
  };

  const flagNeedsWrite = {
    0:false, 1:true, 2:true, 64:true, 65:true, 66:true, 129:true, 193:true,
    514:true, 577:true, 578:true, 705:true, 706:true, 1024:true, 1025:true,
    1026:true, 1089:true, 1090:true, 1153:true, 1154:true, 1217:true, 1218:true,
    4096:true, 4098:true,
  };

  const proxyFS = {
    mount(mount) {
      return this.createNode(null, mount.mountpoint, DIR_MODE, 0);
    },
    createNode(parent, name, mode, dev) {
      const node = FS.createNode(parent, name, mode, dev);
      node.node_ops = proxyFS.node_ops;
      node.stream_ops = proxyFS.stream_ops;
      return node;
    },
    node_ops: {
      getattr(nodeOrStream) {
        const node = nodeOrStream.node ?? nodeOrStream;
        const stats = pyAPI.getattr(toAPIPath(realPath(node)));
        stats.mode = node.mode;
        stats.ino = node.id;
        return stats;
      },
      setattr(nodeOrStream, attr) {
        const node = nodeOrStream.node ?? nodeOrStream;
        if (attr.mode !== undefined) node.mode = attr.mode;
        if (attr.timestamp !== undefined) node.timestamp = attr.timestamp;
      },
      lookup(parentOrStream, name) {
        const parent = parentOrStream.node ?? parentOrStream;
        const path = toAPIPath(join2(realPath(parent), name));
        const result = pyAPI.lookup(path);
        if (!result.ok) throw new FS.ErrnoError(EC["ENOENT"]);
        return proxyFS.createNode(parent, name, result.mode, 0);
      },
      mknod(parentOrStream, name, mode, dev) {
        const parent = parentOrStream.node ?? parentOrStream;
        const path = toAPIPath(join2(realPath(parent), name));
        pyAPI.mknod(path, mode);
        return proxyFS.createNode(parent, name, mode, dev);
      },
      rename(nodeOrStream, newDirOrStream, newName) {
        const node = nodeOrStream.node ?? nodeOrStream;
        const newDir = newDirOrStream.node ?? newDirOrStream;
        const oldPath = node.parent
          ? toAPIPath(join2(realPath(node.parent), node.name))
          : toAPIPath(node.name);
        pyAPI.rename(oldPath, toAPIPath(join2(realPath(newDir), newName)));
        node.name = newName;
        node.parent = newDir;
      },
      unlink(parentOrStream, name) {
        const parent = parentOrStream.node ?? parentOrStream;
        return pyAPI.rmdir(toAPIPath(join2(realPath(parent), name)));
      },
      rmdir(parentOrStream, name) {
        const parent = parentOrStream.node ?? parentOrStream;
        return pyAPI.rmdir(toAPIPath(join2(realPath(parent), name)));
      },
      readdir(nodeOrStream) {
        const node = nodeOrStream.node ?? nodeOrStream;
        return pyAPI.readdir(toAPIPath(realPath(node)));
      },
      symlink() { throw new FS.ErrnoError(EC["EPERM"]); },
      readlink() { throw new FS.ErrnoError(EC["EINVAL"]); },
    },
    stream_ops: {
      open(stream) {
        if (FS.isFile(stream.node.mode)) {
          try {
            stream.file = pyAPI.get(toAPIPath(realPath(stream.node)));
          } catch {
            const flags = stream.flags ?? stream.shared?.flags ?? 0;
            const pf = (typeof flags === "string" ? parseInt(flags,10) : flags) & 0x1fff;
            if (flagNeedsWrite[pf]) {
              stream.node = proxyFS.node_ops.mknod(
                stream.node.parent, stream.node.name, stream.node.mode, 0);
              stream.file = pyAPI.get(toAPIPath(realPath(stream.node)));
            } else {
              throw new FS.ErrnoError(EC["ENOENT"]);
            }
          }
        }
      },
      close(stream) {
        if (!FS.isFile(stream.node.mode) || !stream.file) return;
        const flags = stream.flags ?? stream.shared?.flags ?? 0;
        const pf = (typeof flags === "string" ? parseInt(flags,10) : flags) & 0x1fff;
        if (flagNeedsWrite[pf] !== false) {
          pyAPI.put(toAPIPath(realPath(stream.node)), stream.file);
        }
        stream.file = undefined;
      },
      read(stream, buffer, offset, length, position) {
        if (length <= 0 || !stream.file || position >= (stream.file.data?.length || 0))
          return 0;
        const size = Math.min(stream.file.data.length - position, length);
        buffer.set(stream.file.data.subarray(position, position + size), offset);
        return size;
      },
      write(stream, buffer, offset, length, position) {
        if (length <= 0 || !stream.file) return 0;
        if (position + length > (stream.file.data?.length || 0)) {
          const old = stream.file.data || new Uint8Array();
          stream.file.data = new Uint8Array(position + length);
          stream.file.data.set(old);
        }
        stream.file.data.set(buffer.subarray(offset, offset + length), position);
        return length;
      },
      llseek(stream, offset, whence) {
        let pos = offset;
        if (whence === SEEK_CUR) pos += stream.position ?? stream.shared?.position ?? 0;
        else if (whence === SEEK_END && FS.isFile(stream.node.mode) && stream.file)
          pos += stream.file.data.length;
        if (pos < 0) throw new FS.ErrnoError(EC["EINVAL"]);
        return pos;
      },
    },
  };

  try { FS.unmount(mountpoint); } catch {}
  try { FS.mkdirTree(mountpoint); } catch {}
  FS.mount(proxyFS, {}, mountpoint);
  FS.chdir(mountpoint);
  return true;
}
"""


class LammpsError(RuntimeError):
    """A LAMMPS error, with the message LAMMPS reported."""


def _require_pyodide():
    try:
        import js  # noqa: F401
        from pyodide.code import run_js  # noqa: F401
        from pyodide.ffi import create_proxy, to_js  # noqa: F401
    except ImportError as exc:  # pragma: no cover - outside pyodide
        raise RuntimeError(
            "This lammps module drives the lammps.js WebAssembly engine and "
            "only runs inside Pyodide (e.g. the JupyterLite Python kernel). "
            "For native Python use the official LAMMPS bindings instead."
        ) from exc
    import js
    from pyodide.code import run_js
    from pyodide.ffi import create_proxy, to_js

    return js, run_js, create_proxy, to_js


def _default_client_url(js) -> str:
    if CLIENT_URL:
        return CLIENT_URL
    base = ""
    document = getattr(js, "document", None)
    if document is not None and getattr(document, "baseURI", None):
        base = str(document.baseURI)
    elif getattr(js, "location", None) is not None:
        base = str(js.location.href)
    site = _KERNEL_PATH_RE.sub("", base)
    if not site or site.startswith("blob:"):
        raise LammpsError(
            "Could not derive the site URL that serves lammps.js "
            f"(kernel URL: {base!r}). Set lammps.CLIENT_URL to the full URL "
            "of client.js before creating the instance."
        )
    return site + ("" if site.endswith("/") else "/") + "lammps/client.js"


def site_url(path: str = "") -> str:
    """Absolute URL of ``path`` relative to the site root.

    Useful for fetching data files shipped with the notebook site, e.g.
    ``pyfetch(site_url("files/data/lj-melt.in"))`` (JupyterLite serves the
    content directory under ``files/``).
    """
    js, _run_js, _create_proxy, _to_js = _require_pyodide()
    client = _default_client_url(js)
    return client.rsplit("lammps/client.js", 1)[0] + str(path).lstrip("/")


async def _load_client(url: str):
    """Dynamic-import the lammps.js client ES module (cached per URL)."""
    if url not in _client_modules:
        _js, run_js, _create_proxy, _to_js = _require_pyodide()
        _client_modules[url] = await run_js(f"import({url!r})")
    return _client_modules[url]


def _parse_kokkos_cmdargs(cmdargs) -> dict | None:
    """Detect native-style ``-k on t N ... -sf kk`` arguments."""
    if not cmdargs:
        return None
    args = [str(a) for a in cmdargs]
    for flag in ("-k", "-kokkos"):
        if flag in args:
            i = args.index(flag)
            if i + 1 < len(args) and args[i + 1] == "on":
                opts: dict = {}
                rest = args[i + 2 :]
                if "t" in rest:
                    j = rest.index("t")
                    if j + 1 < len(rest):
                        try:
                            opts["threads"] = int(rest[j + 1])
                        except ValueError:
                            pass
                return opts
    return None


def _version_from_banner(banner: str) -> int:
    # "LAMMPS (29 Aug 2024 - Update 1)" -> 20240829
    m = re.search(r"LAMMPS\s*\((\d+)\s+([A-Za-z]{3})[a-z]*\s+(\d{4})", banner)
    if not m:
        return -1
    day, mon, year = int(m.group(1)), _MONTHS.get(m.group(2), 0), int(m.group(3))
    return year * 10000 + mon * 100 + day


class lammps:  # noqa: N801 - mirrors the official class name
    """A LAMMPS session running on the lammps.js WebAssembly engine.

    Create with ``lmp = await lammps(...)``. Accepts the official
    constructor arguments (``name``, ``cmdargs``; ``ptr``/``comm`` are
    accepted and ignored) plus browser-specific ones:

    - ``kokkos``: True or ``{"threads": n}`` to use the multithreaded
      KOKKOS wasm build (equivalently pass native-style ``cmdargs``).
    - ``output``: callable that receives each LAMMPS output line
      (default: ``print``). Pass ``None`` to silence output.
    - ``client_url``: URL of client.js, overriding auto-detection.
    """

    def __init__(
        self,
        name: str = "",
        cmdargs=None,
        ptr=None,
        comm=None,
        *,
        kokkos=None,
        output=print,
        client_url: str | None = None,
    ):
        del name, ptr, comm  # accepted for API compatibility
        self._cmdargs = [str(a) for a in cmdargs] if cmdargs else None
        kk_from_args = _parse_kokkos_cmdargs(self._cmdargs)
        if kokkos is None:
            self._kokkos = kk_from_args
        elif kokkos is True:
            self._kokkos = kk_from_args or {}
        elif kokkos:
            self._kokkos = dict(kokkos)
        else:
            self._kokkos = None
        self._output = output
        self._client_url = client_url
        self._client = None
        self._np = None
        self._banner = ""
        self._closed = False
        self._proxies = []
        self.numpy = _NumpyAccessor(self)

    # -- creation ---------------------------------------------------------

    def __await__(self):
        return self._astart().__await__()

    async def _astart(self):
        if self._client is not None:
            return self
        js, _run_js, create_proxy, to_js = self._ffi = _require_pyodide()

        if self._kokkos is not None and not getattr(js, "crossOriginIsolated", False):
            raise LammpsError(
                "The KOKKOS multithreaded build needs SharedArrayBuffer, "
                "which requires a cross-origin isolated page (COOP/COEP "
                "headers). This page is not cross-origin isolated — create "
                "the instance without kokkos/-k arguments to use the "
                "single-threaded build."
            )

        url = self._client_url or _default_client_url(js)
        mod = await _load_client(url)

        print_proxy = create_proxy(self._on_stdout)
        printerr_proxy = create_proxy(self._on_stderr)
        self._proxies += [print_proxy, printerr_proxy]

        # Reuse the wasm module across lammps() calls — this shares the
        # in-memory filesystem so files written by one session are visible
        # to the next without manual copying.
        cache_key = f"{url}|{'kk' if self._kokkos is not None else 'serial'}"
        wasm_module = _wasm_modules.get(cache_key)
        if wasm_module is None:
            module_opts = to_js(
                {"print": print_proxy, "printErr": printerr_proxy},
                dict_converter=js.Object.fromEntries,
            )
            client_opts = to_js(
                {"kokkos": self._kokkos if self._kokkos is not None else False},
                dict_converter=js.Object.fromEntries,
            )
            self._client = await mod.LammpsClient.create(module_opts, client_opts)
            _wasm_modules[cache_key] = self._client.module
        else:
            wasm_module.print = print_proxy
            wasm_module.printErr = printerr_proxy
            instance = wasm_module.LAMMPSWeb.new()
            self._client = mod.LammpsClient.new(wasm_module, instance)

        # Mount JupyterLite's DriveFS on /work so LAMMPS reads/writes go
        # directly to the notebook filesystem — no syncing needed.
        await self._mount_drivefs()

        try:
            if self._cmdargs:
                self._client.instance.startWithArgs(to_js(self._cmdargs))
            else:
                self._client.start()
        except Exception as exc:
            raise self._error(exc) from None
        return self

    # -- output -----------------------------------------------------------

    def _on_stdout(self, line):
        line = str(line)
        if not self._banner and line.startswith("LAMMPS ("):
            self._banner = line
        if self._output is not None:
            self._output(line)

    def _on_stderr(self, line):
        if self._output is not None:
            self._output(str(line))

    # -- internals --------------------------------------------------------

    @property
    def _instance(self):
        if self._client is None:
            raise LammpsError(
                "This lammps instance has not been started. Create it with "
                "`lmp = await lammps(...)` (note the await)."
            )
        if self._closed:
            raise LammpsError("This lammps instance has been closed.")
        return self._client.instance

    def _error(self, exc) -> LammpsError:
        message = ""
        try:
            message = str(self._client.instance.getLastErrorMessage())
        except Exception:
            pass
        return LammpsError(message or str(exc))

    def _call(self, method: str, *args):
        instance = self._instance
        try:
            return getattr(instance, method)(*args)
        except Exception as exc:
            raise self._error(exc) from None

    def _numpy(self):
        if self._np is None:
            import numpy as np

            self._np = np
        return self._np

    def _view_to_numpy(self, view, dtype_hint=None):
        """Copy a wasm BufferView (ptr/length/components/type) into numpy."""
        np = self._numpy()
        length = int(view.length) if view and view.length else 0
        if length == 0:
            return np.empty(0, dtype=dtype_hint or np.float64)
        module = self._client.module
        # view.type is an embind enum instance; its numeric id is in .value.
        scalar = int(getattr(view.type, "value", view.type))
        heap = {
            0: module.HEAPF32,
            1: module.HEAPF64,
            2: module.HEAP32,
            3: getattr(module, "HEAP64", None) or module.HEAP32,
        }[scalar]
        itemsize = 4 if scalar in (0, 2) else 8
        start = int(view.ptr) // itemsize
        arr = np.asarray(heap.subarray(start, start + length).to_py()).copy()
        components = int(view.components or 1)
        if components > 1:
            arr = arr.reshape(-1, components)
        return arr

    def _sync_modifier(self, category: str, name: str):
        self._call("syncModifiers")
        snapshot = self._call("syncModifier", category, name)
        if snapshot is None:
            raise LammpsError(
                f'No {category} named "{name}" is defined in this session.'
            )
        return snapshot

    def _modifier_values(self, category: str, name: str, style: int, type: int):
        np = self._numpy()
        snapshot = self._sync_modifier(category, name)
        if style == LMP_STYLE_ATOM:
            view = self._call("getModifierPerAtom", category, name)
            return self._view_to_numpy(view)
        if style != LMP_STYLE_GLOBAL:
            raise LammpsError("Only global and per-atom styles are supported.")
        if type == LMP_TYPE_SCALAR:
            return float(snapshot.scalar)
        series = list(snapshot.series)
        if not series:
            raise LammpsError(
                f'{category} "{name}" exposes no vector/array data '
                "(run at least one step so it has been invoked)."
            )
        if bool(snapshot.clearPerSync):
            # Histogram-like data (e.g. compute rdf): series hold the full
            # current curve. VECTOR -> first curve's y values; ARRAY -> the
            # x column followed by every curve's y column.
            columns = [self._view_to_numpy(series[0].x)]
            columns += [self._view_to_numpy(s.y) for s in series]
            if type == LMP_TYPE_VECTOR:
                return columns[1]
            return np.column_stack(columns)
        # Time-series data: the current vector is the last sample of each
        # series (one series per component).
        values = [self._view_to_numpy(s.y) for s in series]
        current = np.array([v[-1] if len(v) else math.nan for v in values])
        if type == LMP_TYPE_VECTOR:
            return current
        return np.column_stack([v for v in values])

    # -- DriveFS mount -----------------------------------------------------

    async def _mount_drivefs(self):
        """Mount JupyterLite's DriveFS on the LAMMPS module's /work.

        After this, every LAMMPS ``fopen``/``fwrite``/``fclose`` in ``/work``
        goes directly through JupyterLite's service-worker contents API to the
        notebook filesystem — files appear in the file browser instantly (and
        vice versa), with no polling or sync step.

        Falls back silently if the DriveFS import or the Pyodide /drive mount
        is unavailable (e.g. running outside JupyterLite).
        """
        cache_key = id(self._client.module)
        if cache_key in _drivefs_mounted:
            return
        run_js = self._ffi[1]
        try:
            import pyodide_js

            mount_fn = run_js(_MOUNT_DRIVEFS_JS)
            mount_fn(self._client.module, pyodide_js.FS)
            _drivefs_mounted.add(cache_key)
        except Exception:
            pass

    # -- official API: commands -------------------------------------------

    def command(self, cmd: str):
        """Run a single LAMMPS command."""
        self._call("runCommand", str(cmd))

    def commands_list(self, cmdlist):
        """Run a list of LAMMPS commands."""
        self.commands_string("\n".join(str(c) for c in cmdlist))

    def commands_string(self, multicmd: str):
        """Run a block of LAMMPS commands (one input script string)."""
        script = str(multicmd)
        if not script.endswith("\n"):
            script += "\n"
        self._call("runScript", script)

    def file(self, path: str, contents=None):
        """Run a LAMMPS input script from a file.

        If ``contents`` is given (str or bytes) it is written to ``path`` in
        the wasm filesystem first. Otherwise, if ``path`` exists in the
        notebook's local filesystem it is copied in transparently.
        """
        if contents is not None:
            self.write_file(path, contents)
        self._call("runFile", str(path))

    # -- official API: queries --------------------------------------------

    def get_natoms(self) -> int:
        """Total number of atoms."""
        return int(round(float(self._call("getThermo", "atoms"))))

    def get_thermo(self, name: str):
        """Current value of any thermo keyword (e.g. "temp", "press", "pe")."""
        value = float(self._call("getThermo", str(name)))
        return None if math.isnan(value) else value

    def version(self) -> int:
        """LAMMPS version as YYYYMMDD (parsed from the startup banner)."""
        self._instance  # raise if not started
        return _version_from_banner(self._banner)

    def extract_global(self, name: str, dtype=None):
        """A subset of the global properties the wasm bindings expose."""
        del dtype
        box = None
        if name in ("boxlo", "boxhi", "boxxlo", "boxxhi", "boxylo", "boxyhi",
                    "boxzlo", "boxzhi", "dimension"):
            box = self._call("syncSimulationBox")
        if name == "ntimestep":
            return int(self._call("getCurrentStep"))
        if name == "dt":
            return float(self._call("getTimestepSize"))
        if name == "natoms":
            return self.get_natoms()
        if name == "dimension":
            return int(box.dimension)
        if box is not None:
            origin = self._view_to_numpy(box.origin).reshape(-1)
            lengths = self._view_to_numpy(box.lengths).reshape(-1)
            lo = [float(v) for v in origin]
            hi = [float(a + b) for a, b in zip(origin, lengths)]
            table = {
                "boxlo": lo, "boxhi": hi,
                "boxxlo": lo[0], "boxylo": lo[1], "boxzlo": lo[2],
                "boxxhi": hi[0], "boxyhi": hi[1], "boxzhi": hi[2],
            }
            return table[name]
        raise LammpsError(
            f'extract_global("{name}") is not available in the browser '
            'bindings. Available: ntimestep, dt, natoms, dimension, '
            "boxlo/boxhi and per-face variants."
        )

    def extract_box(self):
        """(boxlo, boxhi, xy, yz, xz, periodicity, box_change).

        Periodicity is not exposed by the wasm bindings and is reported as
        [1, 1, 1]; box_change is reported as 0.
        """
        box = self._call("syncSimulationBox")
        origin = self._view_to_numpy(box.origin).reshape(-1)
        lengths = self._view_to_numpy(box.lengths).reshape(-1)
        matrix = self._view_to_numpy(box.matrix).reshape(-1)
        boxlo = [float(v) for v in origin]
        boxhi = [float(a + b) for a, b in zip(origin, lengths)]
        # Column-major cell matrix: b's x component and c's x/y components.
        xy = float(matrix[3]) if len(matrix) == 9 else 0.0
        xz = float(matrix[6]) if len(matrix) == 9 else 0.0
        yz = float(matrix[7]) if len(matrix) == 9 else 0.0
        return (boxlo, boxhi, xy, yz, xz, [1, 1, 1], 0)

    def extract_atom(self, name: str, dtype=None):
        """Per-atom data as a numpy copy: "x" (natoms, 3), "id", "type".

        Other per-atom quantities: define an atom-style variable and read it
        with extract_variable(name, vartype=LMP_VAR_ATOM).
        """
        del dtype
        np = self._numpy()
        to_js = self._ffi[3]
        js = self._ffi[0]
        snap = self._client.syncParticles(
            to_js({"copy": True}, dict_converter=js.Object.fromEntries)
        )
        if name == "x":
            return np.asarray(snap.positions.to_py(), dtype=np.float64).reshape(-1, 3)
        if name == "id":
            return np.asarray(snap.ids.to_py()).copy()
        if name == "type":
            return np.asarray(snap.types.to_py()).copy()
        raise LammpsError(
            f'extract_atom("{name}") is not exposed by the wasm bindings. '
            'Available: "x", "id", "type" — or use an atom-style variable '
            "with extract_variable(name, vartype=LMP_VAR_ATOM)."
        )

    def extract_compute(self, cid: str, style: int, type: int):
        """Compute results.

        Global scalar/vector/array and per-atom values are supported (local
        data is not). Vector/array data comes from the modifier registry:
        time-series computes report their current values, histogram-like
        computes (e.g. rdf) their full current curve.
        """
        if style == LMP_STYLE_GLOBAL and type == LMP_TYPE_SCALAR:
            value = float(self._call("getComputeScalar", str(cid)))
            return None if math.isnan(value) else value
        return self._modifier_values("compute", str(cid), style, type)

    def extract_fix(self, fid: str, style: int, type: int, nrow: int = 0, ncol: int = 0):
        """Fix results (global scalar/vector and per-atom values)."""
        del nrow, ncol
        if style == LMP_STYLE_GLOBAL and type == LMP_TYPE_SCALAR:
            snapshot = self._sync_modifier("fix", str(fid))
            return float(snapshot.scalar)
        return self._modifier_values("fix", str(fid), style, type)

    def extract_variable(self, name: str, group=None, vartype: int = LMP_VAR_EQUAL):
        """Equal-style (float) or atom-style (numpy array) variable values."""
        del group
        if vartype == LMP_VAR_ATOM:
            self._sync_modifier("variable", str(name))
            view = self._call("getModifierPerAtom", "variable", str(name))
            return self._view_to_numpy(view)
        snapshot = self._sync_modifier("variable", str(name))
        return float(snapshot.scalar)

    # -- lifecycle ---------------------------------------------------------

    def close(self):
        """Shut down the LAMMPS instance."""
        if self._client is not None and not self._closed:
            try:
                self._client.stop()
            finally:
                self._closed = True
                for proxy in self._proxies:
                    try:
                        proxy.destroy()
                    except Exception:
                        pass
                self._proxies = []

    def finalize(self):
        """Alias for close(), matching the official module."""
        self.close()

    # -- lammps.js extensions ----------------------------------------------

    def has_package(self, name: str) -> bool:
        """Whether the wasm build includes a LAMMPS package (e.g. "KOKKOS")."""
        return bool(self._call("hasPackage", str(name)))

    def write_file(self, path: str, contents):
        """Write a file into the wasm filesystem (creating directories)."""
        instance = self._instance  # noqa: F841 - validates state
        js = self._ffi[0]
        to_js = self._ffi[3]
        FS = self._client.module.FS
        parent = PurePosixPath(str(path)).parent
        if str(parent) not in (".", "/"):
            prefix = ""
            for part in parent.parts:
                if part == "/":
                    prefix = "/"
                    continue
                prefix = f"{prefix}{part}" if prefix.endswith("/") or not prefix else f"{prefix}/{part}"
                try:
                    FS.mkdir(prefix)
                except Exception:
                    pass  # already exists
        if isinstance(contents, str):
            FS.writeFile(str(path), contents)
        else:
            FS.writeFile(str(path), to_js(bytes(contents)))
        del js

    def read_file(self, path: str) -> str:
        """Read a text file from the wasm filesystem (e.g. a written dump)."""
        js = self._ffi[0]
        to_js = self._ffi[3]
        opts = to_js({"encoding": "utf8"}, dict_converter=js.Object.fromEntries)
        return str(self._client.module.FS.readFile(str(path), opts))

    @property
    def client(self):
        """The underlying lammps.js LammpsClient (JsProxy) — full JS API."""
        self._instance
        return self._client


class _NumpyAccessor:
    """`lmp.numpy.*` compatibility: our extract_* already return numpy."""

    def __init__(self, lmp: lammps):
        self._lmp = lmp

    def extract_atom(self, *args, **kw):
        return self._lmp.extract_atom(*args, **kw)

    def extract_compute(self, *args, **kw):
        return self._lmp.extract_compute(*args, **kw)

    def extract_fix(self, *args, **kw):
        return self._lmp.extract_fix(*args, **kw)

    def extract_variable(self, *args, **kw):
        return self._lmp.extract_variable(*args, **kw)
