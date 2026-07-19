import { toWikilinkSuggestions } from "../src/lib/wikilink";

// The [[wikilink]] provider shaping (RFC-0001 D13): a text listing → typed
// slug/title suggestions filtered by the query.

const TEXTS = [
  { slug: "small-tools", title: "On small tools" },
  { slug: "big-systems", title: "Designing big systems" },
  { slug: "toolmaking", title: "The craft of toolmaking" },
];

describe("toWikilinkSuggestions", () => {
  test("empty query returns everything (up to the limit)", () => {
    expect(toWikilinkSuggestions(TEXTS, "")).toHaveLength(3);
    expect(toWikilinkSuggestions(TEXTS, "  ")).toHaveLength(3);
  });

  test("matches on slug or title, case-insensitively", () => {
    expect(toWikilinkSuggestions(TEXTS, "tool").map((s) => s.slug)).toEqual([
      "small-tools",
      "toolmaking",
    ]);
    expect(toWikilinkSuggestions(TEXTS, "DESIGNING").map((s) => s.slug)).toEqual(["big-systems"]);
  });

  test("projects to slug/title only and honours the limit", () => {
    const out = toWikilinkSuggestions(TEXTS, "", 2);
    expect(out).toHaveLength(2);
    expect(Object.keys(out[0]!).sort()).toEqual(["slug", "title"]);
  });

  test("no matches yields an empty list", () => {
    expect(toWikilinkSuggestions(TEXTS, "nonexistent")).toEqual([]);
  });
});
