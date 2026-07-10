/**
 * /__version endpoint contract.
 *
 * Plain unit tests (vite-plus/test), same constraint as
 * organization-invitation.test.ts: promoter's entry module extends
 * `WorkerEntrypoint` from `cloudflare:workers` (runtime-only), so the worker
 * itself can't be imported outside workerd. The default fetch is a one-liner
 * delegating to `handleVersionRequest` from @somewhatintelligent/kit/version —
 * these tests exercise that exact call shape (same options object
 * src/index.ts passes, including the `overrides` forwarding of
 * WORKER_VERSION/WORKER_COMMIT — the kit version module no longer reads
 * those off env itself), which is the whole HTTP surface promoter exposes.
 */
import { describe, expect, test } from "vite-plus/test";
import { handleVersionRequest } from "@somewhatintelligent/kit/version";

const fetchLike = (request: Request, env: Record<string, string | undefined>) =>
  handleVersionRequest(request, {
    worker: "promoter",
    env,
    overrides: { version: env.WORKER_VERSION, commit: env.WORKER_COMMIT },
  }) ?? new Response(null, { status: 404 });

describe("promoter /__version", () => {
  test("GET /__version answers with the promoter payload", async () => {
    const res = fetchLike(new Request("http://localhost/__version"), {
      ENVIRONMENT: "staging",
      WORKER_VERSION: "1.2.3",
      WORKER_COMMIT: "abc1234",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      worker: "promoter",
      version: "1.2.3",
      commit: "abc1234",
      environment: "staging",
    });
  });

  test("un-injected env falls back safely (local dev / tests)", async () => {
    const res = fetchLike(new Request("http://localhost/__version"), { ENVIRONMENT: "staging" });
    const body = (await res.json()) as Record<string, string>;
    expect(body.version).toBe("0.0.0-dev");
    expect(body.commit).toBe("unknown");
  });

  test("every other path keeps promoter's RPC-only 404", () => {
    expect(fetchLike(new Request("http://localhost/send"), {}).status).toBe(404);
    expect(
      fetchLike(new Request("http://localhost/__version", { method: "POST" }), {}).status,
    ).toBe(404);
  });
});
