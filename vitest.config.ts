import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    hookTimeout: 120_000,
    testTimeout: 120_000,
    include: ["tests/**/*.spec.ts"],
    server: {
      deps: {
        // Load the emscripten glue (wasm embedded as base64, up to ~56 MB)
        // with Node's own loader. Transforming it through vite-node exhausts
        // the 4 GB default heap for the atomify build.
        external: [/\/dist\/cpp\/lammps[\w-]*\.js$/],
      },
    },
  }
});
