/**
 * INV-1 — Education AWARD framing is law (docs/sprout/08-compliance-invariants.md §INV-1).
 *
 * The monthly award is an *education fund / professional-development award*. The
 * words prize / reward / cash / winnings / payout / giveaway NEVER appear in an
 * award context. Load-bearing point: the schema's column set (no `prize`/`reward`/
 * `cash` column) + a write-time validator. This source-level scan is the documented
 * **regression backstop** for naive copy/paste regressions — it strips comments so
 * it never trips on the rule's own prose ("Never prize / reward / cash").
 */
import { describe, expect, test } from "vitest";
import { FORBIDDEN_AWARD, globApp, readSrc, stripComments } from "./_helpers";

// Award-context surfaces: the award read fns, the Hub award route + its chrome,
// and the Hub shell that frames the award card. These hold the runtime award copy.
const AWARD_SURFACES = [
  "src/lib/award.functions.ts",
  "src/lib/hub.functions.ts",
  "src/routes/hub/award.tsx",
  "src/routes/hub.tsx",
  "src/components/hub/Countdown.tsx",
];

describe("INV-1 education award framing", () => {
  test("no forbidden award terms in award-surface code or copy", () => {
    const offenders: string[] = [];
    let matched = 0;
    for (const rel of AWARD_SURFACES) {
      for (const _file of globApp(rel)) {
        matched++;
        // Strip comments first: the source legitimately *names* the forbidden words
        // when documenting the rule. Only executable code + real copy strings remain.
        const scanned = stripComments(readSrc(rel));
        const hit = FORBIDDEN_AWARD.exec(scanned);
        if (hit) offenders.push(`${rel}: "${hit[0]}"`);
      }
    }
    // Fail loudly if the globs matched nothing — a moved award file must not pass silently.
    expect(matched, "award-framing globs matched no files").toBeGreaterThan(0);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  test("education_award schema uses fund language, has no prize/reward/cash column", () => {
    const schema = readSrc("src/schema.ts");
    const start = schema.indexOf('"educationAward"');
    // Fall back to the snake table name the migration uses, in case the var differs.
    const anchor = start >= 0 ? start : schema.indexOf("education_award");
    expect(anchor, "education_award table not found in schema").toBeGreaterThan(-1);
    const block = schema.slice(anchor, anchor + 4000);
    // The fund-framing columns are the schema-level statement of the rule.
    expect(block).toMatch(/coversText|covers_text/);
    // No suppression of the framing via a prize/reward/cash column or enum value.
    expect(block).not.toMatch(/\b(prize|reward|cash)\b/i);
  });

  test("the getAward read surface emits fund framing (coversText), never a prize field", () => {
    const fns = stripComments(readSrc("src/lib/award.functions.ts"));
    expect(fns).toMatch(/coversText/);
    expect(fns).not.toMatch(/prizeDescription|prize_description|rewardAmount|cashValue/i);
  });
});
