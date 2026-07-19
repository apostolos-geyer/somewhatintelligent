import type { DeletionPlan } from "@si/contracts";
import {
  confirmationSatisfied,
  deletionReducer,
  initialDeletionPhase,
  isReplannable,
  type DeletionPhase,
} from "../src/lib/deletion-machine";

// The two-step hard-delete state machine (RFC-0001 D8): plan → typed-confirm →
// token-bound execute, with a re-plan escape hatch for a stale/expired plan.

const PLAN: DeletionPlan = {
  impact: {
    targetType: "text",
    targetId: "t_1",
    label: "A text",
    activeReleaseAffected: false,
    deleteCounts: { releases: 2 },
    retainedCounts: {},
    warnings: [],
  },
  confirmationToken: "tok_abc",
  expiresAt: Date.now() + 60_000,
};

const ready: DeletionPhase = { status: "ready", plan: PLAN };

describe("deletionReducer", () => {
  test("plan lifecycle: planning → ready", () => {
    expect(initialDeletionPhase).toEqual({ status: "planning" });
    expect(deletionReducer(initialDeletionPhase, { type: "plan_ok", plan: PLAN })).toEqual(ready);
  });

  test("plan failure carries a message", () => {
    expect(
      deletionReducer({ status: "planning" }, { type: "plan_fail", message: "not_found" }),
    ).toEqual({ status: "plan_error", message: "not_found" });
  });

  test("confirm can only start from a plan-bearing phase", () => {
    expect(deletionReducer(ready, { type: "confirm_start" })).toEqual({
      status: "confirming",
      plan: PLAN,
    });
    // Not from planning — no token yet.
    expect(deletionReducer({ status: "planning" }, { type: "confirm_start" })).toEqual({
      status: "planning",
    });
  });

  test("confirm success ends in done with the returned activeVersion", () => {
    const confirming: DeletionPhase = { status: "confirming", plan: PLAN };
    expect(deletionReducer(confirming, { type: "confirm_ok", activeVersion: "1.2.0" })).toEqual({
      status: "done",
      activeVersion: "1.2.0",
    });
  });

  test("confirm failure keeps the plan so a retry/re-plan is possible", () => {
    const confirming: DeletionPhase = { status: "confirming", plan: PLAN };
    const next = deletionReducer(confirming, {
      type: "confirm_fail",
      error: "deletion_plan_expired",
    });
    expect(next).toEqual({ status: "confirm_error", plan: PLAN, error: "deletion_plan_expired" });
  });

  test("a stale plan can be re-planned from the errored phase", () => {
    const errored: DeletionPhase = {
      status: "confirm_error",
      plan: PLAN,
      error: "deletion_plan_expired",
    };
    expect(deletionReducer(errored, { type: "plan_start" })).toEqual({ status: "planning" });
    // And a confirm can restart from the errored phase too.
    expect(deletionReducer(errored, { type: "confirm_start" })).toEqual({
      status: "confirming",
      plan: PLAN,
    });
  });
});

describe("isReplannable", () => {
  test("expiry and mismatch are recoverable; not_found and already-executed are terminal", () => {
    expect(isReplannable("deletion_plan_expired")).toBe(true);
    expect(isReplannable("deletion_plan_mismatch")).toBe(true);
    expect(isReplannable("not_found")).toBe(false);
    expect(isReplannable("deletion_already_executed")).toBe(false);
  });
});

describe("confirmationSatisfied", () => {
  test("requires an exact, non-empty match (trimmed)", () => {
    expect(confirmationSatisfied("my-slug", "my-slug")).toBe(true);
    expect(confirmationSatisfied("  my-slug  ", "my-slug")).toBe(true);
    expect(confirmationSatisfied("my-slu", "my-slug")).toBe(false);
    expect(confirmationSatisfied("", "")).toBe(false);
  });
});
