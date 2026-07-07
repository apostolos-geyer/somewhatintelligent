// Reference consistency reconciler — DEFERRED in v1. Requires consumer apps
// to expose claim endpoints which don't exist yet (spec §Deferrals —
// Reference consistency reconciler). The reconcile_cursor row exists in the
// schema for the future implementation.
import type { RoadieEnv } from "../roadie-env";

export async function run(
  _env: RoadieEnv,
  _ctx: ExecutionContext,
): Promise<{ processed: number; durationMs: number; status: "deferred" }> {
  return { processed: 0, durationMs: 0, status: "deferred" };
}
