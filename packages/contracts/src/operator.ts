import { type } from "arktype";

/**
 * The operator call envelope (RFC-0001 "Shared operator call contract" / D7).
 *
 * `OperatorActor` and `OperatorMeta` are constructed server-side by Operator
 * AFTER Cloudflare Access validation — no browser input schema may contain a
 * `meta` or `actor` property. The browser supplies only an
 * `OperatorCommandInput` whose `commandId` is a UUID; Operator namespaces it by
 * actor and action before it becomes a domain idempotency key.
 */
export interface OperatorActor {
  /** Stable Cloudflare Access subject. */
  sub: string;
  /** Verified Access email claim. */
  email: string;
}

export interface OperatorMeta {
  actor: OperatorActor;
  requestId: string;
  idempotencyKey: string;
}

export interface OperatorCall<T> {
  input: T;
  meta: OperatorMeta;
}

/** Browser-to-Operator mutation shape. Never carries `actor`/`meta`. */
export interface OperatorCommandInput<T> {
  commandId: string;
  input: T;
}

/**
 * The browser `commandId` must be a UUID. Operator validates it before deriving
 * the domain idempotency key, so a client cannot assert an identity by choosing
 * a key.
 */
export const commandIdSchema = type("string.uuid");

/**
 * Namespace a browser command into a domain idempotency key:
 * `<actor.sub>:<action>:<commandId>` (RFC-0001 D7). Retrying the same UI command
 * is stable without letting the browser assert an identity.
 */
export function deriveIdempotencyKey(actorSub: string, action: string, commandId: string): string {
  return `${actorSub}:${action}:${commandId}`;
}
