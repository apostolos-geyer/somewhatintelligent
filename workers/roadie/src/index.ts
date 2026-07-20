import { instrumented } from "@somewhatintelligent/kit/log";
import { handleVersionRequest } from "@somewhatintelligent/kit/version";
import { WorkerEntrypoint } from "cloudflare:workers";
import { readCallerApp, type RoadieInstance } from "./log";
import { actorId, validateMeta } from "./meta";
import * as admin from "./methods/admin";
import * as read from "./methods/read";
import * as refs from "./methods/refs";
import * as upload from "./methods/upload";
import { err, type Result } from "./result";
import type { RoadieEnv } from "./roadie-env";
import * as pendingReap from "./scheduled/pending-reap";

// Every class-level member on Roadie is exposed as RPC by default — there
// is no "private helper" surface at this layer (ADR-RD-012). Each entry
// below corresponds 1:1 with a method in workers/roadie.md §API Contract.
// Implementation helpers live as modular functions under src/methods/.
//
// **RPC visibility requires prototype methods, not instance properties** —
// CF Workers RPC exposes only members declared on the class prototype;
// arrow-fn class fields are invisible (workers/runtime-apis/rpc/visibility).
// Each entry below is a real `async` declaration delegating to a module
// function with `this.#self` as the first arg.
//
// `@instrumented` wraps every method with a `withCanonicalLog` scope; the
// `onError` config converts thrown exceptions to `err("internal_error", ...)`
// so the wire contract stays pure.
@instrumented({
  service: "roadie",
  resolveContext: ({ args, instance }) => {
    const meta = validateMeta(args[args.length - 1]);
    return {
      requestId: meta.requestId,
      actorKind: meta.actor.kind,
      actorId: actorId(meta.actor),
      callerApp: readCallerApp(instance as RoadieInstance, meta),
    };
  },
  deriveOutcome: (ret) => {
    const r = ret as { ok: boolean; error?: string };
    return r.ok ? "ok" : r.error;
  },
  onError: (e) =>
    err("internal_error", e instanceof Error ? e.message : String(e)) as Result<
      unknown,
      "internal_error"
    >,
})
export class Roadie extends WorkerEntrypoint<RoadieEnv> {
  get #self(): RoadieInstance {
    return this as unknown as RoadieInstance;
  }

  // ---------- upload ----------
  async registerUpload(
    ...args: ArgsOf<typeof upload.registerUpload>
  ): RetOf<typeof upload.registerUpload> {
    return upload.registerUpload(this.#self, ...args);
  }
  async signPart(...args: ArgsOf<typeof upload.signPart>): RetOf<typeof upload.signPart> {
    return upload.signPart(this.#self, ...args);
  }
  async recordPart(...args: ArgsOf<typeof upload.recordPart>): RetOf<typeof upload.recordPart> {
    return upload.recordPart(this.#self, ...args);
  }
  async getMultipartStatus(
    ...args: ArgsOf<typeof upload.getMultipartStatus>
  ): RetOf<typeof upload.getMultipartStatus> {
    return upload.getMultipartStatus(this.#self, ...args);
  }
  async finalize(...args: ArgsOf<typeof upload.finalize>): RetOf<typeof upload.finalize> {
    return upload.finalize(this.#self, ...args);
  }
  async abandon(...args: ArgsOf<typeof upload.abandon>): RetOf<typeof upload.abandon> {
    return upload.abandon(this.#self, ...args);
  }
  async put(...args: ArgsOf<typeof upload.put>): RetOf<typeof upload.put> {
    return upload.put(this.#self, ...args);
  }

  // ---------- read ----------
  async getReadUrl(...args: ArgsOf<typeof read.getReadUrl>): RetOf<typeof read.getReadUrl> {
    return read.getReadUrl(this.#self, ...args);
  }
  async getReference(...args: ArgsOf<typeof read.getReference>): RetOf<typeof read.getReference> {
    return read.getReference(this.#self, ...args);
  }

  // ---------- refs ----------
  async addReference(...args: ArgsOf<typeof refs.addReference>): RetOf<typeof refs.addReference> {
    return refs.addReference(this.#self, ...args);
  }
  async removeReference(
    ...args: ArgsOf<typeof refs.removeReference>
  ): RetOf<typeof refs.removeReference> {
    return refs.removeReference(this.#self, ...args);
  }

  // ---------- admin ----------
  async adminUsage(...args: ArgsOf<typeof admin.adminUsage>): RetOf<typeof admin.adminUsage> {
    return admin.adminUsage(this.#self, ...args);
  }
  async adminListBlobs(
    ...args: ArgsOf<typeof admin.adminListBlobs>
  ): RetOf<typeof admin.adminListBlobs> {
    return admin.adminListBlobs(this.#self, ...args);
  }
  async adminForceDelete(
    ...args: ArgsOf<typeof admin.adminForceDelete>
  ): RetOf<typeof admin.adminForceDelete> {
    return admin.adminForceDelete(this.#self, ...args);
  }
  async adminTriggerTask(
    ...args: ArgsOf<typeof admin.adminTriggerTask>
  ): RetOf<typeof admin.adminTriggerTask> {
    return admin.adminTriggerTask(this.#self, ...args);
  }
}

// Method-helper modules take `RoadieInstance` as their first param; the class
// trampolines drop it so consumers see only the user-facing args. `RetOf`
// folds the `internal_error` shape that `@instrumented`'s `onError` injects
// into every method's wire return, keeping every signature in lockstep.
type ArgsOf<F extends (...args: never[]) => unknown> = F extends (
  self: RoadieInstance,
  ...rest: infer R
) => unknown
  ? R
  : never;
type RetOf<F extends (...args: never[]) => unknown> = Promise<
  Awaited<ReturnType<F>> | Result<never, "internal_error">
>;

// Default `fetch`: /__version (the only HTTP surface — version/commit are
// ship-time-injected vars, threaded through `overrides` since
// @somewhatintelligent/kit's version module no longer reads them off env),
// 404 for everything else: Roadie has no other public HTTP surface in v1
// (ADR-RD-001). Consumers reach Roadie exclusively over service bindings.
// In local dev only, a `/__dev/blob/<id>` route serves bytes back out of the
// miniflare R2 sim (GET) so `getReadUrl`'s dev URL round-trips fully offline,
// and accepts bytes into it (PUT) so seeds can populate the sim over HTTP.
// `scheduled` dispatches the configured cron entries; v1 ships only the
// pending reaper. The other scheduled tasks are stubbed via
// adminTriggerTask (see spec §Deferrals).
export default {
  async fetch(request: Request, env: RoadieEnv): Promise<Response> {
    const version = handleVersionRequest(request, {
      worker: "roadie",
      env,
      overrides: { version: env.WORKER_VERSION, commit: env.WORKER_COMMIT },
    });
    if (version) return version;
    if (env.ENVIRONMENT === "development") {
      const devBlob = await handleDevBlob(request, env);
      if (devBlob) return devBlob;
    }
    return new Response(null, { status: 404 });
  },
  async scheduled(
    controller: ScheduledController,
    env: RoadieEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    switch (controller.cron) {
      case "*/15 * * * *":
        await pendingReap.run(env, ctx);
        return;
    }
  },
} satisfies ExportedHandler<RoadieEnv>;

// Dev-only blob route. `getReadUrl` points browsers here in development
// instead of a presigned S3 URL, so bytes in the miniflare R2 sim are servable
// back (GET) and local-dev seeds can push bytes in over HTTP (PUT) without a
// service binding. Returns `null` for anything it does not own so the caller
// falls through to the ADR-RD-001 404; the route is never mounted outside
// `ENVIRONMENT === "development"`. Physical blob ids are opaque (`ids.ts`) and
// never contain separators — an id carrying one is rejected, which also blocks
// path traversal. No auth: this is local dev, and object ids are unguessable
// enough for that scope. PUT keys the object by the physical blob id exactly as
// the finalized upload path does, so seeded roadie D1 rows resolve to it.
const DEV_BLOB_PREFIX = "/__dev/blob/";

async function handleDevBlob(request: Request, env: RoadieEnv): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "PUT") return null;
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(DEV_BLOB_PREFIX)) return null;

  const id = decodeURIComponent(pathname.slice(DEV_BLOB_PREFIX.length));
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..")) {
    return new Response(null, { status: 400 });
  }

  if (request.method === "PUT") {
    const contentType = request.headers.get("content-type") ?? "application/octet-stream";
    const body = await request.arrayBuffer();
    await env.BLOBS.put(id, body, { httpMetadata: { contentType } });
    return new Response(null, { status: 204 });
  }

  const object = await env.BLOBS.get(id);
  if (!object) return new Response(null, { status: 404 });

  const headers = new Headers();
  const contentType = object.httpMetadata?.contentType;
  if (contentType) headers.set("content-type", contentType);
  headers.set("content-length", String(object.size));
  headers.set("cache-control", "private, max-age=60");
  return new Response(object.body, { headers });
}
