import { describe, expect, test } from "vitest";
import {
  availabilityFor,
  DEFAULT_PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
  excerpt,
  MAX_PAGE_LIMIT,
  mediaHref,
} from "@/lib/catalog";

// Pure, D1-free units of the StoreCatalog read layer (RFC-0001 "StoreCatalog
// RPC"): the keyset cursor codec, the card excerpt, the stock→availability rule,
// and the storage-neutral media href. The D1-backed query behaviour lives in
// __tests__/integration/catalog.itest.ts.

describe("cursor codec", () => {
  test("round-trips (updatedAt, id)", () => {
    const cursor = { updatedAt: 1_726_000_000_000, id: "01J8ZP" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  test("is url-safe base64 (no +/=)", () => {
    const encoded = encodeCursor({ updatedAt: 1_726_000_000_123, id: "aaa/bbb+ccc" });
    expect(encoded).not.toMatch(/[+/=]/);
    expect(decodeCursor(encoded)).toEqual({ updatedAt: 1_726_000_000_123, id: "aaa/bbb+ccc" });
  });

  test.each([
    ["garbage that is not base64 at all !!!", "non-base64"],
    ["", "empty"],
    [btoa("no-separator"), "missing colon"],
    [btoa(":onlyid"), "missing updatedAt"],
    [btoa("notanumber:id"), "non-integer updatedAt"],
    [btoa("123:"), "empty id"],
  ])("returns null for a malformed cursor (%s)", (raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });
});

describe("excerpt", () => {
  test("null description stays null", () => {
    expect(excerpt(null)).toBeNull();
  });

  test("whitespace-only description collapses to null", () => {
    expect(excerpt("   \n\t  ")).toBeNull();
  });

  test("collapses internal whitespace", () => {
    expect(excerpt("Heavy   box\ntee\t\tblack")).toBe("Heavy box tee black");
  });

  test("truncates with an ellipsis past the max length", () => {
    const out = excerpt("a".repeat(300), 200);
    expect(out).toHaveLength(200);
    expect(out?.endsWith("…")).toBe(true);
  });

  test("keeps short copy verbatim", () => {
    expect(excerpt("Short.", 200)).toBe("Short.");
  });
});

describe("availabilityFor (from CURRENT variant stock)", () => {
  test("no variants → unavailable", () => {
    expect(availabilityFor([])).toBe("unavailable");
  });

  test("variants but zero total stock → sold_out", () => {
    expect(availabilityFor([{ stock: 0 }, { stock: 0 }])).toBe("sold_out");
  });

  test("any positive stock → available", () => {
    expect(availabilityFor([{ stock: 0 }, { stock: 2 }])).toBe("available");
  });
});

describe("mediaHref + limits", () => {
  test("href is the storage-neutral public path", () => {
    expect(mediaHref("m1")).toBe("/api/store/media/m1");
  });

  test("page-size bounds are exported", () => {
    expect(DEFAULT_PAGE_LIMIT).toBe(24);
    expect(MAX_PAGE_LIMIT).toBe(100);
  });
});
