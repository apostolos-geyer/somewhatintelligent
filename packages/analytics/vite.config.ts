import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

// @si/analytics ships client (.tsx) + server code. The react plugin gives the
// component tests (the identity bridge) a working JSX/automatic-runtime
// transform under vitest; node-env tests (registry types, server delivery,
// vendor boundary) don't need it but are unaffected. Per-file environment is
// set with a `// @vitest-environment happy-dom` docblock where a DOM is needed.
export default defineConfig({
  test: {
    includeTaskLocation: true,
  },
  plugins: [react()],
});
