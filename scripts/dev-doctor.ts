#!/usr/bin/env bun
/**
 * dev-doctor — ONE mechanical health check for the local fleet, so nobody
 * (human or agent) improvises curl loops or misdiagnoses the known failure
 * modes. Run any time: `bun run dev:doctor`.
 *
 * Checks, in order:
 *  1. Surface probes (short timeouts, via curl so *.localhost bypasses any
 *     container proxy): identity sign-in.
 *  2. Duplicate-fleet detection: more than one vite dev server per worker
 *     directory means an orphan from a previous boot is still holding ports —
 *     the classic "Port NNNN is in use, trying another one…" squatter that
 *     makes the portless proxy route a hostname to a dead port (blanket 404s).
 *  3. Prints the exact remediation for each finding instead of a wall of red.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, readlinkSync } from "node:fs";

let failures = 0;

function probe(label: string, url: string, expect: number[]): void {
  const r = spawnSync(
    "curl",
    ["-sk", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "6", url],
    { encoding: "utf8" },
  );
  const code = Number(r.stdout.trim());
  const ok = expect.includes(code);
  console.log(`${ok ? "✓" : "✗"} ${label}: ${code || "no response"} (want ${expect.join("/")})`);
  if (!ok) failures++;
}

console.log("── surfaces ──────────────────────────────────────────────────");
probe("identity sign-in ", "https://identity.somewhatintelligent.localhost/sign-in", [200]);

// ── fleet process census ─────────────────────────────────────────────────────
// One vite dev server per worker dir is healthy; two means an orphaned fleet.
console.log("\n── fleet processes ───────────────────────────────────────────");
const byCwd = new Map<string, number[]>();
for (const pid of readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
  try {
    const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
    if (!/vite\/node\/cli\.js dev/.test(cmd)) continue;
    const cwd = readlinkSync(`/proc/${pid}/cwd`);
    byCwd.set(cwd, [...(byCwd.get(cwd) ?? []), Number(pid)]);
  } catch {
    /* raced a process exit, or non-Linux (no /proc) — census degrades to empty */
  }
}
if (byCwd.size === 0) {
  console.log("no vite dev servers found (fleet down, or non-/proc platform — probes above rule)");
} else {
  for (const [cwd, pids] of byCwd) {
    const dup = pids.length > 1;
    console.log(`${dup ? "✗" : "✓"} ${cwd.split("/").slice(-2).join("/")}: pid ${pids.join(", ")}`);
    if (dup) {
      failures++;
      console.log(
        `    two dev servers in one worker dir — an orphan is squatting its port and the\n` +
          `    proxy may route this hostname to the dead one. Kill the OLDER pid, then\n` +
          `    restart the fleet by stopping the supervisor (never pkill -f workerd/vite).`,
      );
    }
  }
}

if (failures === 0) {
  console.log("\nall clear ✅");
} else {
  console.log(`\n${failures} finding(s). Also remember (agent containers):`);
  console.log(
    "  - first AUTHED request after a cold boot can stall via scripted curl while the\n" +
      "    browser walk works — touch any server file (HMR) to un-wedge; not an app bug.\n" +
      "  - blanket 404s on one hostname + 'Port NNNN is in use, trying another one…' in\n" +
      "    the boot log = port squatter (see duplicate-fleet finding above).",
  );
  process.exit(1);
}
