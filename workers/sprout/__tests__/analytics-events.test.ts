import { describe, expect, test } from "vitest";
import { rollupEvents, type RollupEvent } from "@/lib/analytics-rollup";

const ev = (type: string, actorId = "u1", createdAt = 0): RollupEvent => ({
  type,
  actorId,
  createdAt,
});

describe("rollupEvents", () => {
  test("empty input → zero total, empty breakdown", () => {
    expect(rollupEvents([])).toEqual({ total: 0, byType: [] });
  });

  test("counts by type and totals every event", () => {
    const out = rollupEvents([ev("deck_open"), ev("deck_open"), ev("product_view")]);
    expect(out.total).toBe(3);
    expect(out.byType).toEqual([
      { type: "deck_open", count: 2 },
      { type: "product_view", count: 1 },
    ]);
  });

  test("sorts descending by count", () => {
    const out = rollupEvents([ev("a"), ev("b"), ev("b"), ev("c"), ev("c"), ev("c")]);
    expect(out.byType.map((b) => b.type)).toEqual(["c", "b", "a"]);
  });

  test("ties broken ascending by type name (deterministic)", () => {
    const out = rollupEvents([ev("zebra"), ev("alpha")]);
    expect(out.byType).toEqual([
      { type: "alpha", count: 1 },
      { type: "zebra", count: 1 },
    ]);
  });

  test("does not mutate the input array", () => {
    const input: RollupEvent[] = [ev("x"), ev("y")];
    const snapshot = [...input];
    rollupEvents(input);
    expect(input).toEqual(snapshot);
  });

  test("counts whatever it is handed (does not filter by actor/window itself)", () => {
    // The SQL path pre-filters; the pure helper trusts its input. Mixed actors
    // and timestamps are all counted.
    const out = rollupEvents([
      ev("deck_open", "u1", 100),
      ev("deck_open", "u2", 200),
      ev("quiz_attempt_submit", "u1", 300),
    ]);
    expect(out.total).toBe(3);
    expect(out.byType).toEqual([
      { type: "deck_open", count: 2 },
      { type: "quiz_attempt_submit", count: 1 },
    ]);
  });
});
