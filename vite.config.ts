import { defaultExclude, defineConfig } from "vite-plus";

// `**/routeTree.gen.ts` is TanStack Router codegen (regenerated on dev boot);
// its own header says to exclude it from linter/formatter. Keeping it out of
// `fmt`/`lint` stops `vp check --fix` from reflowing it into the repo style
// (semi + double-quote) on every boot and churning the diff.
const ignorePatterns = [".agents/**", ".claude/**", "dist/**", "**/routeTree.gen.ts"];

// `inbox/` (like `marketing-videos/`) is a vendored, self-contained project
// with its own package.json/lockfile/tsconfig/tooling — not a bun workspace
// member, not held to this repo's stricter type-aware lint rules (its own
// `cd inbox && bun run typecheck` is the correctness signal for it). `vp fmt`
// is left alone (its formatting already matches, and the staged-check split
// below needs `scripts/`+`__tests__/` files under inbox/ to stay formattable).
// Root `vp test` has no per-directory scoping either, so exclude inbox/**
// from test discovery: it keeps inbox's own vitest suite in its own tier
// (`cd inbox && bun run test`) instead of double-running under root `vp
// test` against a different, unpinned vitest resolved from inbox's own
// node_modules.
const lintIgnorePatterns = [...ignorePatterns, "inbox/**"];
const testExcludePatterns = [...ignorePatterns, "inbox/**"];

export default defineConfig({
  fmt: {
    semi: true,
    singleQuote: false,
    ignorePatterns,
  },
  lint: {
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: lintIgnorePatterns,
  },
  staged: {
    // One entry routing through a partition script: test files get format-only
    // (per-file vitest-globals quirk, see the script header).
    "*": "bun scripts/staged-check.ts",
  },
  run: {
    cache: true,
  },
  test: {
    // Root `vp test` flat-globs the whole tree, so keep discovery off the same
    // tooling/build dirs `fmt`/`lint` already ignore — in particular registered
    // git worktrees under `.claude/` (which duplicate every `__tests__` file and
    // drag in stale copies) — plus the Playwright `e2e/**` specs, which call
    // Playwright's `test()` and must run via `bun run test:e2e`, never vitest.
    // Per-worker pool-worker suites still run in their own per-service tier
    // (`cd <service> && bun run test` / sprout `test:pool`); see
    // docs/sprout/10-local-stack-and-testing-runbook.md.
    exclude: [...defaultExclude, ...testExcludePatterns, "e2e/**"],
  },
});
