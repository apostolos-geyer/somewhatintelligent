import lockupCream from "@greenroom/design/assets/logos/sprout-lockup-cream.png";

const COLS: [string, string[]][] = [
  ["Platform", ["Community", "Learning", "Rewards", "Live & media"]],
  ["Audiences", ["Licensed Producers", "Retailers", "Budtenders"]],
  ["Early access", ["Join the list", "For LPs", "For retailers"]],
];

export function Footer() {
  return (
    <footer className="bg-charcoal py-[clamp(48px,6vw,80px)] pb-10 text-forest-300">
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="flex flex-wrap items-start justify-between gap-10">
          <div>
            <img src={lockupCream.src} alt="Sprout" className="h-[30px] w-auto" />
            <p className="mt-[14px] font-accent text-base text-sprout-green">
              Learn green, earn green.
            </p>
          </div>

          <div className="flex flex-wrap gap-[clamp(40px,6vw,90px)]">
            {COLS.map(([heading, items]) => (
              <div key={heading}>
                <h5 className="mb-[14px] font-body text-[11px] font-semibold uppercase leading-none tracking-[0.14em] text-kief">
                  {heading}
                </h5>
                <div className="flex flex-col">
                  {items.map((it) => (
                    <a
                      key={it}
                      href="#top"
                      className="font-body text-sm font-[450] leading-[2.1] text-forest-300 no-underline transition-colors hover:text-cream"
                    >
                      {it}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="mt-5 max-w-[70ch] font-body text-xs leading-[1.6] text-stoned">
          Sprout is in early development. Nothing on this page is a live product yet — the platform
          screens shown are illustrative mockups of what we&apos;re building. Join the early-access
          list and we&apos;ll be in touch as features become available.
        </p>

        <div className="mt-[clamp(40px,5vw,64px)] flex flex-wrap justify-between gap-4 border-t border-cream/10 pt-6 font-body text-xs text-kief">
          <span>© 2026 Sprout · Made in Canada</span>
          <span>Budtender engagement platform · For Canadian LPs &amp; retailers</span>
        </div>
      </div>
    </footer>
  );
}
