import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

/**
 * Sprout brand typefaces, loaded locally from `public/fonts` (copied from
 * `packages/design/src/fonts`). We self-host rather than use Google Fonts so
 * rendering works fully offline.
 *
 *   Zerove      — rounded unicase display → headlines, wordmark, hero
 *   Switzer     — variable grotesque sans → UI / body workhorse
 *   Quadrillion — accent face → taglines, the "learn green" marks
 *   Iosevka     — mono → hosts, technical metadata, "// section" kickers
 *
 * `loadFont()` from @remotion/fonts self-manages `delayRender`/`continueRender`,
 * so we call it (unawaited) at module scope — the same shape as the
 * @remotion/google-fonts pattern. Top-level `await` (the local-fonts rule's
 * form) isn't an option here because Remotion's esbuild target is chrome85.
 */

export const FONT_DISPLAY = "Zerove";
export const FONT_SANS = "Switzer";
export const FONT_ACCENT = "Quadrillion";
export const FONT_MONO = "Iosevka";

// Back-compat alias used across components (defaults to the body sans).
export const fontFamily = `${FONT_SANS}, system-ui, sans-serif`;

// FontFace only exists in the browser render context. Skip during any Node-side
// bundle/composition evaluation; frames are painted in the browser regardless.
if (typeof document !== "undefined") {
  loadFont({
    family: FONT_DISPLAY,
    url: staticFile("fonts/Zerove-Regular.otf"),
    weight: "400",
    format: "opentype",
  });
  loadFont({
    family: FONT_SANS,
    url: staticFile("fonts/Switzer-Variable.woff2"),
    weight: "100 900",
    format: "woff2",
  });
  loadFont({
    family: FONT_ACCENT,
    url: staticFile("fonts/Quadrillion-Sb.otf"),
    weight: "600",
    format: "opentype",
  });
  loadFont({
    family: FONT_MONO,
    url: staticFile("fonts/Iosevka-Regular.woff2"),
    weight: "400",
    format: "woff2",
  });
  loadFont({
    family: FONT_MONO,
    url: staticFile("fonts/Iosevka-Bold.woff2"),
    weight: "700",
    format: "woff2",
  });
}
