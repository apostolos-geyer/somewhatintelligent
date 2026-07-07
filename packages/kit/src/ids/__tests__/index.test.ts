import { describe, expect, test } from "vite-plus/test";
import { decodeTime, id, isValid, ulid } from "../index";

describe("ulid", () => {
  test("returns a 26-char Crockford base32 string", () => {
    const value = ulid();
    expect(value).toHaveLength(26);
    expect(value).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test("is monotonic within the same millisecond (CF Workers correctness)", () => {
    // Same sync block — Date.now() returns the same value for all calls.
    // Without monotonicFactory, lex order would be random; with it, strictly increasing.
    const batch = Array.from({ length: 100 }, () => ulid());
    const sorted = [...batch].sort();
    expect(batch).toEqual(sorted);
    expect(new Set(batch).size).toBe(100);
  });
});

describe("id (prefixed)", () => {
  test("composes prefix + monotonic ulid with hyphen separator", () => {
    const value = id("grant");
    expect(value).toMatch(/^grant-[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  test("rejects invalid prefixes", () => {
    expect(() => id("Grant")).toThrow();
    expect(() => id("9bad")).toThrow();
    expect(() => id("toolongprefix1")).toThrow();
    expect(() => id("with-hyphen")).toThrow();
    expect(() => id("")).toThrow();
  });

  test("is monotonic within the same millisecond per prefix", () => {
    const batch = Array.from({ length: 50 }, () => id("act"));
    const sorted = [...batch].sort();
    expect(batch).toEqual(sorted);
  });
});

describe("decodeTime", () => {
  test("decodes plain ULID timestamp", () => {
    const before = Date.now();
    const value = ulid();
    const after = Date.now();
    const decoded = decodeTime(value);
    expect(decoded).toBeGreaterThanOrEqual(before);
    expect(decoded).toBeLessThanOrEqual(after);
  });

  test("decodes prefixed ULID timestamp", () => {
    const before = Date.now();
    const value = id("trk");
    const after = Date.now();
    const decoded = decodeTime(value);
    expect(decoded).toBeGreaterThanOrEqual(before);
    expect(decoded).toBeLessThanOrEqual(after);
  });
});

describe("isValid", () => {
  test("accepts plain and prefixed ULIDs", () => {
    expect(isValid(ulid())).toBe(true);
    expect(isValid(id("grant"))).toBe(true);
  });

  test("rejects garbage", () => {
    expect(isValid("not-a-ulid")).toBe(false);
    expect(isValid("")).toBe(false);
    expect(isValid("01HZX5F7ABCDEF123456GHJKM")).toBe(false); // 25 chars
  });

  test("expectedPrefix asserts entity match", () => {
    const grantId = id("grant");
    expect(isValid(grantId, "grant")).toBe(true);
    expect(isValid(grantId, "trk")).toBe(false);
    expect(isValid(ulid(), "grant")).toBe(false); // unprefixed value
  });
});
