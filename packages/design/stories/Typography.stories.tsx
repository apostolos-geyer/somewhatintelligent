import type { Meta, StoryObj } from "@storybook/react";

const meta: Meta = {
  title: "Design/Typography",
  tags: ["autodocs"],
};
export default meta;

/** Hero type moment + full Zerove weight specimens */
export const Display: StoryObj = {
  name: "Display — Zerove",
  render: () => (
    <div className="max-w-5xl space-y-12 p-8">
      <div>
        <h3 className="mb-1 type-section-label text-text-secondary">Display — Zerove</h3>
        <p className="mb-8 font-mono text-xs text-text-tertiary">
          Headlines, hero, brand · rounded unicase · USE BIG — keep it at display sizes, up to 200px
          for hero moments
        </p>
      </div>

      {/* Hero type moment */}
      <div className="border-b-4 border-border-strong pb-12">
        <div
          className="font-display leading-[0.95] tracking-[0.005em]"
          style={{ fontSize: "clamp(80px, 14vw, 200px)", fontWeight: 400 }}
        >
          sprout
        </div>
        <div
          className="font-display italic leading-[0.95] tracking-[0.005em] text-text-secondary"
          style={{ fontSize: "clamp(80px, 14vw, 200px)", fontWeight: 400 }}
        >
          green
        </div>
      </div>

      {/* Weight specimens */}
      <div className="space-y-0 overflow-hidden font-display">
        <div
          style={{
            fontSize: "clamp(60px, 10vw, 160px)",
            fontWeight: 200,
            lineHeight: 0.92,
            letterSpacing: "-0.02em",
          }}
        >
          Extralight
        </div>
        <div
          className="text-text-secondary"
          style={{
            fontSize: "clamp(60px, 10vw, 160px)",
            fontWeight: 200,
            fontStyle: "italic",
            lineHeight: 0.92,
            letterSpacing: "-0.02em",
          }}
        >
          Italic
        </div>
        <div
          style={{
            fontSize: "clamp(60px, 10vw, 160px)",
            fontWeight: 300,
            lineHeight: 0.92,
            letterSpacing: "-0.02em",
          }}
        >
          Light
        </div>
        <div
          style={{
            fontSize: "clamp(60px, 10vw, 160px)",
            fontWeight: 400,
            lineHeight: 0.92,
            letterSpacing: "-0.02em",
          }}
        >
          Regular
        </div>
        <div
          style={{
            fontSize: "clamp(48px, 8vw, 120px)",
            fontWeight: 600,
            lineHeight: 0.95,
            marginTop: 8,
          }}
        >
          Semibold
        </div>
        <div style={{ fontSize: "clamp(48px, 8vw, 120px)", fontWeight: 700, lineHeight: 0.95 }}>
          Bold
        </div>
        <div style={{ fontSize: "clamp(48px, 8vw, 120px)", fontWeight: 800, lineHeight: 0.95 }}>
          Extrabold
        </div>
      </div>

      {/* Accent lockup */}
      <div>
        <div
          className="font-display italic text-sprout"
          style={{
            fontSize: "clamp(48px, 8vw, 120px)",
            fontWeight: 400,
            lineHeight: 0.95,
            letterSpacing: "0.005em",
          }}
        >
          learn green
        </div>
        <div
          className="font-display"
          style={{
            fontSize: "clamp(48px, 8vw, 120px)",
            fontWeight: 400,
            lineHeight: 0.95,
            letterSpacing: "0.005em",
          }}
        >
          earn green
        </div>
      </div>
    </div>
  ),
  parameters: { layout: "fullscreen" },
};

/** Switzer — the default body/UI font */
export const Body: StoryObj = {
  name: "Body — Switzer",
  render: () => (
    <div className="max-w-4xl space-y-8 p-8">
      <div>
        <h3 className="mb-1 type-section-label text-text-secondary">Body — Switzer</h3>
        <p className="mb-6 font-mono text-xs text-text-tertiary">
          THE DEFAULT · UI, labels, buttons, nav, descriptions · 14–18px · weight 400–700
        </p>
      </div>

      <div className="grid grid-cols-2 gap-8">
        <div>
          <p className="mb-2 type-mono-label text-text-tertiary">16px / 400</p>
          <p className="text-base leading-relaxed text-text-secondary">
            Rooted in nature, designed for connection. Warm cream paper meets forest-green ink. A
            budtender-engagement platform for Canadian licensed producers and retailers — the design
            system is the material itself.
          </p>
        </div>
        <div>
          <p className="text-base">
            <span className="font-normal">Regular</span> ·{" "}
            <span className="font-medium">Medium</span> ·{" "}
            <span className="font-semibold">Semibold</span> ·{" "}
            <span className="font-bold">Bold</span> · <span className="italic">Italic</span>
          </p>
          <p className="mt-3 rounded bg-surface-sunken px-2 py-1 font-mono text-[11px] text-haze">
            BOLD: labels, emphasis · ITALIC: inline prose only · 600+ for buttons
          </p>
        </div>
      </div>

      {/* Size ramp */}
      <div className="space-y-3 border-t border-border pt-8">
        <p className="mb-4 type-mono-label text-text-tertiary">Size ramp</p>
        {[12, 14, 16, 18, 20].map((size) => (
          <div key={size} className="flex items-baseline gap-4">
            <span className="w-12 shrink-0 font-mono text-xs text-text-tertiary">{size}px</span>
            <p style={{ fontSize: size }}>The quick brown fox jumps over the lazy dog</p>
          </div>
        ))}
      </div>

      {/* Weight ramp */}
      <div className="space-y-3 border-t border-border pt-8">
        <p className="mb-4 type-mono-label text-text-tertiary">Weight ramp</p>
        {[
          { weight: 300, label: "Light" },
          { weight: 400, label: "Regular" },
          { weight: 500, label: "Medium" },
          { weight: 600, label: "SemiBold" },
          { weight: 700, label: "Bold" },
        ].map(({ weight, label }) => (
          <div key={weight} className="flex items-baseline gap-4">
            <span className="w-12 shrink-0 font-mono text-xs text-text-tertiary">{weight}</span>
            <p className="text-lg" style={{ fontWeight: weight }}>
              {label} — The quick brown fox jumps over the lazy dog
            </p>
          </div>
        ))}
      </div>
    </div>
  ),
  parameters: { layout: "fullscreen" },
};

/** IBM Plex Serif — editorial serif for long-form prose */
export const Editorial: StoryObj = {
  name: "Editorial — IBM Plex Serif",
  render: () => (
    <div className="max-w-4xl space-y-8 p-8">
      <div>
        <h3 className="mb-1 type-section-label text-text-secondary">Editorial — IBM Plex Serif</h3>
        <p className="mb-6 font-mono text-xs text-text-tertiary">
          Long-form prose, articles, pull quotes · 18–22px · light weight
        </p>
      </div>

      <div className="grid grid-cols-2 gap-8">
        <div>
          <p className="mb-2 type-mono-label text-text-tertiary">18px / 300 — Article body</p>
          <p className="font-editorial text-lg leading-[1.75] text-text-secondary">
            Soft structure with organic warmth — gentle elevation and friendly corners, warm cream
            surfaces and forest-green ink. The material speaks of growth.
          </p>
        </div>
        <div>
          <p className="mb-2 type-mono-label text-text-tertiary">24px / 300 italic — Pull quote</p>
          <p className="font-editorial-display text-2xl font-light italic leading-snug text-sprout">
            "Rooted in nature. Designed for connection. Learn green, earn green."
          </p>
        </div>
      </div>

      {/* Paragraph specimen */}
      <div className="border-t border-border pt-8">
        <p className="mb-2 type-mono-label text-text-tertiary">Paragraph specimen</p>
        <div className="max-w-2xl font-editorial text-lg leading-[1.75]">
          <p className="mb-6">
            There is a particular quality to things built with intention. Not the frantic minimalism
            of startups that strip everything away until nothing remains, but the measured restraint
            of a craftsman who knows exactly which details matter.
          </p>
          <p>
            Digital interfaces deserve the same consideration. Every border weight, every shadow
            offset, every typeface pairing is a choice that communicates something. The question is
            whether you're making that choice <em>deliberately</em> or by default.
          </p>
        </div>
      </div>
    </div>
  ),
  parameters: { layout: "fullscreen" },
};

/** Iosevka — monospace for code, data, timestamps */
export const Mono: StoryObj = {
  name: "Mono — Iosevka",
  render: () => (
    <div className="max-w-4xl space-y-8 p-8">
      <div>
        <h3 className="mb-1 type-section-label text-text-secondary">Mono — Iosevka</h3>
        <p className="mb-6 font-mono text-xs text-text-tertiary">
          Code, data, timestamps, IDs, paths, keys
        </p>
      </div>

      {/* Code block */}
      <div className="overflow-x-auto rounded border-2 border-border bg-surface-sunken p-5 font-mono text-sm leading-relaxed">
        <span className="text-haze">const</span> palette = {"{"} bg:{" "}
        <span className="text-sprout">"cream"</span>,{" "}
        <span className="text-text-tertiary">{"// hsl(60 23% 94%)"}</span> text:{" "}
        <span className="text-sprout">"indica"</span>,{" "}
        <span className="text-text-tertiary">{"// hsl(143 100% 7%)"}</span> sprout:{" "}
        <span className="text-sprout">"#C7F27D"</span>,{" "}
        <span className="text-text-tertiary">{"// brand green"}</span> {"}"};
      </div>

      {/* Weight ramp */}
      <div className="space-y-3 border-t border-border pt-8">
        <p className="mb-4 type-mono-label text-text-tertiary">Weight ramp</p>
        {[
          { weight: 300, label: "Light" },
          { weight: 400, label: "Regular" },
          { weight: 700, label: "Bold" },
        ].map(({ weight, label }) => (
          <div key={weight} className="flex items-baseline gap-4">
            <span className="w-12 shrink-0 font-mono text-xs text-text-tertiary">{weight}</span>
            <p className="font-mono text-base" style={{ fontWeight: weight }}>
              {label} — 0123456789 ABCDEF abcdef {"{}[]();<>"}
            </p>
          </div>
        ))}
      </div>

      {/* Data specimen */}
      <div className="border-t border-border pt-8">
        <p className="mb-4 type-mono-label text-text-tertiary">Data specimen</p>
        <div className="space-y-1 font-mono text-sm text-text-secondary">
          <p>
            user_id: <span className="text-sprout">usr_01HZ3KPXV7BNWQ</span>
          </p>
          <p>
            session: <span className="text-sprout">sess_9f4a2c8b-e1d7</span>
          </p>
          <p>
            created: <span className="text-text-tertiary">2026-04-05T14:32:00Z</span>
          </p>
          <p>
            path: <span className="text-text-tertiary">/api/v1/oauth/authorize</span>
          </p>
        </div>
      </div>
    </div>
  ),
  parameters: { layout: "fullscreen" },
};

/** prose-platform utility — editorial content styling */
export const ProsePlatform: StoryObj = {
  name: "prose-platform",
  render: () => (
    <div className="max-w-3xl p-8">
      <div className="mb-8">
        <h3 className="mb-1 type-section-label text-text-secondary">prose-platform</h3>
        <p className="font-mono text-xs text-text-tertiary">
          Editorial prose styling for long-form content
        </p>
      </div>

      <div className="prose prose-platform max-w-none">
        <h1>Rooted in Nature</h1>
        <p>
          On warm cream paper, the brand grows — fresh sprout-green shoots against forest-green ink.
          Every mark is an invitation to connect, set with intention, designed for the people who
          work the counter.
        </p>
        <h2>Learn Green, Earn Green</h2>
        <p>
          Sprout pairs <strong>budtender education</strong> with <a href="#">real rewards</a> for
          Canadian licensed producers and retailers. The result is a platform that feels as natural
          as the plant it celebrates — proudly made in Canada.
        </p>
        <blockquote>
          The best interfaces feel like a forest at dusk: calm, warm, and alive with quiet growth.
        </blockquote>
        <h2>Where Structure Meets Softness</h2>
        <p>
          Gentle elevation taught us something important: warmth invites people in. The most
          beautiful things happen when soft structure meets organic growth — when a friendly,
          rounded headline sits above prose that breathes and flows like natural speech.
        </p>
        <h3>Code Fragment</h3>
        <pre>
          <code>{`const palette = {
  sprout: "hsl(80 81% 72%)",
  stigma: "hsl(17 54% 47%)",
  cream: "hsl(60 23% 94%)",
};`}</code>
        </pre>
        <p>
          When you walk past a garden catching the afternoon sun, you don't think about the soil it
          grew in. You feel the warmth. That's what good design does — it disappears into the
          experience, leaving only the feeling behind.
        </p>
      </div>
    </div>
  ),
  parameters: { layout: "fullscreen" },
};
