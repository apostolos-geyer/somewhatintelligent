#!/usr/bin/env bun
/**
 * One-command local stack: boots the portal-journey fleet, each worker exactly
 * as its own per-directory `bun run dev` (the proven contract — this script
 * adds supervision, not orchestration: no vp -r, no bare portless, no shared
 * process tree beyond spawn+group-kill).
 *
 * Usage:
 *   bun run dev                    # guestlist identity roadie
 *   bun run dev guestlist identity # any subset of workers/<name>
 *
 * Sequence: cached prep (env:init + local D1 migrations via vp — warm re-runs
 * are no-ops), portless HTTPS proxy ensured (started if absent, exact command
 * printed if that fails), then one child per worker with prefixed logs. Any
 * child exiting tears the whole stack down loudly — a half-up stack is worse
 * than a down one. Ctrl-C stops everything.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const DEFAULT_WORKERS = ["guestlist", "identity", "roadie", "store"];
const COLORS = ["\x1b[36m", "\x1b[35m", "\x1b[33m", "\x1b[32m", "\x1b[34m", "\x1b[31m"];
const RESET = "\x1b[0m";

const workers = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_WORKERS;
for (const w of workers) {
  if (!existsSync(resolve(ROOT, "workers", w, "package.json"))) {
    console.error(`dev-stack: no such worker "workers/${w}"`);
    process.exit(1);
  }
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((done) => {
    const sock = connect({ port, host: "127.0.0.1", timeout: 500 });
    sock.on("connect", () => (sock.destroy(), done(true)));
    sock.on("error", () => done(false));
    sock.on("timeout", () => (sock.destroy(), done(false)));
  });
}

// 1. Prep — vp-cached, so this is fast when nothing changed.
for (const args of [
  ["run", "-r", "env:init"],
  ["run", "-r", "db:migrate:local"],
]) {
  const r = spawnSync("bunx", ["vp", ...args], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// 2. Proxy — the wildcard HTTPS proxy serves *.somewhatintelligent.localhost on :443.
if (!(await portOpen(443))) {
  console.log("dev-stack: portless proxy not detected on :443 — starting it…");
  spawnSync("bunx", ["portless", "proxy", "start", "--https", "--wildcard"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (!(await portOpen(443))) {
    console.error(
      "dev-stack: could not start the proxy (binding :443 may need root/sudo on macOS).\n" +
        "Start it yourself, then re-run:  sudo bunx portless proxy start --https --wildcard",
    );
    process.exit(1);
  }
}

// 3. One child per worker — identical to `cd workers/<w> && bun run dev`.
const children = new Map<string, ChildProcess>();
let shuttingDown = false;

function shutdown(code: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const [, child] of children) {
    if (child.pid && child.exitCode === null) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {}
    }
  }
  setTimeout(() => process.exit(code), 1500);
}

workers.forEach((w, i) => {
  const tag = `${COLORS[i % COLORS.length]}[${w}]${RESET}`;
  const child = spawn("bun", ["run", "dev"], {
    cwd: resolve(ROOT, "workers", w),
    detached: true, // own process group → group-kill reaches workerd/vite
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      // Per-worktree dev registry so parallel worktrees never cross-bind.
      // Wrangler reads WRANGLER_REGISTRY_PATH; the vite plugin's miniflare
      // reads MINIFLARE_REGISTRY_PATH. Belt+suspenders only — the workers
      // also derive this path themselves (vite.config.ts / dev scripts)
      // because env does not survive the portless/vp spawn chain.
      WRANGLER_REGISTRY_PATH: resolve(ROOT, ".wrangler", "dev-registry"),
      MINIFLARE_REGISTRY_PATH: resolve(ROOT, ".wrangler", "dev-registry"),
    },
  });
  const forward = (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) if (line.trim()) console.log(`${tag} ${line}`);
  };
  child.stdout?.on("data", forward);
  child.stderr?.on("data", forward);
  child.on("exit", (code) => {
    if (!shuttingDown) {
      console.error(`${tag} exited (${code}) — stopping the stack`);
      shutdown(code ?? 1);
    }
  });
  children.set(w, child);
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`dev-stack: ${workers.join(" + ")} starting…
  sign-in https://identity.somewhatintelligent.localhost/sign-in
  first run? seed demo data in another terminal:  bun run seed`);
