#!/usr/bin/env bun
// Pre-commit staged check, invoked by `vp staged` (root vite.config.ts
// `staged` block) with the staged file paths as argv.
//
// Everything gets `vp check --fix` EXCEPT test files and scripts/ files: vp's
// per-file checker phantoms ambient globals it can't resolve standalone —
// vitest globals ("Cannot find name 'expect'") in bare test files, and node/bun
// globals (process, node:*, import.meta.path) in root/app scripts/ that no
// tsconfig `types` covers per-file. Those get format-only; the workspace-wide
// check (CI / `bun run check`) + tsgo remain the type-correctness signal.
// Delete this partition once vp's per-file checker honors the nearest tsconfig.
import { spawnSync } from "node:child_process";

const files = process.argv.slice(2);
if (files.length === 0) process.exit(0);

const QUIRK = /((^|\/)(__tests__|test|scripts)\/|\.test\.tsx?$)/;
// Only source files vp's checker actually handles go to `vp check` — a commit
// of nothing but yml/sh/md/json (e.g. a CI-config change) used to make
// `vp check` fail with "Expected at least one target file", vetoing the
// commit outright. Everything else is format-only.
const CHECKABLE = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;
const fmtOnly = files.filter((f) => QUIRK.test(f) || !CHECKABLE.test(f));
const full = files.filter((f) => !QUIRK.test(f) && CHECKABLE.test(f));

function run(cmd: string[], targets: string[]): number {
  if (targets.length === 0) return 0;
  const r = spawnSync(cmd[0]!, [...cmd.slice(1), ...targets], {
    stdio: "inherit",
  });
  return r.status ?? 1;
}

const a = run(["vp", "check", "--fix"], full);
const b = run(["vp", "fmt", "--write"], fmtOnly);
process.exit(a || b);
