import { describe, expect, test } from "vitest";
import { SECTION_KEYS, SECTION_META, SECTION_META_LIST, isSectionKey } from "@/lib/sections";

describe("section keys", () => {
  test("the canonical six, in order", () => {
    expect(SECTION_KEYS).toEqual(["assets", "decks", "quizzes", "feed", "chat", "contact"]);
  });

  test("isSectionKey accepts only canonical keys (the validateSearch guard)", () => {
    for (const k of SECTION_KEYS) expect(isSectionKey(k)).toBe(true);
    expect(isSectionKey("foo")).toBe(false);
    expect(isSectionKey("")).toBe(false);
    expect(isSectionKey(undefined)).toBe(false);
    expect(isSectionKey(123)).toBe(false);
    expect(isSectionKey("Assets")).toBe(false); // case-sensitive
  });

  test("every key has metadata with a unique 01..06 number", () => {
    const nums = SECTION_META_LIST.map((s) => s.num);
    expect(nums).toEqual(["01", "02", "03", "04", "05", "06"]);
    for (const k of SECTION_KEYS) {
      expect(SECTION_META[k].key).toBe(k);
      expect(SECTION_META[k].title.length).toBeGreaterThan(0);
    }
  });
});
