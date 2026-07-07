import { describe, expect, test } from "vitest";
import {
  GOOGLE_FONTS,
  findGoogleFont,
  googleFamiliesInFonts,
  googleFontsHref,
} from "@/lib/google-fonts";
import { sanitizeCssValue } from "@/lib/brand";

describe("findGoogleFont", () => {
  test("maps a stored stack back to its catalog entry", () => {
    expect(findGoogleFont("'Inter', sans-serif")?.name).toBe("Inter");
    expect(findGoogleFont("  'Inter', sans-serif  ")?.name).toBe("Inter"); // trims
  });

  test("returns undefined for unset or unknown stacks", () => {
    expect(findGoogleFont("")).toBeUndefined();
    expect(findGoogleFont(null)).toBeUndefined();
    expect(findGoogleFont("'Zerove', sans-serif")).toBeUndefined(); // a Sprout face
  });
});

describe("googleFontsHref", () => {
  test("null when there are no families", () => {
    expect(googleFontsHref([])).toBeNull();
    expect(googleFontsHref([""])).toBeNull();
  });

  test("encodes spaces as + and de-duplicates families", () => {
    const href = googleFontsHref(["DM Sans", "DM Sans", "Inter"]);
    expect(href).toContain("family=DM+Sans:");
    expect(href).toContain("family=Inter:");
    expect(href!.match(/family=DM\+Sans:/g)).toHaveLength(1); // de-duped
    expect(href).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?/);
    expect(href).toContain("&display=swap");
  });
});

describe("googleFamiliesInFonts", () => {
  test("collects only the catalog families referenced by a theme's fonts bucket", () => {
    const families = googleFamiliesInFonts({
      display: "'Bebas Neue', sans-serif",
      body: "'Inter', sans-serif",
      mono: "'Zerove', sans-serif", // not a Google font → dropped
    });
    expect(families.sort()).toEqual(["Bebas Neue", "Inter"]);
  });

  test("undefined / empty fonts → no families", () => {
    expect(googleFamiliesInFonts(undefined)).toEqual([]);
    expect(googleFamiliesInFonts({})).toEqual([]);
  });
});

describe("catalog stacks survive CSS sanitization", () => {
  // Every stored stack is emitted verbatim into a <style> block via
  // sanitizeCssValue; quotes/commas/spaces must pass through unchanged so the
  // selected family actually drives --font-*.
  test("no catalog stack is altered by sanitizeCssValue", () => {
    for (const f of GOOGLE_FONTS) {
      expect(sanitizeCssValue(f.stack)).toBe(f.stack);
    }
  });
});
