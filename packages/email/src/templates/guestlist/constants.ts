// Guestlist (Sprout IDP) — light theme email constants
// Email clients don't support CSS variables, so we inline hex values.
// These mirror the Sprout light-mode design tokens (packages/design).

// Surfaces (light)
export const COLOR_BG = "#F2F2EC"; // cream
export const COLOR_SURFACE = "#ffffff";
export const COLOR_SURFACE_RAISED = "#ffffff";

// Borders
export const COLOR_BORDER = "#6A9778";
export const COLOR_BORDER_STRONG = "#538268";

// Text
export const COLOR_TEXT = "#00240D"; // indica ink
export const COLOR_TEXT_SECONDARY = "#356B49";
export const COLOR_TEXT_TERTIARY = "#5E8770";
export const COLOR_TEXT_ON_ACCENT = "#F2F2EC"; // cream on accent fills

// Accents
export const COLOR_SPROUT = "#20722E"; // deep growth green — primary
export const COLOR_STIGMA = "#9F4A2D"; // terracotta — destructive

// Shared base for all email buttons
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
  backgroundColor: COLOR_SPROUT,
  color: COLOR_TEXT_ON_ACCENT,
  boxShadow: "0 2px 6px rgba(0,36,13,0.18)",
} as const;

export const DESTRUCTIVE_BUTTON_STYLE = {
  ...BUTTON_BASE,
  backgroundColor: COLOR_STIGMA,
  color: COLOR_TEXT_ON_ACCENT,
  boxShadow: "0 2px 6px rgba(0,36,13,0.18)",
} as const;

// Typography — Sprout email faces with web-safe fallbacks
export const FONT_BODY = '"IBM Plex Serif", Georgia, "Times New Roman", serif';
export const FONT_DISPLAY = '"Zerove", "Switzer", Helvetica, Arial, sans-serif';
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
