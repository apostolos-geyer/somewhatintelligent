import { defineConfig } from "vite-plus";

// Captain needs vitest test locations to identify tests (file + description).
export default defineConfig({
  test: {
    includeTaskLocation: true,
  },
  run: {
    tasks: {
      // Overrides the plain `"typecheck"` package.json script for anything
      // that goes through `vp run` (root `bun run typecheck` does). It
      // chains `bun run fetch` (regenerates src/generated.ts, gitignored
      // build output) before `tsgo --noEmit`. Root `run.cache: true` would
      // otherwise let a cache hit skip re-running fetch WITHOUT restoring
      // the file it writes (no `output` tracked) — same "never cache-replay
      // against local state that could be wiped" reasoning as
      // workers/guestlist's `db:migrate:local` task. Cheap (<1s, offline by
      // default), so always running for real is the safe default.
      typecheck: {
        command: ["bun run fetch", "tsgo --noEmit"],
        cache: false,
      },
    },
  },
});
