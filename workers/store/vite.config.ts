import path from "node:path";
import { defineConfig } from "vite-plus";

// Store is a pure backend (RFC-0001 D3/D12: no routes, no SSR, no client
// bundle) — this config exists solely to give `vp test run` the `@/` alias
// the node-environment unit suite (`*.test.ts`) uses. The D1 pool tier
// (`*.itest.ts`) has its own self-contained vitest.pool.config.ts.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  lint: {
    ignorePatterns: ["__tests__/**/*"],
  },
  test: {
    includeTaskLocation: true,
    globals: true,
    include: ["__tests__/**/*.test.ts"],
    environment: "node",
  },
});
