/**
 * Sprout marketing — content sections (Positioning, Why, Platform, Steps).
 *
 * Ported pixel-for-pixel from the prototype (sections-a.jsx / sections-b.jsx,
 * styled by site.css) onto our design system: Tailwind utilities backed by
 * @greenroom/design tokens, the shared SectionHead / phone screens, and the
 * @greenroom/ui Badge + Card primitives. No raw hex — every colour is a token
 * (Tailwind utility or `var(--color-*)` for gradient/text-stroke cases).
 */
import { Badge } from "@greenroom/ui/components/badge";

import { SectionHead } from "./section-head";
import { ScreenCommunity, ScreenLearn, ScreenLive, ScreenRanks } from "./screens";
import {
  CheckCircle2,
  GraduationCap,
  Gift,
  Megaphone,
  MessagesSquare,
  Radio,
  Trophy,
  Users,
  type LucideIcon,
} from "./icons";

/* ───────────────────────── Positioning quote ─────────────────────────
 * Light cream section with a light-branches texture wash. Centered narrow
 * column: eyebrow, a big editorial pull-quote (Plex Serif Light) with growth
 * <em> spans, and a small uppercase caption beneath. Mirrors `.quote-section`
 * / `.bigquote` in site.css.
 */
export function Positioning() {
  return (
    <section className="relative overflow-hidden bg-bg px-[4vw] py-[clamp(64px,9vw,130px)]">
      {/* light-branches texture layer (.quote-branches — opacity .5) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-50"
        style={{ backgroundImage: "var(--texture-light-branches)" }}
      />
      <div className="relative z-[2] mx-auto w-[min(840px,92vw)] text-center">
        <span className="inline-flex items-center gap-2 font-body text-[11px] font-semibold uppercase leading-tight tracking-[0.16em] text-growth">
          <span className="size-1.5 rounded-full bg-current" />
          What is Sprout
        </span>
        <p className="mt-6 text-balance font-editorial text-[clamp(26px,3.6vw,46px)] font-light leading-[1.32] text-text">
          A place where brands control their own{" "}
          <em className="italic text-growth">narrative, education and engagement</em> — a space
          where budtenders build informed connections with brands directly.
        </p>
        <p className="mt-[22px] text-xs uppercase tracking-[0.14em] text-text-tertiary">
          The idea behind Sprout
        </p>
      </div>
    </section>
  );
}

/* ───────────────────────── Why (3 soft cards) ─────────────────────────
 * Light paper section. Centered SectionHead + a 3-col grid of soft cards,
 * each with a rounded-md success-bg/growth icon tile, an h4 (Switzer) title,
 * and an editorial (Plex Serif) body.
 */
const WHY: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: Megaphone,
    title: "Brand-controlled",
    body: "You shape the lessons, the story and the campaigns — not an algorithm.",
  },
  {
    Icon: Users,
    title: "Direct connection",
    body: "Reach the budtenders selling your products, in one shared space.",
  },
  {
    Icon: Gift,
    title: "Rewarded engagement",
    body: "Points, rewards and friendly competition keep people coming back.",
  },
];

export function Why() {
  return (
    <section id="why" className="bg-paper-50 px-[4vw] py-[clamp(64px,9vw,130px)]">
      <div className="mx-auto w-[min(1180px,92vw)]">
        <SectionHead
          kicker="Why Sprout"
          title="Budtenders are where the sale happens"
          lede="In Canada, brands can't advertise cannabis directly to consumers — but the budtender behind the counter answers the real questions every day. Sprout is being built to help licensed producers reach, educate and reward those budtenders, within the rules."
        />

        <div className="mt-[clamp(40px,5vw,56px)] grid gap-7 md:grid-cols-3">
          {WHY.map(({ Icon, title, body }) => (
            <div
              key={title}
              className="rounded-xl border border-border bg-surface p-[clamp(26px,3vw,36px)] shadow-sm"
            >
              <span className="grid size-[50px] place-items-center rounded-md bg-success-bg text-growth">
                <Icon size={25} />
              </span>
              <h4 className="mt-[18px] font-body text-xl font-semibold leading-tight text-text">
                {title}
              </h4>
              <p className="mt-2.5 font-editorial text-base leading-relaxed text-text-secondary">
                {body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Platform (feature rows) ─────────────────────────
 * Light cream section. Centered SectionHead, then four alternating feature
 * rows. Each row pairs a phone-backdrop (dark indica + dark-arcs texture, OR a
 * forest-100 → sativa-green gradient) holding the matching app screen, with a
 * copy column: a soft uppercase pill, an h2-size heading (Switzer), an
 * editorial paragraph, and a CheckCircle2 feature list.
 */
type Feature = {
  badge: string;
  Icon: LucideIcon;
  Screen: () => React.ReactElement;
  backdrop: "dark" | "green";
  reverse: boolean;
  anchor?: string;
  h: string;
  p: string;
  list: string[];
};

const FEATURES: Feature[] = [
  {
    badge: "Community",
    Icon: MessagesSquare,
    Screen: ScreenCommunity,
    backdrop: "dark",
    reverse: false,
    anchor: "community",
    h: "Brands and budtenders, in one room",
    p: "The heart of Sprout. We're building branded channels where licensed producers and the budtenders selling their products can talk directly — ask questions, share what's working, and build a real relationship.",
    list: [
      "Brand-hosted channels and communities",
      "Budtenders ask questions, brands answer",
      "A direct line that doesn't exist today",
    ],
  },
  {
    badge: "Learning",
    Icon: GraduationCap,
    Screen: ScreenLearn,
    backdrop: "green",
    reverse: true,
    h: "Learn the products you sell",
    p: "Bite-sized lessons and quizzes on strains, terpenes, formats and compliance — written by the brand. The plan is for budtenders to actually understand what's behind the counter, so they can recommend it with confidence.",
    list: [
      "Short lessons and knowledge-check quizzes",
      "Strain, terpene and compliance modules",
      "Brand stories told first-hand",
    ],
  },
  {
    badge: "Rewards",
    Icon: Trophy,
    Screen: ScreenRanks,
    backdrop: "green",
    reverse: false,
    h: "Make learning worth it",
    p: "Points, streaks, store leaderboards and giveaways. We're designing Sprout's rewards so engagement is fun and a little competitive — and so budtenders earn something real for showing what they know.",
    list: [
      "Points, streaks and store leaderboards",
      "Giveaways and sales-driven competitions",
      "Rewards budtenders actually want",
    ],
  },
  {
    badge: "Live & media",
    Icon: Radio,
    Screen: ScreenLive,
    backdrop: "dark",
    reverse: true,
    h: "Go live, tell your story",
    p: "A live-streaming and media space is on the roadmap — grow-room tours, new-drop walkthroughs and Q&As with the people who make the product, plus a library of replays budtenders can watch any time.",
    list: [
      "Live streams and grower Q&As",
      "On-demand video and media library",
      "Bring the brand to life beyond text",
    ],
  },
];

export function Platform() {
  return (
    <section id="platform" className="bg-bg px-[4vw] py-[clamp(64px,9vw,130px)]">
      <div className="mx-auto w-[min(1180px,92vw)]">
        <SectionHead
          kicker="The platform"
          title="Everything we're building, in one platform"
          lede="Four pieces, one goal: keep budtenders learning, connected and rewarded — and keep your brand in the conversation."
        />

        {FEATURES.map((f) => {
          const { Icon, Screen } = f;
          return (
            <div
              key={f.badge}
              id={f.anchor}
              className="mt-[clamp(48px,7vw,96px)] grid items-center gap-[clamp(36px,6vw,90px)] md:grid-cols-2"
            >
              {/* media */}
              <div className={`grid place-items-center ${f.reverse ? "md:order-2" : ""}`}>
                <div
                  className="relative grid w-full place-items-center overflow-hidden rounded-xl p-[clamp(28px,4vw,52px)]"
                  style={
                    f.backdrop === "green"
                      ? {
                          background:
                            "linear-gradient(150deg, var(--color-forest-100), var(--color-sativa-green))",
                        }
                      : { background: "var(--color-indica-green)" }
                  }
                >
                  {/* dark-arcs texture wash on dark backdrops (.phone-backdrop.dark::after) */}
                  {f.backdrop === "dark" ? (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 bg-cover opacity-50"
                      style={{ backgroundImage: "var(--texture-dark-arcs)" }}
                    />
                  ) : null}
                  <div className="relative z-[2]">
                    <Screen />
                  </div>
                </div>
              </div>

              {/* copy */}
              <div className={f.reverse ? "md:order-1" : ""}>
                <Badge variant="soft" size="default" className="tracking-[0.04em]">
                  <Icon size={15} />
                  {f.badge}
                </Badge>
                <h3 className="mt-[18px] font-body text-3xl font-semibold leading-[1.1] tracking-[-0.01em] text-text sm:text-4xl">
                  {f.h}
                </h3>
                <p className="mt-3.5 max-w-[44ch] font-editorial text-lg leading-relaxed text-text-secondary">
                  {f.p}
                </p>
                <ul className="mt-[22px] grid gap-3">
                  {f.list.map((li) => (
                    <li key={li} className="flex items-start gap-[11px] text-text">
                      <CheckCircle2 className="mt-px size-[19px] shrink-0 text-growth" />
                      {li}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ───────────────────────── Steps (how it works) ─────────────────────────
 * Light cream section. Centered SectionHead, then a 3-col grid of numbered
 * steps. Each number is a big Zerove (font-display) digit in bright sprout-lime
 * with a growth-green text outline — exactly the prototype's `.step .num`.
 */
const STEPS: [string, string][] = [
  [
    "Join the early-access list",
    "Tell us whether you're an LP, a retailer or a budtender, and we'll keep you posted as we build.",
  ],
  [
    "We onboard your brand or store",
    "When Sprout opens, we'll help set up your channels, lessons and rewards.",
  ],
  [
    "Budtenders learn, connect & earn",
    "Your team starts learning, talking to brands, and earning rewards — and you stay in the conversation.",
  ],
];

export function Steps() {
  return (
    <section id="how" className="bg-bg px-[4vw] py-[clamp(64px,9vw,130px)]">
      <div className="mx-auto w-[min(1180px,92vw)]">
        <SectionHead
          kicker="How it works"
          title="Here's how Sprout will work"
          lede="We're not live yet — but here's the plan once early access opens."
        />
        <div className="mt-[clamp(40px,5vw,64px)] grid gap-6 md:grid-cols-3">
          {STEPS.map(([title, body], i) => (
            <div key={title} className="relative pt-5">
              <div
                className="font-display text-[56px] leading-none text-sprout-green"
                style={{
                  WebkitTextStroke: "1.5px var(--color-growth-green)",
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </div>
              <h4 className="mt-3.5 font-body text-xl font-semibold leading-tight text-text">
                {title}
              </h4>
              <p className="mt-2.5 font-editorial text-base leading-relaxed text-text-secondary">
                {body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
