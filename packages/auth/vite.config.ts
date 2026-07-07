import { defineConfig } from "vite-plus";

// Captain needs vitest test locations to identify tests (file + description).
export default defineConfig({
  test: {
    includeTaskLocation: true,
  },
});
