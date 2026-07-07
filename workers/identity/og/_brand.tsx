import { LogoIcon } from "@si/ui/components/logo";
import { platformConfig } from "@si/config";
import { APP_PRODUCT_NAME } from "../src/app-brand";

/**
 * Satori-safe mirror of `<GuestlistBrand />` + `<Logo layout="horizontal" />`.
 * Inline styles only — Satori does not resolve the app's Tailwind theme.
 * `<LogoIcon>` is now a hook-free inline SVG, so it renders in satori too.
 */
export function OgBrand({ iconSize, maxWidth = 1040 }: { iconSize: number; maxWidth?: number }) {
  const gap = iconSize * 0.12;
  // The wordmark is long ("somewhatintelligent") and Iosevka Aile is wide —
  // clamp the size so mark + gap + wordmark always fit the canvas width.
  // 0.62em is a safe average advance for Aile Light incl. tracking.
  const name = platformConfig.brand.name;
  const fitSize = (maxWidth - iconSize - gap) / (name.length * 0.62);
  const wordmarkSize = Math.min(iconSize * 0.72, fitSize);
  const subtitleSize = Math.max(7, iconSize * 0.15);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        color: "hsl(45, 8%, 8%)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap }}>
        <LogoIcon colorScheme="light" size={iconSize} />
        <span
          style={{
            fontFamily: "Iosevka Aile",
            fontWeight: 300,
            fontSize: wordmarkSize,
            letterSpacing: `${0.04 * wordmarkSize}px`,
            lineHeight: 1,
          }}
        >
          {platformConfig.brand.name}
        </span>
      </div>
      <span
        style={{
          marginTop: subtitleSize * 0.6,
          fontFamily: "Iosevka",
          fontSize: subtitleSize,
          textTransform: "uppercase",
          letterSpacing: `${0.25 * subtitleSize}px`,
          color: "hsl(35, 8%, 48%)",
        }}
      >
        {APP_PRODUCT_NAME} platform
      </span>
    </div>
  );
}
