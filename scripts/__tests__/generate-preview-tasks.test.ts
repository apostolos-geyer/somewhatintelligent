import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "generate-preview-tasks.sh");

/**
 * Runs scripts/generate-preview-tasks.sh against a scratch OUT dir and
 * returns the generated uploads.yml text. `env` overrides CHANGED/PR/SHA.
 */
function runGenerate(changed: string, outDir: string): string {
  const result = spawnSync("bash", [SCRIPT], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CHANGED: changed,
      PR: "123",
      SHA: "deadbeef",
      OUT: outDir,
    },
  });
  if (result.status !== 0) {
    throw new Error(
      `generate-preview-tasks.sh failed (${result.status}): ${result.stderr?.toString()}`,
    );
  }
  return readFileSync(join(outDir, "uploads.yml"), "utf8");
}

/** Extracts the `run: |` body for a single `upload-<worker>` task from the YAML. */
function taskBody(yaml: string, worker: string): string {
  const marker = `- key: upload-${worker}\n`;
  const start = yaml.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextTaskStart = yaml.indexOf("\n- key: ", start + marker.length);
  return nextTaskStart === -1 ? yaml.slice(start) : yaml.slice(start, nextTaskStart);
}

describe("generate-preview-tasks.sh — queue-binding strip", () => {
  test("emits the presence-gated strip for EVERY worker in CHANGED, not just store", () => {
    const outDir = mkdtempSync(join(tmpdir(), "preview-tasks-"));
    try {
      const yaml = runGenerate("guestlist store", outDir);
      const guestlistBody = taskBody(yaml, "guestlist");
      const storeBody = taskBody(yaml, "store");

      // Before the fix, only store's body contained any strip logic at all —
      // guestlist's body had none regardless of whether guestlist's built
      // wrangler.json actually declares a queues binding.
      expect(guestlistBody).toContain("jq -e 'has(\"queues\")'");
      expect(storeBody).toContain("jq -e 'has(\"queues\")'");

      // Gated on the built dist config, per-worker, not the source .jsonc.
      expect(guestlistBody).toContain("workers/guestlist/dist/server/wrangler.json");
      expect(storeBody).toContain("workers/store/dist/server/wrangler.json");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("the strip guard is unconditional (no worker-name comparison) in the generated YAML", () => {
    const outDir = mkdtempSync(join(tmpdir(), "preview-tasks-"));
    try {
      const yaml = runGenerate("guestlist", outDir);
      // The old hardcoded branch is fully gone, not just supplemented.
      expect(yaml).not.toContain('"${w}" = "store"');
      expect(yaml).not.toMatch(/\[\s*"\$\{w\}"\s*=/);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  /**
   * Extracts the concrete strip snippet from a generated task body and runs
   * it for real against a scratch fixture tree, so we exercise the actual
   * shell logic (not just its presence in the YAML text).
   */
  function extractStripSnippet(body: string): string {
    const start = body.indexOf("dist_wrangler=");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = body.indexOf("\n    cd workers/", start);
    expect(end).toBeGreaterThan(start);
    return body.slice(start, end);
  }

  test("no-op when the built wrangler.json has no queues key", () => {
    const outDir = mkdtempSync(join(tmpdir(), "preview-tasks-"));
    const fixtureRoot = mkdtempSync(join(tmpdir(), "preview-fixture-"));
    try {
      const yaml = runGenerate("guestlist", outDir);
      const snippet = extractStripSnippet(taskBody(yaml, "guestlist"));

      const distDir = join(fixtureRoot, "workers", "guestlist", "dist", "server");
      mkdirSync(distDir, { recursive: true });
      const wranglerPath = join(distDir, "wrangler.json");
      const originalContents = JSON.stringify({ name: "si-guestlist-staging" });
      writeFileSync(wranglerPath, originalContents);

      const result = spawnSync("bash", ["-euo", "pipefail", "-c", snippet], {
        cwd: fixtureRoot,
      });
      expect(result.status).toBe(0);
      expect(readFileSync(wranglerPath, "utf8")).toBe(originalContents);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("strips the queues key when present in the built wrangler.json", () => {
    const outDir = mkdtempSync(join(tmpdir(), "preview-tasks-"));
    const fixtureRoot = mkdtempSync(join(tmpdir(), "preview-fixture-"));
    try {
      const yaml = runGenerate("store", outDir);
      const snippet = extractStripSnippet(taskBody(yaml, "store"));

      const distDir = join(fixtureRoot, "workers", "store", "dist", "server");
      mkdirSync(distDir, { recursive: true });
      const wranglerPath = join(distDir, "wrangler.json");
      writeFileSync(
        wranglerPath,
        JSON.stringify({
          name: "si-store-staging",
          queues: { producers: [{ queue: "stripe-events", binding: "STRIPE_EVENTS" }] },
        }),
      );

      const result = spawnSync("bash", ["-euo", "pipefail", "-c", snippet], {
        cwd: fixtureRoot,
      });
      expect(result.status).toBe(0);
      const stripped = JSON.parse(readFileSync(wranglerPath, "utf8"));
      expect(stripped).not.toHaveProperty("queues");
      expect(stripped.name).toBe("si-store-staging");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("short-circuits without a jq crash when the dist wrangler.json doesn't exist", () => {
    const outDir = mkdtempSync(join(tmpdir(), "preview-tasks-"));
    const fixtureRoot = mkdtempSync(join(tmpdir(), "preview-fixture-"));
    try {
      // roadie's build step is a no-op ("*) build=\":\""), so it never
      // produces workers/roadie/dist/server/wrangler.json in preview.
      const yaml = runGenerate("roadie", outDir);
      const snippet = extractStripSnippet(taskBody(yaml, "roadie"));

      expect(existsSync(join(fixtureRoot, "workers", "roadie", "dist"))).toBe(false);

      const result = spawnSync("bash", ["-euo", "pipefail", "-c", snippet], {
        cwd: fixtureRoot,
      });
      expect(result.status).toBe(0);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  test("uses a per-worker tmp filename, not the old hardcoded store-only name", () => {
    const outDir = mkdtempSync(join(tmpdir(), "preview-tasks-"));
    try {
      const yaml = runGenerate("guestlist store", outDir);
      expect(taskBody(yaml, "guestlist")).toContain("/tmp/guestlist-preview-wrangler.json");
      expect(taskBody(yaml, "store")).toContain("/tmp/store-preview-wrangler.json");
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
