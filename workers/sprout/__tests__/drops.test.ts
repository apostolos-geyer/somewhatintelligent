import { describe, expect, test } from "vitest";
import {
  CANADIAN_PROVINCES,
  PRODUCT_TAGS,
  isProductTag,
  isProvince,
  parseTags,
} from "@/lib/products";

describe("product tags", () => {
  test("isProductTag accepts the vocabulary, rejects everything else", () => {
    for (const t of PRODUCT_TAGS) expect(isProductTag(t)).toBe(true);
    expect(isProductTag("flower")).toBe(false); // a category, not a tag
    expect(isProductTag("ROTATIONAL")).toBe(false); // case-sensitive
    expect(isProductTag(null)).toBe(false);
    expect(isProductTag(42)).toBe(false);
  });

  test("parseTags keeps known tags, drops garbage + dups, never throws", () => {
    expect(parseTags(JSON.stringify(["rotational", "wholesale"]))).toEqual([
      "rotational",
      "wholesale",
    ]);
    // unknown + duplicate are filtered
    expect(parseTags(JSON.stringify(["rotational", "rotational", "bogus", 1]))).toEqual([
      "rotational",
    ]);
    expect(parseTags("not json")).toEqual([]);
    expect(parseTags(null)).toEqual([]);
    expect(parseTags("{}")).toEqual([]); // object, not array
  });
});

describe("provinces", () => {
  test("isProvince validates the Canadian set (upper-case 2-letter)", () => {
    expect(isProvince("ON")).toBe(true);
    expect(isProvince("QC")).toBe(true);
    expect(isProvince("on")).toBe(false); // normalised before this check
    expect(isProvince("ZZ")).toBe(false);
    expect(isProvince(null)).toBe(false);
    expect(CANADIAN_PROVINCES).toContain("BC");
    expect(CANADIAN_PROVINCES.length).toBe(13);
  });
});
