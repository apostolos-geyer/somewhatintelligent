import { defineConfig } from "vite-plus";

// Node-env test config for Site's pure library helpers (lib/markdown.ts).
// Astro reads astro.config.mjs, not this file, so it never affects the build;
// `vp test` reads it. includeTaskLocation lets the runner identify tests by
// file + description (mirrors packages/secrets).
export default defineConfig({
  test: {
    includeTaskLocation: true,
    include: ["src/**/__tests__/**/*.test.ts"],
  },
});
