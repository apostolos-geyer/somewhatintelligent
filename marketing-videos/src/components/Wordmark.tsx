import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { text, sprout } from "../theme";
import { FONT_SANS } from "../load-fonts";

/** The Sprout sprouting-seedling glyph — two leaves off a stem. */
export const SproutMark: React.FC<{ size?: number; color?: string; delay?: number }> = ({
  size = 84,
  color = sprout,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const grow = spring({ frame: frame - delay, fps, config: { damping: 14, mass: 0.7 } });
  const sway = Math.sin((frame - delay) / 24) * 3;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ transform: `rotate(${sway}deg)`, transformOrigin: "50% 90%", overflow: "visible" }}
    >
      {/* stem */}
      <path
        d="M50 92 L50 50"
        stroke={color}
        strokeWidth={7}
        strokeLinecap="round"
        fill="none"
        style={{ transform: `scaleY(${grow})`, transformOrigin: "50% 92px" }}
      />
      {/* left leaf */}
      <path
        d="M50 58 C30 58 18 44 18 30 C36 30 50 42 50 58 Z"
        fill={color}
        style={{
          transform: `scale(${interpolate(grow, [0, 1], [0, 1])})`,
          transformOrigin: "50px 50px",
          opacity: grow,
        }}
      />
      {/* right leaf */}
      <path
        d="M50 50 C70 50 82 36 82 22 C64 22 50 34 50 50 Z"
        fill={color}
        style={{
          transform: `scale(${interpolate(grow, [0, 1], [0, 1])})`,
          transformOrigin: "50px 46px",
          opacity: interpolate(grow, [0.2, 1], [0, 1], { extrapolateLeft: "clamp" }),
        }}
      />
    </svg>
  );
};

/** Animated lockup: the seedling glyph + the "sprout" wordmark. */
export const Wordmark: React.FC<{
  size?: number;
  delay?: number;
  color?: string;
  accent?: string;
}> = ({ size = 84, delay = 0, color = text, accent = sprout }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - delay - 6, fps, config: { damping: 18 } });
  const x = interpolate(enter, [0, 1], [-20, 0]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.18 }}>
      <SproutMark size={size} color={accent} delay={delay} />
      <span
        style={{
          fontFamily: FONT_SANS,
          fontWeight: 800,
          fontSize: size,
          letterSpacing: -size * 0.03,
          color,
          opacity: enter,
          transform: `translateX(${x}px)`,
        }}
      >
        sprout
      </span>
    </div>
  );
};
