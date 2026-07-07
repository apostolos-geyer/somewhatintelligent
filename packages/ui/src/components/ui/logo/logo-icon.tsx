import type { LogoColorScheme, LogoIconProps } from "./types";

/**
 * The somewhatintelligent brand mark — a drafting REGISTRATION MARK:
 * a circle with four tick lines crossing its cardinal points and a plotted
 * center. The symbol printers and drafters use to line a drawing up.
 *
 * This is the SINGLE source of the mark, used by the app AND by satori/OG
 * image generation, so it must stay a hook-free SVG (no lucide components —
 * they call useContext, which satori cannot run). Inlining keeps one
 * definition that works in both worlds.
 *
 * Recolors by `colorScheme` with concrete hex (CSS custom properties don't
 * resolve in satori). The legacy parametric "dual-A" props are accepted for
 * API compatibility but ignored — the mark is a single-stroke symbol.
 */
const SCHEME_STROKE: Record<LogoColorScheme, string> = {
  primary: "#F8F7F1", // paper ink — for dark surfaces
  light: "#171613", // graphite ink — for light surfaces
  "mono-paper": "#F8F7F1", // paper
  "mono-void": "#171613", // ink
  "on-rust": "#F8F7F1", // paper on rust
  "on-success": "#F8F7F1", // paper on success
};

export function LogoIcon({
  ref,
  colorScheme = "primary",
  size = 80,
  colors,
  className,
  style,
  // ── Legacy "dual-A" props: accepted for API compat, intentionally unused so
  //    they don't spread onto the <svg> as invalid attributes. ──
  angle: _angle,
  weight: _weight,
  detail: _detail,
  weights: _weights,
  shadowRect: _shadowRect,
  mainRect: _mainRect,
  leftShaft: _leftShaft,
  rightShaft: _rightShaft,
  leftSerifCap: _leftSerifCap,
  rightSerifCap: _rightSerifCap,
  leftBracket: _leftBracket,
  rightBracket: _rightBracket,
  leftFootSerif: _leftFootSerif,
  rightFootSerif: _rightFootSerif,
  rotatedA: _rotatedA,
  innerHairline: _innerHairline,
  hCrossbar: _hCrossbar,
  vCrossbar: _vCrossbar,
  leftOuterHairline: _leftOuterHairline,
  rightOuterHairline: _rightOuterHairline,
  ...svgProps
}: LogoIconProps) {
  const stroke = colors?.stroke ?? SCHEME_STROKE[colorScheme] ?? "currentColor";
  // Mirror lucide's `absoluteStrokeWidth` (constant ~1.75px regardless of size):
  // strokeWidth is in viewBox units, so scale it by 24/size.
  const strokeWidth = (1.75 * 24) / Number(size);
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="somewhatintelligent"
      className={className}
      style={style}
      {...svgProps}
    >
      {/* Registration circle */}
      <circle cx="12" cy="12" r="6.5" />
      {/* Cardinal tick lines — crossing the circle's edge like plot marks */}
      <path d="M12 2.5v4" />
      <path d="M12 17.5v4" />
      <path d="M2.5 12h4" />
      <path d="M17.5 12h4" />
      {/* Plotted center point */}
      <circle cx="12" cy="12" r="0.9" fill={stroke} stroke="none" />
    </svg>
  );
}
