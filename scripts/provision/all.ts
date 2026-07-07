/// <reference types="bun" />
/**
 * Orchestrator: runs the provisioning suite in the order that respects its
 * dependencies (tokens exist independent of everything; D1/R2 resources
 * should exist before Access apps reference the workers that use them;
 * Access's org/policies should exist before email.ts, which doesn't touch
 * Access but keeps the "infra before app-level wiring" ordering consistent).
 *
 *   tokens -> d1 -> r2 -> access -> email
 *
 * Each step runs as its own `bun scripts/provision/<step>.ts` invocation
 * (so each script's own `if (import.meta.main)` CLI entrypoint runs exactly
 * as it would standalone) with all CLI args forwarded unchanged. Stops at
 * the first non-zero exit — there's no reason to keep going once a step
 * fails, and partial application is safe to retry (everything is
 * idempotent).
 *
 * Usage:
 *   bun scripts/provision/all.ts --env staging --dry-run
 *   bun scripts/provision/all.ts --env staging
 *   bun scripts/provision/all.ts --env staging --write-secrets
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { REPO_ROOT } from "./lib";

export const STEPS = ["tokens.ts", "d1.ts", "r2.ts", "access.ts", "email.ts"] as const;

function main(): void {
  const passthroughArgs = process.argv.slice(2);
  console.log(`Running provisioning suite: ${STEPS.join(" -> ")}`);
  if (passthroughArgs.length) console.log(`Args: ${passthroughArgs.join(" ")}`);

  const results: Array<{ step: string; status: number | null }> = [];

  for (const step of STEPS) {
    console.log(`\n${"=".repeat(70)}\n=== ${step}\n${"=".repeat(70)}`);
    const res = spawnSync(
      "bun",
      [join(REPO_ROOT, "scripts", "provision", step), ...passthroughArgs],
      {
        stdio: "inherit",
        cwd: REPO_ROOT,
      },
    );
    results.push({ step, status: res.status });
    if (res.status !== 0) {
      console.error(
        `\n✗ ${step} failed (exit ${res.status}) — stopping. Steps are idempotent; re-run once fixed.`,
      );
      printSummary(results);
      process.exit(res.status ?? 1);
    }
  }

  printSummary(results);
  console.log("\n✓ All steps completed.");
}

function printSummary(results: Array<{ step: string; status: number | null }>): void {
  console.log("\nStep summary:");
  for (const r of results)
    console.log(`  ${r.status === 0 ? "✓" : "✗"} ${r.step} (exit ${r.status})`);
}

if (import.meta.main) main();
