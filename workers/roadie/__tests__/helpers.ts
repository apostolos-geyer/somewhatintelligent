/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { withCanonicalLog } from "@si/kit/log";
import { createDb } from "../src/db";
import type { RoadieInstance } from "../src/log";
import type { RoadieEnv } from "../src/roadie-env";
import type { CallMeta } from "../src/meta";
import { blobReference, physicalBlob } from "../src/schema";
import * as uploadModule from "../src/methods/upload";
import * as readModule from "../src/methods/read";
import * as refsModule from "../src/methods/refs";
import * as adminModule from "../src/methods/admin";
import * as pendingReapModule from "../src/scheduled/pending-reap";

// Wrap a unit-level call in the same `withCanonicalLog` scope the
// `@instrumented` class decorator opens in production. Tests bypass the
// Roadie class to call module functions directly with a synthetic
// `RoadieInstance` (clean unit-test ergonomics) — but the methods'
// `requireRequestLog()` calls expect an active scope. This is the
// test-side equivalent of the class boundary.
export function withLogScope<T>(fn: () => Promise<T>, op = "roadie.test"): Promise<T> {
  return withCanonicalLog(
    {
      service: "roadie",
      event: "rpc",
      operation: op,
      requestId: "req_test_" + Math.random().toString(36).slice(2),
      actorKind: "user",
      actorId: "u_test",
      callerApp: "test-app",
    },
    fn,
  );
}

// Auto-wrap every method in a module so test calls open the same scope a
// real RPC would. Tests `import { upload } from "./helpers"` and use it
// like the original module — every method call gets its own scope, mirroring
// production where each RPC method is independently instrumented.
function wrapModule<M extends Record<string, unknown>>(mod: M, prefix: string): M {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value === "function") {
      const fn = value as (...a: unknown[]) => Promise<unknown>;
      out[name] = (...args: unknown[]) => withLogScope(() => fn(...args), `${prefix}.${name}`);
    } else {
      out[name] = value;
    }
  }
  return out as M;
}

export const upload = wrapModule(uploadModule, "roadie");
export const read = wrapModule(readModule, "roadie");
export const refs = wrapModule(refsModule, "roadie");
export const admin = wrapModule(adminModule, "roadie");
export const pendingReap = wrapModule(pendingReapModule, "roadie.job");

export type TestRoadie = RoadieInstance;

export function makeRoadie(callerApp = "test-app"): TestRoadie {
  const ctx = createExecutionContext();
  (ctx as { props?: unknown }).props = { callerApp };
  return {
    env: env as unknown as RoadieEnv,
    ctx: ctx as RoadieInstance["ctx"],
  };
}

export function makeMeta(overrides: Partial<CallMeta> = {}): CallMeta {
  return {
    actor: { kind: "user", userId: "u_test" },
    requestId: "req_test_" + Math.random().toString(36).slice(2),
    ...overrides,
  };
}

export async function drainCtx(roadie: TestRoadie): Promise<void> {
  await waitOnExecutionContext(roadie.ctx);
}

export async function sha256Hex(input: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", input.buffer as ArrayBuffer);
  const view = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < view.length; i++) {
    const b = view[i] as number;
    out += (b < 16 ? "0" : "") + b.toString(16);
  }
  return out;
}

export function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function appContext(
  overrides: Partial<{ app: string; resourceType: string; resourceId: string }> = {},
): { app: string; resourceType: string; resourceId: string } {
  return {
    app: "chat",
    resourceType: "track",
    resourceId: "r_" + Math.random().toString(36).slice(2, 10),
    ...overrides,
  };
}

// Backend keys are opaque physical_blob ids — not exposed on the RPC
// surface. Tests that simulate "browser uploaded to the presigned URL" look
// up the key via DB and write directly to the R2 binding at that key, since
// SigV4 + presigned-URL round-trips aren't exercised in miniflare. The R2
// key equals the physical_blob id (invariant held by every write path).
export async function backendKeyFor(roadie: RoadieInstance, referenceId: string): Promise<string> {
  const db = createDb(roadie.env.DB);
  const [row] = await db
    .select({ id: physicalBlob.id })
    .from(blobReference)
    .innerJoin(physicalBlob, eq(physicalBlob.id, blobReference.physicalBlobId))
    .where(eq(blobReference.id, referenceId))
    .limit(1);
  if (!row) throw new Error(`backendKeyFor: reference ${referenceId} not found`);
  return row.id;
}
