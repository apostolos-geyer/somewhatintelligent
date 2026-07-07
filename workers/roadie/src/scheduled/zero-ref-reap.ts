// Zero-reference reaper — DEFERRED in v1. The spec's scheduled scan is
// replaced by synchronous ARC-at-zero in removeReference / abandon (spec
// §Capabilities — Reference management, spec §Deferrals — Zero-reference
// reaper). Module exists so adminTriggerTask has a target; returns the
// documented no-op shape for operator probes.
import type { RoadieEnv } from "../roadie-env";

export async function run(
  _env: RoadieEnv,
  _ctx: ExecutionContext,
): Promise<{ processed: number; durationMs: number; status: "deferred" }> {
  return { processed: 0, durationMs: 0, status: "deferred" };
}
