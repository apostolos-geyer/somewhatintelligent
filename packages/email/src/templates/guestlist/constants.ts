// Guestlist (somewhatintelligent IDP) — light theme email constants
// Email clients don't support CSS variables, so we inline hex values.
// These mirror the blueprint light-mode design tokens (packages/design):
// ink on drafting paper, flat surfaces, NO shadows.

// Surfaces (light)
export const COLOR_BG = "#F8F7F1"; // drafting paper
export const COLOR_SURFACE = "#ffffff";
export const COLOR_SURFACE_RAISED = "#ffffff";

// Borders — ruled ink lines
export const COLOR_BORDER = "#8E8B80"; // ink-400
export const COLOR_BORDER_STRONG = "#4A4841"; // ink-700

// Text — ink
export const COLOR_TEXT = "#171613"; // ink-950
export const COLOR_TEXT_SECONDARY = "#4A4841"; // ink-700
export const COLOR_TEXT_TERTIARY = "#757268"; // ink-500
export const COLOR_TEXT_ON_ACCENT = "#F8F7F1"; // paper on ink fills

// Accents
export const COLOR_INK = "#23221E"; // primary — the pen
export const COLOR_RUST = "#96432B"; // destructive — the red pen

// Shared base for all email buttons — flat, no shadow
const BUTTON_BASE = {
  fontSize: "15px",
  fontWeight: "600" as const,
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "12px 28px",
  borderRadius: "10px",
} as const;

export const CTA_BUTTON_STYLE = {
  ...BUTTON_BASE,
  backgroundColor: COLOR_INK,
  color: COLOR_TEXT_ON_ACCENT,
} as const;

export const DESTRUCTIVE_BUTTON_STYLE = {
  ...BUTTON_BASE,
  backgroundColor: COLOR_RUST,
  color: COLOR_TEXT_ON_ACCENT,
} as const;

// Typography — Iosevka voices with web-safe fallbacks (email clients
// won't load webfonts; the fallbacks carry the plain technical look).
export const FONT_BODY = "Helvetica, Arial, sans-serif";
export const FONT_DISPLAY = '"Iosevka Aile", Helvetica, Arial, sans-serif';
export const FONT_MONO = '"Iosevka", "SF Mono", "Fira Code", Consolas, monospace';

export const HEADING_STYLE = {
  fontSize: "22px",
  fontWeight: 600,
  color: COLOR_TEXT,
  margin: "0 0 16px",
} as const;

export const BODY_STYLE = {
  fontSize: "15px",
  lineHeight: "26px",
  color: COLOR_TEXT_SECONDARY,
} as const;

export const EMAIL_MAX_WIDTH = "560px";
