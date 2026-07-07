import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { Backdrop } from "../components/Backdrop";
import { Wordmark } from "../components/Wordmark";
import { Kicker, BigTitle, Body } from "../components/Typography";
import { BrowserFrame } from "../components/Device";
import { PortalHero, SectionGrid, DropSheet, HubScreen, AIConversation } from "../components/Mocks";
import { skins, sprout, text, surface, bg } from "../theme";

const T = 15; // transition length

const sceneDurations = [120, 170, 150, 140, 150, 160, 150] as const;
export const OVERVIEW_DURATION =
  sceneDurations.reduce((a, b) => a + b, 0) - (sceneDurations.length - 1) * T;

const Center: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", padding: 120 }}>
    {children}
  </AbsoluteFill>
);

const Split: React.FC<{ left: React.ReactNode; right: React.ReactNode }> = ({ left, right }) => (
  <AbsoluteFill
    style={{
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 120px",
      gap: 80,
    }}
  >
    <div style={{ flex: "0 0 46%", display: "flex", flexDirection: "column", gap: 28 }}>{left}</div>
    <div style={{ flex: "0 0 48%", display: "flex", justifyContent: "center" }}>{right}</div>
  </AbsoluteFill>
);

/** A device that drifts up + scales in on entrance. */
const DeviceReveal: React.FC<{ children: React.ReactNode; delay?: number }> = ({
  children,
  delay = 8,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 18, mass: 0.9 } });
  return (
    <div
      style={{
        transform: `translateY(${interpolate(s, [0, 1], [60, 0])}px) scale(${interpolate(s, [0, 1], [0.92, 1])})`,
        opacity: s,
      }}
    >
      {children}
    </div>
  );
};

// ── Scene 1: intro wordmark ──
const SceneIntro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tag = spring({ frame: frame - 40, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill>
      <Backdrop />
      <Center>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 26 }}>
          <Wordmark size={150} delay={6} />
          <div
            style={{
              opacity: tag,
              transform: `translateY(${interpolate(tag, [0, 1], [16, 0])}px)`,
              fontWeight: 700,
              fontSize: 30,
              letterSpacing: 3,
              color: sprout,
              textAlign: "center",
            }}
          >
            Turn budtenders into your brand experts.
          </div>
        </div>
      </Center>
    </AbsoluteFill>
  );
};

// ── Scene 2: your own branded portal (the morphing portal) ──
const SkinMorphBrowser: React.FC = () => {
  const frame = useCurrentFrame();
  // hold each skin ~36 frames, crossfade 12
  const per = 44;
  const idx = Math.floor(frame / per) % skins.length;
  const next = (idx + 1) % skins.length;
  const local = frame % per;
  const mix = interpolate(local, [per - 12, per], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const slide = Math.floor(frame / 30) % 3;
  return (
    <BrowserFrame
      host={`${skins[idx].id.toLowerCase()}.sproutportal.ca`}
      accent={skins[idx].accent}
      width={1040}
      height={620}
    >
      <AbsoluteFill>
        <PortalHero skin={skins[idx]} slide={slide} />
      </AbsoluteFill>
      <AbsoluteFill style={{ opacity: mix }}>
        <PortalHero skin={skins[next]} slide={slide} />
      </AbsoluteFill>
    </BrowserFrame>
  );
};

const SceneOneEngine: React.FC = () => (
  <AbsoluteFill>
    <Backdrop />
    <Split
      left={
        <>
          <Kicker delay={4}>A portal that's 100% yours</Kicker>
          <BigTitle delay={10} size={80} accentWords={["brand"]}>
            Your brand, in every budtender's hands.
          </BigTitle>
          <Body delay={34} size={31}>
            Give the staff who sell you a branded home to learn, engage and keep coming back to —
            your logo, your products, your voice. Not a marketplace. Not an app store. Yours.
          </Body>
        </>
      }
      right={
        <DeviceReveal>
          <SkinMorphBrowser />
        </DeviceReveal>
      }
    />
  </AbsoluteFill>
);

// ── Scene 3: one page, every section ──
const SceneSections: React.FC = () => (
  <AbsoluteFill>
    <Backdrop />
    <Split
      left={
        <>
          <Kicker delay={4}>Own the whole relationship</Kicker>
          <BigTitle delay={10} size={84} accentWords={["you", "them"]}>
            Everything between you and them, in one place.
          </BigTitle>
          <Body delay={36} size={30}>
            Products, decks, media, chat and support — the entire relationship with your retail
            floor lives in your portal. You keep the connection, and the data, instead of a third
            party.
          </Body>
        </>
      }
      right={
        <DeviceReveal>
          <BrowserFrame
            host="mtl.sproutportal.ca"
            accent={skins[0].accent}
            width={1040}
            height={620}
          >
            <SectionGrid skin={skins[0]} />
          </BrowserFrame>
        </DeviceReveal>
      }
    />
  </AbsoluteFill>
);

// ── Scene 4: the drop sheet ──
const SceneDropSheet: React.FC = () => (
  <AbsoluteFill>
    <Backdrop accent={skins[2].accent} base={skins[2].bg} baseDeep={skins[2].bgDeep} />
    <Split
      left={
        <>
          <Kicker delay={4} color={skins[2].accent}>
            From shelf to sell-through
          </Kicker>
          <BigTitle delay={10} size={80} accentWords={["sell"]} accentColor={skins[2].accent}>
            Give them the talking points that sell it.
          </BigTitle>
          <Body delay={36} size={30}>
            Launch every drop and limited release with the strain detail and talking points
            budtenders need to recommend it — and let real reviews from the floor build the
            confidence to sell.
          </Body>
        </>
      }
      right={
        <DeviceReveal>
          <BrowserFrame
            host="litelabel.sproutportal.ca"
            accent={skins[2].accent}
            width={1040}
            height={620}
          >
            <DropSheet skin={skins[2]} />
          </BrowserFrame>
        </DeviceReveal>
      }
    />
  </AbsoluteFill>
);

// ── Scene 5: AI assistant ──
const SceneAI: React.FC = () => {
  const frame = useCurrentFrame();
  const shown = Math.min(4, 1 + Math.floor(frame / 26));
  return (
    <AbsoluteFill>
      <Backdrop accent={skins[1].accent} base={skins[1].bg} baseDeep={skins[1].bgDeep} />
      <Split
        left={
          <>
            <Kicker delay={4} color={skins[1].accent}>
              An expert on every shift
            </Kicker>
            <BigTitle
              delay={10}
              size={84}
              accentWords={["instantly"]}
              accentColor={skins[1].accent}
            >
              Answer every floor question, instantly.
            </BigTitle>
            <Body delay={36} size={30}>
              An assistant trained on your products helps budtenders recommend with confidence in
              the moment — and shows you exactly what customers are asking out on the floor.
            </Body>
          </>
        }
        right={
          <DeviceReveal>
            <BrowserFrame
              host="domjackson.sproutportal.ca"
              accent={skins[1].accent}
              width={860}
              height={620}
            >
              <AIConversation skin={skins[1]} shown={shown} />
            </BrowserFrame>
          </DeviceReveal>
        }
      />
    </AbsoluteFill>
  );
};

// ── Scene 6: the Hub + Education Award ──
const SceneHub: React.FC = () => (
  <AbsoluteFill>
    <Backdrop />
    <Split
      left={
        <>
          <Kicker delay={4}>Keep them coming back</Kicker>
          <BigTitle delay={10} size={88} accentWords={["Reward"]}>
            Reward learning, the compliant way.
          </BigTitle>
          <Body delay={36} size={30}>
            The monthly Education Award funds budtenders' professional development — a compliant way
            to keep the staff who know you best engaged, month after month. Learn Green, Earn Green.
          </Body>
        </>
      }
      right={
        <DeviceReveal>
          <BrowserFrame host="hub.sproutportal.ca" accent={sprout} width={760} height={640}>
            <HubScreen accent={sprout} bg={bg} surface={surface} text={text} />
          </BrowserFrame>
        </DeviceReveal>
      }
    />
  </AbsoluteFill>
);

// ── Scene 7: closing ──
const SceneClose: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const line = spring({ frame: frame - 34, fps, config: { damping: 200 } });
  const credit = spring({ frame: frame - 60, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill>
      <Backdrop intensity={1.2} />
      <Center>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 30 }}>
          <Wordmark size={150} delay={4} />
          <div
            style={{
              opacity: line,
              transform: `translateY(${interpolate(line, [0, 1], [16, 0])}px)`,
              fontSize: 34,
              letterSpacing: 1,
              color: text,
              fontWeight: 700,
              textAlign: "center",
            }}
          >
            Turn budtenders into your best advocates.
          </div>
          <div
            style={{
              opacity: credit,
              fontSize: 24,
              letterSpacing: 6,
              color: sprout,
              fontWeight: 700,
              marginTop: 12,
            }}
          >
            LEARN GREEN, EARN GREEN
          </div>
        </div>
      </Center>
    </AbsoluteFill>
  );
};

export const SproutOverview: React.FC = () => {
  const scenes = [
    SceneIntro,
    SceneOneEngine,
    SceneSections,
    SceneDropSheet,
    SceneAI,
    SceneHub,
    SceneClose,
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: bg }}>
      <TransitionSeries>
        {scenes.map((S, i) => (
          <React.Fragment key={i}>
            <TransitionSeries.Sequence durationInFrames={sceneDurations[i]}>
              <S />
            </TransitionSeries.Sequence>
            {i < scenes.length - 1 ? (
              <TransitionSeries.Transition
                presentation={i % 2 === 0 ? fade() : slide({ direction: "from-right" })}
                timing={linearTiming({ durationInFrames: T })}
              />
            ) : null}
          </React.Fragment>
        ))}
      </TransitionSeries>
    </AbsoluteFill>
  );
};
