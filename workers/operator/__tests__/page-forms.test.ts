import { validatePageDocument } from "@si/contracts";
import { PAGE_KEYS, defaultPageDocument, pageDocumentMediaRefs } from "../src/lib/page-forms";

// Page form seeds must be faithful to the fixed page-document contracts (RFC-0001
// D9): a fresh default for each key must pass the same arktype validator the
// write boundary enforces (INV-PAGE-1).

describe("defaultPageDocument", () => {
  test("every key's default is a valid document", () => {
    for (const key of PAGE_KEYS) {
      const doc = defaultPageDocument(key);
      const res = validatePageDocument(key, doc);
      expect(res.ok).toBe(true);
      expect(doc.key).toBe(key);
    }
  });

  test("returns a fresh object each call (no shared nested refs)", () => {
    const a = defaultPageDocument("home");
    const b = defaultPageDocument("home");
    expect(a).not.toBe(b);
    expect(a.seo).not.toBe(b.seo);
    a.seo.title = "mutated";
    expect(b.seo.title).toBe("");
  });
});

describe("pageDocumentMediaRefs", () => {
  test("home surfaces seo + hero refs, skipping nulls", () => {
    const doc = defaultPageDocument("home");
    doc.seo.imageMediaId = "m_seo";
    doc.heroMediaId = "m_hero";
    expect(pageDocumentMediaRefs(doc)).toEqual([
      { slot: "seo.imageMediaId", mediaId: "m_seo" },
      { slot: "heroMediaId", mediaId: "m_hero" },
    ]);
  });

  test("about surfaces primary + secondary refs", () => {
    const doc = defaultPageDocument("about");
    doc.primaryMediaId = "m_p";
    doc.secondaryMediaId = "m_s";
    const slots = pageDocumentMediaRefs(doc).map((r) => r.slot);
    expect(slots).toEqual(["primaryMediaId", "secondaryMediaId"]);
  });

  test("a list page with no media yields no refs", () => {
    expect(pageDocumentMediaRefs(defaultPageDocument("shop"))).toEqual([]);
  });
});
