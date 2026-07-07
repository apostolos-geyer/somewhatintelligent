import babel from "@rolldown/plugin-babel";
import { defineConfig } from "vite-plus";

// Oxc (vite-plus's parser) does not yet support TC39 Stage 3 decorators
// (oxc#9170). Cloudflare's Agents SDK ships `agents/vite` which is a thin
// wrapper around the same babel transform we set up here directly — avoids
// pulling the full Agents SDK runtime as a dep just to get the transform.
//
// `code: "@"` filter limits babel to files actually containing `@` so the
// transform overhead is paid only by the few files using the decorator
// pattern (the @instrumented / @logged.skip surfaces in `src/log/`).
export default defineConfig({
  test: {
    includeTaskLocation: true,
  },
  plugins: [
    babel({
      presets: [
        {
          preset: () => ({
            plugins: [["@babel/plugin-proposal-decorators", { version: "2023-11" }]],
          }),
          rolldown: { filter: { code: "@" } },
        },
      ],
    }) as never,
  ],
});
