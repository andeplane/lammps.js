import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

// COOP/COEP make the dev/preview servers cross-origin isolated so the
// multithreaded KOKKOS build (SharedArrayBuffer) works locally. On GitHub
// Pages, which cannot set response headers, coi-serviceworker.min.js
// injects the same headers from a service worker instead.
const crossOriginIsolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp"
};

export default defineConfig({
  base: "./",
  // The Emscripten modules use top-level await, which the default es2020
  // target rejects.
  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        // Two pages: the playground at / and the interactive docs at /docs/.
        main: resolve(root, "index.html"),
        docs: resolve(root, "docs/index.html")
      }
    }
  },
  // The lammps worker is a module worker and its client lazy-imports the
  // wasm modules; the default iife worker format cannot represent that.
  worker: { format: "es" },
  server: { headers: crossOriginIsolationHeaders },
  preview: { headers: crossOriginIsolationHeaders }
});
