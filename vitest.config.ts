import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  // Use the automatic JSX runtime (same as Next) so rendered components don't
  // need an explicit `import React` — matches the app's build config.
  esbuild: {
    jsx: "automatic",
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Run test FILES serially. `tests/vocab-index.test.ts` writes and unlinks a
    // real repo-relative file (data/vocab-index.json) that `loadVocabIndex()`
    // reads; under parallel file execution a concurrent worker (e.g.
    // concept-resolver.test.ts) could read that file mid-window — a shared-FS
    // race. Serial files remove it deterministically. The suite is sub-second,
    // so the cost is negligible; within-file tests still run normally.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
