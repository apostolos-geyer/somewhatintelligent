/**
 * The two-step hard-delete flow (RFC-0001 D8) as a pure state machine, split out
 * from `DeletionDialog` so the phase transitions are unit-testable without a DOM.
 * A destructive command first plans (impact + short-lived `confirmationToken`),
 * the operator confirms with a typed phrase, then execution consumes the token.
 */
import type { DeletionError, DeletionPlan } from "@si/contracts";

export type DeletionPhase =
  | { status: "planning" }
  | { status: "plan_error"; message: string }
  | { status: "ready"; plan: DeletionPlan }
  | { status: "confirming"; plan: DeletionPlan }
  | { status: "confirm_error"; plan: DeletionPlan; error: DeletionError }
  | { status: "done"; activeVersion?: string | null };

export type DeletionEvent =
  | { type: "plan_start" }
  | { type: "plan_ok"; plan: DeletionPlan }
  | { type: "plan_fail"; message: string }
  | { type: "confirm_start" }
  | { type: "confirm_ok"; activeVersion?: string | null }
  | { type: "confirm_fail"; error: DeletionError };

export const initialDeletionPhase: DeletionPhase = { status: "planning" };

/** Copy for every typed `DeletionError`, plus the re-plan hint for expiry. */
export const DELETION_ERROR_COPY: Record<DeletionError, string> = {
  not_found: "This item no longer exists — it may already be deleted.",
  deletion_plan_expired: "The confirmation timed out. Re-plan to try again.",
  deletion_plan_mismatch: "The item changed since you planned this. Re-plan to see the new impact.",
  deletion_already_executed: "This deletion already ran — nothing more to do.",
};

/** A stale plan (expiry or drift) is recoverable by re-planning from scratch. */
export function isReplannable(error: DeletionError): boolean {
  return error === "deletion_plan_expired" || error === "deletion_plan_mismatch";
}

/** Pure transition. Unknown events for a phase leave state unchanged. */
export function deletionReducer(state: DeletionPhase, event: DeletionEvent): DeletionPhase {
  switch (event.type) {
    case "plan_start":
      return { status: "planning" };
    case "plan_ok":
      return { status: "ready", plan: event.plan };
    case "plan_fail":
      return { status: "plan_error", message: event.message };
    case "confirm_start":
      // Only a ready/errored (but plan-bearing) phase can start a confirm.
      if (state.status === "ready" || state.status === "confirm_error") {
        return { status: "confirming", plan: state.plan };
      }
      return state;
    case "confirm_ok":
      return { status: "done", activeVersion: event.activeVersion };
    case "confirm_fail":
      if (state.status === "confirming") {
        return { status: "confirm_error", plan: state.plan, error: event.error };
      }
      return state;
    default:
      return state;
  }
}

/** Typed-confirmation gate: the operator must type the target phrase exactly. */
export function confirmationSatisfied(input: string, phrase: string): boolean {
  return input.trim() === phrase.trim() && phrase.trim().length > 0;
}
