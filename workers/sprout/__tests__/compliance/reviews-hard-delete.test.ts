/**
 * INV-3 — Reviews: DELETE, never suppress (docs/sprout/08-compliance-invariants.md §INV-3).
 *
 * A `reviews` row can be hard-DELETEd (author removes own, admin removes a
 * guideline violation). An admin can NEVER edit and NEVER hide a review: there is
 * no soft-delete column, no `editReview`/`hideReview`/`moderateReview` server fn,
 * and the delete fns issue a real Drizzle `.delete(reviews)` — never a `.update`.
 *
 * Note on idiom: this repo's reviews surface uses the Drizzle query-builder
 * (`db.delete(reviews)`), not raw `env.DB.prepare("DELETE FROM reviews ...")`. The
 * assertions below match the actual in-repo style, not the illustrative raw-SQL in
 * doc 08's sample. (`upsertMyReview` is the author editing their OWN row in place —
 * explicitly allowed by INV-3; only an *admin* edit/hide is forbidden.)
 */
import { describe, expect, test } from "vitest";
import { readSrc, stripComments } from "./_helpers";

describe("INV-3 reviews delete-never-suppress", () => {
  test("reviews table has no soft-delete / hidden / status column (structural law)", () => {
    const schema = readSrc("src/schema.ts");
    const start = schema.indexOf('"reviews"');
    expect(start, "reviews table not found in schema").toBeGreaterThan(-1);
    // slice to the next table definition so we scan only the reviews block
    const next = schema.indexOf("sqliteTable(", start + 1);
    const block = schema.slice(start, next > start ? next : start + 4000);
    // the column-name SET is the law — no suppression column may exist
    expect(block).not.toMatch(/deleted_at|deletedAt|archived_at|archivedAt/);
    expect(block).not.toMatch(/\bhidden\b|\bsuppressed\b|is_visible|isVisible|\bstatus\b/);
    // one review per budtender per product is a UNIQUE over (brand_id, product_id, user_id)
    // (declared in-repo as `uniqueIndex(...).on(t.brandId, t.productId, t.userId)`)
    expect(block).toMatch(
      /unique(?:Index)?\([\s\S]*?\)?\s*\.?on\([\s\S]*?brandId[\s\S]*?productId[\s\S]*?userId/,
    );
  });

  test("no admin edit/hide/moderate review server fn exists", () => {
    const fns = stripComments(readSrc("src/lib/reviews.functions.ts"));
    expect(fns).not.toMatch(/editReview|hideReview|moderateReview|setReviewVisible|suppressReview/);
    // the admin write surface is a single destructive action
    expect(fns).toMatch(/\bdeleteReview\b/);
  });

  test("deleteReview is a real DELETE (Drizzle .delete), never an UPDATE", () => {
    const fns = stripComments(readSrc("src/lib/reviews.functions.ts"));
    // isolate the admin deleteReview handler body
    const start = fns.indexOf("export const deleteReview");
    expect(start, "deleteReview export not found").toBeGreaterThan(-1);
    const after = fns.indexOf("export const ", start + 1);
    const handler = fns.slice(start, after > start ? after : fns.length);
    // a real delete against the reviews table…
    expect(handler).toMatch(/\.delete\(reviews\)/);
    // …and it never mutates rows (no soft-delete column to flip, no in-place edit)
    expect(handler).not.toMatch(/\.update\(reviews\)/);
  });

  test("the author's own-review removal is also a hard DELETE, never a suppress flag", () => {
    const fns = stripComments(readSrc("src/lib/reviews.functions.ts"));
    const start = fns.indexOf("export const deleteMyReview");
    expect(start, "deleteMyReview export not found").toBeGreaterThan(-1);
    const after = fns.indexOf("export const ", start + 1);
    const handler = fns.slice(start, after > start ? after : fns.length);
    expect(handler).toMatch(/\.delete\(reviews\)/);
    expect(handler).not.toMatch(/\.update\(reviews\)/);
  });
});
