import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { LammpsModule } from "../types";
import { loadModule } from "./helpers/lammps";

// The DriveFS mount lives as a JS snippet inside the Python bindings
// (python/lammps/__init__.py, _MOUNT_DRIVEFS_JS). These tests extract that
// exact snippet and exercise every branch of it against the real wasm
// filesystem, with the JupyterLite ContentsAPI replaced by an in-memory
// mock. Branch checklist:
//
//   toAPIPath   : cwd inside /drive (prefix), cwd == /drive (no prefix),
//                 cwd outside /drive, cwd() throwing
//   node_ops    : lookup hit/miss, mknod (file + dir), getattr, setattr
//                 (mode, timestamp), rename, unlink, rmdir, readdir,
//                 symlink (EPERM), readlink (EINVAL)
//   stream_ops  : open existing / missing+write (mknod) / missing+read
//                 (ENOENT) / O_TRUNC, close with and without write flags,
//                 read (normal, past-EOF, zero-length), write (grow,
//                 in-place), llseek (CUR, END, negative)
//   mount       : first mount, re-mount (unmount + mkdirTree branches)
//   end-to-end  : LAMMPS write_dump / fix ave-time file / fix ave-chunk +
//                 unfix / read_data + include of Python-written files /
//                 re-run overwriting a previous output

function extractMountJs(): string {
  const py = readFileSync(
    join(process.cwd(), "python", "lammps", "__init__.py"),
    "utf8",
  );
  const match = py.match(/_MOUNT_DRIVEFS_JS = """\n([\s\S]*?)\n"""/);
  if (!match) throw new Error("_MOUNT_DRIVEFS_JS not found in bindings");
  // Interpret the python string escapes (only \\ occurs in the snippet).
  return match[1].replace(/\\\\/g, "\\");
}

interface StoredFile {
  data: Uint8Array;
}

/** In-memory stand-in for JupyterLite's DriveFS ContentsAPI. */
class MockContentsAPI {
  files = new Map<string, StoredFile>();
  dirs = new Set<string>(["/"]);
  putCalls: string[] = [];

  seed(path: string, text: string) {
    const parts = path.split("/").slice(1, -1);
    let prefix = "";
    for (const part of parts) {
      prefix += "/" + part;
      this.dirs.add(prefix);
    }
    this.files.set(path, { data: new TextEncoder().encode(text) });
  }

  text(path: string): string | undefined {
    const f = this.files.get(path);
    return f ? new TextDecoder().decode(f.data) : undefined;
  }

  lookup(path: string) {
    if (path === "/" || this.dirs.has(path)) return { ok: true, mode: 16895 };
    if (this.files.has(path)) return { ok: true, mode: 33206 };
    return { ok: false };
  }

  getattr(path: string) {
    const size = this.files.get(path)?.data.length ?? 0;
    const now = new Date(0);
    return {
      dev: 1, ino: 0, mode: this.files.has(path) ? 33206 : 16895, nlink: 1,
      uid: 0, gid: 0, rdev: 0, size, atime: now, mtime: now, ctime: now,
      blksize: 4096, blocks: Math.ceil(size / 4096),
    };
  }

  get(path: string): StoredFile {
    const f = this.files.get(path);
    if (!f) throw new Error(`get: ${path} not found`);
    // Return a copy-holder so proxy writes don't mutate the store until put.
    return { data: f.data.slice() };
  }

  put(path: string, file: StoredFile) {
    this.putCalls.push(path);
    this.files.set(path, { data: file.data.slice() });
  }

  mknod(path: string, mode: number) {
    if ((mode & 61440) === 16384) this.dirs.add(path);
    else this.files.set(path, { data: new Uint8Array() });
  }

  rename(oldPath: string, newPath: string) {
    const f = this.files.get(oldPath);
    if (f) {
      this.files.delete(oldPath);
      this.files.set(newPath, f);
    } else if (this.dirs.has(oldPath)) {
      this.dirs.delete(oldPath);
      this.dirs.add(newPath);
    }
  }

  rmdir(path: string) {
    this.files.delete(path);
    this.dirs.delete(path);
  }

  readdir(path: string): string[] {
    // The proxy hands us the mount root as "/", subdirs as "/name/" or
    // "/name" — normalize away a trailing slash like the real API does.
    if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
    const prefix = path === "/" ? "/" : path + "/";
    const names = new Set<string>();
    for (const p of [...this.files.keys(), ...this.dirs]) {
      if (p !== path && p.startsWith(prefix)) {
        names.add(p.slice(prefix.length).split("/")[0]);
      }
    }
    return [".", "..", ...names];
  }
}

let wasm: LammpsModule;
let api: MockContentsAPI;
let cwd: () => string;
let mount: (mod: LammpsModule, pyFS: unknown) => boolean;

function pyodideFsMock() {
  return {
    lookupPath: () => ({ node: { mount: { type: { API: api } } } }),
    cwd: () => cwd(),
  };
}

function remount() {
  api = new MockContentsAPI();
  cwd = () => "/drive/nb";
  expect(mount(wasm, pyodideFsMock())).toBe(true);
}

beforeAll(async () => {
  wasm = await loadModule();
  // eslint-disable-next-line no-eval
  mount = (0, eval)(extractMountJs());
});

beforeEach(() => {
  remount();
});

describe("mounting", () => {
  it("mounts /work on the contents API and chdirs into it", () => {
    expect(wasm.FS.cwd()).toBe("/work");
  });

  it("can re-mount over an existing mount (unmount + mkdirTree branches)", () => {
    remount(); // beforeEach already mounted once; this exercises unmount
    wasm.FS.writeFile("/work/x.txt", "hello");
    expect(api.text("/nb/x.txt")).toBe("hello");
  });
});

describe("toAPIPath cwd prefix", () => {
  it("prefixes with the kernel cwd inside /drive", () => {
    cwd = () => "/drive/sub/dir";
    wasm.FS.writeFile("/work/a.txt", "A");
    expect(api.text("/sub/dir/a.txt")).toBe("A");
  });

  it("uses the drive root when cwd is exactly /drive", () => {
    cwd = () => "/drive";
    wasm.FS.writeFile("/work/b.txt", "B");
    expect(api.text("/b.txt")).toBe("B");
  });

  it("uses the drive root when cwd is outside /drive", () => {
    cwd = () => "/tmp";
    wasm.FS.writeFile("/work/c.txt", "C");
    expect(api.text("/c.txt")).toBe("C");
  });

  it("falls back to the drive root when cwd() throws", () => {
    cwd = () => {
      throw new Error("no cwd");
    };
    wasm.FS.writeFile("/work/d.txt", "D");
    expect(api.text("/d.txt")).toBe("D");
  });

  it("re-evaluates the cwd on every operation", () => {
    cwd = () => "/drive/one";
    wasm.FS.writeFile("/work/e.txt", "E1");
    cwd = () => "/drive/two";
    wasm.FS.writeFile("/work/e.txt", "E2");
    expect(api.text("/one/e.txt")).toBe("E1");
    expect(api.text("/two/e.txt")).toBe("E2");
  });
});

describe("node_ops", () => {
  it("lookup finds files seeded in the contents store", () => {
    api.seed("/nb/seeded.txt", "from python");
    expect(wasm.FS.readFile("/work/seeded.txt", { encoding: "utf8" })).toBe(
      "from python",
    );
  });

  it("lookup of a missing file throws ENOENT", () => {
    expect(() => wasm.FS.readFile("/work/missing.txt")).toThrow();
  });

  it("mknod creates directories in the store", () => {
    wasm.FS.mkdir("/work/newdir");
    expect(api.dirs.has("/nb/newdir")).toBe(true);
    wasm.FS.writeFile("/work/newdir/f.txt", "nested");
    expect(api.text("/nb/newdir/f.txt")).toBe("nested");
  });

  it("getattr reports the stored size", () => {
    api.seed("/nb/sized.txt", "12345");
    const st = wasm.FS.stat("/work/sized.txt");
    expect(st.size).toBe(5);
  });

  it("setattr accepts mode and timestamp changes", () => {
    api.seed("/nb/attr.txt", "x");
    wasm.FS.chmod("/work/attr.txt", 0o600); // mode branch
    wasm.FS.utime("/work/attr.txt", 1000, 1000); // timestamp branch
    expect(api.text("/nb/attr.txt")).toBe("x");
  });

  it("rename moves the file in the store", () => {
    wasm.FS.writeFile("/work/old.txt", "payload");
    wasm.FS.rename("/work/old.txt", "/work/new.txt");
    expect(api.text("/nb/new.txt")).toBe("payload");
    expect(api.text("/nb/old.txt")).toBeUndefined();
  });

  it("unlink removes the file from the store", () => {
    wasm.FS.writeFile("/work/gone.txt", "bye");
    wasm.FS.unlink("/work/gone.txt");
    expect(api.text("/nb/gone.txt")).toBeUndefined();
  });

  it("rmdir removes a directory from the store", () => {
    wasm.FS.mkdir("/work/tmpdir");
    wasm.FS.rmdir("/work/tmpdir");
    expect(api.dirs.has("/nb/tmpdir")).toBe(false);
  });

  it("readdir lists store entries", () => {
    wasm.FS.writeFile("/work/l1.txt", "1");
    api.seed("/nb/l2.txt", "2");
    const names = wasm.FS.readdir("/work");
    expect(names).toContain("l1.txt");
    expect(names).toContain("l2.txt");
  });

  it("symlink and readlink are rejected", () => {
    expect(() => wasm.FS.symlink("/work/l1.txt", "/work/link")).toThrow();
    expect(() => wasm.FS.readlink("/work/l1.txt")).toThrow();
  });
});

describe("stream_ops", () => {
  it("open of a missing file in read mode throws ENOENT", () => {
    expect(() => wasm.FS.open("/work/nope.txt", "r")).toThrow();
  });

  it("write-mode open of a missing file creates it (mknod branch)", () => {
    const s = wasm.FS.open("/work/created.txt", "w");
    wasm.FS.write(s, new TextEncoder().encode("made"), 0, 4);
    wasm.FS.close(s);
    expect(api.text("/nb/created.txt")).toBe("made");
  });

  it("read-only close does not put", () => {
    api.seed("/nb/ro.txt", "read me");
    api.putCalls = [];
    const s = wasm.FS.open("/work/ro.txt", "r");
    const buf = new Uint8Array(7);
    wasm.FS.read(s, buf, 0, 7);
    wasm.FS.close(s);
    expect(new TextDecoder().decode(buf)).toBe("read me");
    expect(api.putCalls).toEqual([]);
  });

  it("read past EOF returns 0 bytes", () => {
    api.seed("/nb/short.txt", "ab");
    const s = wasm.FS.open("/work/short.txt", "r");
    const buf = new Uint8Array(10);
    const n1 = wasm.FS.read(s, buf, 0, 10);
    const n2 = wasm.FS.read(s, buf, 0, 10);
    wasm.FS.close(s);
    expect(n1).toBe(2);
    expect(n2).toBe(0);
  });

  it("writes grow the buffer and in-place writes preserve the rest", () => {
    wasm.FS.writeFile("/work/grow.txt", "0123456789");
    const s = wasm.FS.open("/work/grow.txt", "r+");
    wasm.FS.write(s, new TextEncoder().encode("AB"), 0, 2, 3); // in place
    wasm.FS.close(s);
    expect(api.text("/nb/grow.txt")).toBe("012AB56789");
  });

  it("append mode seeks to the end (SEEK_END branch)", () => {
    wasm.FS.writeFile("/work/log.txt", "line1\n");
    const s = wasm.FS.open("/work/log.txt", "a");
    wasm.FS.write(s, new TextEncoder().encode("line2\n"), 0, 6);
    wasm.FS.close(s);
    expect(api.text("/nb/log.txt")).toBe("line1\nline2\n");
  });

  it("llseek with SEEK_CUR advances relative to the position", () => {
    api.seed("/nb/seek.txt", "abcdef");
    const s = wasm.FS.open("/work/seek.txt", "r");
    const buf = new Uint8Array(2);
    wasm.FS.read(s, buf, 0, 2);
    wasm.FS.llseek(s, 2, 1); // SEEK_CUR: 2 + 2 = 4
    wasm.FS.read(s, buf, 0, 2);
    wasm.FS.close(s);
    expect(new TextDecoder().decode(buf)).toBe("ef");
  });

  it("llseek to a negative position throws EINVAL", () => {
    api.seed("/nb/neg.txt", "abc");
    const s = wasm.FS.open("/work/neg.txt", "r");
    expect(() => wasm.FS.llseek(s, -10, 0)).toThrow();
    wasm.FS.close(s);
  });

  it("re-opening an existing file with 'w' truncates the old content", () => {
    wasm.FS.writeFile("/work/trunc.txt", "a much longer previous content");
    wasm.FS.writeFile("/work/trunc.txt", "short");
    expect(api.text("/nb/trunc.txt")).toBe("short");
  });

  it("truncate to a nonzero size keeps the leading bytes", () => {
    wasm.FS.writeFile("/work/part.txt", "abcdefgh");
    wasm.FS.truncate("/work/part.txt", 3);
    expect(api.text("/nb/part.txt")).toBe("abc");
  });

  it("truncate can also extend a file with zero padding", () => {
    wasm.FS.writeFile("/work/pad.txt", "ab");
    wasm.FS.truncate("/work/pad.txt", 4);
    expect(api.files.get("/nb/pad.txt")!.data).toEqual(
      new Uint8Array([97, 98, 0, 0]),
    );
  });
});

describe("LAMMPS end-to-end through the mount", () => {
  const SETUP = `
units lj
atom_style atomic
lattice fcc 0.8442
region box block 0 2 0 2 0 2
create_box 1 box
create_atoms 1 box
mass 1 1.0
velocity all create 1.44 87287
pair_style lj/cut 2.5
pair_coeff 1 1 1.0 1.0 2.5
fix 1 all nve
`;

  function session() {
    const lmp = new wasm.LAMMPSWeb();
    lmp.start();
    return lmp;
  }

  it("write_dump lands next to the notebook and parses", () => {
    const lmp = session();
    lmp.runScript(SETUP + "run 10\nwrite_dump all atom out.dump\n");
    lmp.stop();
    const dump = api.text("/nb/out.dump");
    expect(dump).toBeDefined();
    const lines = dump!.trim().split("\n");
    expect(lines[0]).toBe("ITEM: TIMESTEP");
    expect(lines.length).toBe(9 + 32); // header + one row per atom
  });

  it("fix ave/time output is complete after the session closes", () => {
    const lmp = session();
    lmp.runScript(
      SETUP +
        "variable t equal temp\n" +
        "fix out all ave/time 5 1 5 v_t file thermo_test.txt\n" +
        "run 50\n",
    );
    lmp.stop(); // closes the fix's file -> flushed through put
    const rows = api
      .text("/nb/thermo_test.txt")!
      .split("\n")
      .filter((l) => l && !l.startsWith("#"));
    expect(rows.length).toBe(11); // steps 0, 5, …, 50
    for (const row of rows) {
      const [step, value] = row.trim().split(/\s+/).map(Number);
      expect(step % 5).toBe(0);
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("fix ave/chunk output is complete after unfix", () => {
    const lmp = session();
    lmp.runScript(
      SETUP +
        "compute ck all chunk/atom bin/1d x lower 0.25 units reduced\n" +
        "fix tp all ave/chunk 5 2 10 ck temp file profile_test.txt\n" +
        "run 10\n" +
        "unfix tp\n",
    );
    const rows = api
      .text("/nb/profile_test.txt")!
      .split("\n")
      .filter((l) => l && !l.startsWith("#"));
    lmp.stop();
    expect(rows.length).toBe(1 + 4); // block header + 4 bins
  });

  it("LAMMPS reads scripts and data files written to the store", () => {
    api.seed("/nb/tiny.in", SETUP + "run 5\nwrite_data tiny.data\n");
    const lmp = session();
    lmp.runFile("tiny.in");
    lmp.stop();
    expect(api.text("/nb/tiny.data")).toContain("32 atoms");

    const lmp2 = session();
    lmp2.runScript(
      "units lj\natom_style atomic\npair_style lj/cut 2.5\nread_data tiny.data\n",
    );
    expect(lmp2.getThermo("atoms")).toBe(32);
    lmp2.stop();
  });

  it("re-running a script overwrites the previous, longer output cleanly", () => {
    const lmp = session();
    lmp.runScript(
      SETUP +
        "variable t equal temp\n" +
        "fix out all ave/time 5 1 5 v_t file rerun_test.txt\n" +
        "run 100\n",
    );
    lmp.stop();
    const first = api.text("/nb/rerun_test.txt")!;

    const lmp2 = session();
    lmp2.runScript(
      SETUP +
        "variable t equal temp\n" +
        "fix out all ave/time 5 1 5 v_t file rerun_test.txt\n" +
        "run 10\n",
    );
    lmp2.stop();
    const second = api.text("/nb/rerun_test.txt")!;
    expect(second.length).toBeLessThan(first.length);
    const rows = second.split("\n").filter((l) => l && !l.startsWith("#"));
    expect(rows.length).toBe(3); // steps 0, 5, 10 — no stale tail from the first run
  });
});
