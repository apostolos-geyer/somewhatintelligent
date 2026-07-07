import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { bg, bgDeep } from "../theme";

/**
 * The shared canvas: a warm espresso radial floor with two slowly drifting
 * brand-green glows and a film-grain + vignette pass. All motion is driven by
 * `useCurrentFrame` (never CSS animation, per Remotion rules).
 */
export const Backdrop: React.FC<{
  accent?: string;
  base?: string;
  baseDeep?: string;
  intensity?: number;
}> = ({ accent = "hsl(115, 60%, 45%)", base = bg, baseDeep = bgDeep, intensity = 1 }) => {
  const frame = useCurrentFrame();
  const { width, durationInFrames } = useVideoConfig();

  // Two glows breathe and drift across the whole clip.
  const t = frame / Math.max(durationInFrames, 1);
  const driftX = interpolate(t, [0, 1], [0, 1]);
  const breath = (Math.sin(frame / 40) + 1) / 2;

  const glowA = {
    left: `${interpolate(driftX, [0, 1], [18, 32])}%`,
    top: `${interpolate(breath, [0, 1], [22, 30])}%`,
    width: width * 0.9,
    height: width * 0.9,
    background: `radial-gradient(circle, ${accent.replace(")", " / 0.22)").replace("hsl(", "hsla(")} 0%, transparent 60%)`,
    opacity: (0.55 + breath * 0.25) * intensity,
  } as const;

  const glowB = {
    right: `${interpolate(driftX, [0, 1], [10, 22])}%`,
    bottom: `${interpolate(1 - breath, [0, 1], [12, 22])}%`,
    width: width * 0.7,
    height: width * 0.7,
    background: `radial-gradient(circle, ${accent.replace(")", " / 0.16)").replace("hsl(", "hsla(")} 0%, transparent 60%)`,
    opacity: (0.4 + (1 - breath) * 0.25) * intensity,
  } as const;

  return (
    <AbsoluteFill
      style={{ background: `radial-gradient(120% 120% at 50% 18%, ${base} 0%, ${baseDeep} 100%)` }}
    >
      <div style={{ position: "absolute", borderRadius: "50%", filter: "blur(40px)", ...glowA }} />
      <div style={{ position: "absolute", borderRadius: "50%", filter: "blur(40px)", ...glowB }} />
      <Grain />
      {/* Vignette */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(120% 120% at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%)",
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
};

const Grain: React.FC = () => {
  const frame = useCurrentFrame();
  // A tiny animated SVG turbulence — re-seeded each frame so it shimmers like film grain.
  const seed = frame % 12;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='${seed}'/><feColorMatrix type='matrix' values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`;
  return (
    <AbsoluteFill
      style={{
        backgroundImage: `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`,
        backgroundSize: "180px 180px",
        opacity: 0.05,
        mixBlendMode: "overlay",
        pointerEvents: "none",
      }}
    />
  );
};
