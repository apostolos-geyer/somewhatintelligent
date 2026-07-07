import type { LogoColorScheme, LogoIconProps } from "./types";

/**
 * The Sprout brand mark — the two-leaf seedling (lucide's `sprout` path data,
 * inlined). This is the SINGLE source of the mark, used by the app AND by
 * satori/OG image generation. It is deliberately NOT the lucide `<Sprout>`
 * component: lucide icons call React hooks (useContext), which satori cannot
 * run ("Invalid hook call"), so OG rendering needs a hook-free SVG. Inlining
 * the paths keeps one definition that works in both worlds.
 *
 * Recolors by `colorScheme` with concrete hex (CSS custom properties don't
 * resolve in satori). The legacy parametric "dual-A" props are accepted for
 * API compatibility but ignored — the mark is now a single-stroke seedling.
 */
const SCHEME_STROKE: Record<LogoColorScheme, string> = {
  primary: "#C7F27D", // sprout-green (bright lime) — for dark surfaces
  light: "#3E9F32", // growth-green — for light surfaces
  "mono-cream": "#F2F2EC", // cream
  "mono-void": "#00240D", // indica
  "on-stigma": "#F2F2EC", // cream on terracotta
  "on-growth": "#F2F2EC", // cream on growth
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
      aria-label="Sprout"
      className={className}
      style={style}
      {...svgProps}
    >
      <path d="M7 20h10" />
      <path d="M10 20c5.5-2.5.8-6.4 3-10" />
      <path d="M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z" />
      <path d="M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z" />
    </svg>
  );
}
