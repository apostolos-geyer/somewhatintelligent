/**
 * Integration probe: does "Reset to defaults → Save draft → Publish" actually
 * return a brand's LIVE theme to the empty (Sprout-default) skin?
 *
 * Replays the EXACT D1 writes the two theme server fns make against a REAL
 * local D1:
 *  - updateThemeDraft: upsert draft_theme_json = "{}"
 *  - publishTheme:     live_theme_json = draft_theme_json (the copy-down)
 * The public render reads only live_theme_json, so the bug ("colours don't
 * reset") would show as live_theme_json staying non-empty after the publish.
 */
import { env } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { brandTheme } from "@/schema";

const db = createDb(env.DB);
const now = () => Date.now();
const ORG = "org_flip";

beforeEach(async () => {
  await db.delete(brandTheme);
});

describe("reset → save → publish returns the live theme to Sprout defaults", () => {
  it("publishTheme copies an emptied draft down to live (real D1)", async () => {
    // A brand that already published a custom skin (v1 legacy shape, as seeded).
    const seeded = JSON.stringify({ colors: { primary: "#1f6f3c", accent: "#caa14b" } });
    await db.insert(brandTheme).values({
      id: "bt_flip",
      orgId: ORG,
      draftThemeJson: seeded,
      liveThemeJson: seeded,
      state: "live",
      livePublishedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    });

    // 1) Reset → Save draft: updateThemeDraft writes draft_theme_json = "{}".
    const draftThemeJson = JSON.stringify({}); // "{}"
    await db
      .insert(brandTheme)
      .values({
        id: "x",
        orgId: ORG,
        draftThemeJson,
        state: "draft",
        createdAt: now(),
        updatedAt: now(),
      })
      .onConflictDoUpdate({
        target: brandTheme.orgId,
        set: { draftThemeJson, updatedAt: now() },
      });

    const afterSave = (await db.select().from(brandTheme).where(eq(brandTheme.orgId, ORG))).at(0)!;
    expect(afterSave.draftThemeJson).toBe("{}");
    expect(afterSave.liveThemeJson).toBe(seeded); // live untouched until publish

    // 2) Publish: publishTheme copies draft → live (the exact source SQL).
    await db
      .update(brandTheme)
      .set({
        liveThemeJson: sql`${brandTheme.draftThemeJson}`,
        state: "live",
        livePublishedAt: now(),
        updatedAt: now(),
      })
      .where(eq(brandTheme.orgId, ORG));

    const afterFlip = (await db.select().from(brandTheme).where(eq(brandTheme.orgId, ORG))).at(0)!;

    // The load-bearing assertion: the public read (live_theme_json) is now empty,
    // so brandThemeToCss("{}") === "" → the portal falls back to the Sprout skin.
    expect(afterFlip.liveThemeJson).toBe("{}");
  });
});
