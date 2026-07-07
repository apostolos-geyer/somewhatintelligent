import { useState } from "react";

import { buttonVariants } from "@greenroom/ui/components/button";
import { cn } from "@greenroom/ui/lib/utils";

import { SectionHead } from "./section-head";
import {
  ArrowRight,
  BarChart3,
  Building2,
  Gift,
  GraduationCap,
  Megaphone,
  MessagesSquare,
  Sprout,
  Store,
  Trophy,
  type LucideIcon,
} from "./icons";
import { ScreenHome, ScreenLive, ScreenRanks } from "./screens";

/**
 * "Built for both sides of the counter" — the tabbed audience switcher.
 *
 * Faithful re-port of the prototype's `AUDIENCES` / `AudiencePanelBody` /
 * `Audiences` (sections-b.jsx) onto our design system. Light section
 * (`bg-forest-50`) with a centred `SectionHead`, a pill tab group, and an
 * animated two-column surface card: copy + CTA on the left, a phone-backdrop
 * wrapping the matching app screen on the right.
 */

type AudienceKey = "lp" | "retail" | "budtender";
type ScreenKey = "live" | "ranks" | "home";

type Audience = {
  tab: string;
  TabIcon: LucideIcon;
  eyebrow: string;
  screen: ScreenKey;
  h: string;
  lede: string;
  points: [LucideIcon, string, string][];
  ctaPrimary: string;
};

const AUDIENCES: Record<AudienceKey, Audience> = {
  lp: {
    tab: "Licensed Producers",
    TabIcon: Building2,
    eyebrow: "For Canadian LPs",
    screen: "live",
    h: "Own your brand's story at retail",
    lede: "Reach the budtenders selling your products without breaking ad rules — through education, community and live content you control.",
    points: [
      [
        Megaphone,
        "Tell your story directly",
        "Branded channels, lessons and live streams — your narrative, your voice.",
      ],
      [
        GraduationCap,
        "Turn budtenders into advocates",
        "Teach the people on the floor what makes your strains different.",
      ],
      [
        BarChart3,
        "Drive sell-through",
        "Giveaways and competitions designed to reward the sales that matter.",
      ],
    ],
    ctaPrimary: "I'm a licensed producer",
  },
  retail: {
    tab: "Retailers",
    TabIcon: Store,
    eyebrow: "For dispensaries",
    screen: "ranks",
    h: "A more engaged, knowledgeable team",
    lede: "Give your budtenders one place to learn the products on your shelves, connect with brands, and earn rewards for getting better at their job.",
    points: [
      [
        GraduationCap,
        "Better-trained staff",
        "Product knowledge across every brand you carry, in one platform.",
      ],
      [
        Trophy,
        "Friendly competition",
        "Store leaderboards and streaks that keep your team motivated.",
      ],
      [Gift, "Perks at no cost to you", "Brands fund the rewards — your team reaps the benefits."],
    ],
    ctaPrimary: "I'm a retailer",
  },
  budtender: {
    tab: "Budtenders",
    TabIcon: Sprout,
    eyebrow: "For budtenders",
    screen: "home",
    h: "Learn green, earn green",
    lede: "Level up on the products you sell, talk to the brands behind them, and get rewarded for what you know.",
    points: [
      [
        GraduationCap,
        "Know your stuff",
        "Quick lessons and quizzes that make you the expert on the floor.",
      ],
      [
        MessagesSquare,
        "Talk to the brands",
        "Ask the makers your questions — and get real answers.",
      ],
      [Gift, "Earn real rewards", "Points, streaks and giveaways for staying sharp."],
    ],
    ctaPrimary: "Ask your store about Sprout",
  },
};

// LPs-first order — matches the prototype's default `lead`.
const ORDER: AudienceKey[] = ["lp", "retail", "budtender"];

/** Picks the matching app screen for an audience. */
function AudScreen({ name }: { name: ScreenKey }) {
  if (name === "live") return <ScreenLive />;
  if (name === "ranks") return <ScreenRanks />;
  return <ScreenHome />;
}

export function Audiences() {
  const [active, setActive] = useState<AudienceKey>(ORDER[0]);
  const a = AUDIENCES[active];
  // Live / home / community screens sit on the dark indica backdrop;
  // everything else gets the soft green gradient.
  const darkScreen = a.screen === "live" || a.screen === "home";

  return (
    <section id="audiences" className="bg-forest-50 px-[4vw] py-[clamp(64px,9vw,130px)]">
      <div className="mx-auto w-[min(1180px,92vw)]">
        <SectionHead
          kicker="Built for both sides of the counter"
          title="One platform, three points of view"
          lede="Licensed producers, the retailers they sell through, and the budtenders in between — Sprout is being built for all three."
        />

        {/* Pill tab group */}
        <div className="mt-8 flex justify-center">
          <div className="inline-flex gap-1 rounded-full border border-border bg-surface p-[5px] shadow-sm">
            {ORDER.map((key) => {
              const { tab, TabIcon } = AUDIENCES[key];
              const isActive = active === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActive(key)}
                  aria-pressed={isActive}
                  className={
                    "inline-flex items-center gap-2 rounded-full px-[22px] py-[11px] font-sans text-sm font-semibold transition-all duration-200 ease-out " +
                    (isActive
                      ? "bg-indica-green text-cream"
                      : "text-text-secondary hover:text-text")
                  }
                >
                  <TabIcon size={17} />
                  {tab}
                </button>
              );
            })}
          </div>
        </div>

        {/* Active panel */}
        <div
          key={active}
          className="animate-fade mt-12 grid items-center gap-8 rounded-xl border border-border bg-surface p-8 shadow-md md:grid-cols-2 md:gap-16 md:p-14"
        >
          <div>
            <span className="font-body text-[11px] font-semibold uppercase leading-none tracking-[0.14em] text-growth">
              {a.eyebrow}
            </span>
            <h3 className="mt-3 font-display text-3xl leading-[1.05] tracking-[0.005em] text-text sm:text-4xl lg:text-5xl">
              {a.h}
            </h3>
            <p className="mt-4 font-editorial text-lg leading-relaxed text-text-secondary sm:text-xl">
              {a.lede}
            </p>

            <ul className="mt-6 grid gap-4">
              {a.points.map(([PointIcon, title, desc]) => (
                <li key={title} className="flex items-start gap-3.5">
                  <span className="grid size-[38px] shrink-0 place-items-center rounded-sm bg-success-bg text-growth">
                    <PointIcon size={19} />
                  </span>
                  <div>
                    <div className="font-sans text-[15px] font-semibold leading-tight text-text">
                      {title}
                    </div>
                    <div className="mt-[3px] font-sans text-sm leading-snug text-text-secondary">
                      {desc}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#get-access-paths"
                className={cn(buttonVariants({ variant: "strong", size: "lg" }))}
              >
                {a.ctaPrimary}
                <ArrowRight size={17} />
              </a>
            </div>
          </div>

          {/* Phone backdrop + screen */}
          <div className="grid place-items-center">
            <div
              className={
                "relative grid w-full place-items-center overflow-hidden rounded-xl p-8 sm:p-12 " +
                (darkScreen
                  ? "bg-indica-green"
                  : "bg-gradient-to-br from-forest-100 to-sativa-green")
              }
            >
              {darkScreen ? (
                <div
                  aria-hidden="true"
                  className="absolute inset-0 bg-cover opacity-50"
                  style={{ backgroundImage: "var(--texture-dark-arcs)" }}
                />
              ) : null}
              <div className="relative z-[2]">
                <AudScreen name={a.screen} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
