import { describe, expect, test } from "vitest";

describe("smoke", () => {
  test("test harness is wired", () => {
    expect(1 + 1).toBe(2);
  });
});
