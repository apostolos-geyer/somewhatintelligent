import { describe, expect, test } from "vitest";
import { buildProductMaps, skuFor, slugify, sortBySize } from "@/lib/catalog";

describe("slugify", () => {
  test("lowercases, replaces runs of non-alnum with a single dash, trims dashes", () => {
    expect(slugify("Heavyweight Box Tee — Black")).toBe("heavyweight-box-tee-black");
    expect(slugify("  Spaced  Out  ")).toBe("spaced-out");
    expect(slugify("Weird!!!Chars###Here")).toBe("weird-chars-here");
    expect(slugify("--leading-and-trailing--")).toBe("leading-and-trailing");
  });

  test("caps at 64 chars", () => {
    expect(slugify("a".repeat(100)).length).toBe(64);
  });
});

describe("skuFor", () => {
  test("uppercases slug+size and strips non A-Z0-9-", () => {
    expect(skuFor("field-tee", "M")).toBe("FIELD-TEE-M");
    expect(skuFor("weird.slug", "2XL")).toBe("WEIRDSLUG-2XL");
  });
});

describe("sortBySize", () => {
  test("orders by the canonical size ranking; unknown sizes sort last", () => {
    const rows = [{ size: "XL" }, { size: "S" }, { size: "??" }, { size: "M" }, { size: "XS" }];
    expect(sortBySize(rows).map((r) => r.size)).toEqual(["XS", "S", "M", "XL", "??"]);
  });

  test("does not mutate the input", () => {
    const rows = [{ size: "L" }, { size: "S" }];
    sortBySize(rows);
    expect(rows.map((r) => r.size)).toEqual(["L", "S"]);
  });
});

describe("buildProductMaps", () => {
  const img = (over: Partial<Parameters<typeof buildProductMaps>[0][number]>) => ({
    productId: "p1",
    roadieReferenceId: "ref",
    position: 0,
    uploadedAt: new Date(1),
    ...over,
  });

  test("cover = first UPLOADED image by position; pending images are skipped", () => {
    const { cover } = buildProductMaps(
      [
        img({ position: 1, roadieReferenceId: "second", uploadedAt: new Date(1) }),
        img({ position: 0, roadieReferenceId: "cover", uploadedAt: null }), // pending → skipped
        img({ position: 2, roadieReferenceId: "third", uploadedAt: new Date(1) }),
      ],
      [],
    );
    // position 0 is pending, so the first uploaded by position (1) wins.
    expect(cover.get("p1")).toBe("second");
  });

  test("stock = summed variant stock per product", () => {
    const { stock } = buildProductMaps(
      [],
      [
        { productId: "p1", stock: 3 },
        { productId: "p1", stock: 4 },
        { productId: "p2", stock: 5 },
      ],
    );
    expect(stock.get("p1")).toBe(7);
    expect(stock.get("p2")).toBe(5);
    expect(stock.get("p3")).toBeUndefined();
  });
});
