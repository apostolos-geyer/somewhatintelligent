/**
 * Build-time version stamp, rendered subtly in the storefront footer. The
 * values are inlined by vite.config.ts `define` (from package.json version +
 * `git rev-parse --short HEAD`) with safe fallbacks when git/pkg is
 * unavailable. Mirrors inbox/vite.config.ts's pattern.
 */
export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
export const APP_COMMIT: string = typeof __APP_COMMIT__ === "string" ? __APP_COMMIT__ : "unknown";

/** e.g. "v0.1.0 · a1b2c3d" — the footer build annotation. */
export const VERSION_LABEL = `v${APP_VERSION} · ${APP_COMMIT}`;
