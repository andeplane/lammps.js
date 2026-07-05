#!/usr/bin/env python3
"""
CMake-based build script for lammps.js

This script builds LAMMPS as a WebAssembly module using CMake and Emscripten.
It handles cloning LAMMPS, configuring CMake, building the library, and linking
the final WASM module.

Usage:
    python cpp/build.py           # Basic build
    python cpp/build.py --debug   # Debug build with source maps
    python cpp/build.py -r        # Force full recompilation

Environment variables:
    EMSDK_PATH    - Path to Emscripten SDK (required)
    LAMMPS_TAG    - Git tag/branch for LAMMPS (default: patch_10Sep2025)
    PACKAGES      - Space-separated list of LAMMPS packages (default: MOLECULE)
    SINGLE_FILE   - Set to "0" to output separate .wasm file (default: "1")
    KOKKOS        - Set to "1" to build the KOKKOS (pthreads) variant,
                    emitted as dist/cpp/lammps-kokkos.js
"""

import os
import subprocess
import shutil
import sys
from pathlib import Path

# Configuration
LAMMPS_TAG = os.environ.get("LAMMPS_TAG", "patch_10Sep2025")
PACKAGES = os.environ.get("PACKAGES", "MOLECULE").split()
SINGLE_FILE = os.environ.get("SINGLE_FILE", "1") == "1"
KOKKOS = os.environ.get("KOKKOS", "0") == "1"

BASE_DIR = Path(__file__).resolve().parent
LAMMPS_DIR = BASE_DIR / "lammps"
SRC_DIR = LAMMPS_DIR / "src"
BUILD_DIR = BASE_DIR / ("build_emscripten_kokkos" if KOKKOS else "build_emscripten")

# KOKKOS needs 64-bit pointers (MEMORY64=2 keeps a wasm32 binary) and pthreads.
KOKKOS_CC_FLAGS = "-pthread -sMEMORY64=2"

# Custom source files to copy into LAMMPS
CUSTOM_BASENAMES = ["lammpsweb", "fix_js_async"]


def get_emsdk_path():
    """Get and validate EMSDK path."""
    emsdk_path = os.environ.get("EMSDK_PATH")
    if not emsdk_path:
        sys.exit("ERROR: The EMSDK_PATH environment variable must be set to your Emscripten SDK path.")
    
    emsdk_env = Path(emsdk_path) / "emsdk_env.sh"
    if not emsdk_env.exists():
        sys.exit(f"ERROR: Emscripten SDK not found at {emsdk_path}")
    
    return str(emsdk_env)


def file_content(path: Path) -> str:
    """Read file content or return empty string if file doesn't exist."""
    if not path.exists():
        return ""
    return path.read_text()


def copy_if_changed(src: Path, dst: Path) -> None:
    """Copy file only if content has changed."""
    if file_content(src) != file_content(dst):
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        print(f"Copied: {src.name} -> {dst.relative_to(BASE_DIR)}")


def ensure_clone() -> None:
    """Clone LAMMPS if not already present."""
    if LAMMPS_DIR.is_dir():
        print(f"Using existing LAMMPS clone at {LAMMPS_DIR}")
        return
    
    print(f"Cloning LAMMPS ({LAMMPS_TAG})...")
    subprocess.check_call([
        "git", "clone",
        "--depth", "1",
        "--branch", LAMMPS_TAG,
        "https://github.com/lammps/lammps.git",
        str(LAMMPS_DIR),
    ], cwd=BASE_DIR)


def copy_custom_sources() -> None:
    """Copy custom lammpsweb sources to LAMMPS src directory."""
    for basename in CUSTOM_BASENAMES:
        for ext in (".cpp", ".h"):
            src = BASE_DIR / "lammpsweb" / f"{basename}{ext}"
            dst = SRC_DIR / f"{basename}{ext}"
            if src.exists():
                copy_if_changed(src, dst)


def remove_broken_imd() -> None:
    """Remove fix_imd which doesn't work in WebAssembly."""
    # Check in both root src and MISC subdirectory
    for subdir in ["", "MISC"]:
        for ext in [".cpp", ".h"]:
            target = SRC_DIR / subdir / f"fix_imd{ext}"
            if target.is_file():
                target.unlink()
                print(f"Removed: {target.relative_to(BASE_DIR)}")


def ensure_locate_file() -> None:
    """Create locateFile.js if it doesn't exist."""
    locate_file = BASE_DIR / "locateFile.js"
    if locate_file.exists():
        return
    
    locate_file.write_text("""\
if (typeof Module === "undefined") {
  Module = {};
}
if (!Module.locateFile) {
  Module.locateFile = function locateFile(path) {
    return path;
  };
}
""")
    print(f"Created: {locate_file.relative_to(BASE_DIR)}")


def configure_cmake(emsdk_env: str, debug_mode: bool = False) -> None:
    """Configure CMake with Emscripten and required packages."""
    print("Configuring CMake with Emscripten...")
    
    # CMake source path (LAMMPS has its cmake config in cmake/)
    cmake_source = "../lammps/cmake"
    cmake_source_abs = LAMMPS_DIR / "cmake"
    if not cmake_source_abs.exists():
        sys.exit(f"ERROR: CMake source directory not found: {cmake_source_abs}")
    
    # Build package flags
    packages = PACKAGES + (["KOKKOS"] if KOKKOS and "KOKKOS" not in PACKAGES else [])
    package_flags = [f"-DPKG_{pkg}=ON" for pkg in packages]
    print(f"Enabling packages: {', '.join(packages)}")

    # Compiler flags
    cc_flags_common = "-DLAMMPS_EXCEPTIONS -s NO_DISABLE_EXCEPTION_CATCHING=1"
    if KOKKOS:
        cc_flags_common = f"{KOKKOS_CC_FLAGS} {cc_flags_common}"

    if debug_mode:
        cc_flags = f"-O0 -gsource-map {cc_flags_common}"
        build_type = "Debug"
    else:
        cc_flags = f"-Oz -DNDEBUG -flto {cc_flags_common}"
        build_type = "Release"

    cmake_args = [
        "emcmake", "cmake",
        cmake_source,
        f"-DCMAKE_BUILD_TYPE={build_type}",
        "-DCMAKE_CXX_STANDARD=17",
        "-DCMAKE_CXX_STANDARD_REQUIRED=ON",
        "-DLAMMPS_SIZES=smallbig",
        "-DBUILD_MPI=OFF",  # Use LAMMPS built-in MPI STUBS for serial build
        f'-DCMAKE_CXX_FLAGS="{cc_flags}"',
        f'-DCMAKE_C_FLAGS="{cc_flags}"',
    ] + package_flags

    if KOKKOS:
        cmake_args += [
            "-DKokkos_ENABLE_THREADS=ON",
            "-DKokkos_ENABLE_LIBDL=OFF",  # no dynamic loading in WebAssembly
            "-DKokkos_ENABLE_DEPRECATION_WARNINGS=OFF",
        ]
    
    # Create build directory
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    
    # Source emsdk_env.sh and run cmake
    cmake_cmd = f'source {emsdk_env} && cd {BUILD_DIR} && {" ".join(cmake_args)}'
    subprocess.run(cmake_cmd, shell=True, executable="/bin/bash", check=True)
    print("CMake configuration complete!")


def build_lammps_library(emsdk_env: str) -> None:
    """Build the LAMMPS library using CMake."""
    print("Building LAMMPS library...")
    
    jobs = os.cpu_count() or 1
    build_cmd = f'source {emsdk_env} && cd {BUILD_DIR} && cmake --build . --target lammps -j{jobs}'
    
    subprocess.run(build_cmd, shell=True, executable="/bin/bash", check=True)
    print("LAMMPS library build complete!")


def link_wasm_module(emsdk_env: str, debug_mode: bool = False) -> None:
    """Link the LAMMPS library into a WASM module."""
    print("Linking WASM module...")
    
    # Find the library file
    lib_path = BUILD_DIR / "liblammps.a"
    if not lib_path.exists():
        lib_path = BUILD_DIR / "lib" / "liblammps.a"
        if not lib_path.exists():
            sys.exit(f"ERROR: LAMMPS library not found")
    
    lib_abs_path = lib_path.resolve()
    locate_file_abs = (BASE_DIR / "locateFile.js").resolve()

    # Output file - must land in dist/cpp/ so that dist/client.js can import ./cpp/lammps.js
    output_name = "lammps-kokkos.js" if KOKKOS else "lammps.js"
    output_file = BASE_DIR.parent / "dist" / "cpp" / output_name
    output_file.parent.mkdir(parents=True, exist_ok=True)

    # Build emcc arguments
    emcc_args = []
    
    if debug_mode:
        emcc_args.extend(["-O1", "-gsource-map", "--source-map-base=http://localhost:5173/"])
    else:
        emcc_args.extend(["-Oz", "-flto"])
    
    # Pre-js and basic flags
    emcc_args.extend([
        "--pre-js", str(locate_file_abs),
        "--no-entry",
        "-lembind",
    ])
    
    # Environment - support web, worker, and node
    emcc_args.extend(["-s", "ENVIRONMENT=web,worker,node"])

    # Exception handling
    emcc_args.extend(["-s", "NO_DISABLE_EXCEPTION_CATCHING=1"])

    # Memory settings
    emcc_args.extend([
        "-s", "ALLOW_MEMORY_GROWTH=1",
        "-s", "INITIAL_MEMORY=256MB",
    ])

    # Async support
    emcc_args.extend(["-s", "ASYNCIFY"])

    if KOKKOS:
        emcc_args.extend([
            "-pthread",
            "-s", "MEMORY64=2",
            "-s", "MAXIMUM_MEMORY=4GB",  # required for memory growth with shared memory
            "-s", "PTHREAD_POOL_SIZE=8",
        ])
    
    # Module settings
    emcc_args.extend([
        "-s", "MODULARIZE=1",
        "-s", "EXPORT_ES6=1",
        "-s", "EXPORT_NAME='createModule'",
    ])
    
    # Runtime exports
    emcc_args.extend([
        "-s", "EXPORTED_RUNTIME_METHODS=['getValue','FS','HEAP32','HEAPF32','HEAPF64','HEAP64']",
    ])
    
    # Filesystem
    emcc_args.extend(["-s", "FORCE_FILESYSTEM=1"])
    
    # Single file mode (embed wasm in JS)
    if SINGLE_FILE:
        emcc_args.extend(["-s", "SINGLE_FILE=1"])
        print("Building with embedded WASM (SINGLE_FILE=1)")
    else:
        print("Building with separate WASM file")
    
    # Assertions for debugging
    if debug_mode:
        emcc_args.extend(["-s", "ASSERTIONS=2"])
    
    # Library linking - use whole-archive to include all symbols
    emcc_args.extend([
        "-Wl,--whole-archive",
        str(lib_abs_path),
        "-Wl,--no-whole-archive",
    ])

    # The KOKKOS build produces separate Kokkos static libraries that
    # liblammps.a depends on (regular archive linking is enough for these).
    if KOKKOS:
        kokkos_libs = sorted(BUILD_DIR.glob("lib/kokkos/**/*.a"))
        if not kokkos_libs:
            sys.exit("ERROR: Kokkos libraries not found in build directory")
        emcc_args.extend(str(lib.resolve()) for lib in kokkos_libs)
    
    # Output file
    emcc_args.extend(["-o", str(output_file)])
    
    # Build the command with proper quoting
    def quote_arg(arg):
        if any(c in arg for c in [" ", "'", "[", "]"]):
            return f'"{arg}"'
        return arg
    
    emcc_cmd = "emcc " + " ".join(quote_arg(arg) for arg in emcc_args)
    full_cmd = f'source {emsdk_env} && {emcc_cmd}'
    
    subprocess.run(full_cmd, shell=True, executable="/bin/bash", check=True)
    print(f"WASM module linked: {output_file.relative_to(BASE_DIR.parent)}")


def main():
    # Parse arguments
    debug_mode = "--debug" in sys.argv or "-d" in sys.argv
    recompile = "--recompile" in sys.argv or "-r" in sys.argv
    
    if debug_mode:
        print("Building in DEBUG mode with source maps...")
    else:
        print("Building in RELEASE mode (optimized)...")
    
    # Setup
    emsdk_env = get_emsdk_path()
    ensure_locate_file()
    
    # Clone LAMMPS if needed
    ensure_clone()
    
    # Copy custom sources
    print("Copying custom source files...")
    copy_custom_sources()
    
    # Remove problematic files
    remove_broken_imd()
    
    # Clean build directory if recompile requested
    if recompile and BUILD_DIR.exists():
        print("Cleaning build directory for full recompilation...")
        shutil.rmtree(BUILD_DIR)
    
    # Configure CMake
    configure_cmake(emsdk_env, debug_mode=debug_mode)
    
    # Build library
    build_lammps_library(emsdk_env)
    
    # Link WASM module
    link_wasm_module(emsdk_env, debug_mode=debug_mode)
    
    print("\nBuild complete!")
    print(f"Output: {BASE_DIR.parent / 'dist' / 'cpp' / 'lammps.js'}")


if __name__ == "__main__":
    main()
