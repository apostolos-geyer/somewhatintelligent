/**
 * Hero — the dark forest top of the marketing page (sections-a.jsx `Hero`,
 * site.css `.hero*`).
 *
 * `data-theme="dark"` on the <header> root flips SEMANTIC tokens, so
 * `text-text-secondary` reads as the on-dark muted cream and accents brighten.
 * The canvas is the raw `bg-indica-green` (theme-invariant deep ink).
 *
 * Three stacked decorative layers (absolute, pointer-events-none):
 *   1. the two radial-gradient glows from `.hero::before`
 *      (growth-green/42 top-right + sprout-green/12 bottom-left),
 *   2. the green-waves texture (opacity-30, mix-blend-screen),
 *   3. the faint sprout-icon watermark (right, opacity .05, brightness 300).
 */
import { SignupForm } from "./signup-form";
import { ScreenHome } from "./screens";
import { Building2, ShieldCheck, Sprout } from "./icons";

const TRUST = [
  { Icon: Building2, label: "For LPs & dispensaries" },
  { Icon: ShieldCheck, label: "Built with the rules in mind" },
  { Icon: Sprout, label: "Launching soon" },
] as const;

export function Hero() {
  return (
    <header
      data-theme="dark"
      id="top"
      className="relative overflow-hidden bg-indica-green text-cream"
    >
      {/* 1 — radial-gradient glows (.hero::before) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 88% 8%, color-mix(in srgb, var(--color-growth-green) 42%, transparent), transparent 55%), radial-gradient(90% 80% at 6% 100%, color-mix(in srgb, var(--color-sprout-green) 12%, transparent), transparent 50%)",
        }}
      />
      {/* 2 — green-waves texture */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-30 mix-blend-screen"
        style={{ backgroundImage: "var(--texture-green-waves)" }}
      />
      {/* 3 — sprout watermark */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[-8%] top-1/2 w-[60%] max-w-[720px] -translate-y-1/2 bg-contain bg-right bg-no-repeat opacity-[.05] brightness-[3]"
        style={{
          aspectRatio: "1 / 1",
          backgroundImage: "var(--texture-sprout-watermark)",
        }}
      />

      <div className="relative z-[2] mx-auto grid w-[min(1180px,92vw)] items-center gap-8 pb-[clamp(80px,10vw,120px)] pt-[clamp(140px,17vh,200px)] lg:gap-[clamp(32px,5vw,80px)] lg:grid-cols-[1.05fr_0.95fr]">
        {/* ── left: copy ── */}
        <div className="animate-fade-up">
          <span className="inline-flex items-center gap-2 font-body text-[11px] font-semibold uppercase leading-tight tracking-[0.16em] text-sprout-green">
            <span className="size-1.5 rounded-full bg-current" />
            Early access · Building in Canada
          </span>

          <h1 className="mt-[18px] max-w-[12ch] font-display text-[clamp(48px,7vw,88px)] leading-[0.98] tracking-[0.01em]">
            Where brands and <span className="text-sprout-green">budtenders grow together</span>
          </h1>

          <p className="mt-[22px] font-accent text-[19px] tracking-[0.01em] text-sprout-green">
            Learn green, earn green.
          </p>

          <p className="mt-[18px] max-w-[46ch] font-editorial text-xl leading-[1.55] text-text-secondary">
            Sprout is a budtender engagement platform for Canadian licensed producers — and the
            retailers they sell through. We&apos;re building a place for learning, community and
            rewards, so brands and the people behind the counter can connect directly.
          </p>

          <div id="get-access">
            <SignupForm />
          </div>

          <div className="mt-[26px] flex flex-wrap items-center gap-[18px]">
            {TRUST.map(({ Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-[7px] font-body text-xs text-text-secondary"
              >
                <Icon size={15} className="text-sprout-green" />
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* ── right: phone ── */}
        <div className="grid min-h-0 place-items-center lg:min-h-[540px]">
          <ScreenHome />
        </div>
      </div>
    </header>
  );
}
