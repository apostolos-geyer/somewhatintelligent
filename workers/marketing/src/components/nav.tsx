import { useEffect, useState } from "react";

import { buttonVariants } from "@greenroom/ui/components/button";
import { cn } from "@greenroom/ui/lib/utils";

import lockup from "@greenroom/design/assets/logos/sprout-lockup-cream.png";

/**
 * Top-of-page nav links. Each scrolls smoothly to its section anchor on the
 * marketing page (Platform / Audiences / Community / How it works).
 */
const LINKS = [
  { id: "platform", label: "Platform" },
  { id: "audiences", label: "For LPs & retailers" },
  { id: "community", label: "Community" },
  { id: "how", label: "How it works" },
] as const;

/** Smooth-scroll to an in-page section by id (the prototype's scrollTo). */
function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * Fixed marketing header. Hydrated as an Astro island (`client:load`) so the
 * scroll listener runs in the browser. Transparent over the dark hero; on
 * scroll past 40px it gains a translucent indica blur, a soft cream hairline
 * and tighter padding. `identityUrl` is computed at build time in index.astro
 * from @greenroom/config and passed in as a serializable prop, used here for
 * the optional Sign in link.
 */
export function Nav({ identityUrl }: { identityUrl?: string }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      data-theme="dark"
      className={cn(
        "fixed inset-x-0 top-0 z-50 border-b border-transparent transition-[background-color,border-color,padding] duration-300 ease-out",
        scrolled
          ? "border-cream/8 bg-indica-green/82 py-3 backdrop-blur-md backdrop-saturate-150"
          : "py-[18px]",
      )}
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-6 px-6">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            scrollToId("top");
          }}
          className="flex items-center"
        >
          <img src={lockup.src} alt="Sprout" className="h-[30px] w-auto" />
        </a>

        <div className="hidden items-center gap-[30px] min-[860px]:flex">
          {LINKS.map((l) => (
            <a
              key={l.id}
              href={`#${l.id}`}
              onClick={(e) => {
                e.preventDefault();
                scrollToId(l.id);
              }}
              className="text-sm font-medium text-cream/70 transition-colors duration-150 hover:text-cream"
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {identityUrl ? (
            <a
              href={identityUrl}
              className="hidden text-sm font-medium text-cream/70 transition-colors duration-150 hover:text-cream min-[860px]:inline-flex"
            >
              Sign in
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => scrollToId("get-access")}
            className={cn(buttonVariants({ variant: "default", size: "sm" }))}
          >
            Get early access
          </button>
        </div>
      </div>
    </nav>
  );
}
