/**
 * Device-frame primitives for the marketing app-screen mockups.
 *
 * Faithful to the Sprout prototype's `phones.css`: a 300×620 device with a
 * 46px bezel radius, a 36px inner-screen radius and a pill notch. The bezel
 * and notch are the device chrome — the ONE allowed literal is the bezel
 * black `#0a0a0a`. Every surface inside the screen reads from a design-system
 * token (cream / indica / forest / white), never an arbitrary hex.
 *
 * `screens.tsx` (next wave) composes these: it renders a `<Phone>` and fills
 * the screen with `<StatusBar />`, scroll content and a `<TabBar />`.
 */
import { GraduationCap, Gift, Home, Trophy } from "./icons";

/** The only allowed literal — physical device chrome (bezel + notch). */
const BEZEL = "#0a0a0a";

/* ─────────────────────────── Status bar ─────────────────────────── */

/**
 * iOS-style status bar: time + signal / wifi / battery glyphs.
 * `dark` renders cream-on-dark; default renders indica-on-light.
 */
export function StatusBar({ dark = false }: { dark?: boolean }) {
  const tone = dark ? "text-cream" : "text-indica-green";
  return (
    <div
      className={`relative z-20 flex items-center justify-between px-[22px] pb-1 pt-3.5 font-sans text-[13px] font-semibold ${tone}`}
    >
      <span>9:41</span>
      <div className="flex items-center gap-[5px]">
        {/* signal */}
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
          style={{ width: 15, height: 15 }}
        >
          <rect x="1" y="14" width="3" height="6" rx="1" />
          <rect x="6" y="10" width="3" height="10" rx="1" />
          <rect x="11" y="6" width="3" height="14" rx="1" />
          <rect x="16" y="3" width="3" height="17" rx="1" opacity=".4" />
        </svg>
        {/* wifi */}
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
          style={{ width: 15, height: 15 }}
        >
          <path d="M12 4C7 4 2.7 6 0 9l12 15L24 9c-2.7-3-7-5-12-5z" opacity=".95" />
        </svg>
        {/* battery */}
        <svg
          viewBox="0 0 28 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
          style={{ width: 20, height: 15 }}
        >
          <rect x="1" y="6" width="20" height="12" rx="3" />
          <rect x="3" y="8" width="14" height="8" rx="1.5" fill="currentColor" stroke="none" />
          <rect x="23" y="10" width="2" height="4" rx="1" fill="currentColor" stroke="none" />
        </svg>
      </div>
    </div>
  );
}

/* ──────────────────────────── Tab bar ───────────────────────────── */

const TABS = [
  { key: "Home", label: "Home", Icon: Home },
  { key: "Learn", label: "Learn", Icon: GraduationCap },
  { key: "Rewards", label: "Rewards", Icon: Gift },
  { key: "Ranks", label: "Ranks", Icon: Trophy },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

/**
 * Floating bottom tab bar (Home / Learn / Rewards / Ranks). The active tab is
 * growth-green; the rest are forest-400. Sits on a white pill above the screen.
 */
export function TabBar({ active }: { active: TabKey }) {
  return (
    <div className="absolute inset-x-3.5 bottom-3.5 z-[25] flex items-center justify-around rounded-[26px] bg-paper-0 px-1.5 pb-2 pt-[9px] shadow-lg">
      {TABS.map(({ key, label, Icon }) => {
        const on = active === key;
        return (
          <div
            key={key}
            className={`grid justify-items-center gap-[3px] font-sans text-[9.5px] font-semibold ${
              on ? "text-growth-green" : "text-forest-400"
            }`}
          >
            <Icon size={21} strokeWidth={2} />
            <span>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────────── Phone ────────────────────────────── */

/**
 * The device shell. Wraps screen content in the bezel + notch and the rounded
 * inner screen. `dark` flips the inner-screen surface to the indica canvas
 * (and tags it `data-theme="dark"` so semantic tokens inside flip too); the
 * default is the cream light surface.
 */
export function Phone({
  children,
  dark = false,
  className = "",
}: {
  children: React.ReactNode;
  dark?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`relative mx-auto shrink-0 ${className}`}
      style={{
        width: 300,
        height: 620,
        background: BEZEL,
        borderRadius: 46,
        padding: 11,
        boxShadow: "0 30px 60px -18px rgba(0,36,13,.5), 0 0 0 2px rgba(0,0,0,.6)",
      }}
    >
      {/* notch */}
      <div
        className="absolute left-1/2 top-[11px] z-30 -translate-x-1/2 rounded-full"
        style={{ width: 96, height: 26, background: BEZEL }}
      />
      <div
        {...(dark ? { "data-theme": "dark" } : {})}
        className={`relative h-full w-full overflow-hidden ${
          dark ? "bg-indica-green" : "bg-cream"
        }`}
        style={{ borderRadius: 36 }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Back-compat alias for the previous single-prop frame. Prefer `Phone`.
 * @deprecated use `Phone` (with `StatusBar` / `TabBar`) instead.
 */
export function PhoneFrame({ children }: { children: React.ReactNode }) {
  return <Phone className="animate-float">{children}</Phone>;
}
