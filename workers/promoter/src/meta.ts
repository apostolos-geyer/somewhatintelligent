// Per-call audit + trace context. Required second argument on every RPC
// method. See spec §API Contract — Conventions and RFC ADR-RD-011.
//
// Promoter mirrors Roadie's meta shape but doesn't carry binding-pinned
// `props.callerApp` (no consumer-side wrangler config sets it today),
// so caller_app comes exclusively from `meta.callerApp`.
export type { Actor } from "@si/kit/request-context";
import type { Actor } from "@si/kit/request-context";

export type CallMeta = {
  actor: Actor;
  // Platform-wide propagated request id. Promoter never mints this — it
  // inherits from the caller (cf-request-id at the entry Worker).
  requestId: string;
  // Caller application identifier. Required for promoter calls so log
  // lines can attribute sends to the originating app/service.
  callerApp: string;
};

export class InvalidMetaError extends Error {
  constructor(reason: string) {
    super(`invalid meta: ${reason}`);
    this.name = "InvalidMetaError";
  }
}

// Defensive shape check. RPC arguments are typed but the runtime doesn't
// enforce TypeScript types — a buggy or malicious caller could pass anything.
export function validateMeta(input: unknown): CallMeta {
  if (typeof input !== "object" || input === null) {
    throw new InvalidMetaError("expected object");
  }
  const m = input as Record<string, unknown>;
  if (typeof m.requestId !== "string" || m.requestId.length === 0) {
    throw new InvalidMetaError("requestId must be a non-empty string");
  }
  if (typeof m.callerApp !== "string" || m.callerApp.length === 0) {
    throw new InvalidMetaError("callerApp must be a non-empty string");
  }
  const actor = m.actor;
  if (typeof actor !== "object" || actor === null) {
    throw new InvalidMetaError("actor must be an object");
  }
  const a = actor as Record<string, unknown>;
  if (a.kind === "user") {
    if (typeof a.userId !== "string" || a.userId.length === 0) {
      throw new InvalidMetaError("actor.userId must be a non-empty string");
    }
    return {
      actor: { kind: "user", userId: a.userId },
      requestId: m.requestId,
      callerApp: m.callerApp,
    };
  }
  if (a.kind === "service") {
    if (typeof a.serviceName !== "string" || a.serviceName.length === 0) {
      throw new InvalidMetaError("actor.serviceName must be a non-empty string");
    }
    return {
      actor: { kind: "service", serviceName: a.serviceName },
      requestId: m.requestId,
      callerApp: m.callerApp,
    };
  }
  throw new InvalidMetaError(`actor.kind must be "user" or "service"`);
}

export function actorId(actor: Actor): string {
  return actor.kind === "user" ? actor.userId : actor.serviceName;
}

// SHA-256 hash of an email address, hex-encoded. Used in canonical log lines
// instead of the raw email — operators can correlate sends to a user without
// the line itself becoming a PII surface. Hash is stable across calls.
export async function hashEmail(email: string): Promise<string> {
  const buf = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const view = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < view.length; i++) {
    const b = view[i] as number;
    out += (b < 16 ? "0" : "") + b.toString(16);
  }
  return out;
}
