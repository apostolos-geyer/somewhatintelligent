import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { SproutMark } from "../components/Wordmark";
import { Kicker, BigTitle, Body } from "../components/Typography";
import { PhoneFrame } from "../components/Device";
import { FONT_SANS } from "../load-fonts";
import { PortalHero, DropSheet, HubScreen } from "../components/Mocks";
import { skins, sprout, text, textSecondary, surface, bg, type Skin } from "../theme";

export const SPOTLIGHT_DURATION = 360; // 12s @ 30fps

/** Shared vertical layout: kicker + title up top, device in the middle, footer lockup. */
const VerticalScene: React.FC<{
  accent: string;
  base?: string;
  baseDeep?: string;
  kicker: string;
  title: string;
  accentWords: string[];
  body: string;
  device: React.ReactNode;
}> = ({ accent, base, baseDeep, kicker, title, accentWords, body, device }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const deviceSpring = spring({ frame: frame - 12, fps, config: { damping: 18, mass: 0.9 } });
  const footer = spring({ frame: frame - 24, fps, config: { damping: 200 } });
  // gentle float on the device for the whole clip
  const float = Math.sin(frame / 30) * 8;
  // graceful exit fade in the last 20 frames
  const outro = interpolate(frame, [durationInFrames - 18, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity: outro }}>
      <Backdrop accent={accent} base={base} baseDeep={baseDeep} />
      <AbsoluteFill style={{ alignItems: "center", padding: "120px 70px", gap: 40 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 22,
            textAlign: "center",
          }}
        >
          <Kicker delay={2} color={accent}>
            {kicker}
          </Kicker>
          <BigTitle
            delay={8}
            size={88}
            align="center"
            accentWords={accentWords}
            accentColor={accent}
          >
            {title}
          </BigTitle>
        </div>
        <div
          style={{
            transform: `translateY(${interpolate(deviceSpring, [0, 1], [80, float])}px) scale(${interpolate(deviceSpring, [0, 1], [0.9, 1])})`,
            opacity: deviceSpring,
          }}
        >
          {device}
        </div>
        <div style={{ flex: 1 }} />
        <div
          style={{
            opacity: footer,
            transform: `translateY(${interpolate(footer, [0, 1], [16, 0])}px)`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 18,
          }}
        >
          <Body delay={24} size={30} align="center" maxWidth={820} color={textSecondary}>
            {body}
          </Body>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
            <SproutMark size={44} color={sprout} delay={26} />
            <span style={{ fontFamily: FONT_SANS, fontWeight: 800, fontSize: 44, color: text }}>
              sprout
            </span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** A phone that cycles through the three brand skins (white-label proof). */
const SkinCyclePhone: React.FC = () => {
  const frame = useCurrentFrame();
  const per = 70;
  const idx = Math.floor(frame / per) % skins.length;
  const next = (idx + 1) % skins.length;
  const local = frame % per;
  const mix = interpolate(local, [per - 16, per], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const slide = Math.floor(frame / 34) % 3;
  return (
    <PhoneFrame accent={skins[idx].accent} width={560}>
      <AbsoluteFill>
        <PortalHero skin={skins[idx]} slide={slide} />
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: mix }}>
        <PortalHero skin={skins[next]} slide={slide} />
      </AbsoluteFill>
      <SkinBadge skin={skins[idx]} mix={mix} next={skins[next]} />
    </PhoneFrame>
  );
};

const SkinBadge: React.FC<{ skin: Skin; next: Skin; mix: number }> = ({ skin, next, mix }) => {
  const shown = mix < 0.5 ? skin : next;
  return (
    <div
      style={{
        position: "absolute",
        bottom: 90,
        left: "50%",
        transform: "translateX(-50%)",
        padding: "10px 22px",
        borderRadius: 999,
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(6px)",
        color: shown.accent,
        fontFamily: FONT_SANS,
        fontWeight: 800,
        fontSize: 22,
        letterSpacing: 2,
        zIndex: 30,
      }}
    >
      {shown.name.toUpperCase()}
    </div>
  );
};

export const SpotlightWhiteLabel: React.FC = () => (
  <VerticalScene
    accent={sprout}
    kicker="Every brand you sell"
    title="All your brands. One login."
    accentWords={["brands", "login"]}
    body="Every brand you carry, in one place — learn their products, talk to their team, and earn while you do it."
    device={<SkinCyclePhone />}
  />
);

export const SpotlightDropSheet: React.FC = () => (
  <VerticalScene
    accent={skins[0].accent}
    base={bg}
    baseDeep="hsl(40,16%,5%)"
    kicker="Know it before they ask"
    title="Sell it like you grew it."
    accentWords={["grew"]}
    body="Every product, every talking point, and what other budtenders really think — so you recommend with confidence and customers trust you."
    device={
      <PhoneFrame accent={skins[0].accent} width={560}>
        <DropSheet skin={skins[0]} />
      </PhoneFrame>
    }
  />
);

export const SpotlightLearnEarn: React.FC = () => (
  <VerticalScene
    accent={sprout}
    kicker="Learn Green, Earn Green"
    title="Get certified. Get rewarded."
    accentWords={["certified", "rewarded"]}
    body="Pass quizzes, earn certifications and climb the leaderboard — and the top learner each month earns a professional-development fund."
    device={
      <PhoneFrame accent={sprout} width={560}>
        <HubScreen accent={sprout} bg={bg} surface={surface} text={text} />
      </PhoneFrame>
    }
  />
);
