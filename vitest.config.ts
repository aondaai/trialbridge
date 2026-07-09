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
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
