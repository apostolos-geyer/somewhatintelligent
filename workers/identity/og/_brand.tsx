import { LogoIcon } from "@si/ui/components/logo";
import { appConfig } from "../src/app.config";
import { APP_PRODUCT_NAME } from "../src/app-brand";

/**
 * Satori-safe mirror of `<GuestlistBrand />` + `<Logo layout="horizontal" />`.
 * Inline styles only — Satori does not resolve the app's Tailwind theme.
 * `<LogoIcon>` is now a hook-free inline SVG, so it renders in satori too.
 */
export function OgBrand({ iconSize, maxWidth = 1040 }: { iconSize: number; maxWidth?: number }) {
  const gap = iconSize * 0.12;
  // Brand names can be long — clamp the condensed wordmark so mark + gap +
  // name always fit the canvas width. 0.48em is a conservative average
  // advance for Barlow Condensed including tracking.
  const name = appConfig.brand.name;
  const fitSize = (maxWidth - iconSize - gap) / (name.length * 0.48);
  const wordmarkSize = Math.min(iconSize * 0.82, fitSize);
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
            fontFamily: "Barlow Condensed",
            fontWeight: 400,
            fontSize: wordmarkSize,
            letterSpacing: `${0.015 * wordmarkSize}px`,
            lineHeight: 0.9,
          }}
        >
          {appConfig.brand.name}
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
