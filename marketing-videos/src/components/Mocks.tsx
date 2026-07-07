import React from "react";
import { AbsoluteFill } from "remotion";
import type { Skin } from "../theme";
import { fontFamily, FONT_DISPLAY } from "../load-fonts";

const stack: React.CSSProperties = { display: "flex", flexDirection: "column" };

/** Landing screen: rotating hero + flanking banner cards + persistent AI bubble. */
export const PortalHero: React.FC<{ skin: Skin; slide?: number }> = ({ skin, slide = 0 }) => {
  const slides = [
    { tag: "NEW BATCH", title: "Garlic Breath", sub: "Indica hybrid · evening" },
    { tag: "LIVE", title: "Education Call", sub: "Genetics deep dive · 2pm ET" },
    { tag: "ENTER THE GROW", title: "Harvest Day", sub: "New batch photos + footage" },
  ];
  const s = slides[slide % slides.length];
  return (
    <AbsoluteFill style={{ background: skin.bg, fontFamily, color: skin.text }}>
      {/* hero image area */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(90% 80% at 50% 30%, ${skin.accentSoft}55 0%, ${skin.bgDeep} 70%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          ...stack,
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          padding: 40,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: 6, opacity: 0.9 }}>
          {skin.name.toUpperCase()}
        </div>
        <div style={{ fontSize: 16, letterSpacing: 4, opacity: 0.6 }}>
          BUDTENDER PORTAL · {skin.tagline.toUpperCase()}
        </div>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 64,
            fontWeight: 900,
            lineHeight: 1,
            margin: "8px 0",
            color: skin.accent,
          }}
        >
          {s.title}
        </div>
        <div style={{ fontSize: 22, opacity: 0.8 }}>{s.sub}</div>
        <div
          style={{
            marginTop: 16,
            padding: "16px 38px",
            borderRadius: 999,
            background: skin.accent,
            color: skin.bgDeep,
            fontWeight: 800,
            fontSize: 22,
            boxShadow: `0 0 40px ${skin.accent}66`,
          }}
        >
          ENTER PORTAL
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          {slides.map((_, i) => (
            <div
              key={i}
              style={{
                width: i === slide % slides.length ? 26 : 10,
                height: 8,
                borderRadius: 4,
                background: i === slide % slides.length ? skin.accent : `${skin.text}44`,
              }}
            />
          ))}
        </div>
      </div>
      {/* top-left live tag */}
      <div
        style={{
          position: "absolute",
          top: 22,
          left: 22,
          padding: "6px 14px",
          borderRadius: 8,
          background: "hsl(8,72%,52%)",
          color: "#fff",
          fontWeight: 800,
          fontSize: 15,
          letterSpacing: 1,
        }}
      >
        ● {s.tag}
      </div>
      <AIBubble accent={skin.accent} />
    </AbsoluteFill>
  );
};

/** Persistent AI assistant chat bubble, bottom-right. */
export const AIBubble: React.FC<{ accent: string }> = ({ accent }) => (
  <div
    style={{
      position: "absolute",
      bottom: 22,
      right: 22,
      width: 64,
      height: 64,
      borderRadius: "50%",
      background: accent,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: `0 0 36px ${accent}88`,
      fontSize: 30,
    }}
  >
    💬
  </div>
);

/** Six-card section grid. */
export const SectionGrid: React.FC<{ skin: Skin }> = ({ skin }) => {
  const cards = [
    { n: "01", t: "Store Assets", d: "Download + request physical", icon: "🗂️" },
    { n: "02", t: "PK Decks", d: "Flip-through product decks", icon: "📑" },
    { n: "03", t: "Quizzes", d: "Test your strain knowledge", icon: "🎯" },
    { n: "04", t: "Enter the Grow", d: "Photos + video from the facility", icon: "🌱" },
    { n: "05", t: "Group Chat", d: "Community for all budtenders", icon: "💬" },
    { n: "06", t: "Contact", d: "Restocking, events, feedback", icon: "✉️" },
  ];
  return (
    <AbsoluteFill style={{ background: skin.bg, fontFamily, color: skin.text, padding: 28 }}>
      <div style={{ fontSize: 16, letterSpacing: 4, opacity: 0.6, marginBottom: 14 }}>
        {skin.name.toUpperCase()} · SECTIONS
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, flex: 1 }}>
        {cards.map((c) => (
          <div
            key={c.n}
            style={{
              ...stack,
              justifyContent: "space-between",
              background: skin.surface,
              borderTop: `3px solid ${skin.accent}`,
              borderRadius: 16,
              padding: 20,
            }}
          >
            <div style={{ fontSize: 30 }}>{c.icon}</div>
            <div>
              <div style={{ fontSize: 14, opacity: 0.5, fontWeight: 700 }}>{c.n} / 06</div>
              <div style={{ fontSize: 26, fontWeight: 800 }}>{c.t}</div>
              <div style={{ fontSize: 17, opacity: 0.7 }}>{c.d}</div>
            </div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/** Drop Sheet: category cards + a selected product with reviews. */
export const DropSheet: React.FC<{ skin: Skin }> = ({ skin }) => {
  const cats = [
    { k: "FLOWER", n: "Garlic Breath", m: "THC 28% · ★4.3" },
    { k: "PRE-ROLL", n: "Dog Walker", m: "0.5g×10 · ★4.6" },
    { k: "INFUSED", n: "Live Resin", m: "THC 38% · ★4.1" },
    { k: "HASH", n: "Temple Ball", m: "THC 62% · ★4.8" },
  ];
  const reviews = [
    {
      a: "Alex · The Green Room",
      s: 5,
      t: "Customers come back for this one. The garlic nose sells itself.",
    },
    {
      a: "Sarah · High Times",
      s: 4,
      t: "Strong seller for the indica crowd. PK talking points helped.",
    },
    { a: "Jordan · The Joint", s: 3, t: "Great flower, but price is a hurdle for some regulars." },
  ];
  return (
    <AbsoluteFill
      style={{ background: skin.bg, fontFamily, color: skin.text, padding: 28, ...stack, gap: 16 }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 16, letterSpacing: 4, opacity: 0.6 }}>// CURRENT LINEUP</div>
        <div style={{ fontSize: 16, color: skin.accent, fontWeight: 700 }}>FULL PK →</div>
      </div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 38, fontWeight: 900 }}>The Drop Sheet</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        {cats.map((c, i) => (
          <div
            key={c.k}
            style={{
              background: skin.surface,
              borderTop: `3px solid ${skin.accent}`,
              borderRadius: 12,
              padding: 14,
              opacity: i === 0 ? 1 : 0.85,
            }}
          >
            <div style={{ fontSize: 13, letterSpacing: 1, opacity: 0.6, fontWeight: 700 }}>
              {c.k}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, margin: "6px 0 4px" }}>{c.n}</div>
            <div style={{ fontSize: 15, opacity: 0.7 }}>{c.m}</div>
          </div>
        ))}
      </div>
      {/* selected product */}
      <div
        style={{
          background: skin.surface,
          borderRadius: 16,
          padding: 20,
          ...stack,
          gap: 12,
          flex: 1,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 28, fontWeight: 900 }}>
            GARLIC BREATH
          </div>
          <div style={{ fontSize: 18, color: skin.accent, fontWeight: 700 }}>
            ★★★★☆ 4.3 · 27 reviews
          </div>
        </div>
        <div style={{ fontSize: 16, opacity: 0.75 }}>
          THC 28% · Myrcene 3.2% · Caryophyllene 2.1% · Relaxed, Euphoric · Evening use
        </div>
        <div style={{ height: 1, background: `${skin.text}22`, margin: "2px 0" }} />
        {reviews.map((r) => (
          <div key={r.a} style={{ ...stack, gap: 3 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: skin.accent }}>
              {"★".repeat(r.s) + "☆".repeat(5 - r.s)}{" "}
              <span style={{ color: skin.text, opacity: 0.85, fontWeight: 600 }}>{r.a}</span>
            </div>
            <div style={{ fontSize: 16, opacity: 0.72 }}>{r.t}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/** The Sprout Hub: Your Portals + leaderboard + Education Award. The one Sprout-branded surface. */
export const HubScreen: React.FC<{ accent: string; bg: string; surface: string; text: string }> = ({
  accent,
  bg,
  surface,
  text,
}) => {
  const board = [
    { r: "#1", n: "Alex T. · The Green Room", p: "2,840" },
    { r: "#2", n: "Sarah K. · High Times", p: "2,615" },
    { r: "#3", n: "Jordan M. · The Joint", p: "2,390" },
    { r: "#4", n: "Priya R. · Greenline", p: "2,170" },
  ];
  return (
    <AbsoluteFill
      style={{ background: bg, fontFamily, color: text, padding: 28, ...stack, gap: 16 }}
    >
      <div style={{ ...stack, alignItems: "center", gap: 2 }}>
        <div style={{ fontSize: 30, fontWeight: 900 }}>sprout</div>
        <div style={{ fontSize: 14, letterSpacing: 5, color: accent, fontWeight: 700 }}>
          LEARN GREEN, EARN GREEN
        </div>
      </div>
      <div style={{ fontSize: 15, letterSpacing: 3, opacity: 0.6 }}>YOUR PORTALS</div>
      <div style={{ display: "flex", gap: 12 }}>
        {[
          { id: "MTL", c: "hsl(96,70%,55%)" },
          { id: "DOMJ", c: "hsl(279,60%,68%)" },
          { id: "RH", c: "hsl(199,80%,60%)" },
        ].map((p) => (
          <div
            key={p.id}
            style={{
              flex: 1,
              background: surface,
              borderRadius: 14,
              padding: "16px 10px",
              textAlign: "center",
              borderBottom: `3px solid ${p.c}`,
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 900, color: p.c }}>{p.id}</div>
            <div style={{ fontSize: 13, opacity: 0.6 }}>2h ago</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 15, letterSpacing: 3, opacity: 0.6 }}>LEADERBOARD — THIS MONTH</div>
      <div style={{ background: surface, borderRadius: 14, padding: 14, ...stack, gap: 10 }}>
        {board.map((b) => (
          <div key={b.r} style={{ display: "flex", justifyContent: "space-between", fontSize: 18 }}>
            <span>
              <span style={{ color: accent, fontWeight: 800, marginRight: 10 }}>{b.r}</span>
              {b.n}
            </span>
            <span style={{ fontWeight: 800 }}>{b.p}</span>
          </div>
        ))}
        <div style={{ height: 1, background: `${text}22` }} />
        <div
          style={{ display: "flex", justifyContent: "space-between", fontSize: 17, opacity: 0.85 }}
        >
          <span>YOU — ranked #47</span>
          <span style={{ fontWeight: 800 }}>880 pts</span>
        </div>
      </div>
      <div
        style={{
          background: `linear-gradient(120deg, ${accent}22, transparent)`,
          border: `1px solid ${accent}55`,
          borderRadius: 14,
          padding: 16,
          ...stack,
          gap: 6,
        }}
      >
        <div style={{ fontSize: 16, letterSpacing: 2, color: accent, fontWeight: 800 }}>
          EDUCATION AWARD — JUNE
        </div>
        <div style={{ fontSize: 17, opacity: 0.8 }}>
          Top learner earns a professional development fund.
        </div>
        <div style={{ fontSize: 24, fontWeight: 900 }}>
          19d : 06h : 42m{" "}
          <span style={{ fontSize: 15, opacity: 0.6, fontWeight: 600 }}>REMAINING</span>
        </div>
      </div>
    </AbsoluteFill>
  );
};

/** AI assistant conversation snippet. */
export const AIConversation: React.FC<{ skin: Skin; shown?: number }> = ({ skin, shown = 99 }) => {
  const msgs = [
    { me: true, t: "Customer wants something for sleep — what do we have?" },
    {
      me: false,
      t: "Point them to Garlic Breath — 28% THC indica, myrcene-dominant (3.2%). “Deep garlic-diesel nose, evening use.”",
    },
    { me: true, t: "And where do I request tent cards?" },
    {
      me: false,
      t: "Store Assets → Tent Card → Request Physical. Want the team? I can get you a call slot → (booking only)",
    },
  ];
  return (
    <AbsoluteFill
      style={{ background: skin.bg, fontFamily, color: skin.text, padding: 26, ...stack, gap: 14 }}
    >
      <div style={{ ...stack, gap: 2 }}>
        <div style={{ fontSize: 24, fontWeight: 900 }}>{skin.name} Assistant</div>
        <div style={{ fontSize: 15, color: skin.accent }}>Trained on the {skin.id} lineup</div>
      </div>
      <div style={{ ...stack, gap: 12, flex: 1, justifyContent: "flex-end" }}>
        {msgs.slice(0, shown).map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.me ? "flex-end" : "flex-start",
              maxWidth: "82%",
              background: m.me ? skin.accent : skin.surface,
              color: m.me ? skin.bgDeep : skin.text,
              borderRadius: 18,
              borderBottomRightRadius: m.me ? 4 : 18,
              borderBottomLeftRadius: m.me ? 18 : 4,
              padding: "14px 18px",
              fontSize: 19,
              fontWeight: m.me ? 700 : 500,
              lineHeight: 1.35,
            }}
          >
            {m.t}
          </div>
        ))}
      </div>
      <div
        style={{
          background: skin.surface,
          borderRadius: 999,
          padding: "14px 20px",
          display: "flex",
          justifyContent: "space-between",
          color: `${skin.text}99`,
          fontSize: 18,
        }}
      >
        Ask about the lineup… <span style={{ color: skin.accent, fontWeight: 800 }}>ASK</span>
      </div>
    </AbsoluteFill>
  );
};
