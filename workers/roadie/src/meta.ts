// Per-call audit + trace context. Required second argument on every RPC
// method. See spec §API Contract — Conventions and RFC ADR-RD-011.
export type { Actor } from "@si/kit/request-context";
import type { Actor } from "@si/kit/request-context";

export type CallMeta = {
  actor: Actor;
  // Platform-wide propagated request id (see patterns/observability.md).
  // Roadie never mints this — it inherits from the caller.
  requestId: string;
  // Caller application identifier. Primary source is the binding's
  // `props.callerApp` (verified at deploy time), but the `@cloudflare/vite-plugin`
  // dev path drops `props` when converting wrangler config to miniflare options
  // (wrangler 4.83.0). Consumers include this in meta so the dev path still
  // has a reliable caller-app signal; `readCallerApp` prefers props and falls
  // back to this.
  callerApp?: string;
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
  const actor = m.actor;
  if (typeof actor !== "object" || actor === null) {
    throw new InvalidMetaError("actor must be an object");
  }
  const a = actor as Record<string, unknown>;
  let callerApp: string | undefined;
  if (m.callerApp !== undefined) {
    if (typeof m.callerApp !== "string" || m.callerApp.length === 0) {
      throw new InvalidMetaError("callerApp must be a non-empty string when provided");
    }
    callerApp = m.callerApp;
  }
  if (a.kind === "user") {
    if (typeof a.userId !== "string" || a.userId.length === 0) {
      throw new InvalidMetaError("actor.userId must be a non-empty string");
    }
    return {
      actor: { kind: "user", userId: a.userId },
      requestId: m.requestId,
      ...(callerApp !== undefined && { callerApp }),
    };
  }
  if (a.kind === "service") {
    if (typeof a.serviceName !== "string" || a.serviceName.length === 0) {
      throw new InvalidMetaError("actor.serviceName must be a non-empty string");
    }
    return {
      actor: { kind: "service", serviceName: a.serviceName },
      requestId: m.requestId,
      ...(callerApp !== undefined && { callerApp }),
    };
  }
  throw new InvalidMetaError(`actor.kind must be "user" or "service"`);
}

export function actorId(actor: Actor): string {
  return actor.kind === "user" ? actor.userId : actor.serviceName;
}
