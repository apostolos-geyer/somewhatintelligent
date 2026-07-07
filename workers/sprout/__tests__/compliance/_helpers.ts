/**
 * Shared, binding-free helpers for the Doc-08 compliance regression backstop
 * (idiom B: plain vitest, environment node, NO real bindings). These tests lock
 * the *load-bearing source-level invariants* from `docs/sprout/08-compliance-invariants.md`
 * by statically reading the app source — they never touch D1, roadie, or the DO.
 *
 * Two design rules make the scans honest (matching doc 08's "regression backstop,
 * not the law" framing):
 *
 *  1. **Anchor to the app root, fail loud on an empty glob.** Every scan resolves
 *     paths from this file's directory up to `workers/sprout/` and asserts it matched
 *     ≥1 file, so a moved/renamed source file can never silently pass the suite.
 *  2. **Strip comments before a forbidden-term scan.** The Sprout source documents
 *     these very rules in prose ("Never prize / reward / cash", "there is NO
 *     'Start Call Now'"). A naive substring grep would false-positive on the rule's
 *     own documentation. We strip line/block/JSDoc comments first, so the scan only
 *     sees executable code + real copy strings — a genuine regression (a `prize` in
 *     award copy, a `startCall` affordance) still trips it.
 */
import { globSync, readFileSync } from "node:fs";
import path from "node:path";

/** `workers/sprout/` — anchored to this file (`__tests__/compliance/_helpers.ts`). */
export const APP_ROOT = path.resolve(import.meta.dirname, "../..");

/** Resolve a repo-relative-to-app path (e.g. `"src/schema.ts"`) to an absolute one. */
export function appPath(rel: string): string {
  return path.resolve(APP_ROOT, rel);
}

/** Read a source file relative to the app root. */
export function readSrc(rel: string): string {
  return readFileSync(appPath(rel), "utf8");
}

/**
 * Glob (anchored to the app root) and return absolute file paths. Caller asserts
 * the count so an empty match fails loudly.
 */
export function globApp(pattern: string): string[] {
  // Anchor with the `cwd` option, NOT an absolute pattern: bun's `fs.globSync`
  // returns [] for absolute patterns (node tolerates them), which silently broke
  // this "fail loud on empty glob" guard under the bun test runtime. Relative
  // pattern + cwd works on both runtimes; returned paths are relative to APP_ROOT.
  return globSync(pattern, { cwd: APP_ROOT });
}

/**
 * Strip `//` line comments, `/* *\/` block comments, and JSDoc from source so a
 * forbidden-term scan never trips on the rule's own documentation. Preserves
 * string contents (so real *copy* still gets scanned) by only removing comment
 * syntax, not string literals.
 *
 * This is a deliberately conservative pass: it removes comments but keeps every
 * string/JSX-text token, which is exactly the surface a copy regression lands in.
 */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  // states: 0 code, 1 line-comment, 2 block-comment, 3 single-q, 4 double-q, 5 template
  let state = 0;
  while (i < n) {
    const c = src[i];
    const c2 = i + 1 < n ? src[i + 1] : "";
    if (state === 0) {
      if (c === "/" && c2 === "/") {
        state = 1;
        i += 2;
      } else if (c === "/" && c2 === "*") {
        state = 2;
        i += 2;
      } else if (c === "'") {
        state = 3;
        out += c;
        i++;
      } else if (c === '"') {
        state = 4;
        out += c;
        i++;
      } else if (c === "`") {
        state = 5;
        out += c;
        i++;
      } else {
        out += c;
        i++;
      }
    } else if (state === 1) {
      if (c === "\n") {
        state = 0;
        out += c;
      }
      i++;
    } else if (state === 2) {
      if (c === "*" && c2 === "/") {
        state = 0;
        i += 2;
      } else {
        // keep newlines so line numbers / blank structure stay roughly intact
        if (c === "\n") out += c;
        i++;
      }
    } else if (state === 3 || state === 4 || state === 5) {
      const quote = state === 3 ? "'" : state === 4 ? '"' : "`";
      out += c;
      if (c === "\\") {
        // escape next char verbatim
        if (i + 1 < n) out += src[i + 1];
        i += 2;
        continue;
      }
      if (c === quote) state = 0;
      i++;
    }
  }
  return out;
}

/**
 * Remove *negated* mentions of the instant-call concept from already-comment-
 * stripped source, so the INV-2 affordance scan never trips on copy that DENIES
 * the feature ("There's no instant call", `NO "Start Call Now"`, "never call now").
 *
 * The product surface legitimately *tells the budtender* there is no instant call
 * — that copy is compliant, not a regression. A real instant-call CTA ("Start Call
 * Now" as a button label, "start an instant call") is NOT preceded by a negator and
 * survives this strip, so a genuine affordance still fails the test.
 */
export function stripNegatedClaims(src: string): string {
  const NEGATOR =
    "(?:no|never|not|without|isn't|isnt|aren't|arent|there's no|theres no|there is no|don't|dont)";
  // negator … (≤24 chars, e.g. "NO \"") … instant-call phrase  → drop the phrase
  const re = new RegExp(
    `${NEGATOR}\\b[\\s"'\`(]{0,24}(?:start call now|instant[\\s-]?(?:video[\\s-]?)?call|call[\\s-]?now|join[\\s-]?now)`,
    "gi",
  );
  return src.replace(re, " ");
}

/** Forbidden award-context terms (INV-1). */
export const FORBIDDEN_AWARD = /\b(prize|reward|cash|winnings|payout|giveaway)\b/i;

/** Instant-call affordance terms / identifiers (INV-2). */
export const INSTANT_CALL_STRINGS = /start call now|instant (?:video )?call|call now|join now/i;
export const INSTANT_CALL_IDENTS = /\b(?:startCall|joinNow|instantCall|callNow|openRoomNow)\b/;
