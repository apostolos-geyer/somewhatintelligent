/**
 * INV-2 — Booking only, no instant calls (docs/sprout/08-compliance-invariants.md §INV-2).
 *
 * There is no "Start Call Now" affordance anywhere: no instant-call string rendered
 * as a CTA, no instant-call route/component, no `startCall`/`joinNow` server fn or
 * AI tool. A live room is reachable ONLY from a booked `bookings`/`group_sessions`
 * row at/after slot start. The escalation tool surface is booking-only.
 *
 * The Sprout source documents this rule in prose ("there is NO 'Start Call Now'"),
 * so the string scan strips comments first and only flags an instant-call CTA that
 * survives in executable code / real copy.
 */
import { describe, expect, test } from "vitest";
import {
  INSTANT_CALL_IDENTS,
  INSTANT_CALL_STRINGS,
  globApp,
  readSrc,
  stripComments,
  stripNegatedClaims,
} from "./_helpers";

describe("INV-2 booking only", () => {
  test("no instant-call affordance string survives in executable code / copy", () => {
    const offenders: string[] = [];
    const files = globApp("src/**/*.{ts,tsx}").filter((f) => !f.includes(`${"/__tests__/"}`));
    expect(files.length, "src glob matched no files").toBeGreaterThan(0);
    for (const file of files) {
      // The codebase legitimately *names* "Start Call Now" when it documents that
      // there is none — in comments AND in user-facing copy that denies the feature
      // ("There's no instant call; everything is scheduled."). Strip comments, then
      // strip negated mentions, so only a real instant-call CTA survives the scan.
      const scanned = stripNegatedClaims(stripComments(readSrc(file.slice(file.indexOf("src/")))));
      const hit = INSTANT_CALL_STRINGS.exec(scanned);
      if (hit) offenders.push(`${file}: "${hit[0]}"`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  test("no instant-call route or component file exists", () => {
    const all = globApp("src/**/*.{ts,tsx}").map((f) => f.toLowerCase());
    const bad = all.filter((f) => /start-?call|instant-?call|call-?now|join-?now/.test(f));
    expect(bad, bad.join("\n")).toEqual([]);
  });

  test("no startCall/joinNow/instantCall identifier exists in the booking + AI surface", () => {
    const surface = [
      "src/lib/ai.functions.ts",
      "src/lib/sessions.functions.ts",
      "src/lib/realtime.ts",
      ...globApp("src/components/booking/*.tsx").map((f) => f.slice(f.indexOf("src/"))),
      ...globApp("src/components/ai/*.tsx").map((f) => f.slice(f.indexOf("src/"))),
    ];
    const offenders: string[] = [];
    for (const rel of surface) {
      const scanned = stripComments(readSrc(rel)); // negated mentions live in comments
      if (INSTANT_CALL_IDENTS.test(scanned)) offenders.push(rel);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  test("the call escalation tool is booking-only (bookCall/listSlots, never startCall)", () => {
    // The bookable-slot tools live in the sessions surface; the AI panel embeds the
    // SlotPicker to escalate. The only call action is booking a scheduled slot.
    const sessions = stripComments(readSrc("src/lib/sessions.functions.ts"));
    expect(sessions).toMatch(/\bbookCall\b/);
    expect(sessions).toMatch(/\blistSlots\b/);
    expect(sessions).not.toMatch(INSTANT_CALL_IDENTS);

    // The AI assistant escalates to a booked slot (SlotPicker), with no open-room-now path.
    const ai = stripComments(readSrc("src/lib/ai.functions.ts"));
    expect(ai).not.toMatch(INSTANT_CALL_IDENTS);
  });
});
