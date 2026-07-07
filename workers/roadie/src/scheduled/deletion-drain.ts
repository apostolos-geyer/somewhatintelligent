// Deletion queue drainer — DEFERRED in v1. Backend deletions are attempted
// synchronously in the call that brought refcount to zero; failures land in
// deletion_queue for operator visibility only (spec §Deferrals —
// Backend-deletion-failure retry).
import type { RoadieEnv } from "../roadie-env";

export async function run(
  _env: RoadieEnv,
  _ctx: ExecutionContext,
): Promise<{ processed: number; durationMs: number; status: "deferred" }> {
  return { processed: 0, durationMs: 0, status: "deferred" };
}
