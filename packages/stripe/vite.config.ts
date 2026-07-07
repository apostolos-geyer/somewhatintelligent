import { defineConfig } from "vite-plus";

// Captain needs vitest test locations to identify tests (file + description).
export default defineConfig({
  test: {
    includeTaskLocation: true,
  },
  run: {
    tasks: {
      // THE task-graph home of src/generated.ts (gitignored codegen).
      // Anything that bundles or typechecks code importing @si/stripe must
      // `dependsOn: ["@si/stripe#codegen"]` instead of hand-rolling stub
      // generation (CI bootstrap layers, preview uploads, and deploy builds
      // all converge here). Guarded (`env:init` skips when the file exists)
      // so an operator-fetched generated.ts with REAL Stripe ids is never
      // clobbered by the offline stub. cache: false — same "never
      // cache-replay against local state that could be wiped" reasoning as
      // workers/guestlist's `db:migrate:local`; a replayed success would
      // skip regenerating a file a clean checkout doesn't have.
      codegen: {
        command: "bun run env:init",
        cache: false,
      },
    },
  },
});
