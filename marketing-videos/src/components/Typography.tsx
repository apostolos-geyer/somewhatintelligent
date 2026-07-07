import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { text, textSecondary, sprout } from "../theme";
import { FONT_DISPLAY, FONT_SANS, FONT_MONO } from "../load-fonts";

/** A spaced, upper-case eyebrow label — matches the journey report's "// SECTION" style. */
export const Kicker: React.FC<{ children: React.ReactNode; delay?: number; color?: string }> = ({
  children,
  delay = 0,
  color = sprout,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontWeight: 700,
        fontSize: 26,
        letterSpacing: 8,
        textTransform: "uppercase",
        color,
        opacity: enter,
        transform: `translateY(${interpolate(enter, [0, 1], [12, 0])}px)`,
      }}
    >
      {children}
    </div>
  );
};

/** Big display headline with a per-word spring rise. */
export const BigTitle: React.FC<{
  children: string;
  delay?: number;
  size?: number;
  color?: string;
  accentWords?: string[];
  accentColor?: string;
  align?: "left" | "center";
}> = ({
  children,
  delay = 0,
  size = 110,
  color = text,
  accentWords = [],
  accentColor = sprout,
  align = "left",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words = children.split(" ");

  return (
    <div
      style={{
        fontFamily: FONT_DISPLAY,
        fontWeight: 900,
        fontSize: size,
        lineHeight: 1.02,
        letterSpacing: -size * 0.025,
        color,
        display: "flex",
        flexWrap: "wrap",
        gap: `0 ${size * 0.24}px`,
        justifyContent: align === "center" ? "center" : "flex-start",
        textAlign: align,
        maxWidth: "100%",
      }}
    >
      {words.map((w, i) => {
        const wf = frame - delay - i * 4;
        const s = spring({ frame: wf, fps, config: { damping: 16, mass: 0.6 } });
        const isAccent = accentWords.includes(w.replace(/[.,]/g, ""));
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              transform: `translateY(${interpolate(s, [0, 1], [size * 0.6, 0])}px)`,
              opacity: s,
              color: isAccent ? accentColor : color,
            }}
          >
            {w}
          </span>
        );
      })}
    </div>
  );
};

/** Supporting body copy that fades up. */
export const Body: React.FC<{
  children: React.ReactNode;
  delay?: number;
  size?: number;
  color?: string;
  align?: "left" | "center";
  maxWidth?: number;
}> = ({
  children,
  delay = 0,
  size = 34,
  color = textSecondary,
  align = "left",
  maxWidth = 900,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame: frame - delay, fps, config: { damping: 200 } });
  return (
    <div
      style={{
        fontFamily: FONT_SANS,
        fontWeight: 500,
        fontSize: size,
        lineHeight: 1.4,
        color,
        opacity: enter,
        transform: `translateY(${interpolate(enter, [0, 1], [16, 0])}px)`,
        textAlign: align,
        maxWidth,
      }}
    >
      {children}
    </div>
  );
};
